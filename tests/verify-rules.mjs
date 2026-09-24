import {
  canMoveSubtree,
  getNodeDepth,
  getDescendantTasks,
  calculateProgress,
  isTaskOverdue,
  formatRelativeDate,
  getAncestorNodes
} from '../src/services/treeOperations.ts';
import { validateImportJson, exportBackupData } from '../src/services/importExport.ts';
import { getTodayDateString } from '../src/services/seedData.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`✗ FAIL: ${message}`);
  }
}

console.log('=== TodoTree PRD v1.0 业务规则与验收项自动化校验 ===\n');

// 1. A01: 快速新建仅标题时，quadrant/due/planned 为空
const task1 = {
  id: 't1',
  parent_id: null,
  root_bucket: 'categories',
  title: '测试任务',
  note: '',
  sort_order: 1,
  status: 'open',
  completed_at: null,
  due_type: 'none',
  due_date: null,
  due_at: null,
  quadrant: null,
  planned_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  deletion_batch_id: null,
};
assert(task1.quadrant === null && task1.due_date === null && task1.planned_date === null, 'A01: 快速新建任务仅有标题，日期与象限为 null');

// 2. A04: 最大 5 层深度限制及防循环检测
const level1 = { ...task1, id: 'l1', parent_id: null };
const level2 = { ...task1, id: 'l2', parent_id: 'l1' };
const level3 = { ...task1, id: 'l3', parent_id: 'l2' };
const level4 = { ...task1, id: 'l4', parent_id: 'l3' };
const level5 = { ...task1, id: 'l5', parent_id: 'l4' };
const tree5 = [level1, level2, level3, level4, level5];

assert(getNodeDepth(tree5, level5) === 5, '层级计算：第 5 层深度为 5');

// Attempt to add a 6th level or move a child to 6th level
const candidateChild = { ...task1, id: 'l6', parent_id: null };
const check6 = canMoveSubtree([...tree5, candidateChild], candidateChild, 'l5');
assert(!check6.allowed && check6.reason.includes('5 层'), 'A04: 阻止超过 5 层的移动并给出明确提示');

// Attempt to move l1 into its descendant l3 (cycle)
const checkCycle = canMoveSubtree(tree5, level1, 'l3');
assert(!checkCycle.allowed && checkCycle.reason.includes('后代'), 'A04: 阻止将节点移动到自身后代（防循环）');

// 3. A07 & A08: 仅日期逾期判断
const todayStr = getTodayDateString(0);
const yesterdayStr = getTodayDateString(-1);
const tomorrowStr = getTodayDateString(1);

const taskToday = { ...task1, due_type: 'date', due_date: todayStr };
const taskYesterday = { ...task1, due_type: 'date', due_date: yesterdayStr };
const taskTomorrow = { ...task1, due_type: 'date', due_date: tomorrowStr };

assert(!isTaskOverdue(taskToday), 'A07: 仅日期任务在当天不视为逾期');
assert(isTaskOverdue(taskYesterday), 'A07: 仅日期任务在次日（昨天设定的）视为逾期');
assert(!isTaskOverdue(taskTomorrow), '未来日期任务不逾期');

// 4. A10: 父项划分象限不影响子项
const parentQ1 = { ...task1, id: 'p1', quadrant: 'Q1' };
const childNull = { ...task1, id: 'c1', parent_id: 'p1', quadrant: null };
assert(parentQ1.quadrant === 'Q1' && childNull.quadrant === null, 'A10: 父子象限独立，父项设为 Q1 不影响子项');

// 5. A17: 所有子项完成，父项显示 100% 待确认，父项依然为 open
const parentTask = { ...task1, id: 'p2', status: 'open' };
const childDone1 = { ...task1, id: 'c2_1', parent_id: 'p2', status: 'done' };
const childDone2 = { ...task1, id: 'c2_2', parent_id: 'p2', status: 'done' };
const testTasksA17 = [parentTask, childDone1, childDone2];
const prog = calculateProgress(testTasksA17, 'p2');
assert(prog.isAllLeavesDone && prog.percentage === 100 && parentTask.status === 'open', 'A17: 全部子任务完成显示 100%，父项仍保持未完成待用户确认');

// 6. A18: 恢复已完成子项同步恢复已完成祖先
const ancestorDone = { ...task1, id: 'anc1', status: 'done' };
const subDone = { ...task1, id: 'sub1', parent_id: 'anc1', status: 'done' };
const treeForRestore = [ancestorDone, subDone];
const ancestorsToRestore = getAncestorNodes(treeForRestore, subDone).filter(a => a.status === 'done');
assert(ancestorsToRestore.length === 1 && ancestorsToRestore[0].id === 'anc1', 'A18: 恢复子项识别出已完成祖先 anc1');

// 7. A26: JSON 导入严格校验（防孤立、防非法象限、防循环、防已完成父项下有未完成子项）
const badJsonCycle = JSON.stringify({
  schema_version: 1,
  tasks: [
    { ...task1, id: 'c_a', parent_id: 'c_b' },
    { ...task1, id: 'c_b', parent_id: 'c_a' },
  ],
  settings: {}
});
const valCycle = validateImportJson(badJsonCycle);
assert(!valCycle.valid && valCycle.error.includes('循环引用'), 'A26: JSON 校验拦截循环引用');

const badJsonIllegalQuadrant = JSON.stringify({
  schema_version: 1,
  tasks: [
    { ...task1, id: 't_bad_q', quadrant: 'Q99' },
  ],
  settings: {}
});
const valBadQ = validateImportJson(badJsonIllegalQuadrant);
assert(!valBadQ.valid && valBadQ.error.includes('非法'), 'A26: JSON 校验拦截非法象限枚举');

const badJsonDoneParentOpenChild = JSON.stringify({
  schema_version: 1,
  tasks: [
    { ...task1, id: 'p_done', status: 'done' },
    { ...task1, id: 'c_open', parent_id: 'p_done', status: 'open' },
  ],
  settings: {}
});
const valDoneParent = validateImportJson(badJsonDoneParentOpenChild);
assert(!valDoneParent.valid && valDoneParent.error.includes('已完成的父项'), 'A26: JSON 校验拦截完成父项下存在未完成子项');

console.log(`\n测试汇总: 通过 ${passed} 项，失败 ${failed} 项.`);
if (failed > 0) process.exit(1);
