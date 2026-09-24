import { TaskNode } from '../types/todo';
import { getNodeDepth } from './treeOperations';

function indexTasks(tasks: TaskNode[]) {
  const byId = new Map(tasks.filter(t => !t.deleted_at).map(t => [t.id, t]));
  const children = new Map<string, TaskNode[]>();
  for (const task of byId.values()) {
    if (!task.parent_id) continue;
    const siblings = children.get(task.parent_id) || [];
    siblings.push(task);
    children.set(task.parent_id, siblings);
  }
  const subtree = (id: string) => {
    const ids = new Set<string>();
    const queue = [id];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (ids.has(current) || !byId.has(current)) continue;
      ids.add(current);
      for (const child of children.get(current) || []) queue.push(child.id);
    }
    return ids;
  };
  return { byId, children, subtree };
}

/** Completion is a fact; archiving only controls workspace visibility. */
export function completeTaskBranch(tasks: TaskNode[], id: string, outcomeNote?: string) {
  const { byId, children, subtree } = indexTasks(tasks);
  const target = byId.get(id);
  if (!target || target.status !== 'open') {
    return { tasks, completedTasks: [], autoClosedIds: [] as string[] };
  }
  const completing = new Set([...subtree(id)].filter(key => byId.get(key)!.status === 'open'));
  const autoClosedIds: string[] = [];
  let parentId = target.parent_id;
  const visited = new Set<string>([id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    const siblings = children.get(parentId) || [];
    if (!siblings.length || !siblings.every(t => t.status === 'done' || completing.has(t.id))) break;
    if (parent.status === 'open') {
      completing.add(parentId);
      autoClosedIds.push(parentId);
    }
    parentId = parent.parent_id;
  }

  // A closed branch leaves together. A lone completed child stays under its open parent.
  const archiveRoot = autoClosedIds[autoClosedIds.length - 1] ||
    ((children.get(id)?.length || !target.parent_id || byId.get(target.parent_id)?.status === 'done') ? id : null);
  const archiving = archiveRoot ? subtree(archiveRoot) : new Set<string>();
  const now = new Date().toISOString();
  const next = tasks.map(task => {
    if (!completing.has(task.id) && !archiving.has(task.id)) return task;
    return {
      ...task,
      status: 'done' as const,
      completed_at: completing.has(task.id) ? now : task.completed_at,
      archived_at: archiving.has(task.id) ? task.archived_at || now : null,
      outcome_note: task.id === id ? outcomeNote ?? task.outcome_note ?? '' : task.outcome_note,
      updated_at: now,
    };
  });
  return { tasks: next, completedTasks: next.filter(t => completing.has(t.id)), autoClosedIds };
}

/** “搞定” archives an already completed item without completing/logging it a second time. */
export function archiveCompletedBranch(tasks: TaskNode[], id: string): TaskNode[] {
  const { byId, subtree } = indexTasks(tasks);
  const target = byId.get(id);
  if (!target || target.status !== 'done' || target.archived_at) return tasks;
  const ids = subtree(id);
  if ([...ids].some(key => byId.get(key)!.status !== 'done')) return tasks;
  const now = new Date().toISOString();
  return tasks.map(t => ids.has(t.id) ? { ...t, archived_at: t.archived_at || now, updated_at: now } : t);
}

/** Reopening a child also reopens its closed ancestors, preserving the tree invariant. */
export function reopenTaskBranch(tasks: TaskNode[], id: string, includeDescendants = false): TaskNode[] {
  const { byId, subtree } = indexTasks(tasks);
  if (!byId.has(id)) return tasks;
  const ids = includeDescendants ? subtree(id) : new Set<string>([id]);
  let parentId = byId.get(id)!.parent_id;
  const visited = new Set<string>([id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ids.add(parentId);
    parentId = parent.parent_id;
  }
  const now = new Date().toISOString();
  return tasks.map(t => ids.has(t.id) && (t.status === 'done' || t.archived_at)
    ? { ...t, status: 'open', completed_at: null, archived_at: null, updated_at: now }
    : t);
}

/** Used by every creation entry point, including nested inline drafts. */
export function insertTaskNode(tasks: TaskNode[], task: TaskNode): TaskNode[] {
  if (!task.title.trim()) throw new Error('任务名称不能为空');
  if (tasks.some(t => t.id === task.id)) throw new Error('任务已经存在，请勿重复添加');
  let next = tasks;
  if (task.parent_id) {
    const parent = tasks.find(t => t.id === task.parent_id && !t.deleted_at);
    if (!parent) throw new Error('父任务已不存在，请重新选择');
    if (getNodeDepth(tasks, parent) >= 5) throw new Error('已达到最大层级深度（5 层）');
    next = reopenTaskBranch(tasks, parent.id);
  }
  return [...next, { ...task, title: task.title.trim(), status: 'open', completed_at: null, archived_at: null }];
}
