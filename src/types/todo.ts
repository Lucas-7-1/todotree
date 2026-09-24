export type TaskStatus = 'open' | 'done';
export type DueType = 'none' | 'date' | 'datetime';
export type QuadrantType = 'Q1' | 'Q2' | 'Q3' | 'Q4' | null;
export type RootBucket = 'categories' | 'inbox' | null;

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  id: string;
  type: RecurrenceType;
  interval?: number;
  days_of_week?: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  day_of_month?: number;   // 1..31
  start_date: string;      // YYYY-MM-DD
  end_date?: string | null;
  paused?: boolean;
}

export interface TaskNode {
  id: string;
  parent_id: string | null;
  root_bucket: RootBucket;
  title: string;
  note: string;
  sort_order: number;
  status: TaskStatus;
  completed_at: string | null;
  due_type: DueType;
  due_date: string | null; // YYYY-MM-DD
  due_at: string | null;   // UTC ISO string
  quadrant: QuadrantType;
  planned_date: string | null; // YYYY-MM-DD
  outcome_note?: string;       // Optional completion result note (PRD 3.1 & 3.2)
  background_text?: string;    // Optional background/context note (PRD v1.2 A31)
  instance_id?: string;        // Specific instance identifier (for recurring instances)
  recurrence_rule_id?: string | null;
  recurrence_rule?: RecurrenceRule | null;
  recurrence_period_key?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deletion_batch_id: string | null;
}

export interface AppSettings {
  timezone: string;
  reduced_motion: boolean;
  show_completed: boolean;
  schema_version: number;
  initialized?: boolean;
}

export type ViewType = 'tree' | 'today' | 'quadrant' | 'completed' | 'trash' | 'review';
export type TaskViewMode = 'tree' | 'list' | 'project_group';

export type QuadrantLevelFilter = 'all' | 'root_only' | 'leaf_only';

export interface UndoStep {
  description: string;
  tasksSnapshot: TaskNode[];
  timestamp: number;
}

export interface TaskFieldChanges {
  taskId: string;
  before: Partial<TaskNode>;
  after: Partial<TaskNode>;
}

export interface DeltaUndoCommand {
  commandId: string;
  type: string;
  description: string;
  timestamp: number;
  changes: TaskFieldChanges[];
  batchId?: string;
  undone?: boolean;
}

export interface TemplatePreviewItem {
  title: string;
  depth: number;
  due_type: DueType;
  due_date: string | null;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  iconName: string;
  items: (todayStr: string) => TemplatePreviewItem[];
}
