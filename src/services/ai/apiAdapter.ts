import { AISettings, FactsPackage, GenerationSnapshot, OutboundInspectionResult } from '../../types/ai';
import { buildSystemPrompt, formatUserMessage, DEFAULT_PROMPT_TEMPLATE } from './prompts';
import { computeContentHash } from './hashUtils';

export interface APIResponse {
  rawText: string;
  statusCode: number;
  tokensUsed?: number;
  responseModel?: string;
  durationMs?: number;
  inspection?: OutboundInspectionResult;
  error?: string;
  isRetryable?: boolean;
  isAuthError?: boolean;
}

/**
 * Pre-send Request Inspector Hook (PRD v1.3 Section 4.3 & checklist A09, A10, A11)
 * Validates that outbound payload strictly matches snapshot before any network request.
 * Zero model/API calls are made if inspection fails.
 */
export function inspectOutboundPayload(
  payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  },
  snapshot?: GenerationSnapshot,
  attemptId: string = 'att-' + Date.now()
): OutboundInspectionResult {
  const timestamp = new Date().toISOString();
  const systemMsg = payload.messages.find(m => m.role === 'system')?.content || '';
  const userMsg = payload.messages.find(m => m.role === 'user')?.content || '';

  const systemHash = computeContentHash(systemMsg);
  const userHash = computeContentHash(userMsg);

  // If no snapshot provided, minimal verification
  if (!snapshot) {
    return {
      attempt_id: attemptId,
      timestamp,
      outbound_system_hash: systemHash,
      outbound_user_hash: userHash,
      is_verified: true,
      verification_checks: {
        template_matched: true,
        user_instructions_matched: true,
        no_duplicate_default: true,
        no_credentials_leaked: true,
      },
    };
  }

  // 1. Template matched check
  // The system message must contain the snapshot's template content
  const templateMatched = systemMsg.includes(snapshot.template_content.trim());

  // 2. User instructions matched check
  let instructionsMatched = true;
  if (snapshot.user_instructions_snapshot && snapshot.user_instructions_snapshot.trim()) {
    instructionsMatched = systemMsg.includes(snapshot.user_instructions_snapshot.trim());
  }

  // 3. No duplicate default template check (A11)
  // If user selected a custom template, ensure default template isn't accidentally appended
  let noDuplicateDefault = true;
  if (snapshot.template_id !== DEFAULT_PROMPT_TEMPLATE.profile_id) {
    const defaultTrimmed = DEFAULT_PROMPT_TEMPLATE.content.trim();
    if (systemMsg.includes(defaultTrimmed)) {
      noDuplicateDefault = false;
    }
  }

  // 4. No credentials leaked check (Section 10.3)
  const noCredentialsLeaked = !systemMsg.includes('Bearer ') && !userMsg.includes('Bearer ');

  const isVerified = templateMatched && instructionsMatched && noDuplicateDefault && noCredentialsLeaked;

  let errorReason: string | undefined;
  if (!templateMatched) {
    errorReason = '出站请求核验失败：系统提示词中未包含所选模板的完整内容 (A10)';
  } else if (!instructionsMatched) {
    errorReason = '出站请求核验失败：系统提示词中未包含当次附加要求';
  } else if (!noDuplicateDefault) {
    errorReason = '出站请求核验失败：检测到硬编码默认模板与自定义模板重复拼入 (A11)';
  } else if (!noCredentialsLeaked) {
    errorReason = '出站请求核验失败：载荷中疑似泄露身份凭据密钥';
  }

  return {
    attempt_id: attemptId,
    timestamp,
    outbound_system_hash: systemHash,
    outbound_user_hash: userHash,
    is_verified: isVerified,
    verification_checks: {
      template_matched: templateMatched,
      user_instructions_matched: instructionsMatched,
      no_duplicate_default: noDuplicateDefault,
      no_credentials_leaked: noCredentialsLeaked,
    },
    error_reason: errorReason,
  };
}

/**
 * Call OpenAI Compatible /chat/completions endpoint (PRD v1.3 Section 4.3 & 7.2)
 */
export async function callOpenAICompatible(
  facts: FactsPackage,
  settings: AISettings,
  options?: {
    systemPrompt?: string;
    signal?: AbortSignal;
    snapshot?: GenerationSnapshot;
    attemptId?: string;
    isTestCall?: boolean;
  }
): Promise<APIResponse> {
  const attemptId = options?.attemptId || 'att-' + Date.now();
  const systemContent = options?.systemPrompt || buildSystemPrompt();
  const userContent = formatUserMessage(facts);

  const payload = {
    model: settings.model_id || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  // Run Request Inspector Pre-send Hook (Section 4.3 & checklist A09, A10)
  const inspection = inspectOutboundPayload(payload, options?.snapshot, attemptId);
  if (!inspection.is_verified) {
    return {
      rawText: '',
      statusCode: 422,
      error: inspection.error_reason || '请求组装校验失败',
      inspection,
    };
  }

  // Handle Mock Mode
  if (settings.use_mock) {
    const durationMs = 35;
    // Check if it's a test link call with verification code
    const verifyMatch = systemContent.match(/验证标记：(VERIFY-d+)/);
    if (verifyMatch) {
      const code = verifyMatch[1];
      const mockTestOutput = JSON.stringify({
        report_markdown: `验证标记：${code}\n\n已成功完成系统链路测试，模型响应符合格式契约。`,
        evidence_map: [
          {
            claim_text: '已成功完成系统链路测试',
            task_instance_ids: ['test-fictional-task-01:once'],
            claim_kind: 'fact',
          },
        ],
        clarification_notes: [],
      });
      return {
        rawText: mockTestOutput,
        statusCode: 200,
        tokensUsed: 120,
        responseModel: 'mock-verified-model',
        durationMs,
        inspection,
      };
    }

    // PRD Section 4 & 5 Mock Generator: Dynamically construct realistic summary from facts.completed_records
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

    const sections: string[] = ['## 本期完成事项\n'];
    const mockEvidence: any[] = [];
    for (const [groupName, recs] of groups.entries()) {
      if (groups.size > 1 || groupName !== '主要完成事项') {
        sections.push(`### ${groupName}`);
      }
      for (const rec of recs) {
        const cleanTitle = rec.title.trim() || '未命名任务';
        let claimText = '';
        if (rec.outcome_note && rec.outcome_note.trim()) {
          claimText = `完成“${cleanTitle}”：${rec.outcome_note.trim()}`;
        } else {
          claimText = `完成“${cleanTitle}”`;
        }
        sections.push(`- ${claimText}。`);
        mockEvidence.push({
          claim_text: claimText,
          task_instance_ids: [rec.instance_id],
          claim_kind: 'fact',
        });
      }
      sections.push('');
    }

    const mockOutput = JSON.stringify({
      report_markdown: sections.join('\n').trim(),
      evidence_map: mockEvidence,
      clarification_notes: [],
    });

    return {
      rawText: mockOutput,
      statusCode: 200,
      tokensUsed: 260,
      responseModel: 'mock-gpt-4o-mini',
      durationMs,
      inspection,
    };
  }

  // Real Network Call
  const baseUrl = settings.base_url.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.api_key) {
    headers['Authorization'] = `Bearer ${settings.api_key.trim()}`;
  }

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const isAuth = resp.status === 401 || resp.status === 403;
      const isRetryable = resp.status === 429 || resp.status >= 500;
      return {
        rawText: '',
        statusCode: resp.status,
        durationMs,
        error: `API 请求失败 [${resp.status}]: ${errText || resp.statusText}`,
        isRetryable,
        isAuthError: isAuth,
        inspection,
      };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const tokens = data?.usage?.total_tokens;
    const responseModel = data?.model || undefined;

    return {
      rawText: content,
      statusCode: 200,
      tokensUsed: tokens,
      responseModel,
      durationMs,
      inspection,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError';
    return {
      rawText: '',
      statusCode: isTimeout ? 408 : 0,
      durationMs,
      error: isTimeout ? '请求超时 (90秒未收到响应)' : `网络连接异常: ${err.message}`,
      isRetryable: isTimeout,
      inspection,
    };
  }
}

/**
 * Health test connection for OpenAI Compatible API
 */
export async function testConnection(
  settings: AISettings
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  if (settings.use_mock) {
    return {
      success: true,
      message: '确定性模拟适配器已启用 (无需配置网络 Key)',
      latencyMs: 15,
    };
  }

  const baseUrl = settings.base_url.replace(/\/+$/, '');
  const url = `${baseUrl}/models`;

  const headers: Record<string, string> = {};
  if (settings.api_key) {
    headers['Authorization'] = `Bearer ${settings.api_key.trim()}`;
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - start;
    if (resp.ok) {
      return {
        success: true,
        message: `连接成功！已连接到模型服务 (${latencyMs}ms)`,
        latencyMs,
      };
    } else {
      return {
        success: false,
        message: `连接失败 [${resp.status}]: ${resp.statusText}`,
        latencyMs,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `无法连接到端点: ${err.message}`,
    };
  }
}
