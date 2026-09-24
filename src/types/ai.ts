export type TaskEventType =
  | 'task_completed'
  | 'task_uncompleted'
  | 'task_created'
  | 'task_updated'
  | 'task_moved'
  | 'task_deleted'
  | 'task_restored';

export interface TaskEvent {
  event_id: string;
  task_id: string;
  instance_id: string;
  timestamp: string; // UTC ISO string
  event_type: TaskEventType;
  before_value?: any;
  after_value?: any;
  operation_batch_id?: string;
  // Snapshot captured on completion
  path_ids_at_completion?: string[];
  path_titles_at_completion?: string[];
  title?: string;
  outcome_note?: string;
  recurrence_rule_id?: string | null;
  occurrence_key?: string | null;
  is_leaf_at_completion?: boolean;
}

export type AIReportType = 'weekly' | 'monthly' | 'custom';

export interface ReportPeriod {
  start: string;          // ISO string with timezone
  end_exclusive: string;  // ISO string with timezone
  cutoff: string;         // ISO string with timezone
  timezone: string;       // IANA timezone, e.g. "Asia/Shanghai"
  is_complete: boolean;   // true if cutoff === end_exclusive
  label: string;          // e.g. "本周，截至 2026-09-23 18:00" or "上周 (完整周期)"
  display_start: string;  // YYYY-MM-DD
  display_end: string;    // YYYY-MM-DD (inclusive display for end_exclusive - 1ms)
}

export interface ReportScope {
  root_ids: string[];
  excluded_ids: string[];
}

export interface CompletedRecord {
  task_id: string;
  instance_id: string;
  title: string;
  path_ids_at_completion: string[];
  path_titles_at_completion: string[];
  completed_at: string;
  is_leaf_at_completion: boolean;
  outcome_note: string;
  note?: string;
  recurrence_rule_id: string | null;
  occurrence_key: string | null;
}

export interface ProjectContextItem {
  id: string;
  path_ids: string[];
  path_titles: string[];
  status_at_cutoff: string;
}

export interface ContextNodeItem {
  node_id: string;
  parent_id: string | null;
  path_ids: string[];
  path_titles: string[];
  title: string;
  background_text?: string;
  note?: string;
  status_at_cutoff: string;
  updated_at?: string;
}

export interface FactsPackage {
  report_type: AIReportType;
  period: ReportPeriod;
  scope: ReportScope;
  data_quality: {
    history_complete: boolean;
    warnings: string[];
  };
  stats: {
    completed_leaf_instances: number;
    completed_parent_instances?: number;
  };
  project_context: ProjectContextItem[];
  completed_records: CompletedRecord[];
  context_nodes?: ContextNodeItem[];
}

export interface ContextRef {
  node_id: string;
  field: 'background_text' | 'note' | 'outcome_note';
  revision?: string;
}

export interface EvidenceItem {
  claim_text: string;
  task_instance_ids: string[];
  context_refs?: ContextRef[];
  claim_kind?: 'fact' | 'inference';
}

export interface ClarificationNote {
  task_instance_ids: string[];
  issue: string;
  suggested_input: string;
}

export interface AIReportResponse {
  report_markdown: string;
  evidence_map: EvidenceItem[];
  clarification_notes: ClarificationNote[];
}

export interface PromptTemplate {
  profile_id: string;
  name: string;
  content: string;
  version: number;
  updated_at: string;
  is_default: boolean;
  content_hash?: string; // SHA-256 of normalized template content
}

export interface GenerationSnapshot {
  snapshot_id: string;
  created_at: string;
  report_type: AIReportType;
  period_label: string;
  date_range: { start: string; end: string };
  template_id: string;
  template_name: string;
  template_version: number;
  template_hash: string;
  template_content: string;
  system_prompt_snapshot: string;
  user_prompt_snapshot: string;
  user_instructions_snapshot: string;
  user_instructions_hash: string;
  tasks_count: number;
  task_ids: string[];
}

export interface OutboundInspectionResult {
  attempt_id: string;
  timestamp: string;
  outbound_system_hash: string;
  outbound_user_hash: string;
  is_verified: boolean;
  verification_checks: {
    template_matched: boolean;
    user_instructions_matched: boolean;
    no_duplicate_default: boolean;
    no_credentials_leaked: boolean;
  };
  error_reason?: string;
}

export interface DryRunPreview {
  snapshot: GenerationSnapshot;
  outbound_system: string;
  outbound_user: string;
  system_hash: string;
  user_hash: string;
  verified: boolean;
}

export interface LiveLinkTestResult {
  success: boolean;
  verification_code: string;
  duration_ms: number;
  model_response?: string;
  found_verification_code: boolean;
  error_message?: string;
  inspection?: OutboundInspectionResult;
}

export interface ReportComplianceCheck {
  passed: boolean;
  period_matched: boolean;
  no_raw_ids: boolean;
  markdown_valid: boolean;
  task_coverage_rate: number;
  reasons?: string[];
}

export interface ReportVersion {
  version: number;
  created_at: string;
  model: string;
  prompt_version: string;
  response: AIReportResponse;
  is_mock?: boolean;
  applied_template_content?: string;
  applied_template_version?: number;
  applied_template_hash?: string;
  custom_instructions?: string;
  custom_instructions_hash?: string;
  snapshot?: GenerationSnapshot;
  outbound_inspection?: OutboundInspectionResult;
  duration_ms?: number;
  compliance_check?: ReportComplianceCheck;
  is_downgraded?: boolean;
  downgrade_reason?: string;
  source_kind?: 'ai' | 'local_summary' | 'local_empty';
}

export interface SavedReport {
  id: string;
  report_key: string;
  input_hash: string;
  report_type: AIReportType;
  title: string;
  period: ReportPeriod;
  scope: ReportScope;
  facts: FactsPackage;
  latest_version: number;
  versions: ReportVersion[];
  created_at: string;
  updated_at: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'quota_wait'
  | 'succeeded'
  | 'empty'
  | 'failed'
  | 'uncertain'
  | 'cancelled'
  | 'superseded';

export interface ReportJob {
  job_id: string;
  report_key: string;
  input_hash: string;
  trigger_source: 'manual' | 'scheduled' | 'retry';
  status: JobStatus;
  status_text: string;
  attempts_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  error_message?: string;
  report_id?: string;
  facts?: FactsPackage;
  next_allowed_attempt_at?: number;
  template_id?: string;
  custom_instructions?: string;
}

export interface AIAttempt {
  attempt_id: string;
  job_id: string;
  report_key: string;
  timestamp: string; // ISO string
  is_success: boolean;
  is_counted: boolean; // Counts against rolling 24h budget
  source?: 'manual' | 'scheduled'; // PRD v1.1 rate limit isolation
  status_code?: number;
  tokens_used?: number;
  error_type?: string;
}

export interface ScheduleConfig {
  weekly_enabled: boolean;
  weekly_trigger_time: string; // e.g. "09:00"
  weekly_day_of_week: number;  // 1 = Monday
  monthly_enabled: boolean;
  monthly_trigger_time: string; // e.g. "09:00"
  monthly_day_of_month: number; // 1 = 1st of month
  last_weekly_checked_key?: string;
  last_monthly_checked_key?: string;
  consecutive_failures: number;
  is_paused: boolean;
  paused_reason?: string;
}

export interface AISettings {
  use_mock: boolean;
  mock_scenario: 'success' | 'invalid_json' | 'rate_limit' | 'auth_error' | 'timeout';
  provider: 'openai_compatible';
  base_url: string;
  model_id: string;
  api_key: string;
  max_daily_budget: number; // default 5 (rolling 24h)
  send_notes: boolean;     // default false
  send_outcome_notes: boolean; // default true
  send_background: boolean; // default true (PRD v1.2 A32)
  prompt_templates?: PromptTemplate[];
  default_template_id?: string;
  schedule: ScheduleConfig;
}
