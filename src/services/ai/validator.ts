import { FactsPackage, AIReportResponse, EvidenceItem, ClarificationNote } from '../../types/ai';

export interface ValidationResult {
  isValid: boolean;
  data?: AIReportResponse;
  errorMessage?: string;
  canRepairLocally?: boolean;
}

/**
 * Local empty report generator (PRD 6.2 & 8.1 - 0 API calls when completed_records is empty)
 */
export function generateLocalEmptyReport(facts: FactsPackage): AIReportResponse {
  const typeTitle =
    facts.report_type === 'weekly'
      ? '工作周报'
      : facts.report_type === 'monthly'
      ? '工作月报'
      : '阶段工作总结';

  const markdown = `${typeTitle}
统计周期：${facts.period.label}

一、本期工作概述
本期暂无可归纳的已完成工作记录。`;

  return {
    report_markdown: markdown,
    evidence_map: [],
    clarification_notes: [],
  };
}

/**
 * Detect if text is an unhelpful rejection notice (PRD v1.1 Section 3.3)
 */
export function isRejectionOrInsufficientNotice(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const lower = text.trim();
  if (lower.includes('信息不足，暂无法整理为具体工作成果')) return true;
  if (
    lower.includes('信息不足') &&
    (lower.includes('暂无法') || lower.includes('无法整理') || lower.includes('缺少具体工作内容'))
  ) {
    return true;
  }
  if (lower.includes('暂无成果可写')) return true;
  return false;
}

/**
 * Local base summary generator (PRD v1.1 Section 2, 3.3, 4, 5)
 * Deterministically organizes confirmed completed records by project/parent into a clean Markdown summary
 */
export function generateLocalBaseSummary(facts: FactsPackage): AIReportResponse {
  if (!facts.completed_records || facts.completed_records.length === 0) {
    return generateLocalEmptyReport(facts);
  }

  // 1. Group records by project or parent context
  const groups = new Map<string, typeof facts.completed_records>();
  for (const rec of facts.completed_records) {
    let groupName = '主要完成事项';
    if (rec.path_titles_at_completion && rec.path_titles_at_completion.length > 0) {
      groupName = rec.path_titles_at_completion[rec.path_titles_at_completion.length - 1];
    }
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName)!.push(rec);
  }

  const markdownSections: string[] = ['## 本期完成事项\n'];
  const evidenceMap: EvidenceItem[] = [];
  const clarificationNotes: ClarificationNote[] = [];

  for (const [groupName, recs] of groups.entries()) {
    if (groups.size > 1 || groupName !== '主要完成事项') {
      markdownSections.push(`### ${groupName}`);
    }

    // Format items under this group
    for (const rec of recs) {
      const cleanTitle = rec.title.trim() || '未命名任务';
      let claimText = '';
      if (rec.outcome_note && rec.outcome_note.trim()) {
        claimText = `完成“${cleanTitle}”：${rec.outcome_note.trim()}`;
      } else {
        claimText = `完成“${cleanTitle}”`;
      }

      markdownSections.push(`- ${claimText}。`);
      evidenceMap.push({
        claim_text: claimText,
        task_instance_ids: [rec.instance_id],
        claim_kind: 'fact',
      });

      // If title is super short or looks like a placeholder, add non-blocking friendly suggestion (max 3)
      if (clarificationNotes.length < 3 && (/^\d+$/.test(cleanTitle) || cleanTitle.includes('测试任务'))) {
        clarificationNotes.push({
          task_instance_ids: [rec.instance_id],
          issue: `任务「${cleanTitle}」信息较简单`,
          suggested_input: '补充任务具体产出或说明，可让下次复盘总结更丰富具体',
        });
      }
    }
    markdownSections.push('');
  }

  return {
    report_markdown: markdownSections.join('\n').trim(),
    evidence_map: evidenceMap,
    clarification_notes: clarificationNotes,
  };
}

/**
 * Clean and parse raw JSON text returned by the model
 */
export function extractAndParseJSON(rawText: string): { success: boolean; data?: any; error?: string } {
  let cleaned = rawText.trim();

  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { success: true, data: parsed };
  } catch (err: any) {
    // Attempt minor repair: remove trailing commas before } or ]
    try {
      const repaired = cleaned.replace(/,\s*([\]}])/g, '$1');
      const parsed = JSON.parse(repaired);
      return { success: true, data: parsed };
    } catch {
      return { success: false, error: `JSON 语法解析失败: ${err.message}` };
    }
  }
}

/**
 * Validate AI response structure, fields, and cross-reference evidence IDs with facts package (PRD 6.3 & A14)
 */
export function validateAIReportResponse(
  rawText: string,
  facts: FactsPackage
): ValidationResult {
  const parseRes = extractAndParseJSON(rawText);
  if (!parseRes.success || !parseRes.data) {
    return {
      isValid: false,
      errorMessage: parseRes.error || '无法解析模型输出为合法 JSON',
      canRepairLocally: false,
    };
  }

  const obj = parseRes.data;

  // 1. Check report_markdown
  if (typeof obj.report_markdown !== 'string' || obj.report_markdown.trim().length === 0) {
    return {
      isValid: false,
      errorMessage: '模型输出缺少非空的 report_markdown 正文字段',
      canRepairLocally: true,
    };
  }

  // 1.1 Check if model produced an unhelpful rejection notice (PRD 3.3)
  if (facts.completed_records.length > 0 && isRejectionOrInsufficientNotice(obj.report_markdown)) {
    return {
      isValid: false,
      errorMessage: '模型输出为信息不足拒绝句，触发本地基础摘要降级 (PRD 3.3)',
      canRepairLocally: true,
    };
  }

  // 2. Check evidence_map
  if (!Array.isArray(obj.evidence_map)) {
    return {
      isValid: false,
      errorMessage: '模型输出缺少 evidence_map 数组字段',
    };
  }

  // Set of valid instance IDs in facts completed_records
  const validInstanceIds = new Set(facts.completed_records.map((r) => r.instance_id));
  // Also accept task_id if ordinary task
  for (const r of facts.completed_records) {
    validInstanceIds.add(r.task_id);
  }

  const cleanedEvidence: EvidenceItem[] = [];
  for (let i = 0; i < obj.evidence_map.length; i++) {
    const item = obj.evidence_map[i];
    if (!item || typeof item.claim_text !== 'string' || !Array.isArray(item.task_instance_ids)) {
      return {
        isValid: false,
        errorMessage: `evidence_map 第 ${i + 1} 项格式错误 (须包含 claim_text 和 task_instance_ids)`,
      };
    }

    // Verify all referenced IDs exist in completed_records
    for (const id of item.task_instance_ids) {
      if (!validInstanceIds.has(id)) {
        return {
          isValid: false,
          errorMessage: `evidence_map 引用了不存在或未完成的依据 ID: 「${id}」(不得引用未完成父项或外部 ID)`,
        };
      }
    }

    cleanedEvidence.push({
      claim_text: item.claim_text,
      task_instance_ids: item.task_instance_ids,
    });
  }

  // 3. Check clarification_notes
  const cleanedNotes: ClarificationNote[] = [];
  if (Array.isArray(obj.clarification_notes)) {
    for (const note of obj.clarification_notes) {
      if (note && Array.isArray(note.task_instance_ids) && typeof note.issue === 'string') {
        cleanedNotes.push({
          task_instance_ids: note.task_instance_ids,
          issue: note.issue,
          suggested_input: note.suggested_input || '',
        });
      }
    }
  }

  // 4. Sanitize Markdown (PRD 6.3 - disable raw HTML and dangerous scripts)
  const sanitizedMarkdown = sanitizeMarkdown(obj.report_markdown);

  return {
    isValid: true,
    data: {
      report_markdown: sanitizedMarkdown,
      evidence_map: cleanedEvidence,
      clarification_notes: cleanedNotes,
    },
  };
}

/**
 * Strip dangerous HTML tags and script execution from markdown
 */
export function sanitizeMarkdown(md: string): string {
  return md
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/javascript:/gi, '');
}
