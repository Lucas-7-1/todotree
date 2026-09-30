import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dir = path.resolve('node_modules/.cache/backup-compat');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'entry.ts'), `export * from ${JSON.stringify(path.resolve('src/services/importExport'))};\nexport * from ${JSON.stringify(path.resolve('src/services/backupCodec'))};\n`);
await build({ entryPoints: [path.join(dir, 'entry.ts')], outfile: path.join(dir, 'backup.cjs'), bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
// Exercise the actual previous-version source, not a reimplementation of its reader.
for (const [name, source] of [['oldStore', 'durableStore'], ['oldTaskIO', 'importExport']]) {
  const entry = path.join(dir, name + '.ts');
  await writeFile(entry, execFileSync('git', ['show', '9af2ecb:src/services/' + source + '.ts'], { encoding: 'utf8' }));
  await build({ entryPoints: [entry], outfile: path.join(dir, name + '.cjs'), bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [{ name: 'legacy-relative-paths', setup(b) {
    b.onResolve({ filter: /^\./ }, args => args.importer === entry ? { path: path.resolve('src/services', args.path) + '.ts' } : undefined);
  } }] });
}
const require = createRequire(import.meta.url);
const dom = new JSDOM('', { url: 'https://localhost/' });
globalThis.window = dom.window; globalThis.localStorage = dom.window.localStorage; globalThis.CustomEvent = dom.window.CustomEvent; globalThis.FileReader = dom.window.FileReader;
window.__TODOTREE_DESKTOP__ = true;
const api = require(path.join(dir, 'backup.cjs'));
const oldStore = require(path.join(dir, 'oldStore.cjs'));
const oldTaskIO = require(path.join(dir, 'oldTaskIO.cjs'));
const time = '2026-09-24T01:00:00.000Z';
const task = (id, parent_id = null, status = 'open') => ({ id, parent_id, title: `任务 ${id} 🍜`, root_bucket: parent_id ? null : 'categories', note: '旧备注\n新行', sort_order: 1, status, completed_at: status === 'done' ? time : null, archived_at: null, due_type: 'none', due_date: null, due_at: null, quadrant: null, planned_date: null, created_at: time, updated_at: time, deleted_at: null, deletion_batch_id: null });
const settings = { timezone: 'Asia/Shanghai', reduced_motion: true, show_completed: false, schema_version: 2 };
const state = { schema_version: 2, revision: 12, operation_id: 'old-op', saved_at: time, data: {
  tasks: [task('root'), task('done', 'root', 'done'), task('open', 'root'), { ...task('trash'), deleted_at: time, deletion_batch_id: 'delete-1' }],
  events: [{ event_id: 'completed-1', task_id: 'done', event_type: 'task_completed', occurred_at: time }],
  reports: [{ id: 'report-1', markdown: '# 真实成果\n旧周报' }], attempts: [{ attempt_id: 'attempt-1' }], settings, ai_settings: { api_key: 'device-only-secret', prompt_templates: [{ profile_id: 'custom', content: '只总结真实记录' }] }
} };
globalThis.fetch = async () => new Response(JSON.stringify(state));
const oldFullText = await oldStore.exportFullBackup();
const currentText = await api.encodeWorkspaceBackup(state);

test('actual old schema-2 export and new export preserve identical business data', async () => {
  assert.deepEqual(JSON.parse(currentText).data, JSON.parse(oldFullText).data);
  assert.equal(JSON.parse(currentText).schema_version, 2);
  assert.ok(!currentText.includes('device-only-secret'));
  assert.equal(state.data.ai_settings.api_key, 'device-only-secret');
  assert.doesNotThrow(() => oldStore.validateWorkspace(JSON.parse(currentText)));
  assert.equal((await api.prepareTaskBackup(oldFullText)).valid, true);
  assert.equal((await api.prepareTaskBackup(currentText)).valid, true);
});
test('actual old schema-1 task export imports and re-exports without task loss', async () => {
  const old = oldTaskIO.exportBackupData(state.data.tasks, settings);
  const restored = await api.prepareTaskBackup(old);
  assert.equal(restored.source_version, 1);
  assert.deepEqual(restored.tasks, state.data.tasks);
  assert.equal(oldTaskIO.validateImportJson(api.exportBackupData(restored.tasks, settings)).valid, true);
});
test('BOM and Windows UTF-16LE/BE decode into the same old facts', async () => {
  const utf8 = new TextEncoder().encode('\uFEFF' + oldFullText);
  const le = Buffer.from('\uFEFF' + oldFullText, 'utf16le');
  const be = Buffer.from(le); be.swap16();
  for (const bytes of [utf8, le, be]) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await api.prepareTaskBackup(api.decodeBackupBytes(buffer));
    assert.equal(parsed.valid, true); assert.deepEqual(parsed.tasks, state.data.tasks);
  }
});
test('empty, whitespace, truncated and invalid JSON fail with actionable messages', async () => {
  for (const text of ['', ' \n\uFEFF', currentText.slice(0, -4), '{"tasks":', '<html>']) {
    const result = await api.prepareTaskBackup(text); assert.equal(result.valid, false);
    assert.match(result.error, /空|内容|JSON/); assert.ok(!result.tasks);
  }
});
test('future schemas and health/journal documents cannot be imported as tasks', async () => {
  for (const value of [{ schema_version: 99, tasks: [] }, { schema_version: 1, format: 'todotree-health', records: [] }, { schema_version: 2, format: 'todotree-journal', entries: [] }, [], null]) {
    assert.equal((await api.prepareTaskBackup(JSON.stringify(value))).valid, false);
  }
});
test('modified but still syntactically valid new backup fails checksum; key ordering does not', async () => {
  const changed = JSON.parse(currentText); changed.data.tasks[0].title = 'silent corruption';
  assert.equal((await api.prepareTaskBackup(JSON.stringify(changed))).valid, false);
  const reordered = JSON.parse(currentText); reordered.data = Object.fromEntries(Object.entries(reordered.data).reverse());
  assert.equal((await api.prepareTaskBackup(JSON.stringify(reordered))).valid, true);
  for (const integrity of [null, {}, { algorithm: 'sha256', data_sha256: 'bad' }]) {
    assert.equal((await api.prepareTaskBackup(JSON.stringify({ ...JSON.parse(currentText), integrity }))).valid, false);
  }
});
test('legacy missing optional fields are defaulted without fabricating completion dates', async () => {
  const result = await api.prepareTaskBackup(JSON.stringify({ schema_version: 1, tasks: [{ id: 'a', title: '旧任务', status: 'done' }] }));
  assert.equal(result.valid, true); assert.equal(result.tasks[0].parent_id, null);
  assert.equal(result.tasks[0].quadrant, null); assert.equal(result.tasks[0].completed_at, null);
});
test('invalid legacy graph, duplicate ID and bad settings never pass migration', async () => {
  const badLists = [[null], [task('a'), task('a')], [{ ...task('a'), parent_id: 'missing' }], [task('a', 'b'), task('b', 'a')], [task('root', null, 'done'), task('open', 'root')]];
  for (const tasks of badLists) assert.equal((await api.prepareTaskBackup(JSON.stringify({ schema_version: 1, tasks, settings }))).valid, false);
  assert.equal((await api.prepareTaskBackup(JSON.stringify({ schema_version: 1, tasks: [], settings: [] }))).valid, false);
});
test('invalid UTF-8 is rejected instead of silently changing names or identifiers', () => {
  assert.throws(() => api.decodeBackupBytes(new Uint8Array([0xc3, 0x28]).buffer), /编码/);
});
test('browser reads actual selected file bytes and allows a BOM legacy file', async () => {
  const file = new dom.window.File(['\uFEFF' + oldFullText], 'legacy.json', { type: 'application/json' });
  const content = await api.readBackupFile(file);
  assert.equal((await api.prepareTaskBackup(content)).valid, true);
  await assert.rejects(api.readBackupFile({ size: api.MAX_BACKUP_BYTES + 1 }), /32 MB/);
});
test('empty or malformed exports fail before opening a download', async () => {
  await assert.rejects(api.downloadJsonFile(''), /内容/);
  await assert.rejects(api.downloadJsonFile('{'), /完整/);
});
process.on('exit', () => dom.window.close());
