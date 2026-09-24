import { TaskNode, QuadrantType, DueType } from '../types/todo';
import { getTodayDateString } from './seedData';

// Generate unique ID
export function generateId(): string {
  return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}

// Build map for fast access
export function buildTaskMap(tasks: TaskNode[]): Map<string, TaskNode> {
  const map = new Map<string, TaskNode>();
  for (const t of tasks) {
    map.set(t.id, t);
  }
  return map;
}

// Get parent node
export function getParentTask(tasks: TaskNode[], task: TaskNode): TaskNode | null {
  if (!task.parent_id) return null;
  return tasks.find(t => t.id === task.parent_id) || null;
}

// Get direct active children (sorted)
export function getChildrenTasks(tasks: TaskNode[], parentId: string | null): TaskNode[] {
  return tasks
    .filter(t => !t.deleted_at && t.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

// Get all descendants (recursive)
export function getDescendantTasks(tasks: TaskNode[], parentId: string): TaskNode[] {
  const descendants: TaskNode[] = [];
  const queue = [parentId];
  const map = new Map<string, TaskNode[]>();

  for (const t of tasks) {
    if (t.deleted_at) continue;
    if (t.parent_id) {
      const list = map.get(t.parent_id) || [];
      list.push(t);
      map.set(t.parent_id, list);
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const children = map.get(currId) || [];
    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

// Check if candidate is descendant of target (prohibit cycle)
export function isDescendant(tasks: TaskNode[], parentId: string, candidateChildId: string): boolean {
  if (parentId === candidateChildId) return true;
  const descendants = getDescendantTasks(tasks, parentId);
  return descendants.some(d => d.id === candidateChildId);
}

// Calculate the depth of a node in the tree (1-indexed, root is 1)
export function getNodeDepth(tasks: TaskNode[], task: TaskNode): number {
  let depth = 1;
  let curr = task;
  const visited = new Set<string>();
  const map = buildTaskMap(tasks);

  while (curr.parent_id) {
    if (visited.has(curr.id)) break; // cycle guard
    visited.add(curr.id);
    const parent = map.get(curr.parent_id);
    if (!parent) break;
    depth++;
    curr = parent;
  }
  return depth;
}

// Calculate max subtree height (including self: height of leaf is 1)
export function getSubtreeHeight(tasks: TaskNode[], rootId: string): number {
  const map = new Map<string, TaskNode[]>();
  for (const t of tasks) {
    if (t.deleted_at) continue;
    if (t.parent_id) {
      const list = map.get(t.parent_id) || [];
      list.push(t);
      map.set(t.parent_id, list);
    }
  }

  function dfs(currId: string): number {
    const children = map.get(currId) || [];
    if (children.length === 0) return 1;
    let maxChildHeight = 0;
    for (const child of children) {
      maxChildHeight = Math.max(maxChildHeight, dfs(child.id));
    }
    return 1 + maxChildHeight;
  }

  return dfs(rootId);
}

// Validate moving subtree under a new parent (PRD 4.1 & 4.3)
export function canMoveSubtree(tasks: TaskNode[], targetNode: TaskNode, newParentId: string | null): { allowed: boolean; reason?: string } {
  if (targetNode.id === newParentId) {
    return { allowed: false, reason: '不能将节点移动到自己自身' };
  }

  if (newParentId !== null && isDescendant(tasks, targetNode.id, newParentId)) {
    return { allowed: false, reason: '不能将节点移动到自身的后代节点下' };
  }

  // Calculate new depth
  let newParentDepth = 0;
  if (newParentId !== null) {
    const map = buildTaskMap(tasks);
    const parent = map.get(newParentId);
    if (!parent) return { allowed: false, reason: '目标父节点不存在' };
    newParentDepth = getNodeDepth(tasks, parent);
  }

  const subtreeHeight = getSubtreeHeight(tasks, targetNode.id);
  if (newParentDepth + subtreeHeight > 5) {
    return {
      allowed: false,
      reason: `移动后层级深度达到 ${newParentDepth + subtreeHeight} 层，超过系统最大 5 层限制`
    };
  }

  return { allowed: true };
}

// Check leaf nodes of a subtree
export function getLeafDescendants(tasks: TaskNode[], parentId: string): TaskNode[] {
  const descendants = getDescendantTasks(tasks, parentId);
  if (descendants.length === 0) return [];
  const parentIds = new Set(descendants.map(d => d.parent_id).filter(Boolean));
  // Leaves are those descendants who are not parents of any other node
  return descendants.filter(d => !parentIds.has(d.id));
}

// Calculate progress for parent node: (completed leaf descendants) / (total leaf descendants)
export function calculateProgress(tasks: TaskNode[], parentId: string): { completed: number; total: number; percentage: number; isAllLeavesDone: boolean } {
  const leaves = getLeafDescendants(tasks, parentId);
  if (leaves.length === 0) {
    return { completed: 0, total: 0, percentage: 0, isAllLeavesDone: false };
  }
  const completed = leaves.filter(l => l.status === 'done').length;
  const total = leaves.length;
  const percentage = Math.round((completed / total) * 100);
  return { completed, total, percentage, isAllLeavesDone: completed === total };
}

// Get ancestor path: ["工作", "采购调研"]
export function getAncestorPath(tasks: TaskNode[], task: TaskNode): string[] {
  const path: string[] = [];
  let curr = task;
  const map = buildTaskMap(tasks);
  const visited = new Set<string>();

  while (curr.parent_id) {
    if (visited.has(curr.id)) break;
    visited.add(curr.id);
    const parent = map.get(curr.parent_id);
    if (!parent) break;
    path.unshift(parent.title);
    curr = parent;
  }
  return path;
}

// Get ancestor nodes
export function getAncestorNodes(tasks: TaskNode[], task: TaskNode): TaskNode[] {
  const ancestors: TaskNode[] = [];
  let curr = task;
  const map = buildTaskMap(tasks);
  const visited = new Set<string>();

  while (curr.parent_id) {
    if (visited.has(curr.id)) break;
    visited.add(curr.id);
    const parent = map.get(curr.parent_id);
    if (!parent) break;
    ancestors.push(parent);
    curr = parent;
  }
  return ancestors;
}

// Check if task is overdue
export function isTaskOverdue(task: TaskNode, timezone = 'Asia/Shanghai'): boolean {
  if (task.status === 'done' || task.due_type === 'none') {
    return false;
  }
  const todayStr = getTodayDateString(0);

  if (task.due_type === 'date' && task.due_date) {
    // Overdue only if due_date < today
    return task.due_date < todayStr;
  }

  if (task.due_type === 'datetime' && task.due_at) {
    return new Date(task.due_at).getTime() < Date.now();
  }

  return false;
}

// Check if task is due today
export function isTaskDueToday(task: TaskNode): boolean {
  if (task.status === 'done' || task.due_type === 'none') return false;
  const todayStr = getTodayDateString(0);
  if (task.due_type === 'date') {
    return task.due_date === todayStr;
  }
  if (task.due_type === 'datetime' && task.due_at) {
    const dueDay = task.due_at.split('T')[0];
    return dueDay === todayStr;
  }
  return false;
}

// Relative date friendly label (e.g. 昨天, 今天, 明天, 周几, YYYY-MM-DD)
export function formatRelativeDate(task: TaskNode): { label: string; isOverdue: boolean; isToday: boolean } {
  if (task.due_type === 'none' || (!task.due_date && !task.due_at)) {
    return { label: '-', isOverdue: false, isToday: false };
  }

  const overdue = isTaskOverdue(task);
  const dueToday = isTaskDueToday(task);
  const todayStr = getTodayDateString(0);
  const tomorrowStr = getTodayDateString(1);
  const yesterdayStr = getTodayDateString(-1);

  const dateStr = task.due_type === 'date' ? task.due_date : task.due_at?.split('T')[0];

  if (dateStr === yesterdayStr) {
    return { label: '昨天', isOverdue: overdue, isToday: false };
  }
  if (dateStr === todayStr) {
    return { label: '今天', isOverdue: false, isToday: true };
  }
  if (dateStr === tomorrowStr) {
    return { label: '明天', isOverdue: false, isToday: false };
  }

  if (dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.round((d.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / (86400000));
    if (diffDays > 1 && diffDays <= 6) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return { label: weekdays[d.getDay()], isOverdue: false, isToday: false };
    }
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return { label: `${month}月${day}日`, isOverdue: overdue, isToday: false };
  }

  return { label: '-', isOverdue: false, isToday: false };
}
