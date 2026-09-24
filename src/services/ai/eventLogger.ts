import { TaskNode } from '../../types/todo';
import { TaskEvent, TaskEventType } from '../../types/ai';
import { getAncestorNodes, getDescendantTasks } from '../treeOperations';

const EVENTS_STORAGE_KEY = 'todotree_task_events_v1';
let cachedEvents: TaskEvent[] | null = null;

function generateEventId(): string {
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

export async function loadEventsFromStorage(): Promise<TaskEvent[]> {
  if (cachedEvents) return cachedEvents;

  // 1. Try fetching from desktop host /api/events
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const resp = await fetch('/api/events', { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        cachedEvents = data;
        try {
          localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(data));
        } catch {}
        return data;
      }
    }
  } catch {
    // Desktop API not reachable or timed out
  }

  // 2. Fallback to localStorage
  try {
    const local = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) {
        cachedEvents = parsed;
        return parsed;
      }
    }
  } catch {}

  cachedEvents = [];
  return [];
}

export async function saveEventsToStorage(events: TaskEvent[]): Promise<void> {
  cachedEvents = events;
  try {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  } catch {}

  try {
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(events),
    }).catch(() => {});
  } catch {}
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
