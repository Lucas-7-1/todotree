import { TaskNode } from '../../types/todo';
import { TaskEvent, TaskEventType } from '../../types/ai';
import { getAncestorNodes, getDescendantTasks } from '../treeOperations';

import { loadWorkspace, commitWorkspace } from '../durableStore';
function generateEventId(): string { return 'evt_' + crypto.randomUUID(); }
export async function loadEventsFromStorage(): Promise<TaskEvent[]> {
  return (await loadWorkspace()).data.events;
}
export async function saveEventsToStorage(events: TaskEvent[]): Promise<void> {
  // Legacy migration may append baseline events, but can never overwrite newer history.
  await commitWorkspace(data => {
    const known = new Set(data.events.map(e => e.event_id));
    return { ...data, events: [...data.events, ...events.filter(e => !known.has(e.event_id))] };
  });
}

export async function logTaskEvent(
  eventData: Omit<TaskEvent, 'event_id' | 'timestamp'>
): Promise<TaskEvent> {
  const events = await loadEventsFromStorage();
  const newEvent: TaskEvent = {
    ...eventData,
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
  };

  events.push(newEvent);
  await saveEventsToStorage(events);
  return newEvent;
}

export async function logTaskCompletion(
  task: TaskNode,
  allTasks: TaskNode[],
  outcomeNote?: string,
  batchId?: string
): Promise<TaskEvent> {
  const ancestors = getAncestorNodes(allTasks, task);
  const pathIds = ancestors.map((a) => a.id);
  const pathTitles = ancestors.map((a) => a.title);

  // Check if it's leaf node
  const children = allTasks.filter(
    (t) => !t.deleted_at && t.parent_id === task.id
  );
  const isLeaf = children.length === 0;

  return logTaskEvent({
    task_id: task.id,
    instance_id: task.instance_id || task.id,
    event_type: 'task_completed',
    before_value: { status: 'open' },
    after_value: { status: 'done', completed_at: task.completed_at },
    operation_batch_id: batchId,
    path_ids_at_completion: pathIds,
    path_titles_at_completion: pathTitles,
    title: task.title,
    outcome_note: outcomeNote || task.outcome_note || '',
    recurrence_rule_id: task.recurrence_rule_id || null,
    occurrence_key: task.recurrence_period_key || null,
    is_leaf_at_completion: isLeaf,
  });
}

export interface BatchCompletionItem {
  task: TaskNode;
  outcomeNote?: string;
  isClosure?: boolean;
}

export async function logTaskCompletionsBatch(
  items: (BatchCompletionItem | TaskNode)[],
  allTasks: TaskNode[],
  batchIdOrOutcomeMap?: string | Record<string, string>,
  customBatchId?: string
): Promise<TaskEvent[]> {
  if (items.length === 0) return [];
  const events = await loadEventsFromStorage();
  const createdEvents: TaskEvent[] = [];
  const now = new Date().toISOString();

  let batchId = 'batch_' + Date.now();
  let outcomeMap: Record<string, string> = {};

  if (typeof batchIdOrOutcomeMap === 'string') {
    batchId = batchIdOrOutcomeMap;
  } else if (batchIdOrOutcomeMap && typeof batchIdOrOutcomeMap === 'object') {
    outcomeMap = batchIdOrOutcomeMap;
    if (customBatchId) batchId = customBatchId;
  }

  for (const item of items) {
    const isItemObject = 'task' in item;
    const task: TaskNode = isItemObject ? item.task : item;
    const outcomeNote: string = isItemObject
      ? item.outcomeNote || ''
      : outcomeMap[task.id] || task.outcome_note || '';
    const isClosure: boolean | undefined = isItemObject ? item.isClosure : undefined;

    const ancestors = getAncestorNodes(allTasks, task);
    const pathIds = ancestors.map((a) => a.id);
    const pathTitles = ancestors.map((a) => a.title);

    let isLeaf = true;
    if (isClosure !== undefined) {
      isLeaf = !isClosure;
    } else {
      const children = allTasks.filter(
        (t) => !t.deleted_at && t.parent_id === task.id
      );
      isLeaf = children.length === 0;
    }

    const newEvent: TaskEvent = {
      event_id: generateEventId(),
      timestamp: task.completed_at || now,
      task_id: task.id,
      instance_id: task.instance_id || task.id,
      event_type: 'task_completed',
      before_value: { status: 'open' },
      after_value: { status: 'done', completed_at: task.completed_at || now },
      operation_batch_id: batchId,
      path_ids_at_completion: pathIds,
      path_titles_at_completion: pathTitles,
      title: task.title,
      outcome_note: outcomeNote || task.outcome_note || '',
      recurrence_rule_id: task.recurrence_rule_id || null,
      occurrence_key: task.recurrence_period_key || null,
      is_leaf_at_completion: isLeaf,
    };

    events.push(newEvent);
    createdEvents.push(newEvent);
  }

  await saveEventsToStorage(events);
  return createdEvents;
}

export async function logTaskUncomplete(
  task: TaskNode,
  allTasks: TaskNode[],
  batchId?: string
): Promise<TaskEvent> {
  return logTaskEvent({
    task_id: task.id,
    instance_id: task.instance_id || task.id,
    event_type: 'task_uncompleted',
    before_value: { status: 'done', completed_at: task.completed_at },
    after_value: { status: 'open', completed_at: null },
    operation_batch_id: batchId,
  });
}

export async function logTaskUncompletionsBatch(
  tasksOrIds: (TaskNode | string)[],
  allTasks: TaskNode[] = [],
  batchId: string = 'uncomplete_batch_' + Date.now()
): Promise<TaskEvent[]> {
  if (tasksOrIds.length === 0) return [];
  const events = await loadEventsFromStorage();
  const createdEvents: TaskEvent[] = [];
  const now = new Date().toISOString();

  for (const item of tasksOrIds) {
    const task = typeof item === 'string' ? allTasks.find((t) => t.id === item) : item;
    const taskId = typeof item === 'string' ? item : item.id;
    const newEvent: TaskEvent = {
      event_id: generateEventId(),
      timestamp: now,
      task_id: taskId,
      instance_id: task?.instance_id || taskId,
      event_type: 'task_uncompleted',
      before_value: { status: 'done', completed_at: task?.completed_at || null },
      after_value: { status: 'open', completed_at: null },
      operation_batch_id: batchId,
    };
    events.push(newEvent);
    createdEvents.push(newEvent);
  }

  await saveEventsToStorage(events);
  return createdEvents;
}

/**
 * Migration helper: If tasks exist with completed_at but have no event history in task_events,
 * register initial baseline completion events without forging dates (PRD 3.4).
 */
export async function migrateLegacyCompletedTasks(tasks: TaskNode[]): Promise<void> {
  const events = await loadEventsFromStorage();
  const recordedTaskIds = new Set(events.map((e) => e.task_id));

  let modified = false;
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at && !recordedTaskIds.has(t.id)) {
      const ancestors = getAncestorNodes(tasks, t);
      const isLeaf = tasks.filter((sub) => !sub.deleted_at && sub.parent_id === t.id).length === 0;
      events.push({
        event_id: generateEventId(),
        task_id: t.id,
        instance_id: t.instance_id || t.id,
        timestamp: t.completed_at, // Use real completed_at
        event_type: 'task_completed',
        before_value: { status: 'open' },
        after_value: { status: 'done', completed_at: t.completed_at },
        path_ids_at_completion: ancestors.map((a) => a.id),
        path_titles_at_completion: ancestors.map((a) => a.title),
        title: t.title,
        outcome_note: t.outcome_note || '',
        recurrence_rule_id: t.recurrence_rule_id || null,
        occurrence_key: t.recurrence_period_key || null,
        is_leaf_at_completion: isLeaf,
      });
      modified = true;
    }
  }

  if (modified) {
    await saveEventsToStorage(events);
  }
}
