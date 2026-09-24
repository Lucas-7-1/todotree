import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
const dir = path.resolve('node_modules/.cache/todotree-persistence');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'entry.ts'), `export * from '../../../src/services/durableStore';\nexport * from '../../../src/services/storage';\n`);
// Entry lives three levels below the repository root.
await build({ entryPoints: [path.join(dir, 'entry.ts')], outfile: path.join(dir, 'store.cjs'), bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
const require = createRequire(import.meta.url);
const modulePath = path.join(dir, 'store.cjs');
const dom = new JSDOM('', { url: 'http://127.0.0.1:4444/' });
globalThis.window = dom.window; globalThis.localStorage = dom.window.localStorage; globalThis.CustomEvent = dom.window.CustomEvent;
const clone = value => JSON.parse(JSON.stringify(value));
function task(id) { return { id, title: id, status: 'open', parent_id: null, deleted_at: null, completed_at: null }; }
function setup(initial = [task('a')]) {
  delete require.cache[modulePath]; localStorage.clear(); window.__TODOTREE_DESKTOP__ = true;
  const api = require(modulePath);
  let state = { schema_version: 2, revision: 0, operation_id: 'initial', saved_at: '2026-09-24T00:00:00Z', data: { ...api.emptyWorkspace(), tasks: initial } };
  const writes = [];
  globalThis.fetch = async (url, opts) => {
    if (!opts?.method) return new Response(JSON.stringify(state));
    if (url === '/api/backup') return new Response('{}');
    const op = JSON.parse(opts.body);
    if (state.operation_id === op.operation_id) return new Response(JSON.stringify(state));
    if (op.expected_revision !== state.revision) return new Response(JSON.stringify({ error: 'conflict' }), { status: 409 });
    writes.push(op); state = { ...state, revision: state.revision + 1, operation_id: op.operation_id, data: op.data };
    return new Response(JSON.stringify(state));
  };
  return { api, writes, state: () => state, replace: value => { state = value; } };
}

test('disk connection failure is rejected and recovery copy survives', async () => {
  const { api } = setup(); await api.loadWorkspace();
  globalThis.fetch = async () => { throw new Error('disk disconnected'); };
  await assert.rejects(api.saveTasksToStorage([task('b')]), /disk disconnected/);
  assert.equal(api.getRecoveryCopy().data.tasks[0].id, 'b');
  assert.ok(localStorage.getItem('todotree_pending_v2'));
  await assert.rejects(api.saveTasksToStorage([task('c')]), /disk disconnected/);
});
test('no browser database and no disk cannot report a successful save', async () => {
  const { api } = setup(); window.__TODOTREE_DESKTOP__ = false;
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.indexedDB = { open() { const req = { error: new Error('IDB unavailable') }; queueMicrotask(() => req.onerror()); return req; } };
  await assert.rejects(api.saveTasksToStorage([task('a')]), /IDB unavailable/);
});
test('corrupt/empty array disk response cannot replace cache', async () => {
  const { api } = setup(); localStorage.setItem('todotree_workspace_v2', 'valuable backup');
  globalThis.fetch = async () => new Response('[]');
  await assert.rejects(api.loadWorkspace(), /数据格式损坏/);
  assert.equal(localStorage.getItem('todotree_workspace_v2'), 'valuable backup');
});
test('unacknowledged candidate is not overwritten by older disk state', async () => {
  const { api } = setup(); localStorage.setItem('todotree_pending_v2', JSON.stringify({ operation_id: 'pending', expected_revision: 0, data: { ...api.emptyWorkspace(), tasks: [task('new')] } }));
  await api.loadWorkspace(); assert.ok(api.getPersistenceError());
  assert.equal(api.getRecoveryCopy().data.tasks[0].id, 'new');
  await assert.rejects(api.commitWorkspace(d => d), /未确认/);
});
test('queued operations use increasing revisions and keep previous domain updates', async () => {
  const { api, writes, state } = setup();
  await Promise.all([api.commitWorkspace(d => ({ ...d, settings: { timezone: 'Asia/Shanghai' } })), api.saveTasksToStorage([task('b')])]);
  assert.deepEqual(writes.map(w => w.expected_revision), [0, 1]);
  assert.equal(state().data.settings.timezone, 'Asia/Shanghai'); assert.equal(state().data.tasks[0].id, 'b');
});
test('lost acknowledgement retries exact operation without duplicate events', async () => {
  const { api, state, writes } = setup(); await api.loadWorkspace(); const server = globalThis.fetch;
  let lost = true;
  globalThis.fetch = async (...args) => { const result = await server(...args); if (lost && args[1]?.method === 'POST') { lost = false; throw new Error('ack lost'); } return result; };
  await assert.rejects(api.saveTasksToStorage([{ ...task('a'), status: 'done', completed_at: '2026-09-24T02:00:00Z' }]), /ack lost/);
  await api.retryPendingSave();
  assert.equal(writes.length, 1); assert.equal(state().data.events.length, 1); assert.equal(api.getPersistenceError(), null);
});
test('task status and completion/uncompletion history share one committed snapshot', async () => {
  const { api, state } = setup();
  await api.saveTasksToStorage([{ ...task('a'), status: 'done', completed_at: '2026-09-24T02:00:00Z' }]);
  assert.equal(state().data.tasks[0].status, 'done'); assert.equal(state().data.events[0].event_type, 'task_completed'); assert.equal(state().data.events[0].operation_batch_id, state().operation_id);
  await api.saveTasksToStorage([{ ...state().data.tasks[0], archived_at: '2026-09-24T03:00:00Z' }]);
  assert.equal(state().data.events.length, 1);
  await api.saveTasksToStorage([task('a')]); assert.equal(state().data.events[1].event_type, 'task_uncompleted');
});
test('full backup includes history and reports but excludes API key; invalid import does not write', async () => {
  const { api, writes } = setup();
  await api.commitWorkspace(d => ({ ...d, ai_settings: { api_key: 'secret' }, reports: [{ report_id: 'r' }], events: [{ event_id: 'e', task_id: 'a', event_type: 'task_completed' }] }));
  const backup = JSON.parse(await api.exportFullBackup()); assert.equal(backup.data.ai_settings.api_key, undefined);
  assert.equal(backup.data.events.length, 1); assert.equal(backup.data.reports.length, 1);
  const n = writes.length; backup.data.tasks[0].parent_id = 'missing';
  await assert.rejects(api.importFullBackup(backup), /父子关系/); assert.equal(writes.length, n);
});
test('version conflict never blindly retries with a newer base revision', async () => {
  const { api, state, replace } = setup(); await api.loadWorkspace(); replace({ ...clone(state()), revision: 4 });
  await assert.rejects(api.saveTasksToStorage([task('b')]), /conflict/);
  await assert.rejects(api.retryPendingSave(), /conflict/); assert.equal(state().revision, 4);
});
process.on('exit', () => dom.window.close());
