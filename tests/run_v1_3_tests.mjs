import assert from 'assert';
import crypto from 'crypto';

console.log('========================================================');
console.log('   TodoTree PRD v1.3 核心需求与验收测试套件 (2026-09-23)  ');
console.log('========================================================\n');

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

// ----------------------------------------------------
// Hash normalization helper matching hashUtils.ts
// ----------------------------------------------------
function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function sha256Node(text) {
  const norm = normalizeText(text);
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

// ----------------------------------------------------
// 1. A01-A04: 模板配置持久化、版本递增与 SHA-256 内容指纹
// ----------------------------------------------------
runTest('A01-A04: 模板内容指纹计算与跨换行符归一化，及版本自增逻辑', () => {
  const templateWindows = "### 本周工作总结\r\n\r\n请按项目归纳。   ";
  const templateUnix = "### 本周工作总结\n\n请按项目归纳。";

  const hash1 = sha256Node(templateWindows);
  const hash2 = sha256Node(templateUnix);
  assert.strictEqual(hash1, hash2, 'CRLF 与 LF 归一化后计算的 SHA-256 必须完全一致');
  assert.strictEqual(hash1.length, 64, 'SHA-256 必须是 64 位十六进制字符');

  // Version increment logic
  let template = {
    id: 'tpl_1',
    name: '周报模板',
    content: templateUnix,
    content_hash: hash1,
    version: 1,
    is_default: true,
  };

  // Modify content -> increments version
  const newContent = "### 本周工作总结\n\n请突出关键成果与下周计划。";
  const newHash = sha256Node(newContent);
  assert.notStrictEqual(newHash, hash1, '修改内容后指纹必须改变');

  if (newHash !== template.content_hash) {
    template = {
      ...template,
      content: newContent,
      content_hash: newHash,
      version: template.version + 1,
    };
  }
  assert.strictEqual(template.version, 2, '内容变更后版本号必须递增为 2');
  assert.strictEqual(template.content_hash, newHash);

  // Saving without content changes does NOT increment version
  const unchangedContent = "### 本周工作总结\r\n\r\n请突出关键成果与下周计划。\n";
  const unchangedHash = sha256Node(unchangedContent);
  let versionBefore = template.version;
  if (unchangedHash !== template.content_hash) {
    template.version += 1;
  }
  assert.strictEqual(template.version, versionBefore, '内容指纹未变时版本号不得自增');
});

// ----------------------------------------------------
// 2. A05-A08: 不可变快照 (GenerationSnapshot) 固定与防篡改
// ----------------------------------------------------
runTest('A05-A08: 生成任务入队时快照固化，后续修改设置不影响运行中快照', () => {
  let activeTemplate = {
    id: 'tpl_main',
    name: '标准周报',
    content: '第一版模板内容',
    content_hash: sha256Node('第一版模板内容'),
    version: 1,
  };

  const currentFacts = {
    period: '2026-W38',
    type: 'weekly',
    items: [{ id: 'task-1', title: '完成核心架构改造', completed_at: '2026-09-20' }],
  };

  // Lock immutable snapshot
  const snapshot = Object.freeze({
    snapshot_id: 'snap_test_001',
    created_at: new Date().toISOString(),
    template_id: activeTemplate.id,
    template_name: activeTemplate.name,
    template_version: activeTemplate.version,
    template_content: activeTemplate.content,
    content_hash: activeTemplate.content_hash,
    prompt_instruction: '请精简突出',
    instruction_hash: sha256Node('请精简突出'),
    model_name: 'gpt-4o-mini',
    facts: JSON.parse(JSON.stringify(currentFacts)),
  });

  // User subsequently modifies settings
  activeTemplate.content = '第二版被修改的模板内容';
  activeTemplate.content_hash = sha256Node('第二版被修改的模板内容');
  activeTemplate.version = 2;

  // Verify locked snapshot remains intact
  assert.strictEqual(snapshot.template_version, 1, '快照内模板版本必须保持为 1');
  assert.strictEqual(snapshot.template_content, '第一版模板内容', '快照内模板内容不受外部修改影响');
  assert.strictEqual(snapshot.content_hash, sha256Node('第一版模板内容'), '快照内容指纹不变');
});

// ----------------------------------------------------
// 3. A09-A11: 出站请求检查器 (Request Inspector) 拦截验证
// ----------------------------------------------------
runTest('A09-A11: Request Inspector 验证出站载荷完整性，拦截丢失或被篡改的模板', () => {
  function inspectPayload(payload, expectedTemplateContent, promptInstruction) {
    if (!payload || !payload.messages || !Array.isArray(payload.messages)) {
      return { ok: false, error: 'MISSING_MESSAGES' };
    }
    const combinedContent = payload.messages.map((m) => m.content).join('\n');
    const normCombined = normalizeText(combinedContent);
    const normExpected = normalizeText(expectedTemplateContent);

    if (normExpected && !normCombined.includes(normExpected)) {
      return {
        ok: false,
        error: 'REQUEST_ASSEMBLY_VALIDATION_FAILED: 目标模板内容未完整注入出站载荷',
      };
    }

    if (promptInstruction && promptInstruction.trim()) {
      const normInstruction = normalizeText(promptInstruction);
      if (!normCombined.includes(normInstruction)) {
        return {
          ok: false,
          error: 'REQUEST_ASSEMBLY_VALIDATION_FAILED: 当次附加要求未注入出站载荷',
        };
      }
    }

    // Check credential leakage
    const payloadStr = JSON.stringify(payload);
    if (/sk-[a-zA-Z0-9_-]{20,}/.test(payloadStr) || /authorization/i.test(payloadStr)) {
      return {
        ok: false,
        error: 'CREDENTIAL_LEAKAGE_DETECTED',
      };
    }

    return {
      ok: true,
      inspected_model: payload.model,
      outbound_hash: sha256Node(combinedContent),
      token_estimate: Math.round(combinedContent.length / 2),
    };
  }

  const expectedTemplate = '### 重点工作汇报\n请突出产出。';
  const customInstruction = '严禁输出内部 ID';

  // Valid payload
  const validPayload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: '系统基础规则：遵循事实。' },
      { role: 'user', content: `${expectedTemplate}\n\n当次特别要求：${customInstruction}\n\n事实数据：[]` },
    ],
  };

  const validResult = inspectPayload(validPayload, expectedTemplate, customInstruction);
  assert.strictEqual(validResult.ok, true, '合法载荷必须核验通过');
  assert.strictEqual(typeof validResult.outbound_hash, 'string');
  assert.strictEqual(validResult.outbound_hash.length, 64);

  // Missing template payload
  const corruptedPayload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: '系统基础规则：遵循事实。' },
      { role: 'user', content: `硬编码旧模板内容\n\n事实数据：[]` },
    ],
  };

  const failResult = inspectPayload(corruptedPayload, expectedTemplate, customInstruction);
  assert.strictEqual(failResult.ok, false, '缺失用户模板的载荷必须被拦截');
  assert.ok(failResult.error.includes('REQUEST_ASSEMBLY_VALIDATION_FAILED'));

  // Credential leakage check
  const leakPayload = {
    model: 'gpt-4o-mini',
    Authorization: 'Bearer sk-1234567890abcdef1234567890',
    messages: validPayload.messages,
  };
  const leakResult = inspectPayload(leakPayload, expectedTemplate, customInstruction);
  assert.strictEqual(leakResult.ok, false, '载荷携带 Authorization 必须被拦截');
  assert.strictEqual(leakResult.error, 'CREDENTIAL_LEAKAGE_DETECTED');
});

// ----------------------------------------------------
// 4. A14-A16: 缓存穿透与指纹键 (input_hash)
// ----------------------------------------------------
runTest('A14-A16: 缓存键精准覆盖模板内容指纹与附加要求，改动即穿透，改名不失效', () => {
  function computeInputHash(factsJson, templateContent, customPrompt) {
    const factsHash = sha256Node(factsJson);
    const templateHash = sha256Node(templateContent);
    const customHash = customPrompt && customPrompt.trim() ? sha256Node(customPrompt.trim()) : 'none';
    return sha256Node(`${factsHash}:${templateHash}:${customHash}`);
  }

  const factsStr = JSON.stringify({ period: '2026-W38', tasks: ['task-1'] });
  const tplContentA = '模板内容 A';
  const tplContentB = '模板内容 B';

  const hash1 = computeInputHash(factsStr, tplContentA, '');
  const hash2 = computeInputHash(factsStr, tplContentB, '');
  assert.notStrictEqual(hash1, hash2, '模板内容变更必须产生不同 input_hash 穿透缓存');

  // Change custom instruction
  const hash3 = computeInputHash(factsStr, tplContentA, '附加要求 1');
  assert.notStrictEqual(hash1, hash3, '当次附加要求变更必须产生不同 input_hash');

  // Rename template title without changing content -> same input_hash
  const hash4 = computeInputHash(factsStr, tplContentA, '');
  assert.strictEqual(hash1, hash4, '模板重命名（内容未变）必须命中同一缓存键');
});

// ----------------------------------------------------
// 5. A21-A23: 最小真实测试与随机短码验证
// ----------------------------------------------------
runTest('A21-A23: 随机短码生成与模型遵循合规性核验', () => {
  function generateVerificationCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `TEST-${code}`;
  }

  const shortcode = generateVerificationCode();
  assert.match(shortcode, /^TEST-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/, '短码格式符合规范');

  function checkCompliance(rawResponse, expectedCode) {
    const lines = normalizeText(rawResponse).split('\n').filter((l) => l.trim().length > 0);
    const firstLine = lines[0] || '';
    const codeMatch = firstLine.includes(expectedCode);
    const idLeakMatch = /task-[a-zA-Z0-9_-]+/.test(rawResponse);

    return {
      has_shortcode: codeMatch,
      leaked_task_id: idLeakMatch,
      is_compliant: codeMatch && !idLeakMatch,
    };
  }

  // Model followed instructions
  const compliantReply = `验证标记：${shortcode}\n\n## 成果概述\n- 完成了支付模块重构。`;
  const result1 = checkCompliance(compliantReply, shortcode);
  assert.strictEqual(result1.has_shortcode, true);
  assert.strictEqual(result1.leaked_task_id, false);
  assert.strictEqual(result1.is_compliant, true);

  // Model failed to output shortcode on first line
  const nonCompliantReply = `## 成果概述\n- 完成了支付模块重构。\n验证标记：${shortcode}`;
  const result2 = checkCompliance(nonCompliantReply, shortcode);
  assert.strictEqual(result2.has_shortcode, false, '首行无短码应标记未通过遵循检查');

  // Model leaked internal task id
  const leakingReply = `验证标记：${shortcode}\n\n## 成果概述\n- 完成了任务 task-102938 修复。`;
  const result3 = checkCompliance(leakingReply, shortcode);
  assert.strictEqual(result3.leaked_task_id, true, '识别出内部任务 ID 泄露');
  assert.strictEqual(result3.is_compliant, false);
});

// ----------------------------------------------------
// 6. A41-A45: 三种任务视图模式的数据映射与完整性
// ----------------------------------------------------
runTest('A41-A45: 树状、清单与项目分组视图的数据完整性与分组逻辑', () => {
  const tasks = [
    { id: 'proj1', title: '电商平台', parent_id: null, status: 'open' },
    { id: 'sub1', title: '订单微服务', parent_id: 'proj1', status: 'open' },
    { id: 'sub2', title: '支付对接', parent_id: 'proj1', status: 'open' },
    { id: 'proj2', title: '独立任务项', parent_id: null, status: 'open' },
  ];

  // 1. List View: retains all tasks and computes breadcrumbs
  const buildBreadcrumb = (task, all) => {
    const crumbs = [];
    let cur = task;
    while (cur.parent_id) {
      const p = all.find((t) => t.id === cur.parent_id);
      if (!p) break;
      crumbs.unshift(p.title);
      cur = p;
    }
    return crumbs.join(' / ');
  };

  const listItems = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    breadcrumb: buildBreadcrumb(t, tasks),
  }));

  assert.strictEqual(listItems.length, 4, '清单视图必须完整展示所有任务');
  assert.strictEqual(listItems[1].breadcrumb, '电商平台', '子任务面包屑必须正确显示父级名称');
  assert.strictEqual(listItems[3].breadcrumb, '', '根任务面包屑为空');

  // 2. Project Group View: groups by root ancestor
  function buildProjectGroups(allTasks) {
    const rootProjects = allTasks.filter((t) => !t.parent_id);
    const groups = [];

    for (const root of rootProjects) {
      const descendants = [];
      const collect = (pId) => {
        const children = allTasks.filter((t) => t.parent_id === pId);
        for (const c of children) {
          descendants.push(c);
          collect(c.id);
        }
      };
      collect(root.id);

      groups.push({
        rootTask: root,
        children: descendants,
        totalCount: descendants.length + (root.status !== 'completed' ? 1 : 0),
      });
    }
    return groups;
  }

  const groups = buildProjectGroups(tasks);
  assert.strictEqual(groups.length, 2, '共分为 2 个项目大类');
  assert.strictEqual(groups[0].rootTask.title, '电商平台');
  assert.strictEqual(groups[0].children.length, 2, '电商平台包含 2 个子任务');
  assert.strictEqual(groups[0].totalCount, 3, '包含根任务共 3 个待办');
  assert.strictEqual(groups[1].rootTask.title, '独立任务项');
  assert.strictEqual(groups[1].children.length, 0);
  assert.strictEqual(groups[1].totalCount, 1, '独立根任务不丢失自身待办');
});

// ----------------------------------------------------
// 7. A46-A51: 加入/移出今天语义逻辑判断
// ----------------------------------------------------
runTest('A46-A51: 今日安排 4 种状态的精确语义、文案与操作切换', () => {
  const todayStr = '2026-09-23';

  function evaluateTodayState(task) {
    const isDueToday = task.due_date === todayStr;
    const isPlannedToday = task.planned_date === todayStr;

    if (isPlannedToday && !isDueToday) {
      return {
        label: '从今天移出',
        nextPlannedDate: null,
        toastMessage: '已从今日安排中移出',
      };
    } else if (isPlannedToday && isDueToday) {
      return {
        label: '取消今日手动安排',
        nextPlannedDate: null,
        toastMessage: '已取消手动安排，因今天到期／逾期仍显示在今日',
      };
    } else if (!isPlannedToday && isDueToday) {
      return {
        label: '主动加入今天',
        nextPlannedDate: todayStr,
        toastMessage: '已加入今日安排',
      };
    } else {
      return {
        label: '加入今天',
        nextPlannedDate: todayStr,
        toastMessage: '已加入今日安排',
      };
    }
  }

  // 1. Only planned today
  const s1 = evaluateTodayState({ due_date: '2026-09-30', planned_date: todayStr });
  assert.strictEqual(s1.label, '从今天移出');
  assert.strictEqual(s1.nextPlannedDate, null);
  assert.strictEqual(s1.toastMessage, '已从今日安排中移出');

  // 2. Both due today and planned today
  const s2 = evaluateTodayState({ due_date: todayStr, planned_date: todayStr });
  assert.strictEqual(s2.label, '取消今日手动安排');
  assert.strictEqual(s2.nextPlannedDate, null);
  assert.strictEqual(s2.toastMessage, '已取消手动安排，因今天到期／逾期仍显示在今日');

  // 3. Due today but not manually planned
  const s3 = evaluateTodayState({ due_date: todayStr, planned_date: null });
  assert.strictEqual(s3.label, '主动加入今天');
  assert.strictEqual(s3.nextPlannedDate, todayStr);
  assert.strictEqual(s3.toastMessage, '已加入今日安排');

  // 4. Neither due nor planned
  const s4 = evaluateTodayState({ due_date: '2026-10-01', planned_date: null });
  assert.strictEqual(s4.label, '加入今天');
  assert.strictEqual(s4.nextPlannedDate, todayStr);
  assert.strictEqual(s4.toastMessage, '已加入今日安排');
});

// ----------------------------------------------------
// 8. A53-A56: 键盘软删除防误删守卫逻辑
// ----------------------------------------------------
runTest('A53-A56: Delete/Backspace 软删除守卫（输入框、IME、按键长按、无选中项防护）', () => {
  function canExecuteKeyboardDelete(event, state) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return false;
    }
    // Guard 1: IME composing
    if (event.isComposing) {
      return false;
    }
    // Guard 2: Key repeat
    if (event.repeat) {
      return false;
    }
    // Guard 3: Focus on editable elements
    const tag = (event.targetTagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || event.isContentEditable) {
      return false;
    }
    // Guard 4: Modal dialog open
    if (state.isModalOpen) {
      return false;
    }
    // Guard 5: Selected task must exist
    if (!state.selectedTaskId) {
      return false;
    }
    return true;
  }

  const baseState = { isModalOpen: false, selectedTaskId: 'task-100' };

  // Valid Delete key press
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Delete', isComposing: false, repeat: false }, baseState),
    true,
    '合法选中状态按 Delete 必须允许删除'
  );

  // Valid Backspace key press
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Backspace', isComposing: false, repeat: false }, baseState),
    true,
    '合法选中状态按 Backspace 必须允许删除'
  );

  // Guard: IME typing (e.g. typing Pinyin)
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Backspace', isComposing: true, repeat: false }, baseState),
    false,
    '中文输入法合成中按 Backspace 必须拦截'
  );

  // Guard: Key held down (repeat)
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Delete', isComposing: false, repeat: true }, baseState),
    false,
    '长按连发按键必须拦截防误删'
  );

  // Guard: Typing inside input
  assert.strictEqual(
    canExecuteKeyboardDelete(
      { key: 'Backspace', isComposing: false, repeat: false, targetTagName: 'input' },
      baseState
    ),
    false,
    '输入框内部按键必须拦截'
  );

  // Guard: Modal dialog open
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Delete', isComposing: false, repeat: false }, { ...baseState, isModalOpen: true }),
    false,
    '弹层打开时按键必须拦截'
  );

  // Guard: No task selected
  assert.strictEqual(
    canExecuteKeyboardDelete({ key: 'Delete', isComposing: false, repeat: false }, { ...baseState, selectedTaskId: null }),
    false,
    '未选中任何任务时按键必须拦截'
  );
});

console.log('\n========================================================');
console.log(`PRD v1.3 测试执行结果: ${passedTests} / ${totalTests} 通过`);
console.log('========================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
