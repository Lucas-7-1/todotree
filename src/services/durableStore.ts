import { TaskNode, AppSettings } from '../types/todo';
import { TaskEvent, SavedReport, AISettings, AIAttempt } from '../types/ai';

export interface WorkspaceData {
  tasks: TaskNode[];
  events: TaskEvent[];
  settings: Partial<AppSettings>;
  ai_settings: Partial<AISettings>;
  reports: SavedReport[];
  attempts: AIAttempt[];
}
export interface WorkspaceSnapshot {
  schema_version: 2;
  revision: number;
  saved_at: string;
  operation_id: string;
  data: WorkspaceData;
}
export const emptyWorkspace = (): WorkspaceData => ({ tasks: [], events: [], settings: {}, ai_settings: {}, reports: [], attempts: [] });
export const isDesktop = () => Boolean((window as any).__TODOTREE_DESKTOP__);
const CACHE_KEY = 'todotree_workspace_v2';
const PENDING_KEY = 'todotree_pending_v2';
let snapshot: WorkspaceSnapshot | null = null;
let loading: Promise<WorkspaceSnapshot> | null = null;
let tail: Promise<unknown> = Promise.resolve();
let blocked: Error | null = null;
let failedOperation: { operation_id: string; expected_revision: number; data: WorkspaceData } | null = null;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function validateWorkspace(value: any): asserts value is WorkspaceSnapshot {
  if (!value || value.schema_version !== 2 || !Number.isInteger(value.revision) || value.revision < 0 ||
      !value.data || !Array.isArray(value.data.tasks) || !Array.isArray(value.data.events) ||
      !Array.isArray(value.data.reports) || !Array.isArray(value.data.attempts) ||
      !value.data.settings || !value.data.ai_settings) throw new Error('数据格式损坏，请从备份恢复；未覆盖原数据');
  const ids = new Set<string>();
  for (const task of value.data.tasks) {
    if (!task || typeof task.id !== 'string' || ids.has(task.id) || typeof task.title !== 'string' ||
        !['open', 'done'].includes(task.status)) throw new Error('任务数据校验失败');
    ids.add(task.id);
  }
  const byId = new Map<string, TaskNode>(value.data.tasks.map((t: TaskNode) => [t.id, t]));
  for (const task of byId.values()) {
    const visited = new Set<string>([task.id]);
    let parentId = task.parent_id;
    while (parentId) {
      if (visited.has(parentId) || !byId.has(parentId)) throw new Error('任务父子关系损坏');
      visited.add(parentId);
      if (visited.size > 5) throw new Error('任务层级超过 5 层');
      parentId = byId.get(parentId)!.parent_id;
    }
  }
}

async function request(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `磁盘接口失败 (${response.status})`);
    return result;
  } finally { clearTimeout(timer); }
}

async function browserDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('TodoTreeWorkspace', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('浏览器数据库被其他窗口占用'));
    req.onsuccess = () => resolve(req.result);
  });
}

async function readBrowser(): Promise<WorkspaceSnapshot | null> {
  const db = await browserDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state');
      const req = tx.objectStore('state').get('workspace');
      tx.oncomplete = () => resolve(req.result || null);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('读取失败'));
    });
  } finally { db.close(); }
}

async function writeBrowser(next: WorkspaceSnapshot, expected: number): Promise<void> {
  const db = await browserDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const req = store.get('workspace');
      let conflict = false;
      req.onsuccess = () => {
        if (req.result && req.result.revision !== expected) { conflict = true; tx.abort(); return; }
        store.put(next, 'workspace');
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error(conflict ? '其他窗口已修改数据，请重新加载' : '浏览器持久化失败'));
    });
  } finally { db.close(); }
}

async function readLegacyBrowser(): Promise<TaskNode[]> {
  // Read the old IndexedDB too: localStorage may have hit its quota in the old app.
  const raw = localStorage.getItem('todotree_tasks_v1');
  let indexedTasks: TaskNode[] = [];
  if (typeof indexedDB !== 'undefined') {
    indexedTasks = await new Promise((resolve, reject) => {
      const req = indexedDB.open('TodoTreeDB', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tasks')) { db.close(); resolve([]); return; }
        const tx = db.transaction('tasks');
        const get = tx.objectStore('tasks').getAll();
        tx.oncomplete = () => { db.close(); resolve(get.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  if (raw === null) return indexedTasks;
  const localTasks = JSON.parse(raw);
  if (!Array.isArray(localTasks)) throw new Error('旧版缓存损坏，请先导出恢复');
  const normalized = (tasks: TaskNode[]) => JSON.stringify([...tasks].sort((a, b) => a.id.localeCompare(b.id)));
  if (indexedTasks.length && normalized(indexedTasks) !== normalized(localTasks))
    throw new Error('旧版浏览器存储存在不同副本，请先导出核对，未覆盖任何副本');
  return localTasks;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (snapshot) return clone(snapshot);
  if (!loading) loading = (async () => {
    if (!isDesktop() && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
      try {
        const health = await request('/api/health');
        if (health?.instance_id) (window as any).__TODOTREE_DESKTOP__ = true;
      } catch { /* Web development server has no host API. */ }
    }
    let result: WorkspaceSnapshot | null;
    if (isDesktop()) result = await request('/api/workspace');
    else {
      result = await readBrowser();
      if (!result) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          result = JSON.parse(cached);
          validateWorkspace(result);
          await writeBrowser(result, result.revision);
        } else {
          const data = emptyWorkspace();
          data.tasks = await readLegacyBrowser();
          const legacy: [keyof WorkspaceData, string][] = [
            ['events', 'todotree_task_events_v1'], ['settings', 'todotree_settings_v1'],
            ['ai_settings', 'todotree_ai_settings_v1'], ['reports', 'todotree_ai_reports_v1'], ['attempts', 'todotree_ai_attempts_v1'],
          ];
          for (const [key, storageKey] of legacy) {
            const raw = localStorage.getItem(storageKey);
            if (raw !== null) (data as any)[key] = JSON.parse(raw);
          }
          result = { schema_version: 2, revision: 0, operation_id: 'browser-init', saved_at: new Date().toISOString(), data };
          validateWorkspace(result);
          await writeBrowser(result, 0);
        }
      }
    }
    validateWorkspace(result);
    // Do not overwrite a recovery candidate after an ambiguous/lost write response.
    let pendingRaw: string | null = null;
    try { pendingRaw = localStorage.getItem(PENDING_KEY); } catch {}
    if (pendingRaw) {
      const pending = JSON.parse(pendingRaw);
      if (pending.operation_id !== result.operation_id) {
        failedOperation = pending;
        blocked = new Error('发现上次未确认写入的数据，请重试保存或导出恢复副本');
      } else { try { localStorage.removeItem(PENDING_KEY); } catch {} }
    }
    snapshot = clone(result);
    if (!blocked) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch {} }
    return clone(result);
  })().catch(error => { loading = null; throw error; });
  return clone(await loading);
}

function publish(next: WorkspaceSnapshot) {
  snapshot = clone(next);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); localStorage.removeItem(PENDING_KEY); } catch {}
  window.dispatchEvent(new CustomEvent('todotree:persisted', { detail: { revision: next.revision, saved_at: next.saved_at } }));
}

async function send(op: NonNullable<typeof failedOperation>): Promise<WorkspaceSnapshot> {
  let next: WorkspaceSnapshot;
  if (isDesktop()) next = await request('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) });
  else {
    next = { schema_version: 2, revision: op.expected_revision + 1, operation_id: op.operation_id, saved_at: new Date().toISOString(), data: op.data };
    await writeBrowser(next, op.expected_revision);
  }
  validateWorkspace(next);
  if (next.operation_id !== op.operation_id || next.revision !== op.expected_revision + 1)
    throw new Error('保存确认版本不匹配');
  publish(next);
  return next;
}

export function commitWorkspace(change: (data: WorkspaceData, operationId: string) => WorkspaceData, checkpoint = false): Promise<WorkspaceSnapshot> {
  const job = tail.then(async () => {
    const current = await loadWorkspace();
    if (blocked) throw blocked;
    if (checkpoint && isDesktop()) await request('/api/backup', { method: 'POST' });
    const operationId = crypto.randomUUID();
    const operation = { operation_id: operationId, expected_revision: current.revision, data: change(clone(current.data), operationId) };
    validateWorkspace({ ...current, data: operation.data });
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(operation)); } catch { /* Disk commit remains authoritative. */ }
    try { return await send(operation); }
    catch (error) {
      failedOperation = operation;
      blocked = error instanceof Error ? error : new Error('保存失败');
      window.dispatchEvent(new CustomEvent('todotree:save-error', { detail: blocked.message }));
      throw blocked;
    }
  });
  tail = job.catch(() => {});
  return job;
}

export function retryPendingSave(): Promise<WorkspaceSnapshot> {
  const job = tail.then(async () => {
    await loadWorkspace();
    if (!failedOperation) return loadWorkspace();
    const result = await send(failedOperation);
    failedOperation = null; blocked = null;
    return result;
  });
  tail = job.catch(() => {});
  return job;
}
export const getPersistenceError = () => blocked?.message || null;
export const getRecoveryCopy = () => failedOperation ? clone(failedOperation) : null;
export async function exportFullBackup(): Promise<string> {
  await tail;
  const state = await loadWorkspace();
  delete state.data.ai_settings.api_key;
  if (blocked) throw new Error("存在未确认保存，请先导出待恢复副本或重试，不能把旧数据当作最新备份");
  return JSON.stringify({ ...state, exported_at: new Date().toISOString() }, null, 2);
}
export async function importFullBackup(value: unknown): Promise<WorkspaceSnapshot> {
  validateWorkspace(value);
  const data = clone(value.data);
  return commitWorkspace(previous => ({ ...data, ai_settings: { ...data.ai_settings, api_key: previous.ai_settings.api_key || '' } }), true);
}
