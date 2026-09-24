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


/**
 * Finds the top-level ancestor of a task along the parent_id chain.
 * This is the root of the task tree in the workspace (excluding visual/filter roots).
 */
export function getTopLevelTaskId(byId: Map<string, TaskNode>, id: string): string {
  let currId = id;
  const visited = new Set<string>();
  while (currId && !visited.has(currId)) {
    visited.add(currId);
    const node = byId.get(currId);
    if (!node || !node.parent_id || !byId.has(node.parent_id)) {
      return currId;
    }
    currId = node.parent_id;
  }
  return currId;
}

export interface CompleteBranchResult {
  tasks: TaskNode[];
  completedTasks: TaskNode[];
  newlyCompletedIds: string[];
  autoClosedIds: string[];
  autoCompletedAncestorIds: string[];
  newlyArchivedIds: string[];
  retainedCompletedIds: string[];
  operationId: string;
}

/**
 * Determines whether completing a task will trigger the automatic archiving
 * of its entire top-level tree.
 */
export function willCompletionArchiveTree(tasks: TaskNode[], id: string): boolean {
  const { byId, children, subtree } = indexTasks(tasks);
  const target = byId.get(id);
  if (!target || target.status !== 'open') return false;

  const completing = new Set<string>();
  for (const descId of subtree(id)) {
    const desc = byId.get(descId);
    if (desc && desc.status === 'open') completing.add(descId);
  }

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
    }
    parentId = parent.parent_id;
  }

  const topLevelId = getTopLevelTaskId(byId, id);
  const topLevel = byId.get(topLevelId);
  if (!topLevel || (topLevel.status !== 'done' && !completing.has(topLevelId))) {
    return false;
  }

  for (const nodeKey of subtree(topLevelId)) {
    const node = byId.get(nodeKey);
    if (node && node.status !== 'done' && !completing.has(nodeKey)) {
      return false;
    }
  }

  return true;
}

/**
 * Completes a task branch.
 * PRD V1.0 rules:
 * - Completing a task completes all its open active descendants.
 * - Upward auto-completion triggers when all siblings of a parent are completed.
 * - Intermediate parent auto-completion DOES NOT trigger premature branch archiving.
 * - Automatic archiving occurs ONLY when the entire top-level task and all its descendants are done.
 * - Otherwise, completed tasks remain struck through in the workspace with archived_at = null.
 */
export function completeTaskBranch(
  tasks: TaskNode[],
  id: string,
  outcomeNote?: string
): CompleteBranchResult {
  const { byId, children, subtree } = indexTasks(tasks);
  const target = byId.get(id);
  const operationId = `complete-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (!target || target.status !== 'open') {
    return {
      tasks,
      completedTasks: [],
      newlyCompletedIds: [],
      autoClosedIds: [],
      autoCompletedAncestorIds: [],
      newlyArchivedIds: [],
      retainedCompletedIds: [],
      operationId,
    };
  }

  // 1. Target and all open active descendants
  const completing = new Set<string>();
  for (const descId of subtree(id)) {
    const desc = byId.get(descId);
    if (desc && desc.status === 'open') {
      completing.add(descId);
    }
  }

  // 2. Upward completion: propagate up as long as all siblings are done
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

  // 3. Determine if the top-level tree is completely done -> Auto Archiving
  const topLevelId = getTopLevelTaskId(byId, id);
  const topLevelTask = byId.get(topLevelId);
  const topLevelSubtreeIds = subtree(topLevelId);

  const isTopLevelDone = topLevelTask && (topLevelTask.status === 'done' || completing.has(topLevelId));
  let isEntireTreeDone = Boolean(isTopLevelDone);
  if (isEntireTreeDone) {
    for (const treeNodeId of topLevelSubtreeIds) {
      const node = byId.get(treeNodeId);
      if (!node) continue;
      if (node.status !== 'done' && !completing.has(node.id)) {
        isEntireTreeDone = false;
        break;
      }
    }
  }

  // Auto-archive ONLY if the entire top-level tree is completed
  const archiving = isEntireTreeDone ? topLevelSubtreeIds : new Set<string>();

  const now = new Date().toISOString();
  const newlyCompletedIds: string[] = [];
  const newlyArchivedIds: string[] = [];
  const retainedCompletedIds: string[] = [];

  const next = tasks.map(task => {
    const isNowCompleting = completing.has(task.id);
    const isNowArchiving = archiving.has(task.id);

    if (!isNowCompleting && !isNowArchiving) {
      if (task.status === 'done' && !task.archived_at) {
        retainedCompletedIds.push(task.id);
      }
      return task;
    }

    const nextStatus = isNowCompleting ? ('done' as const) : task.status;
    const nextCompletedAt = isNowCompleting ? (task.completed_at || now) : task.completed_at;
    const nextArchivedAt = isNowArchiving ? (task.archived_at || now) : task.archived_at;

    if (isNowCompleting && task.status === 'open') {
      newlyCompletedIds.push(task.id);
    }
    if (isNowArchiving && !task.archived_at) {
      newlyArchivedIds.push(task.id);
    }
    if (nextStatus === 'done' && !nextArchivedAt) {
      retainedCompletedIds.push(task.id);
    }

    return {
      ...task,
      status: nextStatus,
      completed_at: nextCompletedAt,
      archived_at: nextArchivedAt,
      outcome_note: task.id === id ? outcomeNote ?? task.outcome_note ?? '' : task.outcome_note,
      updated_at: now,
    };
  });

  return {
    tasks: next,
    completedTasks: next.filter(t => completing.has(t.id)),
    newlyCompletedIds,
    autoClosedIds,
    autoCompletedAncestorIds: autoClosedIds,
    newlyArchivedIds,
    retainedCompletedIds,
    operationId,
  };
}

export interface ArchiveBranchResult extends Array<TaskNode> {
  tasks: TaskNode[];
  newlyArchivedIds: string[];
  error?: string;
}

/**
 * “搞定” button: archives an already completed item without re-logging completion.
 * PRD Section 2.5:
 * - Must validate that the target and all its descendants are done (status === 'done').
 * - If incomplete descendants exist, reject archiving and return error "仍有未完成子任务".
 * - Returns dual format: Array-like for backward compatibility and { tasks, newlyArchivedIds, error }.
 */
export function archiveCompletedBranch(tasks: TaskNode[], id: string): ArchiveBranchResult {
  const { byId, subtree } = indexTasks(tasks);
  const target = byId.get(id);

  const makeResult = (taskList: TaskNode[], newlyArchived: string[], error?: string): ArchiveBranchResult => {
    if (taskList === tasks && !newlyArchived.length) {
      const arr = tasks as any;
      arr.tasks = tasks;
      arr.newlyArchivedIds = [];
      if (error) arr.error = error;
      return arr as ArchiveBranchResult;
    }
    const arr = [...taskList] as any;
    arr.tasks = taskList;
    arr.newlyArchivedIds = newlyArchived;
    if (error) arr.error = error;
    return arr as ArchiveBranchResult;
  };

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
