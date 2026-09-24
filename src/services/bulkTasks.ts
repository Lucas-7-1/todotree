import { TaskNode, QuadrantType } from '../types/todo';
import { completeTaskBranches, archiveCompletedBranch } from './taskLifecycle';

export type BulkAction = { type: 'complete' | 'archive' | 'delete' } |
  { type: 'quadrant'; value: QuadrantType } | { type: 'due'; value: string | null } |
  { type: 'today'; value: string | null };

/** Selection is explicit; descendants are expanded only for subtree commands. */
export function applyBulkAction(tasks: TaskNode[], ids: string[], action: BulkAction) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const selected = new Set(ids);
  if (!selected.size) return { tasks, changedCount: 0, autoCompletedCount: 0, skippedCount: 0 };
  for (const id of selected) if (!byId.has(id) || byId.get(id)!.deleted_at || byId.get(id)!.archived_at)
    throw new Error('部分所选任务已归档或删除，请重新选择');
  if (action.type === 'due' && action.value && !/^\d{4}-\d{2}-\d{2}$/.test(action.value)) throw new Error('请选择有效日期');
  const roots = [...selected].filter(id => {
    const visited = new Set([id]);
    let parent = byId.get(id)!.parent_id;
    while (parent && byId.has(parent) && !visited.has(parent)) {
      if (selected.has(parent)) return false;
      visited.add(parent); parent = byId.get(parent)!.parent_id;
    }
    return true;
  });
  const children = new Map<string, string[]>();
  for (const task of tasks) if (task.parent_id && !task.deleted_at) {
    const list = children.get(task.parent_id) || []; list.push(task.id); children.set(task.parent_id, list);
  }
  const affected = new Set<string>();
  const subtreeAction = ['complete', 'archive', 'delete'].includes(action.type);
  const queue = subtreeAction ? [...roots] : [...selected];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; if (affected.has(id)) continue;
    affected.add(id); if (subtreeAction) queue.push(...(children.get(id) || []));
  }
  const now = new Date().toISOString();
  let next = tasks;
  if (action.type === 'complete') {
    next = completeTaskBranches(tasks, roots).tasks;
  } else if (action.type === 'archive') {
    if ([...affected].some(id => byId.get(id)!.status !== 'done')) throw new Error('仍有未完成子任务，不能搞定归档');
    next = tasks.map(t => affected.has(t.id) && !t.archived_at ? { ...t, archived_at: now, updated_at: now } : t);
  } else {
    const batch = action.type === 'delete' ? 'delete_' + crypto.randomUUID() : '';
    next = tasks.map(t => {
      if (!affected.has(t.id)) return t;
      switch (action.type) {
        case 'delete': return { ...t, deleted_at: now, deletion_batch_id: batch, updated_at: now };
        case 'quadrant': return t.quadrant === action.value ? t : { ...t, quadrant: action.value, updated_at: now };
        case 'due': return { ...t, due_type: action.value ? 'date' as const : 'none' as const, due_date: action.value, due_at: null, updated_at: now };
        case 'today': return t.planned_date === action.value ? t : { ...t, planned_date: action.value, updated_at: now };
        default: return t;
      }
    });
  }
  const changed = next.filter(t => t !== byId.get(t.id));
  return {
    tasks: changed.length ? next : tasks, changedCount: changed.length,
    autoCompletedCount: changed.filter(t => !affected.has(t.id) && t.status === 'done' && byId.get(t.id)?.status === 'open').length,
    skippedCount: action.type === 'complete' ? [...selected].filter(id => byId.get(id)?.status === 'done').length : 0,
  };
}
