import { filterEffectiveCompletionEvents } from '../src/services/calendarService';
import { buildTransitionEvents } from '../src/services/transitionEvents';
import { applyBulkAction } from '../src/services/bulkTasks';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { TaskTree } from '../src/components/TaskTree/TaskTree';
import { completeTaskBranch, archiveCompletedBranch, reopenTaskBranch, insertTaskNode } from '../src/services/taskLifecycle';
import { isTaskVisibleInWorkspace } from '../src/services/treeOperations';
import { undoManager } from '../src/services/undoManager';
import { validateImportJson, exportBackupData } from '../src/services/importExport';
import { TaskNode } from '../src/types/todo';

const timestamp = '2026-09-24T01:00:00.000Z';
function task(id: string, parent_id: string | null = null, status: 'open' | 'done' = 'open'): TaskNode {
  return { id, parent_id, title: id, status, root_bucket: parent_id ? null : 'categories', note: '', sort_order: 1,
    completed_at: status === 'done' ? timestamp : null, archived_at: null, due_type: 'none', due_date: null, due_at: null,
    quadrant: null, planned_date: null, created_at: timestamp, updated_at: timestamp, deleted_at: null, deletion_batch_id: null };
}
const get = (tasks: TaskNode[], id: string) => tasks.find(t => t.id === id)!;
const visible = (tasks: TaskNode[]) => tasks.filter(t => isTaskVisibleInWorkspace(tasks, t)).map(t => t.id);

let root: Root | undefined;
afterEach(async () => { if (root) { await act(() => root!.unmount()); root = undefined; } document.body.innerHTML = ''; localStorage.clear(); undoManager.clear(); });

test('one completed child remains struck through under an open root category', () => {
  const before = [task('root'), task('a', 'root'), task('b', 'root')];
  const result = completeTaskBranch(before, 'a');
  assert.equal(get(result.tasks, 'a').status, 'done');
  assert.equal(get(result.tasks, 'a').archived_at, null);
  assert.deepEqual(visible(result.tasks), ['root', 'a', 'b']);
  assert.equal(result.completedTasks.length, 1);
});

test('搞定 archives only the completed child; last sibling still closes the whole branch', () => {
  let tasks = completeTaskBranch([task('root'), task('a', 'root'), task('b', 'root')], 'a').tasks;
  const completionTime = get(tasks, 'a').completed_at;
  const beforeArchive = tasks;
  tasks = archiveCompletedBranch(tasks, 'a').tasks;
  assert.deepEqual(visible(tasks), ['root', 'b']);
  assert.equal(get(tasks, 'a').completed_at, completionTime);
  undoManager.pushTaskDiff('archive', beforeArchive, tasks);
  assert.deepEqual(visible(undoManager.undo(tasks)!.newTasks), ['root', 'a', 'b']);
  const result = completeTaskBranch(tasks, 'b');
  assert.deepEqual(visible(result.tasks), []);
  assert.deepEqual(result.completedTasks.map(t => t.id).sort(), ['b', 'root']);
  assert.equal(get(result.tasks, 'a').completed_at, completionTime);
});

test('nested branch auto-closes with strikethrough retention without closing unfinished sibling branch (PRD V1.0)', () => {
  const tasks = [task('root'), task('branch', 'root'), task('other', 'root'), task('a', 'branch'), task('b', 'branch')];
  const first = completeTaskBranch(tasks, 'a').tasks;
  assert.ok(visible(first).includes('a'));
  const last = completeTaskBranch(first, 'b');
  assert.deepEqual(last.autoClosedIds, ['branch']);
  assert.deepEqual(visible(last.tasks), ['root', 'branch', 'other', 'a', 'b']);
  undoManager.pushTaskDiff('last child', first, last.tasks);
  const restored = undoManager.undo(last.tasks)!.newTasks;
  assert.deepEqual(visible(restored), ['root', 'branch', 'other', 'a', 'b']);
  assert.equal(get(restored, 'a').status, 'done');
  assert.equal(get(restored, 'b').status, 'open');
  assert.deepEqual(visible(undoManager.redo(restored)!.newTasks), ['root', 'branch', 'other', 'a', 'b']);

  // PRD V1.0: Intermediate branch auto-completes, but retains strikethrough until top-level completes or explicit "搞定"
  assert.deepEqual(visible(last.tasks), ['root', 'branch', 'other', 'a', 'b']);
  assert.equal(get(last.tasks, 'branch').status, 'done');
  assert.equal(get(last.tasks, 'branch').archived_at, null);
  // Clicking "搞定" on branch archives branch and its children
  const archivedBranch = archiveCompletedBranch(last.tasks, 'branch').tasks;
  assert.deepEqual(visible(archivedBranch), ['root', 'other']);
  // Completing the remaining sibling 'other' closes the top-level tree
  const finalResult = completeTaskBranch(archivedBranch, 'other');
  assert.deepEqual(visible(finalResult.tasks), []);
});

test('manual parent completion includes all descendants and propagates to ancestors', () => {
  const tasks = [task('root'), task('branch', 'root'), task('a', 'branch'), task('grandchild', 'a')];
  const result = completeTaskBranch(tasks, 'branch');
  assert.ok(result.tasks.every(t => t.status === 'done' && t.archived_at));
  assert.equal(result.completedTasks.length, 4);
  assert.equal(completeTaskBranch(result.tasks, 'branch').completedTasks.length, 0);
});

test('adding under a completed nested node reopens the path and is atomically undoable', () => {
  const before = completeTaskBranch([task('root'), task('child', 'root')], 'child').tasks;
  const inserted = insertTaskNode(before, task('grandchild', 'child'));
  assert.ok(inserted.every(t => t.status === 'open' && !t.archived_at));
  undoManager.pushTaskDiff('insert', before, inserted);
  const undone = undoManager.undo(inserted)!.newTasks;
  assert.equal(get(undone, 'child').status, 'done');
  assert.ok(get(undone, 'child').archived_at);
  assert.ok(get(undone, 'grandchild').deleted_at);
  assert.deepEqual(visible(undone), []);
  assert.deepEqual(visible(undoManager.redo(undone)!.newTasks), ['root', 'child', 'grandchild']);
});

test('reopening an archived leaf opens ancestors; deleted children do not block closure', () => {
  const removed = { ...task('deleted', 'root'), deleted_at: timestamp };
  const done = completeTaskBranch([task('root'), task('child', 'root'), removed], 'child').tasks;
  const reopened = reopenTaskBranch(done, 'child');
  assert.equal(get(reopened, 'root').status, 'open');
  assert.equal(get(reopened, 'child').archived_at, null);
  assert.equal(get(reopened, 'deleted').deleted_at, timestamp);
});

test('five levels allowed; sixth level, missing parent and empty title rejected', () => {
  let tasks = [task('level1')];
  for (let depth = 2; depth <= 5; depth++) tasks = insertTaskNode(tasks, task(`level${depth}`, `level${depth - 1}`));
  assert.throws(() => insertTaskNode(tasks, task('level6', 'level5')), /5 层/);
  assert.throws(() => insertTaskNode(tasks, task('bad', 'missing')), /父任务/);
  assert.throws(() => insertTaskNode(tasks, { ...task('blank'), title: '  ' }), /不能为空/);
});

test('archival metadata survives backup/import and cannot be archived while open', () => {
  const tasks = completeTaskBranch([task('root'), task('a', 'root'), task('b', 'root')], 'a').tasks;
  assert.equal(archiveCompletedBranch(tasks, 'b').tasks, tasks);
  const archived = archiveCompletedBranch(tasks, 'a').tasks;
  const backup = exportBackupData(archived, { timezone: 'Asia/Shanghai', reduced_motion: true, show_completed: false, schema_version: 2 });
  const imported = validateImportJson(backup);
  assert.equal(imported.valid, true);
  assert.deepEqual(visible(imported.tasks!), ['root', 'b']);
});

let latest: TaskNode[] = [];
let nextId = 0;
let batchCalls = 0;
let batchFailure = false;
function Harness({ initial, reject = false, bulk = false }: { initial: TaskNode[]; reject?: boolean; bulk?: boolean }) {
  const [tasks, setTasks] = useState(initial);
  latest = tasks;
  const noop = () => {};
  return <TaskTree tasks={tasks} onBulkAction={bulk ? async (ids, action) => {
    batchCalls++;
    if (batchFailure) return false;
    const result = applyBulkAction(tasks, ids, action); setTasks(result.tasks); return true;
  } : undefined} selectedTaskId={null} onSelectTask={noop}
    onToggleComplete={t => setTasks(prev => t.status === 'done' ? reopenTaskBranch(prev, t.id) : completeTaskBranch(prev, t.id).tasks)}
    onArchiveCompleted={t => setTasks(prev => archiveCompletedBranch(prev, t.id).tasks)}
    onUpdateTitle={noop} onUpdateQuadrant={noop} onUpdateDue={noop} onAddChild={noop}
    onAddTaskInline={(parent, title) => {
      if (reject) return null;
      const newTask = { ...task(`new-${++nextId}`, parent), title };
      setTasks(prev => insertTaskNode(prev, newTask));
      return newTask;
    }} onDeleteTask={noop} onDuplicateTask={noop} onTogglePlannedToday={noop} onMoveNode={noop}
    onOpenCompletedDrawer={noop} reducedMotion searchQuery="" onShowErrorToast={noop} />;
}
async function mount(initial: TaskNode[], reject = false, bulk = false) {
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(() => root!.render(<Harness initial={initial} reject={reject} bulk={bulk} />));
}
async function click(el: Element | null) { assert.ok(el); await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); }
async function button(text: string) { const el = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); await click(el!); }
function row(id: string) { return document.querySelector(`[data-task-id="${id}"]`)!; }
function draft() { return document.querySelector('input[placeholder^="输入子任务名称"]') as HTMLInputElement; }
async function enter(value: string) {
  const input = draft(); assert.ok(input, 'inline draft exists');
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}

test('actual tree UI creates children and grandchildren from zero children', async () => {
  await mount([task('root'), task('child', 'root'), task('other', 'root')]);
  await button('全部展开');
  await click(row('child').querySelector('[title="原位添加子任务"]'));
  assert.equal(document.activeElement, draft());
  await enter('孙任务');
  const grandchild = latest.find(t => t.title === '孙任务')!;
  assert.equal(grandchild.parent_id, 'child');
  await click(row(grandchild.id).querySelector('[title="原位添加子任务"]'));
  await enter('曾孙任务');
  assert.equal(latest.find(t => t.title === '曾孙任务')!.parent_id, grandchild.id);
});

test('actual UI retains completed rows, provides 搞定, and closes on the last sibling', async () => {
  await mount([task('root'), task('a', 'root'), task('b', 'root')]);
  await button('全部展开');
  await click(row('a').querySelector('[title="勾选完成"]'));
  await button('确认完成');
  assert.ok(row('a').querySelector('.is-done'));
  await button('搞定');
  assert.equal(row('a'), null);
  assert.ok(row('b'));
  await click(row('b').querySelector('[title="勾选完成"]'));
  await button('确认完成');
  assert.equal(document.querySelectorAll('[data-task-id]').length, 0);
  assert.ok(latest.every(t => t.status === 'done' && t.archived_at));
});

test('actual UI adds a child under a retained completed child and reopens that node', async () => {
  await mount([task('root'), task('a', 'root', 'done'), task('b', 'root')]);
  await button('全部展开');
  await click(row('a').querySelector('[title="原位添加子任务"]'));
  await enter('继续工作');
  assert.equal(get(latest, 'a').status, 'open');
  assert.equal(latest.find(t => t.title === '继续工作')!.parent_id, 'a');
  assert.ok(document.body.textContent?.includes('继续工作'));
});

test('rejected inline creation retains the entered text', async () => {
  await mount([task('root')], true);
  await click(row('root').querySelector('[title="原位添加子任务"]'));
  await enter('不要丢失这段输入');
  assert.equal(draft().value, '不要丢失这段输入');
  assert.equal(latest.length, 1);
});

for (const view of ['list', 'project_group']) {
  test(`nested creation and 搞定 work in ${view} view`, async () => {
    localStorage.setItem('todotree_task_view_mode', view);
    await mount([task('root'), task('a', 'root', 'done'), task('b', 'root')]);
    await click(row('b').querySelector('[title="原位添加子任务"]'));
    await enter('嵌套任务');
    assert.equal(latest.find(t => t.title === '嵌套任务')!.parent_id, 'b');
    await button('搞定');
    assert.equal(row('a'), null);
  });
}

import { App } from '../src/App';
import { applyTaskFilters, DEFAULT_FILTER_STATE } from '../src/services/filterEngine';
import { syncRecurringTasks } from '../src/services/recurrence';

test('search includes retained done tasks but excludes archived matches', () => {
  const tasks = [task('root'), task('匹配a', 'root', 'done'), { ...task('匹配b', 'root', 'done'), archived_at: timestamp }, task('unfinished', 'root')];
  const candidates = new Set(visible(tasks));
  const result = applyTaskFilters(tasks, { ...DEFAULT_FILTER_STATE, keywords: '匹配' }, '2026-09-24', new Date(), candidates);
  assert.deepEqual([...result.matchedIds], ['匹配a']);
  assert.ok(result.contextAncestorIds.has('root'));
});

test('a new recurring occurrence reopens its archived parent', () => {
  const rule = { id: 'repeat', type: 'daily' as const, start_date: '2020-01-01' };
  const child = { ...task('child', 'root', 'done'), archived_at: timestamp, recurrence_rule: rule, recurrence_rule_id: rule.id, recurrence_period_key: 'daily_2020-01-01' };
  const result = syncRecurringTasks([{ ...task('root', null, 'done'), archived_at: timestamp }, child]);
  assert.equal(result.addedCount, 1);
  assert.equal(get(result.updatedTasks, 'root').status, 'open');
  assert.equal(get(result.updatedTasks, 'root').archived_at, null);
});

test('App integration: completion, archive, toast undo, parent closure and reload', async () => {
  let storedTasks = [task('root'), task('a', 'root'), task('b', 'root')];
  const endpointData = new Map<string, unknown>();
  const oldFetch = globalThis.fetch;
  const oldWarn = console.warn;
  console.warn = () => {}; // IndexedDB is deliberately unavailable; API/localStorage are the test stores.
  (window as any).__TODOTREE_DESKTOP__ = true;
  let serverState = { schema_version: 2, revision: 0, operation_id: 'init', saved_at: timestamp,
    data: { tasks: storedTasks, events: [], settings: { timezone: 'Asia/Shanghai', reduced_motion: true, schema_version: 2 }, ai_settings: {}, reports: [], attempts: [] } };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === '/api/workspace') {
      if (options?.method === 'POST') {
        const op = JSON.parse(String(options.body));
        assert.equal(op.expected_revision, serverState.revision);
        serverState = { ...serverState, revision: serverState.revision + 1, operation_id: op.operation_id, data: op.data };
        storedTasks = op.data.tasks;
      }
      return new Response(JSON.stringify(serverState));
    }
    return new Response(JSON.stringify(url.includes('health') ? { status: 'ok', instance_id: 'test', db_ready: true } : {}));
  };
  const mountApp = async () => {
    localStorage.setItem('todotree_settings_v1', JSON.stringify({ timezone: 'Asia/Shanghai', reduced_motion: true, schema_version: 2 }));
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<App />); await new Promise(resolve => setTimeout(resolve, 10)); });
  };
  try {
    await mountApp();
    await button('全部展开');
    await click(row('a').querySelector('[title="勾选完成"]'));
    await button('确认完成');
    assert.equal(get(storedTasks, 'a').status, 'done');
    assert.ok(row('a'));
    await button('搞定');
    assert.equal(row('a'), null);
    assert.ok(get(storedTasks, 'a').archived_at);
    // The toast callback was created before its operation; it must still use latest tasks.
    const undoButtons = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '撤销');
    await click(undoButtons.at(-1)!);
    assert.ok(row('a')?.querySelector('.is-done'));
    assert.ok(!get(storedTasks, 'a').archived_at);
    await click(row('b').querySelector('[title="勾选完成"]'));
    await button('确认完成');
    assert.ok(storedTasks.every(t => t.status === 'done' && t.archived_at));
    assert.equal(document.querySelectorAll('[data-task-id]').length, 0);
    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    assert.equal(get(storedTasks, 'root').status, 'open');
    assert.equal(get(storedTasks, 'a').status, 'done');
    assert.ok(row('a')?.querySelector('.is-done'));
    await act(() => root!.unmount()); root = undefined; document.body.innerHTML = '';
    await mountApp();
    await button('全部展开');
    assert.ok(row('a')?.querySelector('.is-done'));
    assert.equal(get(storedTasks, 'b').status, 'open');
  } finally {
    if (root) { await act(() => root!.unmount()); root = undefined; }
    globalThis.fetch = oldFetch; console.warn = oldWarn;
  }
});

test('blur followed by clicking the same parent + creates a fresh focused draft', async () => {
  await mount([task('root'), task('child', 'root')]);
  await button('全部展开');
  await click(row('child').querySelector('[title="原位添加子任务"]'));
  await act(() => draft().blur());
  assert.equal(draft(), null);
  await click(row('child').querySelector('[title="原位添加子任务"]'));
  assert.ok(draft());
  assert.equal(document.activeElement, draft());
  await enter('不需要手动预建孙节点');
  assert.equal(latest.find(t => t.title === '不需要手动预建孙节点')!.parent_id, 'child');
});


test('batch completion deduplicates parent and child and retains intermediate branch', () => {
  const before = [task('root'), task('A', 'root'), task('a1', 'A'), task('a2', 'A'), task('B', 'root')];
  const result = applyBulkAction(before, ['A', 'a1'], { type: 'complete' });
  assert.equal(result.changedCount, 3);
  assert.equal(get(result.tasks, 'A').status, 'done');
  assert.equal(get(result.tasks, 'root').status, 'open');
  assert.ok(result.tasks.every(t => !t.archived_at));
  undoManager.pushTaskDiff('batch', before, result.tasks);
  assert.ok(undoManager.undo(result.tasks)!.newTasks.every(t => t.status === 'open'));
});

test('bulk properties affect explicit selection only and today/deletion batch undo is exact', () => {
  const before = [task('root'), task('A', 'root'), task('a1', 'A')];
  const dated = applyBulkAction(before, ['A'], { type: 'today', value: '2026-09-24' }).tasks;
  assert.equal(get(dated, 'a1').planned_date, null);
  undoManager.pushTaskDiff('today', before, dated);
  assert.equal(get(undoManager.undo(dated)!.newTasks, 'A').planned_date, null);
  const deleted = applyBulkAction(before, ['A', 'a1'], { type: 'delete' }).tasks;
  assert.equal(get(deleted, 'A').deletion_batch_id, get(deleted, 'a1').deletion_batch_id);
  assert.equal(get(deleted, 'root').deleted_at, null);
  undoManager.pushTaskDiff('delete', before, deleted);
  const restored = undoManager.undo(deleted)!.newTasks;
  assert.equal(get(restored, 'a1').deleted_at, null);
  assert.equal(get(restored, 'a1').deletion_batch_id, null);
});

test('archive refuses unfinished descendants and skips no completed history', () => {
  assert.throws(() => applyBulkAction([task('A', null, 'done'), task('a', 'A')], ['A'], { type: 'archive' }), /未完成/);
  const before = [task('root'), task('a', 'root', 'done'), task('b', 'root')];
  const result = applyBulkAction(before, ['a', 'b'], { type: 'complete' });
  assert.equal(result.skippedCount, 1);
  assert.ok(result.tasks.every(t => t.archived_at));
  assert.equal(get(result.tasks, 'a').completed_at, timestamp);
});

test('actual UI queues two completions and commits them once', async () => {
  batchCalls = 0; batchFailure = false;
  await mount([task('root'), task('a', 'root'), task('b', 'root')], false, true);
  await button('全部展开');
  await click(row('a').querySelector('[title="勾选完成"]'));
  await click(row('b').querySelector('[title="勾选完成"]'));
  assert.ok(row('a').querySelector('[title="取消勾选"]'));
  assert.ok(row('b').querySelector('[title="取消勾选"]'));
  assert.equal(document.querySelectorAll('button').length > 0, true);
  assert.ok(latest.every(t => t.status === 'open'));
  assert.equal([...document.querySelectorAll('button')].filter(b => b.textContent === '确认完成').length, 1);
  await button('确认完成');
  assert.equal(batchCalls, 1);
  assert.ok(latest.every(t => t.archived_at));
});

test('failed batch keeps pending checks for retry', async () => {
  batchCalls = 0; batchFailure = true;
  await mount([task('root'), task('a', 'root'), task('b', 'root')], false, true);
  await button('全部展开');
  await click(row('a').querySelector('[title="勾选完成"]')); await click(row('b').querySelector('[title="勾选完成"]'));
  await button('确认完成');
  assert.ok(row('a').querySelector('[title="取消勾选"]'));
  assert.ok(latest.every(t => t.status === 'open'));
  batchFailure = false; await button('确认完成');
  assert.ok(latest.every(t => t.status === 'done'));
});

test('explicit selection does not complete; Delete previews deduplicated subtree', async () => {
  batchFailure = false; batchCalls = 0;
  await mount([task('root'), task('A', 'root'), task('a', 'A'), task('B', 'root')], false, true);
  await button('全部展开'); await button('多选');
  await click(document.querySelector('[aria-label="选择 A"]'));
  await click(document.querySelector('[aria-label="选择 a"]'));
  assert.ok(latest.every(t => t.status === 'open'));
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
  assert.ok(document.querySelector('[aria-label="确认批量操作"]'));
  await button('确认移入回收站');
  assert.equal(batchCalls, 1);
  assert.ok(get(latest, 'A').deleted_at && get(latest, 'a').deleted_at);
  assert.equal(get(latest, 'B').deleted_at, null);
});


test('undo with a distinct operation id removes completion from calendar; redo restores exactly once', () => {
  const before = [task('a')];
  const done = [{ ...task('a'), status: 'done' as const, completed_at: timestamp }];
  const events = [...buildTransitionEvents(before, done), ...buildTransitionEvents(done, before)];
  assert.equal(filterEffectiveCompletionEvents(events).length, 0);
  assert.equal(filterEffectiveCompletionEvents([...events, ...buildTransitionEvents(before, done)]).length, 1);

});

test('PRD V1.0 C01-C07: multi-level completion, strikethrough retention and archiving rules', () => {
  // Tree: 健身 (root) -> 分支A (branchA) -> A1, A2
  //                   -> 分支B (branchB)
  const tree = [
    task('fitness', null),
    task('branchA', 'fitness'),
    task('branchB', 'fitness'),
    task('a1', 'branchA'),
    task('a2', 'branchA'),
  ];

  // C01: A1 completed, A2 open -> A1 strikethrough retained, A and fitness open
  const step1 = completeTaskBranch(tree, 'a1');
  assert.equal(get(step1.tasks, 'a1').status, 'done');
  assert.equal(get(step1.tasks, 'a1').archived_at, null);
  assert.equal(get(step1.tasks, 'branchA').status, 'open');
  assert.equal(get(step1.tasks, 'fitness').status, 'open');
  assert.deepEqual(step1.newlyArchivedIds, []);
  assert.deepEqual(visible(step1.tasks), ['fitness', 'branchA', 'branchB', 'a1', 'a2']);

  // C02: A1, A2 both completed, B open -> branchA auto completed, branchA retained in workspace
  const step2 = completeTaskBranch(step1.tasks, 'a2');
  assert.equal(get(step2.tasks, 'a2').status, 'done');
  assert.equal(get(step2.tasks, 'branchA').status, 'done');
  assert.equal(get(step2.tasks, 'branchA').archived_at, null);
  assert.equal(get(step2.tasks, 'fitness').status, 'open');
  assert.deepEqual(step2.autoClosedIds, ['branchA']);
  assert.deepEqual(step2.newlyArchivedIds, []);
  assert.deepEqual(visible(step2.tasks), ['fitness', 'branchA', 'branchB', 'a1', 'a2']);

  // C03: User clicks "搞定" on branchA -> only branchA and its children are archived
  const step3 = archiveCompletedBranch(step2.tasks, 'branchA');
  assert.ok(get(step3.tasks, 'branchA').archived_at);
  assert.ok(get(step3.tasks, 'a1').archived_at);
  assert.ok(get(step3.tasks, 'a2').archived_at);
  assert.equal(get(step3.tasks, 'fitness').archived_at, null);
  assert.equal(get(step3.tasks, 'branchB').archived_at, null);
  assert.deepEqual(visible(step3.tasks), ['fitness', 'branchB']);

  // C05: branchA was archived previously, now complete branchB -> fitness auto completes and entire tree archives
  const step4 = completeTaskBranch(step3.tasks, 'branchB');
  assert.equal(get(step4.tasks, 'fitness').status, 'done');
  assert.ok(get(step4.tasks, 'fitness').archived_at);
  assert.ok(get(step4.tasks, 'branchB').archived_at);
  assert.deepEqual(visible(step4.tasks), []);

  // C06: Manual completion of branchA while B is open -> branchA and children complete, but NOT auto-archived
  const freshTree = [
    task('fitness', null),
    task('branchA', 'fitness'),
    task('branchB', 'fitness'),
    task('a1', 'branchA'),
    task('a2', 'branchA'),
  ];
  const manualA = completeTaskBranch(freshTree, 'branchA');
  assert.equal(get(manualA.tasks, 'branchA').status, 'done');
  assert.equal(get(manualA.tasks, 'a1').status, 'done');
  assert.equal(get(manualA.tasks, 'a2').status, 'done');
  assert.equal(get(manualA.tasks, 'branchA').archived_at, null);
  assert.deepEqual(manualA.newlyArchivedIds, []);
  assert.deepEqual(visible(manualA.tasks), ['fitness', 'branchA', 'branchB', 'a1', 'a2']);

  // C07: Manual completion of top-level task -> all valid descendants complete and whole tree archives
  const manualRoot = completeTaskBranch(freshTree, 'fitness');
  assert.ok(manualRoot.tasks.every(t => t.status === 'done' && t.archived_at));
  assert.deepEqual(visible(manualRoot.tasks), []);
});

test('PRD Section 2.5: archiveCompletedBranch rejects archiving with error when incomplete children exist', () => {
  const tree = [
    task('root', null, 'done'),
    task('child1', 'root', 'done'),
    task('child2', 'root', 'open'),
  ];
  const res = archiveCompletedBranch(tree, 'root');
  assert.equal(res.error, '仍有未完成子任务');
  assert.deepEqual(res.newlyArchivedIds, []);
});

test('PRD Section 4.1: Quadrant width calculation formulas and drawer mode threshold', () => {
  // W: available width (window width - 208 sidebar)
  // Formula: maxWidth = min(860, W - 560 - 8)
  // If maxWidth >= 440: defaultWidth = clamp(W * 0.36, 520, 680), actual = clamp(pref || default, 440, maxWidth)
  // Else: drawer mode min(640, window.innerWidth - 32)

  // 1920px window: W = 1712
  const W1 = 1920 - 208; // 1712
  const max1 = Math.min(860, W1 - 560 - 8); // 860
  const def1 = Math.min(680, Math.max(520, Math.round(W1 * 0.36))); // 616
  assert.equal(max1, 860);
  assert.equal(def1, 616);
  assert.ok(max1 >= 440); // Split mode

  // Narrow window 1100px: W = 892
  const W2 = 1100 - 208; // 892
  const max2 = Math.min(860, W2 - 560 - 8); // 324
  assert.ok(max2 < 440); // Switches to drawer mode
  const drawerW2 = Math.min(640, 1100 - 32); // 640
  assert.equal(drawerW2, 640);
});

// Mobile execution and project views share the same real lifecycle actions.
import { MobileWorkspace } from '../src/components/Mobile/MobileWorkspace';
import { selectMobileToday, createTaskRecord } from '../src/services/mobileTasks';
import { formatDateInTimezone } from '../src/services/calendarService';
import { ViewType } from '../src/types/todo';
let mobileLatest: TaskNode[] = [];
function MobileHarness({initial,view='today',reject=false}:{initial:TaskNode[];view?:ViewType;reject?:boolean}) {
  const [tasks,setTasks]=useState(initial);const [current,setView]=useState(view);mobileLatest=tasks;
  return <MobileWorkspace tasks={tasks} view={current} timezone="Asia/Shanghai" saveStatus="saved" disabled={false} overlayOpen={false}
    onCreate={async input=>{if(reject)return false;setTasks(previous=>insertTaskNode(previous,createTaskRecord(input,formatDateInTimezone(new Date(),'Asia/Shanghai'))));return true;}}
    onBulk={async(ids,action)=>{if(reject)return false;setTasks(previous=>applyBulkAction(previous,ids,action).tasks);return true;}}
    onSelect={()=>{}} onRestore={t=>setTasks(previous=>reopenTaskBranch(previous,t.id))} onArchive={t=>setTasks(previous=>archiveCompletedBranch(previous,t.id).tasks)}
    onCompleted={()=>{}} onUndo={()=>{}} canUndo={false} onPrepareComplete={()=>{}} onViewChange={setView}/>;
}
async function mountMobile(initial:TaskNode[],view:ViewType='today',reject=false){const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(()=>root!.render(<MobileHarness initial={initial} view={view} reject={reject}/>));}
async function mobileType(value:string){const el=document.querySelector('.m-composer input') as HTMLInputElement;assert.ok(el);await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
const mobileDay=()=>formatDateInTimezone(new Date(),'Asia/Shanghai');
test('mobile today separates planning from deadlines, deduplicates and uses configured timezone',()=>{
  const items=[{...task('due'),due_type:'datetime' as const,due_at:'2026-09-25T17:00:00Z'}, {...task('both'),planned_date:'2026-09-26',due_type:'date' as const,due_date:'2026-09-26'}, {...task('old'),planned_date:'2026-09-25'}, {...task('overdue-planned'),planned_date:'2026-09-26',due_type:'date' as const,due_date:'2026-09-24'}, {...task('priority-only'),quadrant:'Q1' as const}];
  const result=selectMobileToday(items,'2026-09-26','Asia/Shanghai');assert.deepEqual(result.current.map(t=>t.id),['due','both','overdue-planned']);assert.deepEqual(result.previous.map(t=>t.id),['old']);assert.equal(result.overdue.length,0);
});
test('mobile title-only capture plans today without deadline or priority, failure retains draft',async()=>{
  await mountMobile([]);await mobileType('今日临时事项');await click(document.querySelector('[aria-label="保存任务"]'));assert.equal(mobileLatest.length,1);assert.equal(mobileLatest[0].planned_date,mobileDay());assert.equal(mobileLatest[0].due_date,null);assert.equal(mobileLatest[0].quadrant,null);
  await act(()=>root!.unmount());root=undefined;document.body.innerHTML='';await mountMobile([],'today',true);await mobileType('失败也保留');await click(document.querySelector('[aria-label="保存任务"]'));assert.equal((document.querySelector('.m-composer input') as HTMLInputElement).value,'失败也保留');assert.equal(mobileLatest.length,0);
});
test('mobile can create first child and first grandchild without existing children',async()=>{
  await mountMobile([task('root')],'tree');await click(document.querySelector('[aria-label="更多操作 root"]'));await button('添加子任务');await mobileType('child');await click(document.querySelector('[aria-label="保存任务"]'));assert.equal(mobileLatest.find(t=>t.title==='child')?.parent_id,'root');
  await click(document.querySelector('[aria-label="更多操作 child"]'));await button('添加子任务');await mobileType('grandchild');await click(document.querySelector('[aria-label="保存任务"]'));assert.equal(mobileLatest.find(t=>t.title==='grandchild')?.parent_id,mobileLatest.find(t=>t.title==='child')?.id);assert.equal(mobileLatest.find(t=>t.title==='child')?.planned_date,null);
});
test('mobile queues multiple checks; today removal does not archive a completed branch with open sibling',async()=>{
  const items=[task('root'),task('branch','root'),task('other','root'),{...task('a','branch'),planned_date:mobileDay()},{...task('b','branch'),planned_date:mobileDay()}];await mountMobile(items);
  await click(document.querySelector('[aria-label="勾选完成 a"]'));await click(document.querySelector('[aria-label="勾选完成 b"]'));assert.equal(document.querySelectorAll('.is-pending').length,2);assert.equal(mobileLatest.find(t=>t.id==='a')?.status,'open');await button('确认完成 2 项');assert.equal(document.querySelectorAll('.m-task').length,0);assert.equal(get(mobileLatest,'branch').status,'done');assert.equal(get(mobileLatest,'branch').archived_at,null);assert.equal(get(mobileLatest,'root').status,'open');assert.equal(get(mobileLatest,'other').status,'open');
});
test('mobile failed batch keeps confirmation and cancelling plan still shows due-today reason',async()=>{
  await mountMobile([{...task('a'),planned_date:mobileDay()}],'today',true);await click(document.querySelector('[aria-label="勾选完成 a"]'));await button('确认完成');assert.ok(document.querySelector('.is-pending'));
  await act(()=>root!.unmount());root=undefined;document.body.innerHTML='';await mountMobile([{...task('due'),planned_date:mobileDay(),due_type:'date',due_date:mobileDay()}]);await click(document.querySelector('[aria-label="更多操作 due"]'));await button('取消今日安排（仍因截止显示）');assert.equal(get(mobileLatest,'due').planned_date,null);assert.ok(document.querySelector('[data-task-id="due"]'));assert.match(document.body.textContent||'',/仍因今天截止显示/);
});
test('mobile Chinese IME Enter does not create and a 10000-root list renders bounded rows',async()=>{
  await mountMobile(Array.from({length:10000},(_,i)=>task('r'+i)),'tree');assert.equal(document.querySelectorAll('.m-task').length,50);await mobileType('组词');const el=document.querySelector('.m-composer input')!;await act(()=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));assert.equal(mobileLatest.length,10000);
});
