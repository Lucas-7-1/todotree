import { TaskNode } from '../types/todo';
import { TaskEvent } from '../types/ai';

/** Derive history from the same before/after snapshot that is committed to disk. */
export function buildTransitionEvents(before: TaskNode[], after: TaskNode[], operationId: string = crypto.randomUUID()): TaskEvent[] {
  const previous = new Map(before.map(t => [t.id, t]));
  const byId = new Map(after.map(t => [t.id, t]));
  const parents = new Set(after.filter(t => !t.deleted_at).map(t => t.parent_id));
  const result: TaskEvent[] = [];
  for (const task of after) {
    const old = previous.get(task.id);
    if (task.deleted_at || old?.status === task.status || (!old && task.status !== 'done')) continue;
    const ancestors: TaskNode[] = [];
    const visited = new Set([task.id]);
    let parent = task.parent_id;
    while (parent && !visited.has(parent) && byId.has(parent)) {
      visited.add(parent); const node = byId.get(parent)!; ancestors.unshift(node); parent = node.parent_id;
    }
    const done = task.status === 'done';
    result.push({
      event_id: 'evt_' + crypto.randomUUID(), task_id: task.id, instance_id: task.instance_id || task.id,
      event_type: done ? 'task_completed' : 'task_uncompleted', timestamp: done ? task.completed_at || new Date().toISOString() : new Date().toISOString(),
      operation_batch_id: operationId,
      before_value: { status: old?.status || 'open', completed_at: old?.completed_at || null },
      after_value: { status: task.status, completed_at: task.completed_at },
      title: task.title, outcome_note: task.outcome_note || '',
      path_ids_at_completion: ancestors.map(t => t.id), path_titles_at_completion: ancestors.map(t => t.title),
      is_leaf_at_completion: !parents.has(task.id), recurrence_rule_id: task.recurrence_rule_id || null,
      occurrence_key: task.recurrence_period_key || null,
    });
  }
  return result;
}
