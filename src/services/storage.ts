import { isAndroid } from './native/platform';
import { TaskNode, AppSettings } from '../types/todo';

import { loadWorkspace, commitWorkspace } from './durableStore';
import { buildTransitionEvents } from './transitionEvents';

const SETTINGS_KEY = 'todotree_settings_v1';
const TAB_LOCK_KEY = 'todotree_active_tab_id';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export const DEFAULT_SETTINGS: AppSettings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  reduced_motion: false, show_completed: false, schema_version: 2,
};

export async function loadTasksFromStorage(): Promise<TaskNode[]> {
  return (await loadWorkspace()).data.tasks;
}

export async function saveTasksToStorage(tasks: TaskNode[], checkpoint = false): Promise<void> {
  const captured = JSON.parse(JSON.stringify(tasks)) as TaskNode[];
  await commitWorkspace((data, operationId) => ({ ...data, tasks: captured,
    events: [...data.events, ...buildTransitionEvents(data.tasks, captured, operationId)],
  }), checkpoint);
}

export function loadSettingsFromStorage(): AppSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export async function saveSettingsToStorage(settings: AppSettings): Promise<void> {
  await commitWorkspace(data => ({ ...data, settings }));
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// Multi-tab single editable tab safeguard (PRD 10.2)
const CURRENT_TAB_ID = 'tab_' + Math.random().toString(36).substring(2, 9);
let isCurrentTabOwner = true;

export function initTabLock(onLockChange: (isOwner: boolean) => void): () => void {
  if (isAndroid()) { onLockChange(true); return () => {}; }
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
