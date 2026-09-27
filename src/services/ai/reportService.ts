import { isAndroid } from '../native/platform';
import { loadWorkspace, commitWorkspace } from '../durableStore';
import {
  AISettings,
  FactsPackage,
  SavedReport,
  ReportVersion,
  AIAttempt,
  ReportJob,
  AIReportResponse,
  GenerationSnapshot,
  DryRunPreview,
  LiveLinkTestResult,
  ReportComplianceCheck,
} from '../../types/ai';
import {
  SYSTEM_PROMPT_VERSION,
  DEFAULT_PROMPT_TEMPLATE,
  buildSystemPrompt,
  formatUserMessage,
  generateVerificationCode,
  buildTestPayload,
} from './prompts';
import {
  validateAIReportResponse,
  generateLocalEmptyReport,
  generateLocalBaseSummary,
} from './validator';
import { callOpenAICompatible, inspectOutboundPayload } from './apiAdapter';
import { computeContentHash, formatHashBadge } from './hashUtils';

const SETTINGS_KEY = 'todotree_ai_settings_v1';
const REPORTS_KEY = 'todotree_ai_reports_v1';
const ATTEMPTS_KEY = 'todotree_ai_attempts_v1';
const JOBS_KEY = 'todotree_ai_jobs_v1';

export const DEFAULT_AI_SETTINGS: AISettings = {
  use_mock: true, // Default to mock adapter so it works out of the box without requiring API keys
  mock_scenario: 'success',
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model_id: 'gpt-4o-mini',
  api_key: '',
  max_daily_budget: 5, // Rolling 24-hour limit
  send_notes: false,
  send_outcome_notes: true,
  send_background: true, // PRD v1.2 A32
  prompt_templates: [DEFAULT_PROMPT_TEMPLATE],
  default_template_id: DEFAULT_PROMPT_TEMPLATE.profile_id,
  schedule: {
    weekly_enabled: false,
    weekly_trigger_time: '09:00',
    weekly_day_of_week: 1, // Monday
    monthly_enabled: false,
    monthly_trigger_time: '09:00',
    monthly_day_of_month: 1, // 1st
    consecutive_failures: 0,
    is_paused: false,
  },
};

// --- In-memory Caches ---
let cachedSettings: AISettings | null = null;
let cachedReports: SavedReport[] | null = null;
let cachedAttempts: AIAttempt[] | null = null;
let isExecutingJob = false; // Global concurrency slot: max 1 (PRD 9.1)

/**
 * Compute report_key (PRD 8.2)
 * Uniquely identifies a specific report time interval and scope
 */
export function computeReportKey(facts: FactsPackage): string {
  const sortedScope = [...facts.scope.root_ids].sort().join(',');
  const sortedExcl = [...facts.scope.excluded_ids].sort().join(',');
  return `${facts.report_type}:${facts.period.start}:${facts.period.end_exclusive}:${sortedScope}:${sortedExcl}:${facts.period.timezone}`;
}

/**
 * Compute input_hash (PRD v1.3 Section 6.1 & checklist A14, A15)
 * Uniquely identifies exact input facts, context_nodes, settings, model, prompt content hash and custom instructions hash.
 */
export function computeInputHash(
  reportKey: string,
  facts: FactsPackage,
  settings: AISettings,
  options?: {
    templateContent?: string;
    templateVersion?: number;
    customInstructions?: string;
  }
): string {
  const recordsSummary = facts.completed_records
    .map((r) => `${r.instance_id}_${r.completed_at}_${r.title}_${r.outcome_note || ''}`)
    .join('|');
  const contextSummary = (facts.context_nodes || [])
    .map((c) => `${c.node_id}_${c.title}_${c.background_text || ''}_${c.note || ''}`)
    .join('|');

  const templateHash = computeContentHash(options?.templateContent || DEFAULT_PROMPT_TEMPLATE.content);
  const instructionsHash = computeContentHash(options?.customInstructions || '');

  const payload = [
    reportKey,
    recordsSummary,
    contextSummary,
    facts.stats.completed_leaf_instances,
    facts.period.is_complete,
    settings.send_notes,
    settings.send_outcome_notes,
    settings.send_background !== false,
    settings.model_id,
    settings.use_mock ? 'mock' : 'real',
    templateHash, // Content Hash strictly invalidates cache on any text edit (A14)
    instructionsHash, // Custom instructions hash (A06)
    SYSTEM_PROMPT_VERSION,
  ].join('##');

  return 'hash_' + computeContentHash(payload).slice(0, 16);
}

// --- Persistence Helpers ---

export async function loadAISettings(): Promise<AISettings> {
  const stored = (await loadWorkspace()).data.ai_settings;
  return { ...DEFAULT_AI_SETTINGS, ...stored };
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  // Ensure every template has valid content_hash
  if (settings.prompt_templates && Array.isArray(settings.prompt_templates)) {
    settings.prompt_templates = settings.prompt_templates.map((t) => ({
      ...t,
      content_hash: computeContentHash(t.content),
    }));
  }

  await commitWorkspace(data => ({ ...data, ai_settings: settings }));
  cachedSettings = settings;

}

export async function loadSavedReports(): Promise<SavedReport[]> {
  return (await loadWorkspace()).data.reports;
}

export async function saveSavedReports(reports: SavedReport[]): Promise<void> {
  await commitWorkspace(data => ({ ...data, reports: reports }));
  cachedReports = reports;
}


export async function loadAIAttempts(): Promise<AIAttempt[]> {
  return (await loadWorkspace()).data.attempts;
}

export async function saveAIAttempts(attempts: AIAttempt[]): Promise<void> {
  await commitWorkspace(data => ({ ...data, attempts: attempts }));
  cachedAttempts = attempts;
}


// --- Rolling 24-Hour Budget & Cooldown (PRD 9.1 & 9.2) ---

export async function getBudgetStatus(settings: AISettings): Promise<{
  count24h: number;
  maxBudget: number;
  allowed: boolean;
  earliestReleaseAt?: string;
}> {
  const attempts = await loadAIAttempts();
  const now = Date.now();
  const window24h = 24 * 60 * 60 * 1000;

  // PRD v1.1 Section 9: Only scheduled attempts count against the 24h budget!
  const valid24h = attempts.filter((a) => {
    if (!a.is_counted) return false;
    if (a.source === 'manual') return false; // Manual is UNLIMITED
    const ts = new Date(a.timestamp).getTime();
    return now - ts < window24h;
  });

  const count24h = valid24h.length;
  const allowed = count24h < settings.max_daily_budget;

  let earliestReleaseAt: string | undefined;
  if (!allowed && valid24h.length > 0) {
    const oldest = Math.min(...valid24h.map((a) => new Date(a.timestamp).getTime()));
    earliestReleaseAt = new Date(oldest + window24h).toLocaleTimeString();
  }

  return {
    count24h,
    maxBudget: settings.max_daily_budget,
    allowed,
    earliestReleaseAt,
  };
}

export async function checkCooldown(
  reportKey: string,
  source?: 'manual' | 'scheduled'
): Promise<{ inCooldown: boolean; remainingSeconds: number }> {
  // PRD v1.1 Section 9: Manual generations have ZERO cooldown
  if (source === 'manual') {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  const attempts = await loadAIAttempts();
  const now = Date.now();
  const COOLDOWN_MS = 60 * 1000; // 60s for scheduled only

  const recent = attempts
    .filter((a) => a.report_key === reportKey && a.source === 'scheduled')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  if (!recent) return { inCooldown: false, remainingSeconds: 0 };

  const diff = now - new Date(recent.timestamp).getTime();
  if (diff < COOLDOWN_MS) {
    return {
      inCooldown: true,
      remainingSeconds: Math.ceil((COOLDOWN_MS - diff) / 1000),
    };
  }

  return { inCooldown: false, remainingSeconds: 0 };
}

/**
 * Report Compliance Verification (PRD v1.3 Section 8.1 & 8.3 & checklist A27, A28)
 */
export function checkReportCompliance(
  markdown: string,
  facts: FactsPackage
): ReportComplianceCheck {
  const reasons: string[] = [];

  // Check if raw task ID is leaked into the markdown text (Section 8.1 & A28)
  const idRegex = /\b(task-[a-zA-Z0-9_-]+|test-fictional-[a-zA-Z0-9_-]+)\b/;
  const hasRawId = idRegex.test(markdown);
  if (hasRawId) {
    reasons.push('正文中疑似泄露了内部任务编号（如 task-...）');
  }

  const markdownValid = typeof markdown === 'string' && markdown.trim().length > 0;
  if (!markdownValid) {
    reasons.push('正文为空或格式异常');
  }

  const totalTasks = facts.completed_records.length;
  let covered = 0;
  for (const t of facts.completed_records) {
    if (markdown.includes(t.title)) covered++;
  }
  const coverageRate = totalTasks > 0 ? Math.round((covered / totalTasks) * 100) : 100;

  return {
    passed: !hasRawId && markdownValid,
    period_matched: true,
    no_raw_ids: !hasRawId,
    markdown_valid: markdownValid,
    task_coverage_rate: coverageRate,
    reasons: reasons.length > 0 ? reasons : undefined,
  };
}

/**
 * Preview Outbound Request (Dry-Run, 0 API Calls) (PRD v1.3 Section 5.1 & checklist A20)
 */
export function previewOutboundRequest(
  facts: FactsPackage,
  settings: AISettings,
  options: {
    templateId?: string;
    customInstructions?: string;
  } = {}
): DryRunPreview {
  const templates = settings.prompt_templates || [DEFAULT_PROMPT_TEMPLATE];
  const template =
    templates.find((t) => t.profile_id === (options.templateId || settings.default_template_id)) ||
    templates[0] ||
    DEFAULT_PROMPT_TEMPLATE;

  const systemPrompt = buildSystemPrompt(template.content, options.customInstructions);
  const userMessage = formatUserMessage(facts);
  const templateHash = computeContentHash(template.content);
  const instructionsHash = computeContentHash(options.customInstructions || '');

  const snapshot: GenerationSnapshot = {
    snapshot_id: 'preview_' + Date.now(),
    created_at: new Date().toISOString(),
    report_type: facts.report_type,
    period_label: facts.period.label,
    date_range: { start: facts.period.display_start, end: facts.period.display_end },
    template_id: template.profile_id,
    template_name: template.name,
    template_version: template.version,
    template_hash: templateHash,
    template_content: template.content,
    system_prompt_snapshot: systemPrompt,
    user_prompt_snapshot: userMessage,
    user_instructions_snapshot: options.customInstructions || '',
    user_instructions_hash: instructionsHash,
    tasks_count: facts.completed_records.length,
    task_ids: facts.completed_records.map((r) => r.task_id),
  };

  const payload = {
    model: settings.model_id || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };

  const inspection = inspectOutboundPayload(payload, snapshot);

  return {
    snapshot,
    outbound_system: systemPrompt,
    outbound_user: userMessage,
    system_hash: inspection.outbound_system_hash,
    user_hash: inspection.outbound_user_hash,
    verified: inspection.is_verified,
  };
}

/**
 * Live Link Minimal Verification Test (PRD v1.3 Section 7.2 & checklist A21, A22, A23)
 */
export async function runLiveLinkTest(
  settings: AISettings,
  userTemplateContent?: string
): Promise<LiveLinkTestResult> {
  const code = generateVerificationCode();
  const payload = buildTestPayload(code, userTemplateContent);

  const snapshot: GenerationSnapshot = {
    snapshot_id: 'test_snap_' + Date.now(),
    created_at: new Date().toISOString(),
    report_type: 'weekly',
    period_label: '链路测试',
    date_range: { start: '2026-09-23', end: '2026-09-23' },
    template_id: 'live_test_template',
    template_name: '测试专用临时模板',
    template_version: 1,
    template_hash: computeContentHash(userTemplateContent || DEFAULT_PROMPT_TEMPLATE.content),
    template_content: userTemplateContent || DEFAULT_PROMPT_TEMPLATE.content,
    system_prompt_snapshot: payload.systemPrompt,
    user_prompt_snapshot: payload.userMessage,
    user_instructions_snapshot: payload.customInstruction,
    user_instructions_hash: computeContentHash(payload.customInstruction),
    tasks_count: 2,
    task_ids: ['test-fictional-task-01', 'test-fictional-task-02'],
  };

  const res = await callOpenAICompatible(payload.testFacts, settings, {
    systemPrompt: payload.systemPrompt,
    snapshot,
    isTestCall: true,
  });

  if (res.error) {
    return {
      success: false,
      verification_code: code,
      duration_ms: res.durationMs || 0,
      found_verification_code: false,
      error_message: res.error,
      inspection: res.inspection,
    };
  }

  const raw = res.rawText || '';
  const found = raw.includes(code);

  return {
    success: found,
    verification_code: code,
    duration_ms: res.durationMs || 0,
    model_response: raw,
    found_verification_code: found,
    error_message: found ? undefined : `模型响应未包含指定随机验证码「${code}」 (A22)`,
    inspection: res.inspection,
  };
}

// --- Main Generation Service (PRD v1.3 Section 4-6) ---

export interface GenerateReportResult {
  report: SavedReport;
  reused: boolean;
  isMock: boolean;
}

/**
 * Unified generation entry point with immutable snapshots and Request Inspector (PRD v1.3 Section 4.1 & 4.3)
 */
export async function requestReport(
  facts: FactsPackage,
  settings: AISettings,
  options: {
    forceNewVersion?: boolean;
    source?: 'manual' | 'scheduled';
    templateId?: string;
    customInstructions?: string;
    onProgress?: (statusText: string) => void;
  } = {}
): Promise<GenerateReportResult> {
  const source = options.source || 'manual';
  if (isAndroid() && source === 'scheduled') throw new Error('手机版首版仅支持手动复盘');
  const reportKey = computeReportKey(facts);

  // 1. Template resolution
  const templates = settings.prompt_templates || [DEFAULT_PROMPT_TEMPLATE];
  const template =
    templates.find((t) => t.profile_id === (options.templateId || settings.default_template_id)) ||
    templates[0] ||
    DEFAULT_PROMPT_TEMPLATE;

  // 2. Input hash with strict content fingerprinting
  const inputHash = computeInputHash(reportKey, facts, settings, {
    templateContent: template.content,
    customInstructions: options.customInstructions,
  });

  const reports = await loadSavedReports();
  const existingReport = reports.find((r) => r.report_key === reportKey);

  // 3. Zero records check (PRD 6.2 & 8.1 - 0 API calls)
  if (facts.completed_records.length === 0) {
    options.onProgress?.('本地无已完成记录，直接生成空报告 (零调用)...');
    const emptyResponse = generateLocalEmptyReport(facts);
    const templateHash = computeContentHash(template.content);
    const instructionsHash = computeContentHash(options.customInstructions || '');

    const snapshot: GenerationSnapshot = {
      snapshot_id: 'snap_' + Date.now(),
      created_at: new Date().toISOString(),
      report_type: facts.report_type,
      period_label: facts.period.label,
      date_range: { start: facts.period.display_start, end: facts.period.display_end },
      template_id: template.profile_id,
      template_name: template.name,
      template_version: template.version,
      template_hash: templateHash,
      template_content: template.content,
      system_prompt_snapshot: buildSystemPrompt(template.content, options.customInstructions),
      user_prompt_snapshot: formatUserMessage(facts),
      user_instructions_snapshot: options.customInstructions || '',
      user_instructions_hash: instructionsHash,
      tasks_count: 0,
      task_ids: [],
    };

    const newReport: SavedReport = {
      id: existingReport?.id || 'rep_' + Date.now(),
      report_key: reportKey,
      input_hash: inputHash,
      report_type: facts.report_type,
      title: `${facts.report_type === 'weekly' ? '工作周报' : facts.report_type === 'monthly' ? '工作月报' : '阶段工作总结'} (${facts.period.display_start})`,
      period: facts.period,
      scope: facts.scope,
      facts,
      latest_version: 1,
      versions: [
        {
          version: 1,
          created_at: new Date().toISOString(),
          model: 'local',
          prompt_version: SYSTEM_PROMPT_VERSION,
          response: emptyResponse,
          is_mock: false,
          applied_template_content: template.content,
          applied_template_version: template.version,
          applied_template_hash: templateHash,
          custom_instructions: options.customInstructions,
          custom_instructions_hash: instructionsHash,
          snapshot,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const nextReports = reports.filter((r) => r.report_key !== reportKey);
    nextReports.unshift(newReport);
    await saveSavedReports(nextReports);

    return {
      report: newReport,
      reused: false,
      isMock: false,
    };
  }

  // 4. Cache check: If identical input_hash already succeeded, reuse with 0 API calls (PRD 8.2 & A20 & PRD v1.3 Section 6.1)
  if (existingReport && !options.forceNewVersion) {
    if (existingReport.input_hash === inputHash) {
      options.onProgress?.('命中相同数据快照与提示词缓存，直接复用 (零调用)...');
      return {
        report: existingReport,
        reused: true,
        isMock: existingReport.versions[existingReport.versions.length - 1]?.is_mock || false,
      };
    }
  }

  // 5. Global concurrency lock: max 1 active generation (PRD 9.1 & A16)
  if (isExecutingJob) {
    throw new Error('已有另一个复盘报告正在生成中，请稍候完成后再试。');
  }

  // 6. Rate limit check (PRD v1.1 Section 9: Manual is UNLIMITED, scheduled has 24h budget & 60s cooldown)
  if (source === 'scheduled') {
    const budgetStatus = await getBudgetStatus(settings);
    if (!budgetStatus.allowed) {
      throw new Error(
        `近 24 小时自动复盘额度已用尽 (${budgetStatus.count24h}/${budgetStatus.maxBudget})。最早将于 ${budgetStatus.earliestReleaseAt || '稍后'} 释放新额度。`
      );
    }

    const cooldown = await checkCooldown(reportKey, source);
    if (cooldown.inCooldown) {
      throw new Error(`同报告生成过于频繁，请等待 ${cooldown.remainingSeconds} 秒冷却时间。`);
    }
  }

  isExecutingJob = true;

  try {
    options.onProgress?.(
      settings.use_mock ? '使用确定性模拟适配器生成中...' : '正在调用大模型生成复盘报告...'
    );

    // Build complete system prompt
    const systemPrompt = buildSystemPrompt(template.content, options.customInstructions);
    const templateHash = computeContentHash(template.content);
    const instructionsHash = computeContentHash(options.customInstructions || '');

    // Form immutable snapshot (PRD v1.3 Section 4.1)
    const snapshot: GenerationSnapshot = {
      snapshot_id: 'snap_' + Date.now(),
      created_at: new Date().toISOString(),
      report_type: facts.report_type,
      period_label: facts.period.label,
      date_range: { start: facts.period.display_start, end: facts.period.display_end },
      template_id: template.profile_id,
      template_name: template.name,
      template_version: template.version,
      template_hash: templateHash,
      template_content: template.content,
      system_prompt_snapshot: systemPrompt,
      user_prompt_snapshot: formatUserMessage(facts),
      user_instructions_snapshot: options.customInstructions || '',
      user_instructions_hash: instructionsHash,
      tasks_count: facts.completed_records.length,
      task_ids: facts.completed_records.map((r) => r.task_id),
    };

    let rawOutput = '';
    let validatedData: AIReportResponse | null = null;
    let tokensUsed: number | undefined;
    let responseModel: string | undefined;
    let durationMs: number | undefined;
    let inspectionResult: any = undefined;
    let lastError = '';

    // Attempt 1
    const attemptId1 = 'att_' + Date.now();
    const attempts = await loadAIAttempts();

    const res = await callOpenAICompatible(facts, settings, {
      systemPrompt,
      snapshot,
      attemptId: attemptId1,
    });

    rawOutput = res.rawText;
    tokensUsed = res.tokensUsed;
    responseModel = res.responseModel;
    durationMs = res.durationMs;
    inspectionResult = res.inspection;

    if (res.error) {
      lastError = res.error;
      if (res.isAuthError) {
        settings.schedule.is_paused = true;
        settings.schedule.paused_reason = 'API Key 无效或未授权，自动计划已暂停';
        await saveAISettings(settings);
      }
    } else {
      const valRes = validateAIReportResponse(rawOutput, facts);
      if (valRes.isValid && valRes.data) {
        validatedData = valRes.data;
      } else {
        lastError = valRes.errorMessage || '输出未通过格式契约校验';
      }
    }

    // Log Attempt 1
    const isSuccess1 = !!validatedData;
    attempts.push({
      attempt_id: attemptId1,
      job_id: 'job_' + Date.now(),
      report_key: reportKey,
      timestamp: new Date().toISOString(),
      is_success: isSuccess1,
      is_counted: true,
      source: source,
      tokens_used: tokensUsed,
      error_type: lastError || undefined,
    });
    await saveAIAttempts(attempts);

    let isDowngraded = false;
    let downgradeReason: string | undefined = undefined;
    let sourceKind: 'ai' | 'local_summary' | 'local_empty' = 'ai';

    // If model output is invalid, rejected, or network failed, fallback gracefully (PRD v1.1 Section 3.3)
    if (!validatedData) {
      if (facts.completed_records.length > 0) {
        options.onProgress?.('AI 未生成有效结果，正在按真实完成记录生成本地基础摘要...');
        validatedData = generateLocalBaseSummary(facts);
        isDowngraded = true;
        downgradeReason = lastError || 'AI 暂未生成成功，已提供基础摘要';
        sourceKind = 'local_summary';
        responseModel = '本地基础摘要 (确定性整理)';
      } else {
        validatedData = generateLocalEmptyReport(facts);
        sourceKind = 'local_empty';
        responseModel = '本地空报告';
      }
    }

    // Run compliance check (PRD v1.3 Section 8.1 & 8.3)
    const compliance = checkReportCompliance(validatedData.report_markdown, facts);

    // Save report version with full metadata
    const newVersionNumber = existingReport ? existingReport.latest_version + 1 : 1;
    const reportVersion: ReportVersion = {
      version: newVersionNumber,
      created_at: new Date().toISOString(),
      model: isDowngraded ? '本地基础摘要 (确定性整理)' : responseModel || (settings.use_mock ? 'Mock Adapter (确定性模拟)' : settings.model_id),
      prompt_version: SYSTEM_PROMPT_VERSION,
      response: validatedData,
      is_mock: isDowngraded ? false : settings.use_mock,
      is_downgraded: isDowngraded,
      downgrade_reason: downgradeReason,
      source_kind: sourceKind,
      applied_template_content: template.content,
      applied_template_version: template.version,
      applied_template_hash: templateHash,
      custom_instructions: options.customInstructions,
      custom_instructions_hash: instructionsHash,
      snapshot,
      outbound_inspection: inspectionResult,
      duration_ms: durationMs,
      compliance_check: compliance,
    };

    const typeTitle =
      facts.report_type === 'weekly'
        ? '工作周报'
        : facts.report_type === 'monthly'
        ? '工作月报'
        : '阶段工作总结';

    const savedReport: SavedReport = {
      id: existingReport?.id || 'rep_' + Date.now(),
      report_key: reportKey,
      input_hash: inputHash,
      report_type: facts.report_type,
      title: `${typeTitle} (${facts.period.display_start})`,
      period: facts.period,
      scope: facts.scope,
      facts,
      latest_version: newVersionNumber,
      versions: existingReport ? [...existingReport.versions, reportVersion] : [reportVersion],
      created_at: existingReport?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const nextReports = reports.filter((r) => r.report_key !== reportKey);
    nextReports.unshift(savedReport);
    await saveSavedReports(nextReports);

    // Reset schedule consecutive failures on success
    if (settings.schedule.consecutive_failures > 0) {
      settings.schedule.consecutive_failures = 0;
      await saveAISettings(settings);
    }

    return {
      report: savedReport,
      reused: false,
      isMock: settings.use_mock,
    };
  } finally {
    isExecutingJob = false;
  }
}

/**
 * Delete a report (PRD 8.3)
 */
export async function deleteSavedReport(reportId: string): Promise<void> {
  const reports = await loadSavedReports();
  const nextReports = reports.filter((r) => r.id !== reportId);
  await saveSavedReports(nextReports);
}
