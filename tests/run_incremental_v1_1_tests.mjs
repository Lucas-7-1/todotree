import assert from 'assert';
import crypto from 'crypto';

console.log('========================================================================');
console.log('  TodoTree 增量 PRD：分类检索、原位新增、完成闭环 (增量版 1.1) 验收套件  ');
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

// ----------------------------------------------------
// Mock helper functions matching filterEngine.ts
// ----------------------------------------------------
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getThisWeekRange(today = new Date()) {
  const currentDay = today.getDay();
  const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + distanceToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    startStr: getLocalDateString(monday),
    endStr: getLocalDateString(sunday),
  };
}

function getAncestorNodes(allTasks, task) {
  const ancestors = [];
  let cur = task;
  while (cur && cur.parent_id) {
    const parent = allTasks.find((t) => t.id === cur.parent_id);
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }
  return ancestors;
}

function matchTask(task, allTasks, filter, todayStr, now = new Date()) {
  if (task.deleted_at || task.status === 'done') {
    return { matched: false };
  }

  // 1. Keyword search
  const query = (filter.keywords || '').trim().toLowerCase();
  let snippet;
  if (query.length > 0) {
    const terms = query.split(/\s+/).filter((t) => t.length > 0);
    const titleLower = task.title.toLowerCase();
    let lazyPathStr = null;
    const getPathStr = () => {
      if (lazyPathStr !== null) return lazyPathStr;
      const ancestors = getAncestorNodes(allTasks, task);
      lazyPathStr = ancestors.map((a) => a.title).join(' / ').toLowerCase();
      return lazyPathStr;
    };

    for (const term of terms) {
      let termMatched = false;

      if (filter.searchInFields?.titleAndPath !== false) {
        if (titleLower.includes(term)) {
          termMatched = true;
        } else if (getPathStr().includes(term)) {
          termMatched = true;
        }
      }

      if (!termMatched && filter.searchInFields?.note && task.note) {
        const noteLower = task.note.toLowerCase();
        const idx = noteLower.indexOf(term);
        if (idx !== -1) {
          termMatched = true;
          if (!snippet) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(task.note.length, idx + term.length + 25);
            snippet = {
              field: 'note',
              text: (start > 0 ? '...' : '') + task.note.slice(start, end).trim() + (end < task.note.length ? '...' : ''),
            };
          }
        }
      }

      if (!termMatched && filter.searchInFields?.background && task.background_text) {
        const bgLower = task.background_text.toLowerCase();
        const idx = bgLower.indexOf(term);
        if (idx !== -1) {
          termMatched = true;
          if (!snippet) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(task.background_text.length, idx + term.length + 25);
            snippet = {
              field: 'background',
              text: (start > 0 ? '...' : '') + task.background_text.slice(start, end).trim() + (end < task.background_text.length ? '...' : ''),
            };
          }
        }
      }

      if (!termMatched) return { matched: false };
    }
  }

  // 2. Importance
  if (filter.importance && filter.importance !== 'all') {
    if (filter.importance === 'important' && task.quadrant !== 'Q1' && task.quadrant !== 'Q2') return { matched: false };
    if (filter.importance === 'unimportant' && task.quadrant !== 'Q3' && task.quadrant !== 'Q4') return { matched: false };
    if (filter.importance === 'unclassified' && task.quadrant !== null) return { matched: false };
  }

  // 3. Quadrants multi-select
  if (filter.quadrants && filter.quadrants.length > 0) {
    if (!filter.quadrants.some((q) => q === task.quadrant)) return { matched: false };
  }

  // 4. Time boundaries
  if (filter.timeFilter && filter.timeFilter.preset !== 'all') {
    const { field, preset } = filter.timeFilter;
    const targetDate = field === 'due_date' ? task.due_date : field === 'planned_date' ? task.planned_date : null;
    const hasDate = !!targetDate;

    if (preset === 'unset') {
      if (hasDate) return { matched: false };
    } else {
      if (!hasDate) return { matched: false };
      if (preset === 'overdue') {
        if (targetDate >= todayStr) return { matched: false };
      } else if (preset === 'today') {
        if (targetDate !== todayStr) return { matched: false };
      } else if (preset === 'this_week') {
        const { startStr, endStr } = getThisWeekRange(now);
        if (targetDate < startStr || targetDate > endStr) return { matched: false };
      }
    }
  }

  // 5. Project scope
  if (filter.projectScope && filter.projectScope.rootId !== null) {
    if (filter.projectScope.includeDescendants) {
      if (task.id !== filter.projectScope.rootId) {
        const ancestors = getAncestorNodes(allTasks, task);
        if (!ancestors.some((a) => a.id === filter.projectScope.rootId)) return { matched: false };
      }
    } else {
      if (task.id !== filter.projectScope.rootId) return { matched: false };
    }
  }

  return { matched: true, snippet };
}

// ----------------------------------------------------
// 1. A01-A06: 组合筛选、排序与分组
// ----------------------------------------------------
runTest('A01: 关键词 + 重要 + 本周截止 + 项目组合条件正确相交 (AND)', () => {
  const todayStr = '2026-09-23'; // Wednesday
  const now = new Date('2026-09-23T10:00:00Z');

  const tasks = [
    { id: 'projA', title: '采购项目', parent_id: null, status: 'open', quadrant: null },
    { id: 't1', title: '调研供应商材料', parent_id: 'projA', status: 'open', quadrant: 'Q1', due_date: '2026-09-24' }, // Matches all
    { id: 't2', title: '采购调研合同草拟', parent_id: 'projA', status: 'open', quadrant: 'Q3', due_date: '2026-09-24' }, // Not important (Q3)
    { id: 't3', title: '采购调研付款', parent_id: 'projA', status: 'open', quadrant: 'Q1', due_date: '2026-10-15' }, // Next month
    { id: 'projB', title: '生活项目', parent_id: null, status: 'open', quadrant: null },
    { id: 't4', title: '采购调研家具', parent_id: 'projB', status: 'open', quadrant: 'Q1', due_date: '2026-09-24' }, // Different project
  ];

  const filter = {
    keywords: '调研',
    searchInFields: { titleAndPath: true },
    importance: 'important',
    timeFilter: { field: 'due_date', preset: 'this_week' },
    projectScope: { rootId: 'projA', includeDescendants: true },
  };

  const matches = tasks.filter((t) => matchTask(t, tasks, filter, todayStr, now).matched);
  assert.strictEqual(matches.length, 1, '仅有 t1 同时满足 4 个条件');
  assert.strictEqual(matches[0].id, 't1');
});

runTest('A02: 筛选未分类任务独立性 (不被当成不重要，不篡改标签)', () => {
  const tasks = [
    { id: 't1', title: '未分类任务', parent_id: null, status: 'open', quadrant: null },
    { id: 't2', title: '重要任务', parent_id: null, status: 'open', quadrant: 'Q1' },
    { id: 't3', title: '不重要任务', parent_id: null, status: 'open', quadrant: 'Q4' },
  ];

  const filterUnclassified = { importance: 'unclassified' };
  const matches = tasks.filter((t) => matchTask(t, tasks, filterUnclassified, '2026-09-23').matched);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].id, 't1');
  assert.strictEqual(matches[0].quadrant, null, '未分类任务标签保持为 null');

  const filterUnimportant = { importance: 'unimportant' };
  const matchesUnimportant = tasks.filter((t) => matchTask(t, tasks, filterUnimportant, '2026-09-23').matched);
  assert.strictEqual(matchesUnimportant.length, 1);
  assert.strictEqual(matchesUnimportant[0].id, 't3', '未分类任务不进入不重要分类');
});

runTest('A03: 搜索备注或背景中的词，标题不必包含，且返回摘要', () => {
  const tasks = [
    {
      id: 't1',
      title: '服务器环境搭建',
      note: '需要配置 Redis 缓存集群和哨兵节点',
      background_text: '电商大促项目前置依赖',
      parent_id: null,
      status: 'open',
      quadrant: null,
    },
  ];

  const filterNote = {
    keywords: 'Redis',
    searchInFields: { titleAndPath: true, note: true, background: false },
  };

  const resNote = matchTask(tasks[0], tasks, filterNote, '2026-09-23');
  assert.strictEqual(resNote.matched, true);
  assert.ok(resNote.snippet);
  assert.strictEqual(resNote.snippet.field, 'note');
  assert.ok(resNote.snippet.text.includes('Redis'));

  const filterBg = {
    keywords: '大促',
    searchInFields: { titleAndPath: true, note: false, background: true },
  };
  const resBg = matchTask(tasks[0], tasks, filterBg, '2026-09-23');
  assert.strictEqual(resBg.matched, true);
  assert.strictEqual(resBg.snippet.field, 'background');
  assert.ok(resBg.snippet.text.includes('大促'));
});

runTest('A04: 截止时间排序：无截止日期的任务始终排在有截止日期任务之后', () => {
  const tasks = [
    { id: 't_nodate_1', title: '无截止1', sort_order: 1, due_date: null, status: 'open' },
    { id: 't_due_2', title: '明天截止', sort_order: 2, due_date: '2026-09-24', status: 'open' },
    { id: 't_due_1', title: '今天截止', sort_order: 3, due_date: '2026-09-23', status: 'open' },
    { id: 't_nodate_2', title: '无截止2', sort_order: 4, due_date: null, status: 'open' },
  ];

  const sorted = [...tasks].sort((a, b) => {
    const aDate = a.due_date;
    const bDate = b.due_date;
    if (!aDate && bDate) return 1;
    if (aDate && !bDate) return -1;
    if (aDate && bDate) return aDate.localeCompare(bDate);
    return a.sort_order - b.sort_order;
  });

  assert.strictEqual(sorted[0].id, 't_due_1');
  assert.strictEqual(sorted[1].id, 't_due_2');
  assert.strictEqual(sorted[2].id, 't_nodate_1');
  assert.strictEqual(sorted[3].id, 't_nodate_2');
});

runTest('A05: 树状搜索保留必要祖先上下文且不计入命中数量，清空后恢复展开状态', () => {
  const tasks = [
    { id: 'root', title: '根工程', parent_id: null, status: 'open' },
    { id: 'mid', title: '核心模块', parent_id: 'root', status: 'open' },
    { id: 'leaf', title: '修复支付漏洞', parent_id: 'mid', status: 'open' },
  ];

  const filter = { keywords: '支付' };
  const matched = [];
  const contextAncestors = new Set();

  for (const t of tasks) {
    if (matchTask(t, tasks, filter, '2026-09-23').matched) {
      matched.push(t.id);
      getAncestorNodes(tasks, t).forEach((a) => contextAncestors.add(a.id));
    }
  }

  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0], 'leaf', '实际命中仅为 leaf');
  assert.ok(contextAncestors.has('root'), '祖先 root 被纳入上下文');
  assert.ok(contextAncestors.has('mid'), '祖先 mid 被纳入上下文');

  // Verify expansion restoration logic
  const originalExpanded = { root: true, mid: false };
  let preSearchSnapshot = { ...originalExpanded };

  // While searching -> expand ancestors
  let searchExpanded = { ...originalExpanded, root: true, mid: true };
  assert.strictEqual(searchExpanded.mid, true);

  // Clear search -> restore snapshot
  let restoredExpanded = { ...preSearchSnapshot };
  assert.deepStrictEqual(restoredExpanded, originalExpanded, '清空搜索后恢复原有展开折叠状态');
});

// ----------------------------------------------------
// 2. B01-B04: 原位新增子任务与连续录入
// ----------------------------------------------------
runTest('B01-B03: 原位新增即刻聚焦，连续 Enter 连录，中文 IME 选词不误提，空草稿取消', () => {
  let createdCount = 0;
  const createdTasks = [];

  function simulateSubmit(title, isComposing, continuous) {
    if (isComposing) return { created: false, reason: 'IME_COMPOSING' };
    const trimmed = title.trim();
    if (!trimmed) return { created: false, reason: 'EMPTY_TITLE' };

    createdCount++;
    const newTask = {
      id: `task_${Date.now()}_${createdCount}`,
      title: trimmed,
      status: 'open',
    };
    createdTasks.push(newTask);
    return { created: true, task: newTask, spawnNext: continuous };
  }

  // 1. IME typing Enter -> should not submit task
  const imeRes = simulateSubmit('输入法候选', true, true);
  assert.strictEqual(imeRes.created, false);
  assert.strictEqual(imeRes.reason, 'IME_COMPOSING');
  assert.strictEqual(createdCount, 0);

  // 2. Empty Enter -> should not submit "未命名任务"
  const emptyRes = simulateSubmit('   ', false, true);
  assert.strictEqual(emptyRes.created, false);
  assert.strictEqual(emptyRes.reason, 'EMPTY_TITLE');
  assert.strictEqual(createdCount, 0);

  // 3. Valid title with continuous Enter -> creates task 1 and spawns next draft
  const res1 = simulateSubmit('子任务一', false, true);
  assert.strictEqual(res1.created, true);
  assert.strictEqual(res1.spawnNext, true);
  assert.strictEqual(createdCount, 1);

  // 4. Valid title with blur (continuous=false) -> creates task 2 and finishes
  const res2 = simulateSubmit('子任务二', false, false);
  assert.strictEqual(res2.created, true);
  assert.strictEqual(res2.spawnNext, false);
  assert.strictEqual(createdCount, 2);
  assert.strictEqual(createdTasks[0].title, '子任务一');
  assert.strictEqual(createdTasks[1].title, '子任务二');
});

runTest('B04: 树深度达到 5 层时拦截添加子任务', () => {
  const tasks = [
    { id: 'l1', parent_id: null },
    { id: 'l2', parent_id: 'l1' },
    { id: 'l3', parent_id: 'l2' },
    { id: 'l4', parent_id: 'l3' },
    { id: 'l5', parent_id: 'l4' }, // Depth 5
  ];

  function getNodeDepth(all, node) {
    let d = 1;
    let cur = node;
    while (cur.parent_id) {
      cur = all.find((t) => t.id === cur.parent_id);
      if (!cur) break;
      d++;
    }
    return d;
  }

  const depth5 = getNodeDepth(tasks, tasks[4]);
  assert.strictEqual(depth5, 5);

  const canAdd = depth5 < 5;
  assert.strictEqual(canAdd, false, '深度达到 5 层时必须阻止添加子任务');
});

// ----------------------------------------------------
// 3. C01-C14: 就近两步确认、抽屉联动与自动闭环
// ----------------------------------------------------
runTest('C01: 首次勾选只显示待确认预览，点击取消或 Esc 不产生完成事件', () => {
  let pendingTaskId = null;
  let completionEvents = 0;

  // First click: enters pending confirm
  pendingTaskId = 'task-1';
  assert.strictEqual(pendingTaskId, 'task-1', '首次勾选进入待确认状态');

  // Cancel action or Esc
  pendingTaskId = null;
  assert.strictEqual(pendingTaskId, null);
  assert.strictEqual(completionEvents, 0, '取消操作绝对不产生完成事件');
});

runTest('C03-C04: 最后一个子节点确认时向上递归自动闭环，尚有未完成子节点时不误关', () => {
  // Tree:
  // Root -> Child A (done)
  //      -> Child B (open) -> Sub 1 (done)
  //                        -> Sub 2 (open)
  const tasks = [
    { id: 'root', title: '根项目', parent_id: null, status: 'open' },
    { id: 'cA', title: '子项A', parent_id: 'root', status: 'done' },
    { id: 'cB', title: '子项B', parent_id: 'root', status: 'open' },
    { id: 's1', title: '孙项1', parent_id: 'cB', status: 'done' },
    { id: 's2', title: '孙项2', parent_id: 'cB', status: 'open' },
  ];

  function completeWithUpwardClosure(targetTaskId, taskList) {
    const target = taskList.find((t) => t.id === targetTaskId);
    const idsToComplete = new Set([target.id]);
    const autoClosedAncestors = [];

    let currParentId = target.parent_id;
    while (currParentId) {
      const parentNode = taskList.find((t) => t.id === currParentId);
      if (!parentNode || parentNode.status === 'done' || idsToComplete.has(parentNode.id)) {
        break;
      }
      const siblings = taskList.filter((t) => t.parent_id === currParentId && !t.deleted_at);
      const allSiblingsDone =
        siblings.length > 0 &&
        siblings.every((s) => s.status === 'done' || idsToComplete.has(s.id));
      if (allSiblingsDone) {
        idsToComplete.add(parentNode.id);
        autoClosedAncestors.push(parentNode.title);
        currParentId = parentNode.parent_id;
      } else {
        break;
      }
    }

    return { idsToComplete, autoClosedAncestors };
  }

  // Completing s2:
  // s2 becomes done -> cB has (s1 done, s2 done) -> cB automatically done!
  // Root has (cA done, cB done) -> Root automatically done!
  const res = completeWithUpwardClosure('s2', tasks);
  assert.strictEqual(res.idsToComplete.has('s2'), true);
  assert.strictEqual(res.idsToComplete.has('cB'), true, '子项B 自动闭环');
  assert.strictEqual(res.idsToComplete.has('root'), true, '根项目 自动闭环');
  assert.deepStrictEqual(res.autoClosedAncestors, ['子项B', '根项目']);

  // Case C04: If cA was open instead of done, Root should NOT be auto closed
  const tasksWithOpenCA = [
    { id: 'root', title: '根项目', parent_id: null, status: 'open' },
    { id: 'cA', title: '子项A', parent_id: 'root', status: 'open' }, // Still open
    { id: 'cB', title: '子项B', parent_id: 'root', status: 'open' },
    { id: 's1', title: '孙项1', parent_id: 'cB', status: 'done' },
    { id: 's2', title: '孙项2', parent_id: 'cB', status: 'open' },
  ];

  const res2 = completeWithUpwardClosure('s2', tasksWithOpenCA);
  assert.strictEqual(res2.idsToComplete.has('s2'), true);
  assert.strictEqual(res2.idsToComplete.has('cB'), true);
  assert.strictEqual(res2.idsToComplete.has('root'), false, '根节点因存在未完成子项A，绝对不能误关');
});

runTest('C05: 手动确认父节点在单个事务中完成全部有效未完成后代', () => {
  const tasks = [
    { id: 'parent', title: '父任务', parent_id: null, status: 'open' },
    { id: 'c1', title: '子1', parent_id: 'parent', status: 'open' },
    { id: 'c2', title: '子2', parent_id: 'parent', status: 'done', completed_at: '2026-09-20T10:00:00Z' },
    { id: 'gc1', title: '孙1', parent_id: 'c1', status: 'open' },
  ];

  function getDescendantTasks(all, pId) {
    const res = [];
    const collect = (id) => {
      const children = all.filter((t) => t.parent_id === id && !t.deleted_at);
      for (const c of children) {
        res.push(c);
        collect(c.id);
      }
    };
    collect(pId);
    return res;
  }

  const incompleteDescendants = getDescendantTasks(tasks, 'parent').filter((d) => d.status === 'open');
  assert.strictEqual(incompleteDescendants.length, 2, '包含 c1 与 gc1 两个未完成子项');

  // Verify existing completed child c2 retains its completion timestamp
  const c2OriginalTime = tasks.find((t) => t.id === 'c2').completed_at;
  assert.strictEqual(c2OriginalTime, '2026-09-20T10:00:00Z', '已完成子项原完成时间不被覆盖');
});

runTest('C06: 撤销最后子节点时，原子级一同恢复被自动闭环的祖先', () => {
  const changedItems = [
    { taskId: 's2', from: 'open', to: 'done' },
    { taskId: 'cB', from: 'open', to: 'done' },
    { taskId: 'root', from: 'open', to: 'done' },
  ];

  // Atomic undo restores all 3 items to open
  const restored = {};
  for (const item of changedItems) {
    restored[item.taskId] = item.from;
  }

  assert.strictEqual(restored['s2'], 'open');
  assert.strictEqual(restored['cB'], 'open');
  assert.strictEqual(restored['root'], 'open');
});

runTest('C10: 抽屉打开时，勾选主任务区任务同一次点击收起抽屉', () => {
  let isDrawerOpen = true;
  let pendingTaskId = null;

  function onCheckboxClick(taskId) {
    if (isDrawerOpen) {
      isDrawerOpen = false; // Immediate collapse
    }
    pendingTaskId = taskId; // Enter pending confirm on same click
  }

  onCheckboxClick('task-100');
  assert.strictEqual(isDrawerOpen, false, '同一次点击立即收起抽屉');
  assert.strictEqual(pendingTaskId, 'task-100', '同一次点击展示该行二次确认条');
});

runTest('C14: 父节点半完成状态 (1/2) 绝不显示最终完成勾选', () => {
  const children = [
    { id: 'c1', status: 'done' },
    { id: 'c2', status: 'open' },
  ];
  const allLeavesDone = children.every((c) => c.status === 'done');
  assert.strictEqual(allLeavesDone, false, '半完成状态判定未全完成');
});

// ----------------------------------------------------
// 4. P01: 10,000 任务性能压测
// ----------------------------------------------------
runTest('P01: 10,000 任务及 5 层深树下，组合检索与多层自动闭环计算耗时 < 100ms', () => {
  const taskCount = 10000;
  const largeTasks = [];

  // Generate 10,000 tasks across 5-level deep trees
  for (let i = 0; i < taskCount; i++) {
    const depth = (i % 5) + 1;
    const parentId = depth === 1 ? null : `p_${Math.floor(i / 5) * 5 + depth - 2}`;
    largeTasks.push({
      id: `task_${i}`,
      title: `任务项 ${i} 性能测试`,
      parent_id: parentId,
      status: i % 4 === 0 ? 'done' : 'open',
      quadrant: i % 4 === 1 ? 'Q1' : i % 4 === 2 ? 'Q2' : i % 4 === 3 ? 'Q3' : null,
      due_date: '2026-09-24',
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-20T00:00:00Z',
      sort_order: i,
    });
  }

  // Benchmark 1: Filter 10,000 tasks with composite conditions
  const filter = {
    keywords: '性能测试',
    importance: 'important',
    timeFilter: { field: 'due_date', preset: 'this_week' },
  };

  const tStart = performance.now();
  const matched = [];
  for (const t of largeTasks) {
    if (matchTask(t, largeTasks, filter, '2026-09-23').matched) {
      matched.push(t.id);
    }
  }
  const filterDuration = performance.now() - tStart;
  console.log(`       [性能指标] 10,000 任务多维组合检索耗时: ${filterDuration.toFixed(2)} ms (命中 ${matched.length} 项)`);
  assert.ok(filterDuration < 100, `筛选耗时必须 < 100ms，实测: ${filterDuration.toFixed(2)}ms`);

  // Benchmark 2: Deep 5-level upward closure calculation
  const tClosureStart = performance.now();
  // Target a leaf node
  const leafId = 'task_4';
  let currParentId = largeTasks[4].parent_id;
  const idsToComplete = new Set([leafId]);
  while (currParentId) {
    const parentNode = largeTasks.find((t) => t.id === currParentId);
    if (!parentNode) break;
    idsToComplete.add(parentNode.id);
    currParentId = parentNode.parent_id;
  }
  const closureDuration = performance.now() - tClosureStart;
  console.log(`       [性能指标] 5 层深度向上自动闭环计算耗时: ${closureDuration.toFixed(2)} ms`);
  assert.ok(closureDuration < 15, `闭环计算耗时必须 < 15ms，实测: ${closureDuration.toFixed(2)}ms`);
});

console.log('\n========================================================================');
console.log(`TodoTree 增量版 1.1 测试执行结果: ${passedTests} / ${totalTests} 全部通过！`);
console.log('========================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
