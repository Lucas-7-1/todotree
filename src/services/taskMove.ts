import { TaskNode } from '../types/todo';
import { indexMobileTasks } from './mobileTasks';

export interface TaskMove {
  taskId: string;
  parentId: string | null;
  anchorId?: string;
  placement: 'before' | 'after' | 'end';
  expectedParentId?: string | null;
}

/** Structure-only command. Never invokes completion, recurrence or archive logic. */
export function validateTaskMove(tasks: TaskNode[], move: TaskMove): string | null {
  const index = indexMobileTasks(tasks);
  const source = index.byId.get(move.taskId);
  if (!source || source.archived_at) return '源任务已删除或归档';
  if (move.expectedParentId !== undefined && source.parent_id !== move.expectedParentId)
    return '任务归属已变化，请重新拖动';
  const branch = new Set([source.id, ...index.descendants(source.id).map(t => t.id)]);
  if (move.parentId && branch.has(move.parentId)) return '不能移到自身或自己的子节点下';
  let depth = 0;
  let parent = move.parentId;
  const visited = new Set<string>();
  while (parent) {
    if (visited.has(parent)) return '目标结构存在循环，请先修复';
    visited.add(parent);
    const node = index.byId.get(parent);
    if (!node || node.archived_at) return '目标节点已删除或归档';
    if (node.status === 'done') return '请先恢复目标节点，再移入任务';
    depth++;
    parent = node.parent_id;
  }
  const queue = [{ id: source.id, height: 1 }];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (seen.has(item.id)) return '源任务结构存在循环';
    seen.add(item.id);
    if (depth + item.height > 5) return '移动整个分支后将超过 5 层';
    for (const child of index.children.get(item.id) || []) queue.push({ id: child.id, height: item.height + 1 });
  }
  // A source under a hidden/archived parent must not be resurrected by moving it.
  parent = source.parent_id;
  visited.clear();
  while (parent) {
    if (visited.has(parent)) return '源任务结构存在循环';
    visited.add(parent);
    const node = index.byId.get(parent);
    if (!node || node.archived_at) return '源任务所在分支已归档或删除';
    parent = node.parent_id;
  }
  if (move.placement !== 'end') {
    const anchor = move.anchorId && index.byId.get(move.anchorId);
    if (!anchor || anchor.archived_at || anchor.parent_id !== move.parentId || branch.has(anchor.id))
      return '落点已变化，请重新选择位置';
  }
  return null;
}

export function applyTaskMove(tasks: TaskNode[], move: TaskMove): TaskNode[] {
  const error = validateTaskMove(tasks, move);
  if (error) throw new Error(error);
  const source = tasks.find(t => t.id === move.taskId)!;
  const siblings = tasks.filter(t => !t.deleted_at && t.parent_id === move.parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const previous = siblings.map(t => t.id);
  const ordered = siblings.filter(t => t.id !== source.id);
  const offset = move.placement === 'end' ? ordered.length :
    ordered.findIndex(t => t.id === move.anchorId) + (move.placement === 'after' ? 1 : 0);
  ordered.splice(offset, 0, source);
  if (source.parent_id === move.parentId && previous.join('\0') === ordered.map(t => t.id).join('\0')) return tasks;
  const ranks = new Map<string, number>();
  const left = ordered[offset - 1]?.sort_order;
  const right = ordered[offset + 1]?.sort_order;
  const rank = left === undefined ? (right ?? 1024) - 1024 : right === undefined ? left + 1024 : left + (right - left) / 2;
  if (Number.isFinite(rank) && (left === undefined || rank > left) && (right === undefined || rank < right)) {
    ranks.set(source.id, rank);
  } else ordered.forEach((t, i) => ranks.set(t.id, (i + 1) * 1024));
  const now = new Date().toISOString();
  return tasks.map(t => {
    if (t.id === source.id) return { ...t, parent_id: move.parentId,
      root_bucket: move.parentId === null ? 'categories' : null, sort_order: ranks.get(t.id)!, updated_at: now };
    const next = ranks.get(t.id);
    return next !== undefined && next !== t.sort_order ? { ...t, sort_order: next, updated_at: now } : t;
  });
}

export interface TreeRow { task: TaskNode; depth: number }
export function visibleMobileTree(tasks: TaskNode[], parentId: string | null, expanded: Set<string>, hiddenBranch?: string): TreeRow[] {
  const index = indexMobileTasks(tasks);
  for (const children of index.children.values()) children.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const task of index.children.get(parent) || []) {
      if (task.archived_at || seen.has(task.id)) continue;
      seen.add(task.id);
      rows.push({ task, depth });
      if (expanded.has(task.id) && task.id !== hiddenBranch) visit(task.id, depth + 1);
    }
  };
  visit(parentId, 0);
  return rows;
}
