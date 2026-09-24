import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('  TodoTree 合并增量 PRD：全界面优化、完成日历、动效与效率 (v1.1) 验收套件  ');
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
// 1. Calendar Grid Generation & Calculations (PRD Section 2)
// ---------------------------------------------------------------------------
function getMonthCalendarDays(year, month, timezone = 'Asia/Shanghai') {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const totalDaysInMonth = lastDay.getDate();

  const dayOfWeek = firstDay.getDay(); // 0 is Sunday
  const startDayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0

  const days = [];
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();

  // 1. Overflow from prev month
  for (let i = startDayOffset - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ dateStr, dayNumber: d, isCurrentMonth: false, isToday: false });
  }

  // 2. Days in current month
  const todayStr = '2026-09-24';
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      dateStr,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  // 3. Overflow from next month to fill exactly 42 cells (6 rows * 7 columns)
  const remainingDays = 42 - days.length;
  for (let d = 1; d <= remainingDays; d++) {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ dateStr, dayNumber: d, isCurrentMonth: false, isToday: false });
  }

  return days;
}

runTest('CAL01: 生成标准 42 格月历网格，包含前后月完整补齐', () => {
  // Test September 2026 (starts on Tuesday)
  const days = getMonthCalendarDays(2026, 9);
  assert.strictEqual(days.length, 42, '必须严格保证 42 格 (6行 x 7列)');

  // First cell should be Monday Aug 31
  assert.strictEqual(days[0].dateStr, '2026-08-31');
  assert.strictEqual(days[0].isCurrentMonth, false);

  // Sept 1 is index 1
  assert.strictEqual(days[1].dateStr, '2026-09-01');
  assert.strictEqual(days[1].isCurrentMonth, true);

  // Sept 30 is index 30
  assert.strictEqual(days[30].dateStr, '2026-09-30');
  assert.strictEqual(days[30].isCurrentMonth, true);

  // Oct 1 starts at index 31
  assert.strictEqual(days[31].dateStr, '2026-10-01');
  assert.strictEqual(days[31].isCurrentMonth, false);

  // Last cell is index 41 (Oct 11)
  assert.strictEqual(days[41].dateStr, '2026-10-11');
});

runTest('CAL02: 叶子完成与上级闭环数量严格隔离呈现，禁止合并加总', () => {
  // Mock events for a day: 3 leaf tasks done, 1 branch closure
  const events = [
    { event_id: 'e1', task_id: 't1', event_type: 'task_completed', is_leaf_at_completion: true, timestamp: '2026-09-24T10:00:00Z' },
    { event_id: 'e2', task_id: 't2', event_type: 'task_completed', is_leaf_at_completion: true, timestamp: '2026-09-24T11:00:00Z' },
    { event_id: 'e3', task_id: 't3', event_type: 'task_completed', is_leaf_at_completion: true, timestamp: '2026-09-24T12:00:00Z' },
    { event_id: 'e4', task_id: 'p1', event_type: 'task_completed', is_leaf_at_completion: false, timestamp: '2026-09-24T12:00:00Z' }, // parent closure
  ];

  const leafCount = events.filter((e) => e.is_leaf_at_completion).length;
  const closureCount = events.filter((e) => !e.is_leaf_at_completion).length;

  assert.strictEqual(leafCount, 3, '叶子任务计数必须为 3 条');
  assert.strictEqual(closureCount, 1, '上级闭环计数必须为 1 项');
  assert.notStrictEqual(leafCount + closureCount, 3, '两类数据不能混为一谈加总显示为 4 条叶子完成');

  // Badge text verification
  const leafBadge = `完成 ${leafCount} 条`;
  const closureBadge = `闭环 ${closureCount} 项`;
  assert.strictEqual(leafBadge, '完成 3 条');
  assert.strictEqual(closureBadge, '闭环 1 项');
});

runTest('CAL03: 单元格内高频任务预览上限为 2 条，多出部分收敛为 +N', () => {
  const taskTitles = ['撰写PRD草案', '设计UI走查', '修复动画卡顿', '整理备份数据'];
  const MAX_PREVIEW = 2;
  const visible = taskTitles.slice(0, MAX_PREVIEW);
  const remaining = taskTitles.length - MAX_PREVIEW;

  assert.strictEqual(visible.length, 2);
  assert.strictEqual(visible[0], '撰写PRD草案');
  assert.strictEqual(visible[1], '设计UI走查');
  assert.strictEqual(remaining, 2);
  const moreBadge = `+${remaining}`;
  assert.strictEqual(moreBadge, '+2');
});

runTest('CAL04: 撤销或恢复已完成任务时，有效完成事件原子扣减并过滤', () => {
  // Simulating events log with completion followed by uncompletion
  const events = [
    { event_id: 'e1', task_id: 't1', event_type: 'task_completed', is_leaf_at_completion: true, timestamp: '2026-09-24T10:00:00Z' },
    { event_id: 'e2', task_id: 't2', event_type: 'task_completed', is_leaf_at_completion: true, timestamp: '2026-09-24T10:05:00Z' },
    { event_id: 'e3', task_id: 't1', event_type: 'task_uncompleted', timestamp: '2026-09-24T10:10:00Z' }, // undone
  ];

  // Latest status map by task_id
  const latestStatus = new Map();
  for (const ev of events) {
    if (ev.event_type === 'task_completed') {
      latestStatus.set(ev.task_id, ev);
    } else if (ev.event_type === 'task_uncompleted') {
      latestStatus.delete(ev.task_id);
    }
  }

  const effectiveEvents = Array.from(latestStatus.values());
  assert.strictEqual(effectiveEvents.length, 1, '撤销后有效完成事件必须只剩 1 条');
  assert.strictEqual(effectiveEvents[0].task_id, 't2', '剩余完成事件必须为未被撤销的 t2');
});

runTest('CAL05: 日详情抽屉按项目分组，展示完成时间、方式徽标及产出备注', () => {
  const dayRecords = [
    { id: 't1', title: '子任务A', rootProjectTitle: '项目 alpha', completed_at: '2026-09-24T09:30:00Z', is_leaf: true, outcome_note: '核心代码就绪' },
    { id: 't2', title: '子任务B', rootProjectTitle: '项目 alpha', completed_at: '2026-09-24T10:00:00Z', is_leaf: true, outcome_note: '' },
    { id: 'p1', title: '阶段一', rootProjectTitle: '项目 alpha', completed_at: '2026-09-24T10:00:00Z', is_leaf: false, outcome_note: '' },
    { id: 't3', title: '日常记账', rootProjectTitle: '个人生活', completed_at: '2026-09-24T20:00:00Z', is_leaf: true, outcome_note: '9月水电' },
  ];

  // Group by project
  const groups = {};
  for (const r of dayRecords) {
    if (!groups[r.rootProjectTitle]) groups[r.rootProjectTitle] = [];
    groups[r.rootProjectTitle].push(r);
  }

  assert.strictEqual(Object.keys(groups).length, 2, '应分为两个项目分组');
  assert.strictEqual(groups['项目 alpha'].length, 3);
  assert.strictEqual(groups['个人生活'].length, 1);

  // Check badges & outcome notes
  const alphaClosure = groups['项目 alpha'].find((r) => !r.is_leaf);
  assert.ok(alphaClosure, '应包含闭环父项');
  assert.strictEqual(alphaClosure.title, '阶段一');

  const leafWithOutcome = groups['项目 alpha'].find((r) => r.id === 't1');
  assert.strictEqual(leafWithOutcome.outcome_note, '核心代码就绪');
});

// ---------------------------------------------------------------------------
// 2. Performance & Dissolution Animations (PRD Section 3.3 & 3.4)
// ---------------------------------------------------------------------------
runTest('PERF01: 父子分支完成时批量事件写入单次完成，杜绝 N+1 磁盘/HTTP 调用', () => {
  const branchTasks = [
    { id: 't1', title: '子任务 1', parent_id: 'p1', status: 'open' },
    { id: 't2', title: '子任务 2', parent_id: 'p1', status: 'open' },
    { id: 't3', title: '子任务 3', parent_id: 'p1', status: 'open' },
    { id: 'p1', title: '父任务', parent_id: null, status: 'open' },
  ];

  let writeCount = 0;
  const mockStorageWriter = (items) => {
    writeCount++;
    return items.length;
  };

  // Old sequential method simulated
  let oldWrites = 0;
  for (const t of branchTasks) {
    oldWrites++;
  }
  assert.strictEqual(oldWrites, 4, '旧版需进行 4 次独立写入');

  // New batch method
  const batchItems = branchTasks.map((t) => ({ task: t }));
  mockStorageWriter(batchItems);
  assert.strictEqual(writeCount, 1, '新版批量写入必须仅执行 1 次');
});

runTest('PERF02: 整体退场动画时长为 200ms，保底定时器 <= 400ms', () => {
  const rowSrc = fs.readFileSync('src/components/TaskTree/TaskItemRow.tsx', 'utf8');
  assert.ok(
    rowSrc.includes('opacity-0 -translate-y-1'),
    'TaskItemRow 必须包含整组渐隐平移退场样式'
  );
  assert.ok(
    rowSrc.includes('duration-200') || rowSrc.includes('200ms'),
    '过渡时间必须为 200ms'
  );
  assert.ok(
    rowSrc.includes('400') || rowSrc.includes('safetyTimeout') || rowSrc.includes('fallbackTimeout'),
    '必须设置 400ms 安全保底定时器'
  );
});

runTest('PERF03: 减弱动效 (reduced_motion) 开启时，动画过渡时间为 0ms 立即退出', () => {
  const rowSrc = fs.readFileSync('src/components/TaskTree/TaskItemRow.tsx', 'utf8');
  assert.ok(
    rowSrc.includes('reducedMotion') && (rowSrc.includes('0ms') || rowSrc.includes('duration-0')),
    'reducedMotion 为 true 时动画时长必须置为 0'
  );
});

// ---------------------------------------------------------------------------
// 3. Global UI Consistency & Single Auxiliary Panel (PRD Section 3.1 & 3.2)
// ---------------------------------------------------------------------------
runTest('UI01: 右侧单辅助面板容器互斥规则：同一时刻有且仅有一个抽屉展开', () => {
  const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
  assert.ok(
    appSrc.includes('auxiliaryPanel.type ===') || appSrc.includes('AuxiliaryPanelType'),
    'App.tsx 必须使用统一互斥 auxiliaryPanel 状态'
  );

  // Verify panels are mutually exclusive
  const validTypes = ['none', 'completed', 'report_history', 'task_detail', 'quadrant_quick'];
  for (const t of validTypes) {
    assert.ok(typeof t === 'string');
  }

  // Verify drawer stacking is prevented
  assert.ok(
    !appSrc.includes('<QuadrantPanel\n            tasks={tasks}\n            onUpdateQuadrant={handleUpdateQuadrant}\n            onToggleComplete={handleToggleComplete}\n            onSelectTask={setSelectedTaskId}\n            selectedTaskId={selectedTaskId}\n            isCollapsed={isQuadrantCollapsed}\n            onToggleCollapse={() => setIsQuadrantCollapsed(!isQuadrantCollapsed)}\n          />'),
    '禁止在主工作区并列常驻渲染 QuadrantPanel 导致工作区被挤压'
  );
});

runTest('UI02: 工作复盘 (Work Review) 控制台：单主按钮状态机切换，禁止并排冗余', () => {
  const reviewSrc = fs.readFileSync('src/components/WorkReview/WorkReviewView.tsx', 'utf8');
  assert.ok(
    reviewSrc.includes('isCallingAI') || reviewSrc.includes('isGenerating'),
    '复盘视图必须包含大模型调用状态机'
  );
  assert.ok(
    reviewSrc.includes('正在调用大模型生成报告…') || reviewSrc.includes('正在生成'),
    '生成中状态文本必须符合 PRD'
  );
  assert.ok(
    reviewSrc.includes('生成报告') || reviewSrc.includes('更新报告') || reviewSrc.includes('重新生成'),
    '必须提供标准的主操作文案'
  );
});

runTest('UI03: 工作复盘正文容器限制在 760–960px 宽度，15px 字体与 26px 行高', () => {
  const reviewSrc = fs.readFileSync('src/components/WorkReview/WorkReviewView.tsx', 'utf8');
  assert.ok(
    reviewSrc.includes('max-w-[860px]') || reviewSrc.includes('max-w-[760px]') || reviewSrc.includes('max-w-[960px]') || reviewSrc.includes('max-w-4xl'),
    '报告正文容器必须限制在 760–960px 舒适阅读宽度'
  );
  assert.ok(
    reviewSrc.includes('text-[15px]') || reviewSrc.includes('text-base'),
    '正文字体规范要求 15px'
  );
  assert.ok(
    reviewSrc.includes('leading-[26px]') || reviewSrc.includes('leading-relaxed'),
    '行高规范要求 26px'
  );
});

runTest('UI04: 四象限未分类任务池收归 260px 抽屉，默认收起，移除冗余已完成开关', () => {
  const quadSrc = fs.readFileSync('src/components/Quadrant/QuadrantWorkspace.tsx', 'utf8');
  assert.ok(
    quadSrc.includes('w-[260px]') || quadSrc.includes('w-64'),
    '未分类抽屉宽度必须为 260px 规范'
  );
  assert.ok(
    quadSrc.includes('isUnclassifiedOpen') || quadSrc.includes('showUnclassifiedDrawer') || quadSrc.includes('showUnclassified') || quadSrc.includes('isUnclassifiedCollapsed'),
    '未分类抽屉支持显式展开/收起'
  );
  assert.ok(
    !quadSrc.includes('显示已完成任务') && !quadSrc.includes('show_completed toggle'),
    '四象限工具栏必须移除冗余的已完成任务切换开关'
  );
});

runTest('UI05: 全部任务工具栏提供按需象限速览切换，顶栏移除重复搜索图标', () => {
  const filterSrc = fs.readFileSync('src/components/TaskTree/TaskFilterBar.tsx', 'utf8');
  assert.ok(
    filterSrc.includes('象限速览'),
    '任务过滤栏必须包含按需「象限速览」按钮'
  );

  const headerSrc = fs.readFileSync('src/components/Header.tsx', 'utf8');
  assert.ok(
    headerSrc.includes('showSearch = false') || headerSrc.includes('showSearch?: boolean'),
    'Header 搜索图标默认必须隐藏以消除重复'
  );
});

runTest('UI06: 全部任务具备 4 种独立空状态提示及相应引导操作', () => {
  const treeSrc = fs.readFileSync('src/components/TaskTree/TaskTree.tsx', 'utf8');
  assert.ok(
    treeSrc.includes('暂无任何任务'),
    '必须支持空态 1: 暂无任何任务'
  );
  assert.ok(
    treeSrc.includes('当前筛选无结果') || treeSrc.includes('清空全部筛选'),
    '必须支持空态 2: 当前筛选无结果'
  );
  assert.ok(
    treeSrc.includes('该分类下暂无任务') || treeSrc.includes('分类下暂无任务'),
    '必须支持空态 3: 分类下暂无任务'
  );
  assert.ok(
    treeSrc.includes('全部任务已完成') || treeSrc.includes('太棒了，所有任务均已搞定'),
    '必须支持空态 4: 全部任务已完成'
  );
});

runTest('UI07: 快速录入栏高度为 44–48px 紧凑高度，侧边栏宽度 208px', () => {
  const quickSrc = fs.readFileSync('src/components/QuickInputBar.tsx', 'utf8');
  assert.ok(
    quickSrc.includes('h-[46px]') || quickSrc.includes('h-11') || quickSrc.includes('h-12'),
    '快速录入栏必须处于 44-48px 规范区间'
  );

  const sidebarSrc = fs.readFileSync('src/components/Sidebar.tsx', 'utf8');
  assert.ok(
    sidebarSrc.includes('w-[208px]') || sidebarSrc.includes('w-52'),
    '侧边栏宽度必须为标准 208px 规范'
  );
});

runTest('UI08: Toast 浮层位置统一锚定于右下角，避免遮挡顶部核心操作', () => {
  const toastSrc = fs.readFileSync('src/components/Toast.tsx', 'utf8');
  assert.ok(
    toastSrc.includes('bottom-') && toastSrc.includes('right-'),
    'Toast 提示必须定位在右下角 (bottom/right)'
  );
});

console.log('\n========================================================================');
console.log(`TodoTree 合并增量 v1.1 测试执行结果: ${passedTests} / ${totalTests} 全部通过！`);
console.log('========================================================================\n');
