import { TaskNode, AppSettings } from '../types/todo';
import { getInitialSeedTasks } from './seedData';

const DB_NAME = 'TodoTreeDB';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';
const STORE_SETTINGS = 'settings';

const LOCALSTORAGE_KEY = 'todotree_tasks_v1';
const SETTINGS_KEY = 'todotree_settings_v1';
const TAB_LOCK_KEY = 'todotree_active_tab_id';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  reduced_motion: false,
  show_completed: false,
  schema_version: 1,
};

let dbInstance: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveTasksToIndexedDB(tasks: TaskNode[]): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TASKS, 'readwrite');
      const store = tx.objectStore(STORE_TASKS);
      store.clear();
      for (const task of tasks) {
        store.put(task);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB save failed, used localStorage fallback', err);
  }
}

const INITIALIZED_KEY = 'todotree_initialized';

export async function loadTasksFromStorage(): Promise<TaskNode[]> {
  const isInitialized = () => {
    try {
      return localStorage.getItem(INITIALIZED_KEY) === 'true';
    } catch {
      return false;
    }
  };

  const markInitialized = () => {
    try {
      localStorage.setItem(INITIALIZED_KEY, 'true');
    } catch {}
  };

  // 1. Check if running inside desktop host with /api/tasks support
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch('/api/tasks', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        if (data.length > 0 || isInitialized()) {
          markInitialized();
          try {
            localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data));
          } catch { /* ignore */ }
          saveTasksToIndexedDB(data).catch(() => {});
          return data as TaskNode[];
        }
      }
    }
  } catch {
    // Desktop API not present or timed out, proceed to IndexedDB/localStorage
  }

  // 2. Load from IndexedDB
  try {
    const db = await getDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_TASKS, 'readonly');
      const store = tx.objectStore(STORE_TASKS);
      const req = store.getAll();
      req.onsuccess = () => {
        if (req.result && (req.result.length > 0 || isInitialized())) {
          markInitialized();
          resolve(req.result as TaskNode[]);
        } else {
          // Check localStorage fallback or initialize seed data
          const lsData = localStorage.getItem(LOCALSTORAGE_KEY);
          if (lsData !== null) {
            try {
              const parsed = JSON.parse(lsData);
              if (Array.isArray(parsed) && (parsed.length > 0 || isInitialized())) {
                markInitialized();
                saveTasksToStorage(parsed).catch(console.error);
                return resolve(parsed);
              }
            } catch (e) {
              console.error(e);
            }
          }
          if (isInitialized()) {
            return resolve([]);
          }
          const initial = getInitialSeedTasks();
          markInitialized();
          saveTasksToStorage(initial).catch(console.error);
          resolve(initial);
        }
      };
      req.onerror = () => {
        const lsData = localStorage.getItem(LOCALSTORAGE_KEY);
        if (lsData !== null) {
          try {
            const parsed = JSON.parse(lsData);
            if (Array.isArray(parsed)) return resolve(parsed);
          } catch {}
        }
        if (isInitialized()) return resolve([]);
        const initial = getInitialSeedTasks();
        markInitialized();
        resolve(initial);
      };
    });
  } catch (err) {
    // 3. Fallback directly to localStorage
    const lsData = localStorage.getItem(LOCALSTORAGE_KEY);
    if (lsData !== null) {
      try {
        const parsed = JSON.parse(lsData);
        if (Array.isArray(parsed) && (parsed.length > 0 || isInitialized())) {
          markInitialized();
          return parsed;
        }
      } catch {
        // parse error
      }
    }
    if (isInitialized()) return [];
    const initial = getInitialSeedTasks();
    markInitialized();
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(initial));
    } catch {}
    return initial;
  }
}

export async function saveTasksToStorage(tasks: TaskNode[]): Promise<void> {
  try {
    localStorage.setItem(INITIALIZED_KEY, 'true');
  } catch {}

  // 1. Always mirror to localStorage as resilient secondary copy
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.warn('LocalStorage save failed', e);
  }

  // 2. Persist to desktop host /api/tasks (writes data/tasks.json to disk)
  let desktopSaveSuccess = true;
  try {
    const resp = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(tasks),
    });
    if (!resp.ok) {
      desktopSaveSuccess = false;
      console.error('Desktop API save failed:', resp.status, resp.statusText);
    }
  } catch (err) {
    // ignore network errors if not running with desktop host
  }

  // 3. Persist to IndexedDB
  await saveTasksToIndexedDB(tasks);

  if (!desktopSaveSuccess) {
    throw new Error('Desktop persistence failed');
  }
}

export function loadSettingsFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate: default show_completed to false if schema_version < 2
      const isLegacy = !parsed.schema_version || parsed.schema_version < 2;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        show_completed: isLegacy ? false : Boolean(parsed.show_completed),
        schema_version: 2,
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { ...DEFAULT_SETTINGS, schema_version: 2 };
}

export function saveSettingsToStorage(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error(e);
  }
  try {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(settings),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

// Multi-tab single editable tab safeguard (PRD 10.2)
const CURRENT_TAB_ID = 'tab_' + Math.random().toString(36).substring(2, 9);
let isCurrentTabOwner = true;

export function initTabLock(onLockChange: (isOwner: boolean) => void): () => void {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('todotree_tab_channel') : null;

  const claimLock = () => {
    sessionStorage.setItem(TAB_LOCK_KEY, CURRENT_TAB_ID);
    localStorage.setItem(TAB_LOCK_KEY, CURRENT_TAB_ID);
    isCurrentTabOwner = true;
    onLockChange(true);
    if (channel) {
      channel.postMessage({ type: 'claim', tabId: CURRENT_TAB_ID });
    }
  };

  // Check if someone else holds it
  const activeTab = localStorage.getItem(TAB_LOCK_KEY);
  if (!activeTab || activeTab === CURRENT_TAB_ID) {
    claimLock();
  } else {
    // Another tab exists, become read-only initially, but permit user takeover
    isCurrentTabOwner = false;
    onLockChange(false);
  }

  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type === 'claim' && e.data.tabId !== CURRENT_TAB_ID) {
        isCurrentTabOwner = false;
        onLockChange(false);
      }
    };
  }

  const storageHandler = (e: StorageEvent) => {
    if (e.key === TAB_LOCK_KEY && e.newValue && e.newValue !== CURRENT_TAB_ID) {
      isCurrentTabOwner = false;
      onLockChange(false);
    }
  };
  window.addEventListener('storage', storageHandler);

  return () => {
    window.removeEventListener('storage', storageHandler);
    if (channel) channel.close();
  };
}

export function takeOverTabLock(onLockChange: (isOwner: boolean) => void): void {
  sessionStorage.setItem(TAB_LOCK_KEY, CURRENT_TAB_ID);
  localStorage.setItem(TAB_LOCK_KEY, CURRENT_TAB_ID);
  isCurrentTabOwner = true;
  onLockChange(true);
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('todotree_tab_channel');
    channel.postMessage({ type: 'claim', tabId: CURRENT_TAB_ID });
    channel.close();
  }
}
