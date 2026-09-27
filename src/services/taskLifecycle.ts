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
  return completeTaskBranches(tasks, [id], { [id]: outcomeNote });
}

/** Calculate a batch once, using parent counters instead of rescanning the tree per task. */
export function completeTaskBranches(tasks: TaskNode[], ids: string[], notes: Record<string, string | undefined> = {}) {
  const { byId, children, subtree } = indexTasks(tasks);
  const targets = ids.map(id => byId.get(id)).filter((t): t is TaskNode => !!t && t.status === 'open');
  const completing = new Set<string>();
  const visited = new Set<string>();
  const queue = targets.map(t => t.id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; if (visited.has(id)) continue; visited.add(id);
    if (byId.get(id)!.status === 'open') completing.add(id);
    queue.push(...(children.get(id) || []).map(t => t.id));
  }
  if (!completing.size) return { tasks, completedTasks: [] as TaskNode[], autoClosedIds: [] as string[], newlyArchivedIds: [] as string[] };
  const remaining = new Map([...children].map(([id, list]) => [id, list.filter(t => t.status === 'open').length]));
  const completedQueue = [...completing];
  const autoClosedIds: string[] = [];
  for (let i = 0; i < completedQueue.length; i++) {
    const parentId = byId.get(completedQueue[i])?.parent_id;
    if (!parentId || !byId.has(parentId)) continue;
    const count = (remaining.get(parentId) || 0) - 1;
    remaining.set(parentId, count);
    if (count === 0 && byId.get(parentId)!.status === 'open' && !completing.has(parentId)) {
      completing.add(parentId); completedQueue.push(parentId); autoClosedIds.push(parentId);
    }
  }
  const roots = new Set<string>();
  for (const target of targets) {
    let root = target; const chain = new Set<string>();
    while (root.parent_id && byId.has(root.parent_id) && !chain.has(root.id)) {
      chain.add(root.id); root = byId.get(root.parent_id)!;
    }
    roots.add(root.id);
  }
  const archiving = new Set<string>();
  for (const root of roots) {
    const wholeTree = subtree(root);
    if ([...wholeTree].every(id => byId.get(id)!.status === 'done' || completing.has(id)))
      wholeTree.forEach(id => archiving.add(id));
  }
  const now = new Date().toISOString();
  const next = tasks.map(task => {
    if (!completing.has(task.id) && (!archiving.has(task.id) || task.archived_at)) return task;
    return { ...task, status: 'done' as const,
      completed_at: completing.has(task.id) ? now : task.completed_at,
      archived_at: archiving.has(task.id) ? task.archived_at || now : null,
      outcome_note: notes[task.id] ?? task.outcome_note,
      updated_at: now,
    };
  });
  return { tasks: next, completedTasks: next.filter(t => completing.has(t.id)), autoClosedIds, newlyArchivedIds: next.filter(t => !byId.get(t.id)?.archived_at && t.archived_at).map(t => t.id) };
}

export interface ArchiveBranchResult {
  tasks: TaskNode[];
  newlyArchivedIds: string[];
  error?: string;
}

/**
 * “搞定” button: archives an already completed item without re-logging completion.
 * PRD Section 2.5:
 * - Must validate that the target and all its descendants are done (status === 'done').
 * - If incomplete descendants exist, reject archiving and return error "仍有未完成子任务".
 * - Returns a plain result without mutating the input task array.
 */
export function archiveCompletedBranch(tasks: TaskNode[], id: string): ArchiveBranchResult {
  const { byId, subtree } = indexTasks(tasks);
  const target = byId.get(id);

  const makeResult = (taskList: TaskNode[], newlyArchivedIds: string[], error?: string): ArchiveBranchResult =>
    ({ tasks: taskList, newlyArchivedIds, ...(error ? { error } : {}) });

  if (!target) {
    return makeResult(tasks, [], '任务不存在');
  }
  if (target.status !== 'done') {
    return makeResult(tasks, [], '任务尚未完成，无法归档');
  }
  if (target.archived_at) {
    return makeResult(tasks, []);
  }

  const ids = subtree(id);
  const hasIncompleteDescendant = [...ids].some(key => {
    const node = byId.get(key);
    return node && node.status !== 'done';
  });

  if (hasIncompleteDescendant) {
    return makeResult(tasks, [], '仍有未完成子任务');
  }

  const now = new Date().toISOString();
  const newlyArchivedIds: string[] = [];
  const next = tasks.map(t => {
    if (ids.has(t.id) && !t.archived_at) {
      newlyArchivedIds.push(t.id);
      return { ...t, archived_at: t.archived_at || now, updated_at: now };
    }
    return t;
  });

  return makeResult(next, newlyArchivedIds);
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
