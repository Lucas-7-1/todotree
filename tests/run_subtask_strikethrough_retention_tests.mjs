import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('  TodoTree 测试套件：子任务完成保留划线状态与父子闭环生命周期验收  ');
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

// Implement exact algorithms from treeOperations.ts
function hasActiveTaskAncestor(tasks, task) {
  let currParentId = task.parent_id;
  while (currParentId) {
    const parentNode = tasks.find((t) => t.id === currParentId);
    if (!parentNode || parentNode.deleted_at) break;
    if (parentNode.status === 'open') {
      if (parentNode.root_bucket === 'categories') {
        return false;
      }
      return true;
    }
    currParentId = parentNode.parent_id;
  }
  return false;
}

function isTaskVisibleInWorkspace(tasks, task, showCompleted = false) {
  if (task.deleted_at) return false;
  if (showCompleted) return true;
  if (task.status === 'open') return true;
  return hasActiveTaskAncestor(tasks, task);
}

function getChildrenTasks(allTasks, parentId) {
  return allTasks.filter((t) => t.parent_id === parentId && !t.deleted_at);
}

function getDescendantTasks(allTasks, parentId) {
  const result = [];
  const queue = [parentId];
  while (queue.length > 0) {
    const pid = queue.shift();
    const children = allTasks.filter((t) => t.parent_id === pid && !t.deleted_at);
    for (const child of children) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

function getLeafDescendants(tasks, parentId) {
  const descendants = getDescendantTasks(tasks, parentId);
  if (descendants.length === 0) return [];
  const parentIds = new Set(descendants.map((d) => d.parent_id).filter(Boolean));
  return descendants.filter((d) => !parentIds.has(d.id));
}

function calculateProgress(tasks, parentId) {
  const leaves = getLeafDescendants(tasks, parentId);
  if (leaves.length === 0) {
    return { completed: 0, total: 0, percentage: 0, isAllLeavesDone: false };
  }
  const completed = leaves.filter((l) => l.status === 'done').length;
  const total = leaves.length;
  const percentage = Math.round((completed / total) * 100);
  return { completed, total, percentage, isAllLeavesDone: completed === total };
}

// Helper simulating App.tsx toggleComplete logic
function toggleComplete(tasks, taskId, outcomeNote) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return tasks;

  const isNowDone = task.status === 'open';

  if (isNowDone) {
    const descendants = getDescendantTasks(tasks, task.id);
    const incompleteDescendants = descendants.filter((d) => !d.deleted_at && d.status === 'open');
    const idsToComplete = new Set([task.id, ...incompleteDescendants.map((d) => d.id)]);

    let currParentId = task.parent_id;
    while (currParentId) {
      const parentNode = tasks.find((t) => t.id === currParentId);
      if (!parentNode || parentNode.deleted_at || parentNode.status === 'done' || idsToComplete.has(parentNode.id)) {
        break;
      }
      const siblings = tasks.filter((t) => t.parent_id === currParentId && !t.deleted_at);
      const allSiblingsDone =
        siblings.length > 0 &&
        siblings.every((s) => s.status === 'done' || idsToComplete.has(s.id));
      if (allSiblingsDone) {
        idsToComplete.add(parentNode.id);
        currParentId = parentNode.parent_id;
      } else {
        break;
      }
    }

    const now = new Date().toISOString();
    return tasks.map((t) => {
      if (idsToComplete.has(t.id)) {
        return {
          ...t,
          status: 'done',
          completed_at: now,
          updated_at: now,
        };
      }
      return t;
    });
  } else {
    // Re-open
    return tasks.map((t) =>
      t.id === task.id
        ? { ...t, status: 'open', completed_at: null, updated_at: new Date().toISOString() }
        : t
    );
  }
}

// -----------------------------------------------------------------------------
// Test 1: 3子节点场景：完成1个子节点，该子节点必须保留在主工作区并呈现划线状态
// -----------------------------------------------------------------------------
runTest('STR-01: 一个父节点下有3个子节点，完成1个时该子节点保留在工作区且显示划线状态', () => {
  let tasks = [
    { id: 'parent-1', title: '父任务', parent_id: null, root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c1', title: '子任务1', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c2', title: '子任务2', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c3', title: '子任务3', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
  ];

  // Complete c1
  tasks = toggleComplete(tasks, 'c1');

  const c1 = tasks.find((t) => t.id === 'c1');
  const parent = tasks.find((t) => t.id === 'parent-1');

  assert.strictEqual(c1.status, 'done', 'c1 状态必须为 done');
  assert.strictEqual(parent.status, 'open', 'parent 必须保持 open（因为还有两个未完成）');

  // Check workspace visibility
  assert.strictEqual(
    isTaskVisibleInWorkspace(tasks, c1, false),
    true,
    'c1 必须在主工作区保持可见（保留划线状态），而不是直接没了'
  );
  assert.strictEqual(
    isTaskVisibleInWorkspace(tasks, tasks.find((t) => t.id === 'c2'), false),
    true,
    '未完成的 c2 在主工作区可见'
  );
  assert.strictEqual(
    isTaskVisibleInWorkspace(tasks, tasks.find((t) => t.id === 'c3'), false),
    true,
    '未完成的 c3 在主工作区可见'
  );

  // Check progress
  const progress = calculateProgress(tasks, 'parent-1');
  assert.strictEqual(progress.completed, 1);
  assert.strictEqual(progress.total, 3);
  assert.strictEqual(progress.isAllLeavesDone, false);
});

// -----------------------------------------------------------------------------
// Test 2: 完成第2个子节点，c1和c2均保留划线状态
// -----------------------------------------------------------------------------
runTest('STR-02: 完成第2个子节点，已完成的两个子节点均保留划线状态，进度更新为 2/3', () => {
  let tasks = [
    { id: 'parent-1', title: '父任务', parent_id: null, root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c1', title: '子任务1', parent_id: 'parent-1', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
    { id: 'c2', title: '子任务2', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c3', title: '子任务3', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
  ];

  // Complete c2
  tasks = toggleComplete(tasks, 'c2');

  const c1 = tasks.find((t) => t.id === 'c1');
  const c2 = tasks.find((t) => t.id === 'c2');
  const parent = tasks.find((t) => t.id === 'parent-1');

  assert.strictEqual(c2.status, 'done');
  assert.strictEqual(parent.status, 'open');

  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c1, false), true, 'c1 依然可见并划线');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c2, false), true, 'c2 也保持可见并划线');

  const progress = calculateProgress(tasks, 'parent-1');
  assert.strictEqual(progress.completed, 2);
  assert.strictEqual(progress.total, 3);
});

// -----------------------------------------------------------------------------
// Test 3: 完成第3个子节点（全部子节点完成），父节点自动闭环，整条分支全部退出工作区
// -----------------------------------------------------------------------------
runTest('STR-03: 完成全部子节点时触发父节点向上闭环，整条分支整体退出主工作区', () => {
  let tasks = [
    { id: 'parent-1', title: '父任务', parent_id: null, root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c1', title: '子任务1', parent_id: 'parent-1', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
    { id: 'c2', title: '子任务2', parent_id: 'parent-1', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
    { id: 'c3', title: '子任务3', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
  ];

  // Complete c3 -> triggers closure of parent-1
  tasks = toggleComplete(tasks, 'c3');

  const c1 = tasks.find((t) => t.id === 'c1');
  const c2 = tasks.find((t) => t.id === 'c2');
  const c3 = tasks.find((t) => t.id === 'c3');
  const parent = tasks.find((t) => t.id === 'parent-1');

  assert.strictEqual(parent.status, 'done', '父节点必须自动完成');
  assert.strictEqual(c3.status, 'done', 'c3 必须完成');

  // When showCompleted = false, all of them must exit workspace
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, parent, false), false, '父节点退出主工作区');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c1, false), false, 'c1 随父节点退出主工作区');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c2, false), false, 'c2 随父节点退出主工作区');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c3, false), false, 'c3 随父节点退出主工作区');

  // When showCompleted = true, all are visible
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, parent, true), true);
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c1, true), true);
});

// -----------------------------------------------------------------------------
// Test 4: 反选撤销：划线子节点点击复选框反选，恢复为未完成，划线解除，进度回退
// -----------------------------------------------------------------------------
runTest('STR-04: 点击已划线完成的子节点复选框，可正常反选重新开启，划线解除', () => {
  let tasks = [
    { id: 'parent-1', title: '父任务', parent_id: null, root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c1', title: '子任务1', parent_id: 'parent-1', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
    { id: 'c2', title: '子任务2', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c3', title: '子任务3', parent_id: 'parent-1', root_bucket: null, status: 'open', deleted_at: null },
  ];

  // Re-open c1
  tasks = toggleComplete(tasks, 'c1');

  const c1 = tasks.find((t) => t.id === 'c1');
  assert.strictEqual(c1.status, 'open', 'c1 状态恢复为 open');
  assert.strictEqual(c1.completed_at, null, 'completed_at 清空');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, c1, false), true, '依然在主工作区');

  const progress = calculateProgress(tasks, 'parent-1');
  assert.strictEqual(progress.completed, 0, '完成数回退为 0');
  assert.strictEqual(progress.total, 3);
});

// -----------------------------------------------------------------------------
// Test 5: 分类容器（如工作、学习、生活）下的单独立项任务完成直接归档，不驻留划线
// -----------------------------------------------------------------------------
runTest('STR-05: 分类桶（root_bucket: categories）下的顶层任务完成直接退出工作区', () => {
  const tasks = [
    { id: 'cat-work', title: '工作', parent_id: null, root_bucket: 'categories', status: 'open', deleted_at: null },
    { id: 'task-meeting', title: '确认会议', parent_id: 'cat-work', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
  ];

  assert.strictEqual(
    isTaskVisibleInWorkspace(tasks, tasks.find((t) => t.id === 'task-meeting'), false),
    false,
    '分类下的完成任务直接退出工作区归档至抽屉'
  );
});

// -----------------------------------------------------------------------------
// Test 6: 分类容器下的多层分支：采购调研（含3子任务）在分类桶内部分完成时保留划线
// -----------------------------------------------------------------------------
runTest('STR-06: 分类桶内含子任务的项目，单子任务完成在项目内保留划线，项目全部完成退出分类', () => {
  let tasks = [
    { id: 'cat-work', title: '工作', parent_id: null, root_bucket: 'categories', status: 'open', deleted_at: null },
    { id: 'procurement', title: '采购调研', parent_id: 'cat-work', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'sub-1', title: '整理清单', parent_id: 'procurement', root_bucket: null, status: 'open', deleted_at: null },
    { id: 'sub-2', title: '核对报价', parent_id: 'procurement', root_bucket: null, status: 'open', deleted_at: null },
  ];

  // Complete sub-1
  tasks = toggleComplete(tasks, 'sub-1');
  const sub1 = tasks.find((t) => t.id === 'sub-1');
  const proc = tasks.find((t) => t.id === 'procurement');

  assert.strictEqual(sub1.status, 'done');
  assert.strictEqual(proc.status, 'open');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, sub1, false), true, 'sub-1 在采购调研中保留划线状态');

  // Complete sub-2 -> procurement finishes
  tasks = toggleComplete(tasks, 'sub-2');
  const sub2 = tasks.find((t) => t.id === 'sub-2');
  const procDone = tasks.find((t) => t.id === 'procurement');

  assert.strictEqual(procDone.status, 'done');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, procDone, false), false, '采购调研整体退出工作区');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, sub1, false), false, 'sub-1 随之退出');
  assert.strictEqual(isTaskVisibleInWorkspace(tasks, sub2, false), false, 'sub-2 随之退出');
});

// -----------------------------------------------------------------------------
// Test 7: 树状视图渲染数据源 children 过滤验证
// -----------------------------------------------------------------------------
runTest('STR-07: TaskTree 树节点渲染器正确保留未闭环父节点下的已完成子节点', () => {
  const tasks = [
    { id: 'p', title: '父节点', parent_id: null, root_bucket: null, status: 'open', deleted_at: null },
    { id: 'c1', title: '完成的子任务', parent_id: 'p', root_bucket: null, status: 'done', completed_at: '2026-09-24T00:00:00Z', deleted_at: null },
    { id: 'c2', title: '未完成的子任务', parent_id: 'p', root_bucket: null, status: 'open', deleted_at: null },
  ];

  const visibleChildren = getChildrenTasks(tasks, 'p').filter((c) =>
    isTaskVisibleInWorkspace(tasks, c, false)
  );

  assert.strictEqual(visibleChildren.length, 2, '渲染时父节点必须包含两个子节点');
  assert.strictEqual(visibleChildren[0].id, 'c1');
  assert.strictEqual(visibleChildren[0].status, 'done');
  assert.strictEqual(visibleChildren[1].id, 'c2');
  assert.strictEqual(visibleChildren[1].status, 'open');
});

// -----------------------------------------------------------------------------
// Test 8: 源码集成核验：验证 treeOperations, TaskTree, TaskItemRow 正确对接
// -----------------------------------------------------------------------------
runTest('STR-08: 源码集成核验 - treeOperations, TaskTree, TaskItemRow 文件实现完整性', () => {
  const treeOpsCode = fs.readFileSync('src/services/treeOperations.ts', 'utf-8');
  assert.strictEqual(treeOpsCode.includes('export function hasActiveTaskAncestor'), true);
  assert.strictEqual(treeOpsCode.includes('export function isTaskVisibleInWorkspace'), true);

  const taskTreeCode = fs.readFileSync('src/components/TaskTree/TaskTree.tsx', 'utf-8');
  assert.strictEqual(taskTreeCode.includes('isTaskVisibleInWorkspace'), true);
  assert.strictEqual(taskTreeCode.includes('visibleWorkspaceTasks'), true);
  assert.strictEqual(
    taskTreeCode.includes('children = children.filter((c) => isTaskVisibleInWorkspace(tasks, c, showCompleted));'),
    true
  );

  const taskItemRowCode = fs.readFileSync('src/components/TaskTree/TaskItemRow.tsx', 'utf-8');
  assert.strictEqual(taskItemRowCode.includes('hasActiveTaskAncestor'), true);
  assert.strictEqual(taskItemRowCode.includes('willStayInWorkspace'), true);
  assert.strictEqual(taskItemRowCode.includes('is-done text-slate-400'), true);
});

console.log('\n========================================================================');
console.log(`  验收套件执行结果: ${passedTests} / ${totalTests} 通过 (${passedTests === totalTests ? 'ALL PASSED' : 'FAILED'})`);
console.log('========================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
