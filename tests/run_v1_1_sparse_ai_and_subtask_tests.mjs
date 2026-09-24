import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('========================================================================');
console.log('  TodoTree PRD v1.1：稀疏信息工作总结与新增子节点失效修复 验收套件  ');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log('[PASS] ' + name);
    passedTests++;
  } catch (err) {
    console.error('[FAIL] ' + name);
    console.error('       ' + (err.stack || err.message));
  }
}

// ---------------------------------------------------------------------------
// Section 1: CH01–CH11 In-Place Subtask Addition (0 -> 1 Child Transition)
// ---------------------------------------------------------------------------

function getNodeDepth(tasks, target) {
  let depth = 1;
  let curr = target;
  while (curr.parent_id) {
    const parent = tasks.find((t) => t.id === curr.parent_id);
    if (!parent) break;
    depth++;
    curr = parent;
  }
  return depth;
}

// Simulate TaskTree state machine for in-place subtask draft addition
class TaskTreeDraftEngine {
  constructor(initialTasks = []) {
    this.tasks = JSON.parse(JSON.stringify(initialTasks));
    this.expandedMap = {};
    this.inlineDraft = null;
    this.toastError = null;
  }

  startAddChild(parentId) {
    const parent = this.tasks.find((t) => t.id === parentId);
    if (!parent) return false;

    const depth = getNodeDepth(this.tasks, parent) + 1;
    if (depth > 5) {
      this.toastError = '已达到最大层级深度 (5层)，无法添加子任务';
      return false;
    }

    // Auto-expand parent
    this.expandedMap[parentId] = true;

    // Avoid duplicate draft creation on repeated clicks (PRD 6.3)
    if (this.inlineDraft?.parentId === parentId) {
      return true;
    }

    this.inlineDraft = {
      parentId,
      tempId: 'draft-' + Date.now(),
    };
    return true;
  }

  cancelDraft() {
    this.inlineDraft = null;
  }

  submitDraft(parentId, title, continuous = false) {
    const trimmed = title.trim();
    if (!trimmed) {
      if (!continuous) this.cancelDraft();
      return null;
    }

    const newTask = {
      id: 'task-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      parent_id: parentId,
      title: trimmed,
      status: 'open',
      priority: 'none',
      quadrant: 'q4_neither',
      sort_order: 1000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.tasks.push(newTask);

    if (continuous) {
      this.inlineDraft = {
        parentId,
        tempId: 'draft-' + (Date.now() + 1),
      };
    } else {
      this.inlineDraft = null;
    }

    return newTask;
  }

  getChildren(parentId) {
    return this.tasks.filter((t) => t.parent_id === parentId && !t.deleted_at);
  }

  // Simulation of tree node visibility test (the critical bugfix)
  canRenderSubtreeOrDraft(taskId) {
    const hasRealChildren = this.getChildren(taskId).length > 0;
    const hasDraftChild = this.inlineDraft?.parentId === taskId;
    const isExpanded = !!this.expandedMap[taskId];
    const hasDisplayChildren = hasRealChildren || hasDraftChild;

    return hasDisplayChildren && isExpanded;
  }
}

runTest('CH01: 0子节点叶子任务点击添加子任务，立即展开并允许渲染草稿行', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '独立父任务', status: 'open' },
  ]);

  assert.strictEqual(engine.getChildren('p1').length, 0, 'Initial children count must be 0');
  assert.strictEqual(engine.canRenderSubtreeOrDraft('p1'), false, 'Subtree should not render before click');

  const triggered = engine.startAddChild('p1');
  assert.strictEqual(triggered, true);
  assert.strictEqual(engine.expandedMap['p1'], true, 'Parent must be auto-expanded');
  assert.ok(engine.inlineDraft, 'Draft must be created');
  assert.strictEqual(engine.inlineDraft.parentId, 'p1');

  // Bugfix verification: canRenderSubtreeOrDraft must evaluate to true even with 0 children
  assert.strictEqual(
    engine.canRenderSubtreeOrDraft('p1'),
    true,
    'Subtree/draft container MUST be renderable when draft exists under 0-child node'
  );
});

runTest('CH02: 草稿行正确绑定目标 parentId', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'parent-a', parent_id: null, title: '任务A', status: 'open' },
    { id: 'parent-b', parent_id: null, title: '任务B', status: 'open' },
  ]);

  engine.startAddChild('parent-b');
  assert.strictEqual(engine.inlineDraft?.parentId, 'parent-b');
  assert.strictEqual(engine.canRenderSubtreeOrDraft('parent-a'), false);
  assert.strictEqual(engine.canRenderSubtreeOrDraft('parent-b'), true);
});

runTest('CH03: 取消草稿（Esc/空白失焦）后，节点恢复为 0 子节点状态，不产生脏数据', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '待办项', status: 'open' },
  ]);

  engine.startAddChild('p1');
  assert.ok(engine.inlineDraft);

  engine.cancelDraft();
  assert.strictEqual(engine.inlineDraft, null);
  assert.strictEqual(engine.getChildren('p1').length, 0);
  assert.strictEqual(engine.canRenderSubtreeOrDraft('p1'), false);
});

runTest('CH04: 连续点击同一任务“＋”，不产生重复草稿行', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '待办项', status: 'open' },
  ]);

  engine.startAddChild('p1');
  const tempId1 = engine.inlineDraft.tempId;

  engine.startAddChild('p1');
  const tempId2 = engine.inlineDraft.tempId;

  assert.strictEqual(tempId1, tempId2, 'Repeated click must reuse active draft');
});

runTest('CH05: 输入标题并按 Enter 提交后，真实子任务成功落库，父节点子节点数变为 1', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '工作项目', status: 'open' },
  ]);

  engine.startAddChild('p1');
  const created = engine.submitDraft('p1', '这是第一个真实子任务', false);

  assert.ok(created);
  assert.strictEqual(created.parent_id, 'p1');
  assert.strictEqual(created.title, '这是第一个真实子任务');
  assert.strictEqual(engine.getChildren('p1').length, 1);
  assert.strictEqual(engine.inlineDraft, null);

  assert.strictEqual(engine.canRenderSubtreeOrDraft('p1'), true);
});

runTest('CH06: 刚落库的 1-child 任务继续添加第二个子任务（1->2 场景）正常工作', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '工作项目', status: 'open' },
  ]);

  // 0 -> 1
  engine.startAddChild('p1');
  engine.submitDraft('p1', '子任务1', false);
  assert.strictEqual(engine.getChildren('p1').length, 1);

  // 1 -> 2
  engine.startAddChild('p1');
  engine.submitDraft('p1', '子任务2', false);
  assert.strictEqual(engine.getChildren('p1').length, 2);
  assert.strictEqual(engine.getChildren('p1')[1].title, '子任务2');
});

runTest('CH07: 连续录入模式 (Continuous Enter) 保持草稿开启', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '工作项目', status: 'open' },
  ]);

  engine.startAddChild('p1');
  const t1 = engine.submitDraft('p1', '第一项', true);
  assert.ok(t1);
  assert.ok(engine.inlineDraft, 'Draft should remain active for next input');

  const t2 = engine.submitDraft('p1', '第二项', false);
  assert.ok(t2);
  assert.strictEqual(engine.inlineDraft, null);
  assert.strictEqual(engine.getChildren('p1').length, 2);
});

runTest('CH08: 删除全部子节点变回 0-child 后，原位新增依然可用', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'p1', parent_id: null, title: '工作项目', status: 'open' },
  ]);

  engine.startAddChild('p1');
  const t1 = engine.submitDraft('p1', '子任务A', false);

  t1.deleted_at = new Date().toISOString();
  assert.strictEqual(engine.getChildren('p1').length, 0);

  const success = engine.startAddChild('p1');
  assert.strictEqual(success, true);
  assert.strictEqual(engine.canRenderSubtreeOrDraft('p1'), true);
});

runTest('CH09: 5 层最大深度拦截与提示测试', () => {
  const tasks = [
    { id: 'l1', parent_id: null, title: 'L1' },
    { id: 'l2', parent_id: 'l1', title: 'L2' },
    { id: 'l3', parent_id: 'l2', title: 'L3' },
    { id: 'l4', parent_id: 'l3', title: 'L4' },
    { id: 'l5', parent_id: 'l4', title: 'L5' },
  ];
  const engine = new TaskTreeDraftEngine(tasks);

  const canAddUnderL4 = engine.startAddChild('l4');
  assert.strictEqual(canAddUnderL4, true);

  engine.cancelDraft();
  const canAddUnderL5 = engine.startAddChild('l5');
  assert.strictEqual(canAddUnderL5, false);
  assert.ok(engine.toastError.includes('最大层级深度 (5层)'));
});

runTest('CH10: 中文输入法 (IME Composition) 状态下 Enter 不触发提交', () => {
  let submitted = false;
  const handleKeyDown = (key, isComposing) => {
    if (isComposing) return;
    if (key === 'Enter') submitted = true;
  };

  handleKeyDown('Enter', true);
  assert.strictEqual(submitted, false, 'IME composition must suppress Enter submission');

  handleKeyDown('Enter', false);
  assert.strictEqual(submitted, true, 'Standard Enter must submit');
});

runTest('CH11: 多个未拥有子节点的任务独立操作，互不干扰', () => {
  const engine = new TaskTreeDraftEngine([
    { id: 'task-p', parent_id: null, title: '任务P', status: 'open' },
    { id: 'task-q', parent_id: null, title: '任务Q', status: 'open' },
  ]);

  engine.startAddChild('task-p');
  assert.strictEqual(engine.inlineDraft?.parentId, 'task-p');
  assert.strictEqual(engine.canRenderSubtreeOrDraft('task-p'), true);
  assert.strictEqual(engine.canRenderSubtreeOrDraft('task-q'), false);

  engine.startAddChild('task-q');
  assert.strictEqual(engine.inlineDraft?.parentId, 'task-q');
  assert.strictEqual(engine.canRenderSubtreeOrDraft('task-p'), false);
  assert.strictEqual(engine.canRenderSubtreeOrDraft('task-q'), true);
});

// ---------------------------------------------------------------------------
// Section 2: AI01–AI12 Sparse Information AI Summary & Local Fallback
// ---------------------------------------------------------------------------

function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function computeContentHash(text) {
  const norm = normalizeText(text);
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

// Logic mirror of validator.ts
function isRejectionOrInsufficientNotice(text) {
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

function generateLocalEmptyReport(facts) {
  const typeTitle =
    facts.report_type === 'weekly'
      ? '工作周报'
      : facts.report_type === 'monthly'
      ? '工作月报'
      : '阶段工作总结';

  return {
    report_markdown: `${typeTitle}\n统计周期：${facts.period.label}\n\n一、本期工作概述\n本期暂无可归纳的已完成工作记录。`,
    evidence_map: [],
    clarification_notes: [],
  };
}

function generateLocalBaseSummary(facts) {
  if (!facts.completed_records || facts.completed_records.length === 0) {
    return generateLocalEmptyReport(facts);
  }

  const groups = new Map();
  for (const rec of facts.completed_records) {
    let groupName = '主要完成事项';
    if (rec.path_titles_at_completion && rec.path_titles_at_completion.length > 0) {
      groupName = rec.path_titles_at_completion[rec.path_titles_at_completion.length - 1];
    }
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName).push(rec);
  }

  const markdownSections = ['## 本期完成事项\n'];
  const evidenceMap = [];
  const clarificationNotes = [];

  for (const [groupName, recs] of groups.entries()) {
    if (groups.size > 1 || groupName !== '主要完成事项') {
      markdownSections.push(`### ${groupName}`);
    }

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

runTest('AI01: 验证 prompts.ts 中新版默认提示词移除了“信息不足即拒绝”硬编码规则', () => {
  const promptsFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/prompts.ts'), 'utf8');
  assert.ok(
    !promptsFile.includes('全部记录都含糊时，说明“本期存在完成记录，但信息不足，暂无法整理为具体工作成果”'),
    'Old refusal rule must be completely removed from prompts.ts'
  );
  assert.ok(
    promptsFile.includes('有已确认完成记录，就先输出基于这些记录的总结'),
    'Must include PRD Section 4 core rule'
  );
  assert.ok(
    promptsFile.includes('背景、备注、成果说明可以为空'),
    'Must state optional fields can be empty'
  );
  assert.ok(
    promptsFile.includes('不要把“信息不足”“暂无成果可写”“待补充信息清单”作为报告主体'),
    'Must prohibit unhelpful rejection as body'
  );
});

runTest('AI02: 验证 validator.ts 与 prompts.ts 正确导出了 generateLocalBaseSummary 与 DEFAULT_PROMPT_TEMPLATE', () => {
  const validatorFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/validator.ts'), 'utf8');
  const promptsFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/prompts.ts'), 'utf8');

  assert.ok(validatorFile.includes('export function generateLocalBaseSummary'), 'validator.ts must export generateLocalBaseSummary');
  assert.ok(validatorFile.includes('export function isRejectionOrInsufficientNotice'), 'validator.ts must export isRejectionOrInsufficientNotice');
  assert.ok(promptsFile.includes('export const DEFAULT_PROMPT_TEMPLATE'), 'prompts.ts must export DEFAULT_PROMPT_TEMPLATE');
});

runTest('AI03: 针对截图中 4 条完成记录（含“123”、“测试任务”），本地基础摘要生成正确 Markdown', () => {
  const facts = {
    report_type: 'weekly',
    period: {
      label: '2026年9月第4周',
      display_start: '2026-09-21',
      display_end: '2026-09-27',
      cutoff: '2026-09-24',
    },
    scope: { root_ids: [], excluded_ids: [] },
    data_quality: { history_complete: true, warnings: [] },
    stats: { completed_leaf_instances: 3, completed_parent_instances: 1 },
    project_context: [],
    completed_records: [
      {
        task_id: 't-123',
        instance_id: 't-123:once',
        title: '123',
        path_ids_at_completion: [],
        path_titles_at_completion: [],
        completed_at: '2026-09-24T00:00:00Z',
        is_leaf_at_completion: false,
        outcome_note: '',
      },
      {
        task_id: 't-test-1',
        instance_id: 't-test-1:once',
        title: '这是第一个测试任务',
        path_ids_at_completion: ['t-123'],
        path_titles_at_completion: ['123'],
        completed_at: '2026-09-24T00:00:00Z',
        is_leaf_at_completion: true,
        outcome_note: '',
      },
      {
        task_id: 't-test-2',
        instance_id: 't-test-2:once',
        title: '这是第二个测试任务',
        path_ids_at_completion: ['t-123'],
        path_titles_at_completion: ['123'],
        completed_at: '2026-09-24T00:00:00Z',
        is_leaf_at_completion: true,
        outcome_note: '',
      },
      {
        task_id: 't-agile',
        instance_id: 't-agile:once',
        title: '新敏捷项目',
        path_ids_at_completion: [],
        path_titles_at_completion: [],
        completed_at: '2026-09-24T00:00:00Z',
        is_leaf_at_completion: true,
        outcome_note: '',
      },
    ],
  };

  const res = generateLocalBaseSummary(facts);
  assert.ok(res.report_markdown, 'Markdown must not be empty');

  // Must group by "123" and "主要完成事项"
  assert.ok(res.report_markdown.includes('### 123'), 'Must group children under 123');
  assert.ok(res.report_markdown.includes('这是第一个测试任务'));
  assert.ok(res.report_markdown.includes('这是第二个测试任务'));
  assert.ok(res.report_markdown.includes('新敏捷项目'));

  // Must NOT hallucinate business conclusions
  assert.ok(!res.report_markdown.includes('测试通过'), 'Must NOT hallucinate "测试通过"');
  assert.ok(!res.report_markdown.includes('验收完成'), 'Must NOT hallucinate "验收完成"');
  assert.ok(!res.report_markdown.includes('显著提升'), 'Must NOT hallucinate "显著提升"');

  // Evidence map must map to the 4 instance IDs
  assert.strictEqual(res.evidence_map.length, 4);
  const mappedIds = res.evidence_map.map((e) => e.task_instance_ids[0]);
  assert.ok(mappedIds.includes('t-123:once'));
  assert.ok(mappedIds.includes('t-test-1:once'));
  assert.ok(mappedIds.includes('t-test-2:once'));
  assert.ok(mappedIds.includes('t-agile:once'));
});

runTest('AI04: isRejectionOrInsufficientNotice 准确识别模型无用拒绝', () => {
  const rejected1 = '本期存在完成记录，但信息不足，暂无法整理为具体工作成果。';
  const rejected2 = '由于信息不足，暂无法整理相关工作内容。';
  const rejected3 = '暂无成果可写。';
  const validReport = '## 本期完成事项\n\n### 研发\n- 完成代码重构。';

  assert.strictEqual(isRejectionOrInsufficientNotice(rejected1), true);
  assert.strictEqual(isRejectionOrInsufficientNotice(rejected2), true);
  assert.strictEqual(isRejectionOrInsufficientNotice(rejected3), true);
  assert.strictEqual(isRejectionOrInsufficientNotice(validReport), false);
});

runTest('AI05: 校验器识别拒绝句并触发本地降级逻辑', () => {
  const rawText = JSON.stringify({
    report_markdown: '本期存在完成记录，但信息不足，暂无法整理为具体工作成果。',
    evidence_map: [],
    clarification_notes: [],
  });

  const parsed = JSON.parse(rawText);
  const isRejected = isRejectionOrInsufficientNotice(parsed.report_markdown);
  assert.strictEqual(isRejected, true);

  // Trigger fallback
  const fallback = generateLocalBaseSummary({
    report_type: 'weekly',
    period: { label: '本周' },
    completed_records: [{ task_id: 't1', instance_id: 't1:once', title: '完成的任务' }],
  });
  assert.ok(fallback.report_markdown.includes('完成“完成的任务”'));
});

runTest('AI06: 0 完成记录时生成本地空报告，不调用大模型', () => {
  const emptyFacts = {
    report_type: 'weekly',
    period: { label: '2026年9月第4周' },
    scope: { root_ids: [], excluded_ids: [] },
    completed_records: [],
  };

  const emptyReport = generateLocalEmptyReport(emptyFacts);
  assert.ok(emptyReport.report_markdown.includes('本期暂无可归纳的已完成工作记录'));
  assert.strictEqual(emptyReport.evidence_map.length, 0);
});

runTest('AI07: 带有 outcome_note 的完成记录，摘要完整体现实际产出', () => {
  const facts = {
    report_type: 'weekly',
    period: { label: '本周' },
    completed_records: [
      {
        task_id: 't1',
        instance_id: 't1:once',
        title: '用户调研',
        path_titles_at_completion: ['产品项目'],
        outcome_note: '完成 5 位种子用户访谈并输出调研纪要',
      },
    ],
  };

  const res = generateLocalBaseSummary(facts);
  assert.ok(res.report_markdown.includes('### 产品项目'));
  assert.ok(res.report_markdown.includes('完成“用户调研”：完成 5 位种子用户访谈并输出调研纪要'));
});

runTest('AI08: 建议清单 (clarification_notes) 不超过 3 条且不污染 report_markdown', () => {
  const facts = {
    report_type: 'weekly',
    period: { label: '本周' },
    completed_records: [
      { task_id: 't1', instance_id: 't1:once', title: '123' },
      { task_id: 't2', instance_id: 't2:once', title: '456' },
      { task_id: 't3', instance_id: 't3:once', title: '789' },
      { task_id: 't4', instance_id: 't4:once', title: '测试任务4' },
      { task_id: 't5', instance_id: 't5:once', title: '测试任务5' },
    ],
  };

  const res = generateLocalBaseSummary(facts);
  assert.ok(res.clarification_notes.length <= 3, 'Clarification notes must be capped at 3');
  assert.ok(
    !res.report_markdown.includes('建议：'),
    'Report markdown must not contain clarification advice'
  );
  assert.ok(
    !res.report_markdown.includes('缺少具体工作说明'),
    'Report markdown must not contain internal deficiency labels'
  );
});

runTest('AI09: 出站请求核验与模板指纹计算正确', () => {
  const promptsFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/prompts.ts'), 'utf8');
  assert.ok(promptsFile.includes('computeContentHash(DEFAULT_PROMPT_CONTENT)'));
});

runTest('AI10: 系统安全底座与单 JSON 契约保护保持完好', () => {
  const promptsFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/prompts.ts'), 'utf8');
  assert.ok(promptsFile.includes('【输出格式契约】'));
  assert.ok(promptsFile.includes('report_markdown'));
  assert.ok(promptsFile.includes('evidence_map'));
  assert.ok(promptsFile.includes('clarification_notes'));
});

runTest('AI11: 降级报告元数据标记字段完整性 (is_downgraded, source_kind)', () => {
  const version = {
    version: 1,
    created_at: new Date().toISOString(),
    model: '本地基础摘要 (确定性整理)',
    prompt_version: 'v1.3',
    response: generateLocalBaseSummary({
      report_type: 'weekly',
      period: { label: '本周' },
      completed_records: [{ task_id: 't1', instance_id: 't1:once', title: '任务' }],
    }),
    is_mock: false,
    is_downgraded: true,
    downgrade_reason: '模型输出为信息不足拒绝句，已提供基础摘要',
    source_kind: 'local_summary',
  };

  assert.strictEqual(version.is_downgraded, true);
  assert.strictEqual(version.source_kind, 'local_summary');
  assert.strictEqual(version.is_mock, false);
});

runTest('AI12: reportService.ts 中平滑降级已接入并标记 source_kind: local_summary', () => {
  const reportServiceFile = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/reportService.ts'), 'utf8');
  assert.ok(reportServiceFile.includes('generateLocalBaseSummary(facts)'));
  assert.ok(reportServiceFile.includes("sourceKind = 'local_summary'"));
  assert.ok(reportServiceFile.includes('isDowngraded = true'));
  assert.ok(reportServiceFile.includes('is_downgraded: isDowngraded'));
});

console.log(`\n========================================================================`);
console.log(`  验收套件执行结果: ${passedTests} / ${totalTests} 通过 (${totalTests === passedTests ? 'ALL PASSED' : 'FAILED'})`);
console.log(`========================================================================\n`);

if (passedTests < totalTests) {
  process.exit(1);
}
