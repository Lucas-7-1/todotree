import { TaskNode, QuadrantType, RecurrenceRule } from "../types/todo";
import { formatDateInTimezone } from "./calendarService";
import { generateId } from "./treeOperations";
import { computePeriodKey } from "./recurrence";

export const quadrantLabels = {
  Q1: "重要且紧急",
  Q2: "重要不紧急",
  Q3: "紧急不重要",
  Q4: "不重要不紧急",
};
export interface MobileTaskInput {
  title: string;
  parentId: string | null;
  plannedDate: string | null;
  dueDate?: string | null;
  quadrant?: QuadrantType;
  note?: string;
  recurrenceRule?: RecurrenceRule | null;
}
export function createTaskRecord(
  input: MobileTaskInput,
  today: string,
): TaskNode {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    parent_id: input.parentId,
    root_bucket: input.parentId ? null : "categories",
    title: input.title.trim(),
    note: input.note || "",
    sort_order: Date.now(),
    status: "open",
    completed_at: null,
    archived_at: null,
    due_type: input.dueDate ? "date" : "none",
    due_date: input.dueDate || null,
    due_at: null,
    quadrant: input.quadrant || null,
    planned_date: input.plannedDate,
    recurrence_rule: input.recurrenceRule || null,
    recurrence_rule_id: input.recurrenceRule?.id || null,
    recurrence_period_key: input.recurrenceRule
      ? computePeriodKey(
          input.recurrenceRule,
          input.dueDate || input.plannedDate || today,
        )
      : null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    deletion_batch_id: null,
  };
}
export function indexMobileTasks(tasks: TaskNode[]) {
  const byId = new Map<string, TaskNode>();
  const children = new Map<string | null, TaskNode[]>();
  for (const t of tasks) {
    if (t.deleted_at) continue;
    byId.set(t.id, t);
    const list = children.get(t.parent_id) || [];
    list.push(t);
    children.set(t.parent_id, list);
  }
  const path = (task: TaskNode) => {
    const names: string[] = [];
    const visited = new Set([task.id]);
    let parent = task.parent_id;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const node = byId.get(parent);
      if (!node) break;
      names.unshift(node.title);
      parent = node.parent_id;
    }
    return names.join(" › ");
  };
  const descendants = (id: string) => {
    const result: TaskNode[] = [];
    const seen = new Set([id]);
    const queue = [...(children.get(id) || [])];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      result.push(t);
      queue.push(...(children.get(t.id) || []));
    }
    return result;
  };
  return { byId, children, path, descendants };
}
export function taskDueDay(task: TaskNode, timezone: string): string | null {
  if (task.due_type === "datetime" && task.due_at) {
    const date = new Date(task.due_at);
    return Number.isNaN(date.valueOf())
      ? null
      : formatDateInTimezone(date, timezone);
  }
  return task.due_type === "date" ? task.due_date : null;
}
export function selectMobileToday(
  tasks: TaskNode[],
  today: string,
  timezone: string,
) {
  const current: TaskNode[] = [],
    overdue: TaskNode[] = [],
    previous: TaskNode[] = [];
  for (const t of tasks) {
    if (t.deleted_at || t.archived_at || t.status !== "open") continue;
    const due = taskDueDay(t, timezone);
    if (t.planned_date === today || due === today) current.push(t);
    else if (due && due < today) overdue.push(t);
    else if (t.planned_date && t.planned_date < today) previous.push(t);
  }
  const rank = (t: TaskNode) =>
    taskDueDay(t, timezone) === today ? (t.due_type === "datetime" ? 0 : 1) : 2;
  current.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? (a.due_at || "").localeCompare(b.due_at || "") : 0) ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id),
  );
  overdue.sort(
    (a, b) =>
      (taskDueDay(a, timezone) || "").localeCompare(
        taskDueDay(b, timezone) || "",
      ) || a.sort_order - b.sort_order,
  );
  previous.sort(
    (a, b) =>
      (b.planned_date || "").localeCompare(a.planned_date || "") ||
      a.sort_order - b.sort_order,
  );
  return { current, overdue, previous };
}
