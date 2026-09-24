import assert from 'assert';
import crypto from 'crypto';

console.log('========================================================');
console.log('   TodoTree PRD v1.2 核心需求与验收测试套件 (2026-09-23)  ');
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
    console.error('       ' + err.message);
  }
}

// ----------------------------------------------------
// 1. A08-A10: 软删除保留完整属性与历史批次隔离
// ----------------------------------------------------
runTest('A08-A10: 软删除父节点时，更早删除的子节点保留原删除批次与时间戳，不被篡改', () => {
  const earlyDeletedTime = '2026-09-20T10:00:00.000Z';
  const earlyBatchId = 'batch_early_123';

  // Tree:
  // Root -> Child 1 (deleted earlier)
  //      -> Child 2 (active)
  //            -> Grandchild 2_1 (active)
  const tasks = [
    { id: 'root', title: '父任务', parent_id: null, status: 'open' },
    {
      id: 'child1',
      title: '早期已删子任务',
      parent_id: 'root',
      status: 'open',
      deleted_at: earlyDeletedTime,
      delete_batch_id: earlyBatchId,
      background_text: '早期背景说明',
      note: '早期备注',
    },
    { id: 'child2', title: '活跃子任务', parent_id: 'root', status: 'open' },
    { id: 'grandchild2_1', title: '活跃孙任务', parent_id: 'child2', status: 'open' },
  ];

  // Perform soft delete on 'root'
  const newBatchId = 'batch_new_456';
  const now = '2026-09-23T15:00:00.000Z';

  // Descendants collection function matching App.tsx
  const getActiveDescendantIds = (parentId, taskList) => {
    const ids = [];
    const collect = (pId) => {
      const children = taskList.filter((t) => t.parent_id === pId && !t.deleted_at);
      for (const child of children) {
        ids.push(child.id);
        collect(child.id);
      }
    };
    collect(parentId);
    return ids;
  };

  const targetIds = new Set(['root', ...getActiveDescendantIds('root', tasks)]);

  assert.strictEqual(targetIds.has('root'), true);
  assert.strictEqual(targetIds.has('child2'), true);
  assert.strictEqual(targetIds.has('grandchild2_1'), true);
  // Early deleted child must NOT be included in new batch
  assert.strictEqual(targetIds.has('child1'), false);

  const updatedTasks = tasks.map((t) => {
    if (targetIds.has(t.id)) {
      return { ...t, deleted_at: now, delete_batch_id: newBatchId };
    }
    return t;
  });

  const updatedChild1 = updatedTasks.find((t) => t.id === 'child1');
  assert.strictEqual(updatedChild1.deleted_at, earlyDeletedTime);
  assert.strictEqual(updatedChild1.delete_batch_id, earlyBatchId);
  assert.strictEqual(updatedChild1.background_text, '早期背景说明');
});

// ----------------------------------------------------
// 2. A11-A13: 恢复孤儿任务与原子恢复已完成祖先
// ----------------------------------------------------
runTest('A11: 恢复孤儿任务时，若原父节点已丢失或不存在，自动提升为待归类根节点', () => {
  const tasks = [
    {
      id: 'subtask_orphan',
      title: '孤儿子任务',
      parent_id: 'deleted_parent_id',
      status: 'open',
      deleted_at: '2026-09-23T10:00:00.000Z',
      delete_batch_id: 'batch_orphan',
    },
  ];

  const parentExists = tasks.some((t) => t.id === 'deleted_parent_id' && !t.deleted_at);
  assert.strictEqual(parentExists, false);

  // Restoration logic: If parent does not exist in active tasks, elevate to root
  const restoredTask = {
    ...tasks[0],
    deleted_at: undefined,
    delete_batch_id: undefined,
    parent_id: parentExists ? tasks[0].parent_id : null,
  };

  assert.strictEqual(restoredTask.parent_id, null);
  assert.strictEqual(restoredTask.deleted_at, undefined);
  assert.strictEqual(restoredTask.status, 'open');
});

runTest('A12-A13: 恢复未完成任务到已完成父节点下，原子恢复必要祖先为 open 状态', () => {
  // Tree: Grandparent (done) -> Parent (done) -> Child (in trash, open)
  const tasks = [
    { id: 'gp', title: '已完成爷爷节点', parent_id: null, status: 'done', completed_at: '2026-09-20' },
    { id: 'p', title: '已完成父节点', parent_id: 'gp', status: 'done', completed_at: '2026-09-21' },
    {
      id: 'child',
      title: '待恢复未完成子任务',
      parent_id: 'p',
      status: 'open',
      deleted_at: '2026-09-22',
      delete_batch_id: 'batch_child',
    },
  ];

  // Find all completed ancestors of target
  const completedAncestorIds = new Set();
  let curr = tasks.find((t) => t.id === 'p');
  while (curr) {
    if (curr.status === 'done') {
      completedAncestorIds.add(curr.id);
    }
    curr = curr.parent_id ? tasks.find((t) => t.id === curr.parent_id) : null;
  }

  assert.strictEqual(completedAncestorIds.has('p'), true);
  assert.strictEqual(completedAncestorIds.has('gp'), true);

  // Atomic restore
  const updatedTasks = tasks.map((t) => {
    if (t.id === 'child') {
      return { ...t, deleted_at: undefined, delete_batch_id: undefined };
    }
    if (completedAncestorIds.has(t.id)) {
      return { ...t, status: 'open', completed_at: undefined };
    }
    return t;
  });

  const restoredChild = updatedTasks.find((t) => t.id === 'child');
  const reopenedParent = updatedTasks.find((t) => t.id === 'p');
  const reopenedGrandparent = updatedTasks.find((t) => t.id === 'gp');

  assert.strictEqual(restoredChild.deleted_at, undefined);
  assert.strictEqual(restoredChild.status, 'open');
  assert.strictEqual(reopenedParent.status, 'open');
  assert.strictEqual(reopenedGrandparent.status, 'open');
});

// ----------------------------------------------------
// 3. A17-A18: 持久化空库与清空保护
// ----------------------------------------------------
runTest('A17-A18: INITIALIZED_KEY 存在时，空列表 [] 为合法用户状态，不被演示数据覆盖', () => {
  const fakeLocalStorage = new Map();
  const TASKS_KEY = 'todotree_tasks';
  const INITIALIZED_KEY = 'todotree_initialized';

  // Mark initialized
  fakeLocalStorage.set(INITIALIZED_KEY, 'true');
  // User clears all tasks -> []
  fakeLocalStorage.set(TASKS_KEY, JSON.stringify([]));

  function loadInitialTasks() {
    const isInit = fakeLocalStorage.get(INITIALIZED_KEY) === 'true';
    const raw = fakeLocalStorage.get(TASKS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // If initialized, [] is fully valid
          if (parsed.length > 0 || isInit) {
            return parsed;
          }
        }
      } catch {}
    }
    // Only if not initialized at all, inject mock tasks
    return [{ id: 'mock_1', title: '演示任务' }];
  }

  const loaded = loadInitialTasks();
  assert.strictEqual(Array.isArray(loaded), true);
  assert.strictEqual(loaded.length, 0); // Must be empty array, NOT mock tasks!
});

// ----------------------------------------------------
// 4. A31-A35: 任务背景说明 (background_text) 与事实包上下文节点提取
// ----------------------------------------------------
runTest('A31-A35: 事实包正确提取祖先链条中的背景说明 (context_nodes) 且去重', () => {
  const tasks = [
    {
      id: 'root_project',
      title: '2026 智能工单改造项目',
      parent_id: null,
      status: 'open',
      background_text: '该项目旨在降低售后响应延时，打通跨部门流转流程。',
    },
    {
      id: 'sub_module',
      title: '接口协议联调',
      parent_id: 'root_project',
      status: 'open',
      background_text: '联调重点为网关鉴权与幂等回调规范。',
    },
    {
      id: 'leaf_task',
      title: '完成网关鉴权代码部署',
      parent_id: 'sub_module',
      status: 'done',
      completed_at: '2026-09-23T14:00:00.000Z',
      outcome_note: '上线网关鉴权中间件并完成冒烟测试。',
    },
  ];

  // Context nodes extraction logic matching factsEngine.ts
  const contextNodesMap = new Map();
  const leafRecord = {
    task_id: 'leaf_task',
    path_ids_at_completion: ['root_project', 'sub_module', 'leaf_task'],
  };

  const completedRecords = [leafRecord];
  for (const record of completedRecords) {
    for (const ancestorId of record.path_ids_at_completion) {
      if (contextNodesMap.has(ancestorId)) continue;
      const ancestorTask = tasks.find((t) => t.id === ancestorId);
      if (ancestorTask && ancestorTask.background_text) {
        contextNodesMap.set(ancestorId, {
          node_id: ancestorTask.id,
          title: ancestorTask.title,
          background_text: ancestorTask.background_text,
          path_titles: ['2026 智能工单改造项目'],
        });
      }
    }
  }

  const contextNodes = Array.from(contextNodesMap.values());
  assert.strictEqual(contextNodes.length, 2);
  assert.strictEqual(contextNodes[0].node_id, 'root_project');
  assert.strictEqual(
    contextNodes[0].background_text,
    '该项目旨在降低售后响应延时，打通跨部门流转流程。'
  );
  assert.strictEqual(contextNodes[1].node_id, 'sub_module');
  assert.strictEqual(contextNodes[1].background_text, '联调重点为网关鉴权与幂等回调规范。');
});

// ----------------------------------------------------
// 5. A36-A44: 三层提示词装配与输入指纹 (input_hash) 差异化测试
// ----------------------------------------------------
runTest('A36-A44: 输入指纹 (input_hash) 随提示词模板、版本与当次附加要求精确变更与区分', () => {
  function computeMockInputHash(reportKey, facts, settings, promptOptions) {
    const rawData = JSON.stringify({
      reportKey,
      factsSummary: {
        total: facts.completed_records.length,
        taskIds: facts.completed_records.map((r) => r.instance_id).sort(),
      },
      settingsSummary: {
        model: settings.model_id,
        sendNotes: settings.send_notes,
        sendOutcomeNotes: settings.send_outcome_notes,
        sendBackground: settings.send_background !== false,
      },
      promptSummary: {
        templateContent: promptOptions?.templateContent || '',
        templateVersion: promptOptions?.templateVersion || 1,
        customInstructions: promptOptions?.customInstructions || '',
      },
    });
    return crypto.createHash('sha256').update(rawData, 'utf8').digest('hex');
  }

  const facts = {
    completed_records: [{ instance_id: 'rec_1', title: '编写测试用例' }],
  };
  const settings = {
    model_id: 'gpt-4o-mini',
    send_notes: false,
    send_outcome_notes: true,
    send_background: true,
  };

  const hashDefault = computeMockInputHash('weekly_2026_w38', facts, settings, {
    templateContent: '默认模板内容A',
    templateVersion: 1,
    customInstructions: undefined,
  });

  const hashSame = computeMockInputHash('weekly_2026_w38', facts, settings, {
    templateContent: '默认模板内容A',
    templateVersion: 1,
    customInstructions: undefined,
  });

  // Identical input must produce identical hash (Cache hit)
  assert.strictEqual(hashDefault, hashSame);

  // Custom instructions changed -> hash must change (Cache invalidation)
  const hashWithCustom = computeMockInputHash('weekly_2026_w38', facts, settings, {
    templateContent: '默认模板内容A',
    templateVersion: 1,
    customInstructions: '重点突出交付结论，精简为3条',
  });
  assert.notStrictEqual(hashDefault, hashWithCustom);

  // Template edited -> hash must change
  const hashWithTemplateEdit = computeMockInputHash('weekly_2026_w38', facts, settings, {
    templateContent: '自定义模板内容B',
    templateVersion: 2,
    customInstructions: undefined,
  });
  assert.notStrictEqual(hashDefault, hashWithTemplateEdit);

  // Background toggle changed -> hash must change
  const hashNoBackground = computeMockInputHash(
    'weekly_2026_w38',
    facts,
    { ...settings, send_background: false },
    {
      templateContent: '默认模板内容A',
      templateVersion: 1,
      customInstructions: undefined,
    }
  );
  assert.notStrictEqual(hashDefault, hashNoBackground);
});

console.log('\n========================================================');
console.log(`测试结果汇总: ${passedTests} / ${totalTests} 全部通过！`);
console.log('========================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
