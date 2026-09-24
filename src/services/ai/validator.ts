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
