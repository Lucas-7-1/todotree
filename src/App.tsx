import { isAndroid } from './services/native/platform';
import { App as NativeApp } from '@capacitor/app';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import {
  TaskNode,
  AppSettings,
  ViewType,
  QuadrantType,
  DueType,
  RecurrenceRule,
} from './types/todo';
import {
  loadTasksFromStorage,
  saveTasksToStorage,
  loadSettingsFromStorage,
  saveSettingsToStorage,
  initTabLock,
  takeOverTabLock,
  SaveStatus,
} from './services/storage';
import { loadWorkspace, getPersistenceError, retryPendingSave, isDesktop, importFullBackup, WorkspaceSnapshot } from './services/durableStore';
import { StorageRecovery } from './components/StorageRecovery';
import { applyBulkAction, BulkAction } from './services/bulkTasks';
import { animateArchivedRows } from './services/archiveAnimation';
import { undoManager } from './services/undoManager';
import { completeTaskBranch, archiveCompletedBranch, reopenTaskBranch, insertTaskNode } from './services/taskLifecycle';
import {
  generateId,
  canMoveSubtree,
  getDescendantTasks,
  getAncestorNodes,
  getChildrenTasks,
  getNodeDepth,
  isTaskDueToday,
  isTaskOverdue,
} from './services/treeOperations';
import { getTodayDateString, getInitialSeedTasks } from './services/seedData';
import { syncRecurringTasks, computePeriodKey } from './services/recurrence';

// Components
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TaskTree } from './components/TaskTree/TaskTree';
import { QuickInputBar } from './components/QuickInputBar';
import { QuadrantPanel } from './components/Quadrant/QuadrantPanel';
import { VerticalSplitter } from './components/Quadrant/VerticalSplitter';
import { QuadrantWorkspace } from './components/Quadrant/QuadrantWorkspace';
import { TaskDetailDrawer } from './components/TaskDrawer/TaskDetailDrawer';
import { TodayView } from './components/TodayView/TodayView';
import { CompletedView } from './components/CompletedView/CompletedView';
import { TrashView } from './components/TrashView/TrashView';
import { TemplateModal } from './components/TemplateModal';
import { SettingsModal } from './components/SettingsModal';
import { Toast, ToastMessage } from './components/Toast';
import { ParentCompleteModal } from './components/ParentCompleteModal';
import { WorkReviewView } from './components/WorkReview/WorkReviewView';
import { CreateTaskModal } from './components/CreateTaskModal';
import { CompletedDrawer } from './components/CompletedDrawer/CompletedDrawer';
import { AuxiliaryPanel, AuxiliaryPanelType } from './components/AuxiliaryPanel/AuxiliaryPanel';
import { ReportHistoryPanel } from './components/WorkReview/ReportHistoryPanel';

import { SavedReport } from './types/ai';
import {
  loadAISettings,
  saveAISettings,
  requestReport,
  computeReportKey,
  loadSavedReports,
  deleteSavedReport,
} from './services/ai/reportService';
import { buildFactsPackage } from './services/ai/factsEngine';

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [settings, setSettings] = useState<AppSettings>(loadSettingsFromStorage());
  const [currentView, setCurrentView] = useState<ViewType>(isAndroid() ? 'today' : 'tree');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [quickInputParentId, setQuickInputParentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuadrantCollapsed, setIsQuadrantCollapsed] = useState(false);

  // Unified Single Auxiliary Panel State (PRD Section 3.1: At most ONE auxiliary panel open at a time)
  const [auxiliaryPanel, setAuxiliaryPanel] = useState<{
    type: AuxiliaryPanelType;
    data?: any;
  }>(() => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('todotree_quadrant_open') === 'true') {
        return { type: 'quadrant_quick' };
      }
    } catch {}
    return { type: 'none' };
  });

  // Quadrant sizing & splitter (PRD Section 4 & 5)
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1920
  );
  const [userQuadrantWidth, setUserQuadrantWidth] = useState<number | null>(() => {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem('todotree_quadrant_width');
      if (!raw) return null;
      const parsed = parseFloat(raw);
      return !isNaN(parsed) && parsed >= 440 && parsed <= 1200 ? parsed : null;
    } catch {
      return null;
    }
  });
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const availableWidth = Math.max(0, windowWidth - 208);
  const maxQuadrantWidth = Math.min(860, Math.max(0, availableWidth - 560 - 8));
  const isQuadrantDrawerMode = maxQuadrantWidth < 440;
  const defaultQuadrantWidth = Math.min(680, Math.max(520, Math.round(availableWidth * 0.36)));
  const actualQuadrantWidth = isQuadrantDrawerMode
    ? Math.min(640, windowWidth - 32)
    : Math.min(maxQuadrantWidth, Math.max(440, userQuadrantWidth ?? defaultQuadrantWidth));

  const handleQuadrantResize = useCallback((newWidth: number) => {
    setUserQuadrantWidth(newWidth);
  }, []);

  const handleQuadrantResizeEnd = useCallback((finalWidth: number) => {
    setUserQuadrantWidth(finalWidth);
    try {
      localStorage.setItem('todotree_quadrant_width', finalWidth.toString());
    } catch {}
  }, []);

  const handleQuadrantResetDefault = useCallback(() => {
    setUserQuadrantWidth(defaultQuadrantWidth);
    try {
      localStorage.setItem('todotree_quadrant_width', defaultQuadrantWidth.toString());
    } catch {}
  }, [defaultQuadrantWidth]);

  const [reviewActiveReport, setReviewActiveReport] = useState<SavedReport | null>(null);
  const [reviewSavedReports, setReviewSavedReports] = useState<SavedReport[]>([]);

  // Modals & Drawers
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [undoStackVersion, setUndoStackVersion] = useState(0);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'ai'>('general');
  const [parentCompleteTarget, setParentCompleteTarget] = useState<TaskNode | null>(null);
  const [parentCompleteIncompleteCount, setParentCompleteIncompleteCount] = useState(0);

  // Auxiliary Panel Handlers
  const openAuxiliaryPanel = useCallback((type: AuxiliaryPanelType, data?: any) => {
    setAuxiliaryPanel({ type, data });
    if (type !== 'task_detail') {
      setSelectedTaskId(null);
    }
    try {
      localStorage.setItem('todotree_quadrant_open', type === 'quadrant_quick' ? 'true' : 'false');
    } catch {}
  }, []);

  const closeAuxiliaryPanel = useCallback(() => {
    setAuxiliaryPanel({ type: 'none' });
    setSelectedTaskId(null);
    try {
      localStorage.setItem('todotree_quadrant_open', 'false');
    } catch {}
  }, []);

  const handleSelectTask = useCallback((task: TaskNode | null) => {
    if (task) {
      setSelectedTaskId(task.id);
      setAuxiliaryPanel({ type: 'task_detail', data: task.id });
    } else {
      setSelectedTaskId(null);
      setAuxiliaryPanel((prev) => (prev.type === 'task_detail' ? { type: 'none' } : prev));
    }
  }, []);

  // Backward compatibility bridge
  const isCompletedDrawerOpen = auxiliaryPanel.type === 'completed';
  const setIsCompletedDrawerOpen = useCallback((open: boolean) => {
    if (open) openAuxiliaryPanel('completed');
    else closeAuxiliaryPanel();
  }, [openAuxiliaryPanel, closeAuxiliaryPanel]);

  // Load review saved reports for history drawer
  useEffect(() => {
    loadSavedReports().then(setReviewSavedReports).catch(() => {});
  }, []);

  // Status & Lock
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const savingVersion = useRef(0);
  const failedSaveRef = useRef<{ before: TaskNode[]; next: TaskNode[]; description: string; recordUndo: boolean } | null>(null);
  const pendingNavigationGuard = useRef<null | (() => Promise<boolean>)>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isTabOwner, setIsTabOwner] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isServerDisconnected, setIsServerDisconnected] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isTerminalDisconnected, setIsTerminalDisconnected] = useState(false);
  const [serverHealth, setServerHealth] = useState<{
    instance_id?: string;
    uptime_sec?: number;
    db_ready?: boolean;
    timestamp?: string;
  } | null>(null);
  const isUnloadingRef = useRef(false);
  const reconnectTimeoutRef = useRef<any>(null);
  const [hasUnreadReview, setHasUnreadReview] = useState(false);
  const handleDeleteTaskRef = useRef<(task: TaskNode) => void>(() => {});

  // Probe server connection with bounded backoff recovery (1s, 2s, 4s, 8s, 15s; max 5 attempts)
  const checkServerConnection = useCallback(async (manual = false) => {
    if (isUnloadingRef.current) return false;

    let succeeded = false;
    let healthData: any = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      const res = await fetch('/api/health', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        healthData = await res.json().catch(() => ({ status: 'ok' }));
        succeeded = true;
      }
    } catch {
      // Fallback probe to /api/ping
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch('/api/ping', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          succeeded = true;
        }
      } catch {}
    }

    if (isUnloadingRef.current) return false;

    if (succeeded) {
      if (healthData) setServerHealth(healthData);
      setIsServerDisconnected(false);
      setIsTerminalDisconnected(false);
      setReconnectAttempt(0);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (manual) {
        // Reconnection must not replace pending edits with an older disk snapshot.
        setToast({ id: 'conn-restored-' + Date.now(), type: 'info', title: '本地服务连接已恢复' });
      }
      return true;
    }

    // Failure branch: trigger bounded backoff recovery
    setIsServerDisconnected(true);
    setReconnectAttempt((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setIsTerminalDisconnected(true);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      } else {
        const backoffDelays = [1000, 2000, 4000, 8000, 15000];
        const delay = backoffDelays[next - 1] || 15000;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          checkServerConnection(false);
        }, delay);
      }
      return next;
    });

    return false;
  }, []);

  const handleCopyDiagnosticLog = useCallback(() => {
    const info = [
      `[TodoTree 运行诊断日志]`,
      `生成时间: ${new Date().toISOString()}`,
      `连接状态: ${isTerminalDisconnected ? '本地服务已断连 (5次重试均失败)' : '正在重试恢复中'}`,
      `重试轮次: ${Math.min(reconnectAttempt, 5)}/5`,
      `服务实例ID: ${serverHealth?.instance_id || '未连接'}`,
      `服务运行时间: ${serverHealth?.uptime_sec !== undefined ? serverHealth.uptime_sec + '秒' : '未知'}`,
      `数据库状态: ${serverHealth?.db_ready ? '就绪' : '未就绪'}`,
      `当前视图: ${currentView}`,
      `活动任务数: ${tasks.filter((t) => !t.deleted_at && t.status === 'open').length}`,
      `总任务数: ${tasks.length}`,
      `浏览器客户端: ${navigator.userAgent}`,
      `页面URL: ${window.location.href}`,
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(info)
        .then(() => {
          setToast({ id: 'diag-' + Date.now(), type: 'info', title: '诊断日志已复制到剪贴板' });
        })
        .catch(() => {
          alert(info);
        });
    } else {
      alert(info);
    }
  }, [isTerminalDisconnected, reconnectAttempt, serverHealth, currentView, tasks]);

  // Initialization is independent of heartbeat/disconnection renders.
  useEffect(() => {
    let alive = true;
    loadWorkspace().then(async state => {
      const { updatedTasks, addedCount } = syncRecurringTasks(state.data.tasks);
      if (addedCount) await saveTasksToStorage(updatedTasks);
      if (!alive) return;
      tasksRef.current = updatedTasks;
      setTasks(updatedTasks);
      setSettings(previous => ({ ...previous, ...state.data.settings }));
      setLoaded(true);
      setStorageError(getPersistenceError());
    }).catch(error => { if (alive) setStorageError(error.message || '无法读取数据'); });
    const unlock = initTabLock(setIsTabOwner);
    const onFailure = (event: Event) => setStorageError((event as CustomEvent).detail || '保存失败');
    window.addEventListener('todotree:save-error', onFailure);
    return () => { alive = false; unlock(); window.removeEventListener('todotree:save-error', onFailure); };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    checkServerConnection(false);
    const timer = setInterval(() => checkServerConnection(false), 5000);
    return () => { clearInterval(timer); if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current); };
  }, [checkServerConnection]);

  // Save Guard: intercept beforeunload if save is currently in progress (PRD 10.3)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || storageError) {
        e.preventDefault();
        e.returnValue = '任务正在保存至本地硬盘，请稍候...';
        return '任务正在保存至本地硬盘，请稍候...';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveStatus, storageError]);

  // F5 / Refresh key debounce and save guard
  useEffect(() => {
    let lastF5Time = 0;
    const handleF5KeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
        const now = Date.now();
        if (now - lastF5Time < 600) {
          e.preventDefault();
          return;
        }
        lastF5Time = now;
        if (saveStatus === 'saving' || storageError) {
          e.preventDefault();
          if (
            window.confirm(
              '当前有任务数据正在写入本地磁盘，确定要强制刷新吗？未保存的内容可能会丢失。'
            )
          ) {
            window.location.reload();
          }
        }
      }
    };
    window.addEventListener('keydown', handleF5KeyDown);
    return () => window.removeEventListener('keydown', handleF5KeyDown);
  }, [saveStatus, storageError]);

  // Update reduced motion DOM attribute
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-reduced-motion',
      settings.reduced_motion ? 'true' : 'false'
    );
  }, [settings.reduced_motion]);

  // Single serialized disk commit; only the newest save may update the status badge.
  const updateTasksWithSave = useCallback(
    async (newTasks: TaskNode[], actionDesc: string, recordUndo = true, confirmedOnly = false): Promise<boolean> => {
      if (getPersistenceError()) { setStorageError(getPersistenceError()); return false; }
      const previous = tasksRef.current;
      const version = ++savingVersion.current;
      if (!confirmedOnly) { tasksRef.current = newTasks; setTasks(newTasks); }
      setSaveStatus('saving');
      try {
        await saveTasksToStorage(newTasks, /永久|清空|导入|重置/.test(actionDesc));
        if (confirmedOnly) {
          const oldById = new Map(previous.map(t => [t.id, t]));
          animateArchivedRows(new Set(newTasks.filter(t => t.archived_at && !oldById.get(t.id)?.archived_at).map(t => t.id)), document.documentElement.dataset.reducedMotion === 'true');
          tasksRef.current = newTasks; setTasks(newTasks);
        }
        if (recordUndo) { undoManager.pushTaskDiff(actionDesc, previous, newTasks); setUndoStackVersion(v => v + 1); }
        if (version === savingVersion.current) setSaveStatus('saved');
        return true;
      } catch (error) {
        if (!failedSaveRef.current) failedSaveRef.current = { before: previous, next: newTasks, description: actionDesc, recordUndo };
        if (version === savingVersion.current) setSaveStatus('error');
        setStorageError((error as Error).message);
        return false;
      }
    }, []
  );

  const handleBulkAction = async (ids: string[], action: BulkAction): Promise<boolean> => {
    if (batchBusy || saveStatus === 'saving' || !loaded || !isTabOwner || storageError) return false;
    const before = tasksRef.current;
    let next: TaskNode[];
    try { next = applyBulkAction(before, ids, action).tasks; }
    catch (error) { setToast({ id: 'batch-error', type: 'error', title: (error as Error).message }); return false; }
    if (next === before) return true;
    if (action.type === 'complete') next = syncRecurringTasks(next).updatedTasks;
    setBatchBusy(true);
    try {
      const success = await updateTasksWithSave(next, '批量任务操作', true, true);
      if (!success) return false;
      closeAuxiliaryPanel();
      setToast({ id: 'batch-' + Date.now(), type: 'complete', title: '批量操作已保存', canUndo: true, onUndo: () => handleUndo() });
      return true;
    } finally { setBatchBusy(false); }
  };

  // Undo / Redo handlers
  const handleUndo = useCallback(() => {
    const currentTasks = tasksRef.current;
    const res = undoManager.undo(currentTasks);
    if (res) {

      updateTasksWithSave(res.newTasks, `撤销: ${res.description}`, false);
      setUndoStackVersion((v) => v + 1);
      setToast({
        id: 'undo-' + Date.now(),
        type: 'info',
        title: `已撤销: ${res.description}`,
      });
    }
  }, [tasks, updateTasksWithSave]);

  const handleRedo = useCallback(() => {
    const currentTasks = tasksRef.current;
    const res = undoManager.redo(currentTasks);
    if (res) {

      updateTasksWithSave(res.newTasks, `重做: ${res.description}`, false);
      setUndoStackVersion((v) => v + 1);
      setToast({
        id: 'redo-' + Date.now(),
        type: 'info',
        title: `已重做: ${res.description}`,
      });
    }
  }, [tasks, updateTasksWithSave]);

  // Global Keyboard Shortcuts (Ctrl+N, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || saveStatus === 'saving' || storageError || !loaded) return;
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        ((activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type !== 'checkbox') ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      // 1. Ctrl+N / Cmd+N -> Open Unified Quick Create Modal (PRD 1.1)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !isInput) {
        e.preventDefault();
        setIsCreateModalOpen(true);
        return;
      }

      // 2. Ctrl+Z / Cmd+Z -> Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      // 3. Ctrl+Y -> Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !isInput) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // 4. Delete / Backspace -> Soft delete selected task (PRD v1.3 Section 12.5 & 12.6, A53-A56)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        if (e.repeat) return; // Prevent continuous repeat deletion
        if (
          isCreateModalOpen ||
          isSettingsModalOpen ||
          isTemplateModalOpen ||
          isCompletedDrawerOpen ||
          parentCompleteTarget
        ) {
          return;
        }
        if (selectedTaskId) {
          const target = tasks.find((t) => t.id === selectedTaskId && !t.deleted_at);
          if (target) {
            e.preventDefault();
            handleDeleteTaskRef.current(target);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    tasks,
    selectedTaskId,
    isCreateModalOpen,
    isSettingsModalOpen,
    isTemplateModalOpen,
    isCompletedDrawerOpen,
    parentCompleteTarget,
    handleUndo,
    handleRedo, saveStatus, storageError, loaded,
  ]);

  const handleTakeOverLock = () => {
    takeOverTabLock((isOwner) => {
      setIsTabOwner(isOwner);
      setToast({
        id: 'takeover-' + Date.now(),
        type: 'info',
        title: '已接管当前浏览器窗口编辑权限',
      });
    });
  };

  // 1. Add Task
  const handleAddTask = (
    title: string,
    parentId: string | null = null,
    dueType: DueType = 'none',
    dueDate: string | null = null,
    quadrant: QuadrantType = null,
    recurrenceRule?: RecurrenceRule | null
  ): TaskNode | null => {
    const currentTasks = tasksRef.current;
    // Check depth
    let depth = 1;
    if (parentId) {
      const parent = currentTasks.find((t) => t.id === parentId);
      if (parent) {
        depth = getNodeDepth(currentTasks, parent) + 1;
      }
    }
    if (depth > 5) {
      setToast({
        id: 'err-depth-' + Date.now(),
        type: 'error',
        title: `层级达到 ${depth} 层，超出系统最大 5 层限制`,
      });
      return null;
    }

    const newTask: TaskNode = {
      id: generateId(),
      parent_id: parentId,
      root_bucket: parentId === null ? 'categories' : null,
      title: title.trim(),
      note: '',
      sort_order: Date.now(),
      status: 'open',
      completed_at: null,
      archived_at: null,
      due_type: dueType,
      due_date: dueDate,
      due_at: null,
      quadrant: quadrant,
      planned_date: null,
      recurrence_rule: recurrenceRule || null,
      recurrence_rule_id: recurrenceRule ? recurrenceRule.id : null,
      recurrence_period_key: recurrenceRule
        ? computePeriodKey(recurrenceRule, dueDate || getTodayDateString(0))
        : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      deletion_batch_id: null,
    };

    let nextTasks: TaskNode[];
    try {
      nextTasks = insertTaskNode(currentTasks, newTask);
    } catch (error) {
      setToast({ id: 'add-error-' + Date.now(), type: 'error', title: (error as Error).message });
      return null;
    }
    undoManager.pushTaskDiff(`添加任务「${newTask.title}」`, currentTasks, nextTasks);
    setUndoStackVersion((v) => v + 1);
    updateTasksWithSave(nextTasks, `添加任务「${newTask.title}」`, false);
    setQuickInputParentId(null);
    return newTask;
  };

  const handleAddTaskInline = (parentId: string, title: string): TaskNode | null => {
    return handleAddTask(title, parentId);
  };

  // All completion entry points share the same subtree/ancestor transition.
  const handleToggleComplete = async (task: TaskNode, outcomeNote?: string) => {
    if (saveStatus === 'saving' || storageError) return;
    const currentTasks = tasksRef.current;
    const current = currentTasks.find(t => t.id === task.id && !t.deleted_at);
    if (!current) return;
    if (current.status === 'done') {
      handleRestoreTask(current);
      return;
    }

    const result = completeTaskBranch(currentTasks, current.id, outcomeNote);
    if (!result.completedTasks.length) return;
    const { updatedTasks } = syncRecurringTasks(result.tasks);
    const actionDesc = result.autoClosedIds.length
      ? `已完成「${current.title}」，并闭环 ${result.autoClosedIds.length} 个上级任务`
      : `已完成「${current.title}」`;
    if (!(await updateTasksWithSave(updatedTasks, actionDesc, true, true))) return;
    closeAuxiliaryPanel();
    setToast({
      id: 'complete-' + Date.now(), type: 'complete', title: actionDesc,
      canUndo: true, onUndo: handleUndo,
      onViewCompleted: () => setIsCompletedDrawerOpen(true),
    });
  };

  const handleArchiveCompleted = async (task: TaskNode) => {
    const currentTasks = tasksRef.current;
    const result = archiveCompletedBranch(currentTasks, task.id);
    if (result.error) {
      setToast({ id: 'archive-err-' + Date.now(), type: 'error', title: result.error });
      return;
    }
    const nextTasks = result.tasks;
    if (nextTasks === currentTasks || !result.newlyArchivedIds.length) return;
    const description = `已归档「${task.title}」`;
    if (!(await updateTasksWithSave(nextTasks, description, true, true))) return;
    closeAuxiliaryPanel();
    setToast({
      id: 'archive-' + Date.now(), type: 'complete', title: description,
      canUndo: true, onUndo: handleUndo,
      onViewCompleted: () => setIsCompletedDrawerOpen(true),
    });
  };

  const handleConfirmCompleteParent = () => {
    if (!parentCompleteTarget) return;
    handleToggleComplete(parentCompleteTarget);
    setParentCompleteTarget(null);
  };

  // Restore target/ancestors together; archived siblings keep their history.
  const handleRestoreTask = async (target: TaskNode | string, includeDescendants = false) => {
    const currentTasks = tasksRef.current;
    const id = typeof target === 'string' ? target : target.id;
    const task = currentTasks.find(t => t.id === id && !t.deleted_at);
    if (!task) return;
    const nextTasks = reopenTaskBranch(currentTasks, id, includeDescendants);
    const previous = new Map(currentTasks.map(t => [t.id, t]));
    const reopenedIds = nextTasks.filter(t => t.status === 'open' && previous.get(t.id)?.status === 'done').map(t => t.id);
    if (!reopenedIds.length) return;
    const description = `恢复「${task.title}」`;
    if (!(await updateTasksWithSave(nextTasks, description, true, true))) return;
    setToast({ id: 'restore-' + Date.now(), type: 'info', title: description, canUndo: true, onUndo: handleUndo });
  };

  // 4. Update Node Title
  const handleUpdateTitle = (id: string, newTitle: string) => {
    const target = tasks.find((t) => t.id === id);
    if (!target || target.title === newTitle) return;

    const nowStr = new Date().toISOString();
    const nextTasks = tasks.map((t) =>
      t.id === id ? { ...t, title: newTitle, updated_at: nowStr } : t
    );
    undoManager.pushTaskDiff(target, { ...target, title: newTitle, updated_at: nowStr }, `修改标题为「${newTitle}」`);
    setUndoStackVersion((v) => v + 1);
    updateTasksWithSave(nextTasks, `修改标题为「${newTitle}」`, false);
  };

  // 5. Update Node Quadrant (PRD 6.2)
  const handleUpdateQuadrant = (id: string, quadrant: QuadrantType) => {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;

    // Dragged back to the same quadrant -> no-op
    if (target.quadrant === quadrant) {
      return;
    }

    const nowStr = new Date().toISOString();
    const nextTasks = tasks.map((t) =>
      t.id === id ? { ...t, quadrant, updated_at: nowStr } : t
    );

    const quadrantNames: Record<string, string> = {
      Q1: '重要且紧急',
      Q2: '重要不紧急',
      Q3: '紧急不重要',
      Q4: '不重要不紧急',
    };
    const targetName = quadrant ? quadrantNames[quadrant] : '未分类';
    const actionDesc = `将「${target.title}」象限划分为 ${targetName}`;

    undoManager.pushTaskDiff(target, { ...target, quadrant, updated_at: nowStr }, actionDesc);
    setUndoStackVersion((v) => v + 1);
    updateTasksWithSave(nextTasks, actionDesc, false);

    setToast({
      id: 'quadrant-' + Date.now(),
      type: 'complete',
      title: `已将「${target.title}」设为${targetName}`,
      canUndo: true,
      onUndo: () => {
        handleUndo();
      },
    });
  };

  // 6. Update Node Due Date
  const handleUpdateDue = (id: string, dueType: DueType, dateStr: string | null) => {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;
    const nowStr = new Date().toISOString();
    const nextTasks = tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            due_type: dueType,
            due_date: dateStr,
            updated_at: nowStr,
          }
        : t
    );
    undoManager.pushTaskDiff(
      target,
      { ...target, due_type: dueType, due_date: dateStr, updated_at: nowStr },
      `修改任务截止时间`
    );
    setUndoStackVersion((v) => v + 1);
    updateTasksWithSave(nextTasks, `修改任务截止时间`, false);
  };

  // 7. General Node Update
  const handleUpdateTask = (
    id: string,
    updates: Partial<TaskNode>,
    updateMode: 'single' | 'series' = 'single'
  ) => {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;

    let nextTasks: TaskNode[];
    if (updateMode === 'series' && target.recurrence_rule_id) {
      nextTasks = tasks.map((t) => {
        if (t.id === id) {
          return { ...t, ...updates, updated_at: new Date().toISOString() };
        }
        if (t.status === 'open' && t.recurrence_rule_id === target.recurrence_rule_id) {
          return {
            ...t,
            ...updates,
            id: t.id,
            recurrence_period_key: t.recurrence_period_key,
            updated_at: new Date().toISOString(),
          };
        }
        return t;
      });
    } else {
      nextTasks = tasks.map((t) =>
        t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t
      );
    }
    updateTasksWithSave(nextTasks, `更新任务字段`);
  };

  // 8. Delete Task (Soft Delete into Trash Batch)
  const handleDeleteTask = (task: TaskNode) => {
    // Only collect currently active descendants so earlier deleted items keep their history (PRD v1.2 A10)
    const activeDescendants = getDescendantTasks(tasks, task.id).filter((d) => d.deleted_at === null);
    const deleteIds = new Set<string>([task.id, ...activeDescendants.map((d) => d.id)]);
    const batchId = 'batch_' + Date.now().toString(36);
    const deletedTime = new Date().toISOString();

    const changedItems: Array<{
      taskId: string;
      fieldChanges: {
        deleted_at: { before: string | null; after: string | null };
        deletion_batch_id: { before: string | null; after: string | null };
      };
    }> = [];

    const nextTasks = tasks.map((t) => {
      if (deleteIds.has(t.id)) {
        changedItems.push({
          taskId: t.id,
          fieldChanges: {
            deleted_at: { before: t.deleted_at, after: deletedTime },
            deletion_batch_id: { before: t.deletion_batch_id, after: batchId },
          },
        });
        return { ...t, deleted_at: deletedTime, deletion_batch_id: batchId };
      }
      return t;
    });

    const actionDesc = `删除「${task.title}」及其子任务 (${deleteIds.size} 项)`;
    undoManager.pushDelta({
      type: 'update',
      description: actionDesc,
      changes: changedItems,
    });
    setUndoStackVersion((v) => v + 1);
    updateTasksWithSave(nextTasks, actionDesc, false);

    if (selectedTaskId === task.id) {
      setSelectedTaskId(null);
    }

    setToast({
      id: 'del-' + Date.now(),
      type: 'info',
      title: `已将「${task.title}」移入回收站 (${deleteIds.size} 项)`,
      canUndo: true,
      onUndo: () => {
        handleUndo();
      },
    });
  };
  handleDeleteTaskRef.current = handleDeleteTask;

  // 9. Duplicate Task (PRD 4.4 & A09)
  const handleDuplicateTask = (task: TaskNode, includeSubtree: boolean) => {
    const now = new Date().toISOString();
    const newItems: TaskNode[] = [];

    // Duplicate root
    const newRootId = generateId();
    newItems.push({
      ...task,
      id: newRootId,
      title: `${task.title} (副本)`,
      status: 'open',
      completed_at: null,
      archived_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    });

    if (includeSubtree) {
      const descendants = getDescendantTasks(tasks, task.id);
      const idMap = new Map<string, string>();
      idMap.set(task.id, newRootId);

      for (const d of descendants) {
        const newDId = generateId();
        idMap.set(d.id, newDId);
      }

      for (const d of descendants) {
        const clonedParentId = d.parent_id ? idMap.get(d.parent_id) || task.parent_id : null;
        newItems.push({
          ...d,
          id: idMap.get(d.id)!,
          parent_id: clonedParentId,
          status: 'open',
          completed_at: null,
          archived_at: null,
          due_type: 'none',
          due_date: null,
          due_at: null,
          quadrant: null,
          planned_date: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          deletion_batch_id: null,
        });
      }
    }

    const nextTasks = [...tasks, ...newItems];
    updateTasksWithSave(nextTasks, `复制任务「${task.title}」`);
    setToast({
      id: 'dup-' + Date.now(),
      type: 'info',
      title: includeSubtree
        ? `已复制整棵子树 (${newItems.length} 项)`
        : `已复制任务「${task.title}」`,
    });
  };

  // 10. Set / Clear Planned Date for Today (PRD v1.3 Section 12.3 & A46-A51)
  const handleSetPlannedDate = (task: TaskNode, targetDateOrNull?: string | null) => {
    const todayStr = getTodayDateString(0);
    const isDueOrOverdue = isTaskDueToday(task) || isTaskOverdue(task);
    const currentlyPlanned = task.planned_date === todayStr;

    let nextDate: string | null = null;
    let desc = '';
    let toastTitle = '';

    if (targetDateOrNull !== undefined) {
      nextDate = targetDateOrNull;
      if (nextDate === todayStr) {
        desc = `将「${task.title}」加入今日安排`;
        toastTitle = isDueOrOverdue
          ? `已将「${task.title}」设为今日主动安排`
          : `已将「${task.title}」加入今日安排`;
      } else {
        desc = `将「${task.title}」移出今日安排`;
        toastTitle = isDueOrOverdue
          ? `已取消手动安排，因今天到期／逾期仍显示在今日`
          : `已将「${task.title}」从今日安排中移出`;
      }
    } else {
      if (currentlyPlanned) {
        nextDate = null;
        desc = `将「${task.title}」移出今日安排`;
        toastTitle = isDueOrOverdue
          ? `已取消手动安排，因今天到期／逾期仍显示在今日`
          : `已将「${task.title}」从今日安排中移出`;
      } else {
        nextDate = todayStr;
        desc = `将「${task.title}」加入今日安排`;
        toastTitle = isDueOrOverdue
          ? `已将「${task.title}」设为今日主动安排`
          : `已将「${task.title}」加入今日安排`;
      }
    }

    const nextTasks = tasks.map((t) =>
      t.id === task.id ? { ...t, planned_date: nextDate, updated_at: new Date().toISOString() } : t
    );

    undoManager.pushDelta({
      type: 'update',
      description: desc,
      changes: [
        {
          taskId: task.id,
          fieldChanges: {
            planned_date: { before: task.planned_date, after: nextDate },
          },
        },
      ],
    });
    setUndoStackVersion((v) => v + 1);

    updateTasksWithSave(nextTasks, desc, false);
    setToast({
      id: 'today-' + Date.now(),
      type: 'info',
      title: toastTitle,
      canUndo: true,
      onUndo: () => handleUndo(),
    });
  };

  // 11. Move Node (Tree Reorder & Reparenting)
  const handleMoveNode = (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside'
  ) => {
    const dragged = tasks.find((t) => t.id === draggedId);
    const target = tasks.find((t) => t.id === targetId);
    if (!dragged || !target) return;

    let newParentId: string | null = target.parent_id;
    if (position === 'inside') {
      newParentId = target.id;
    }

    // Check depth and cycle
    const check = canMoveSubtree(tasks, dragged, newParentId);
    if (!check.allowed) {
      setToast({
        id: 'move-err-' + Date.now(),
        type: 'error',
        title: check.reason || '无法移动此节点',
      });
      return;
    }

    let nextTasks = [...tasks];
    // Remove dragged from original list position
    nextTasks = nextTasks.filter((t) => t.id !== draggedId);

    const updatedDragged: TaskNode = {
      ...dragged,
      parent_id: newParentId,
      root_bucket: newParentId === null ? 'categories' : null,
      updated_at: new Date().toISOString(),
    };

    const targetIdx = nextTasks.findIndex((t) => t.id === targetId);
    if (position === 'before') {
      nextTasks.splice(targetIdx, 0, updatedDragged);
    } else {
      nextTasks.splice(targetIdx + 1, 0, updatedDragged);
    }

    if (dragged.status === 'open' && newParentId) {
      nextTasks = reopenTaskBranch(nextTasks, newParentId);
    }
    undoManager.pushTaskDiff(`移动节点「${dragged.title}」`, tasks, nextTasks);
    setUndoStackVersion(v => v + 1);
    updateTasksWithSave(nextTasks, `移动节点「${dragged.title}」`, false);
  };

  // 12. Apply Template (PRD Section 8)
  const handleApplyTemplate = (
    items: { title: string; relativeDay: number | null; depth: number }[],
    targetParentId: string | null
  ) => {
    const now = new Date().toISOString();
    const createdList: TaskNode[] = [];
    const depthParentMap: Record<number, string> = {};

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const newId = generateId();

      let itemParentId: string | null = targetParentId;
      if (item.depth > 1) {
        itemParentId = depthParentMap[item.depth - 1] || targetParentId;
      }

      depthParentMap[item.depth] = newId;

      const dueDate =
        item.relativeDay !== null ? getTodayDateString(item.relativeDay) : null;
      const dueType: DueType = dueDate ? 'date' : 'none';

      createdList.push({
        id: newId,
        parent_id: itemParentId,
        root_bucket: itemParentId === null ? 'categories' : null,
        title: item.title,
        note: '',
        sort_order: Date.now() + i,
        status: 'open',
        completed_at: null,
        due_type: dueType,
        due_date: dueDate,
        due_at: null,
        quadrant: null,
        planned_date: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        deletion_batch_id: null,
      });
    }

    const nextTasks = [...tasks, ...createdList];
    updateTasksWithSave(nextTasks, `应用模板创建了 ${createdList.length} 项任务`);
    setToast({
      id: 'tpl-' + Date.now(),
      type: 'info',
      title: `模板创建成功，生成 ${createdList.length} 项节点`,
    });
  };

  // 13. Restore Batch in Trash (PRD v1.2 A11, A12)
  const handleRestoreBatch = (batchId: string) => {
    const batchTasks = tasks.filter((t) => t.deletion_batch_id === batchId);
    if (batchTasks.length === 0) return;

    const batchIds = new Set(batchTasks.map((t) => t.id));
    const nowStr = new Date().toISOString();

    // Check if any restored tasks are 'open', and find active ancestors that need reopening
    const ancestorsToReopen = new Set<string>();
    for (const t of batchTasks) {
      if (t.status === 'open' && t.parent_id && !batchIds.has(t.parent_id)) {
        let curr = tasks.find((item) => item.id === t.parent_id);
        while (curr && !curr.deleted_at && !batchIds.has(curr.id)) {
          if (curr.status === 'done') {
            ancestorsToReopen.add(curr.id);
          }
          if (!curr.parent_id) break;
          curr = tasks.find((item) => item.id === curr!.parent_id);
        }
      }
    }

    const nextTasks = tasks.map((t) => {
      if (t.deletion_batch_id === batchId) {
        let newParentId = t.parent_id;
        let newRootBucket = t.root_bucket;
        if (t.parent_id && !batchIds.has(t.parent_id)) {
          const parent = tasks.find((item) => item.id === t.parent_id);
          if (!parent || parent.deleted_at !== null) {
            newParentId = null;
            newRootBucket = 'categories';
          }
        }
        return {
          ...t,
          parent_id: newParentId,
          root_bucket: newRootBucket,
          deleted_at: null,
          deletion_batch_id: null,
          updated_at: nowStr,
        };
      }
      if (ancestorsToReopen.has(t.id)) {
        return {
          ...t,
          status: 'open' as const,
          completed_at: null,
          archived_at: null,
          updated_at: nowStr,
        };
      }
      return t;
    });

    const reopenCount = ancestorsToReopen.size;
    const actionDesc =
      reopenCount > 0
        ? `恢复回收站批次 (${batchTasks.length} 项)，并联动恢复 ${reopenCount} 个上级`
        : `恢复回收站批次 (${batchTasks.length} 项)`;
    updateTasksWithSave(nextTasks, actionDesc);
    setToast({
      id: 'restore-batch-' + Date.now(),
      type: 'info',
      title: actionDesc,
    });
  };

  // 13.1 Restore Single Task from Trash (PRD v1.2 A11, A13)
  const handleRestoreSingleTaskFromTrash = (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target || !target.deleted_at) return;

    let newParentId = target.parent_id;
    let newRootBucket = target.root_bucket;

    if (target.parent_id) {
      const parent = tasks.find((t) => t.id === target.parent_id);
      if (!parent || parent.deleted_at !== null) {
        const proceed = window.confirm(
          `该任务的原上级任务已不存在或在回收站中。\n是否将「${target.title}」恢复为根目录任务（待归类）？`
        );
        if (!proceed) return;
        newParentId = null;
        newRootBucket = 'categories';
      }
    }

    const ancestorsToReopen = new Set<string>();
    if (target.status === 'open' && newParentId) {
      let curr = tasks.find((t) => t.id === newParentId);
      while (curr && !curr.deleted_at) {
        if (curr.status === 'done') {
          ancestorsToReopen.add(curr.id);
        }
        if (!curr.parent_id) break;
        curr = tasks.find((t) => t.id === curr!.parent_id);
      }
    }

    const nowStr = new Date().toISOString();
    const nextTasks = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          parent_id: newParentId,
          root_bucket: newRootBucket,
          deleted_at: null,
          deletion_batch_id: null,
          updated_at: nowStr,
        };
      }
      if (ancestorsToReopen.has(t.id)) {
        return {
          ...t,
          status: 'open' as const,
          completed_at: null,
          archived_at: null,
          updated_at: nowStr,
        };
      }
      return t;
    });

    const reopenCount = ancestorsToReopen.size;
    const actionDesc =
      reopenCount > 0
        ? `已从回收站恢复「${target.title}」，并联动恢复 ${reopenCount} 个上级`
        : `已从回收站恢复「${target.title}」`;
    updateTasksWithSave(nextTasks, actionDesc);
    setToast({
      id: 'restore-trash-' + Date.now(),
      type: 'info',
      title: actionDesc,
    });
  };

  // 14. Permanently Delete Batch (PRD v1.2 A14)
  const handlePermanentlyDeleteBatch = (batchId: string) => {
    const count = tasks.filter((t) => t.deletion_batch_id === batchId).length;
    const nextTasks = tasks.filter((t) => t.deletion_batch_id !== batchId);
    updateTasksWithSave(nextTasks, `永久删除回收站批次 (${count} 项)`, false);
    setToast({
      id: 'perm-del-' + Date.now(),
      type: 'info',
      title: `已永久粉碎该批次任务 (${count} 项)`,
    });
  };

  // 14.1 Permanently Delete Single Task (PRD v1.2 A14)
  const handlePermanentlyDeleteSingleTask = (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    const removed = new Set([taskId]);
    let expanded = true;
    while (expanded) { expanded = false; for (const t of tasks) if (t.parent_id && removed.has(t.parent_id) && !removed.has(t.id)) { removed.add(t.id); expanded = true; } }
    const nextTasks = tasks.filter(t => !removed.has(t.id));
    updateTasksWithSave(nextTasks, `永久删除「${target.title}」`, false);
    setToast({
      id: 'perm-del-task-' + Date.now(),
      type: 'info',
      title: `已永久粉碎任务「${target.title}」`,
    });
  };

  // 15. Clear All Trash (PRD v1.2 A14)
  const handleClearAllTrash = () => {
    const count = tasks.filter((t) => t.deleted_at !== null).length;
    const nextTasks = tasks.filter((t) => t.deleted_at === null);
    updateTasksWithSave(nextTasks, `清空回收站 (${count} 项)`, false);
    setToast({
      id: 'clear-trash-' + Date.now(),
      type: 'info',
      title: `已清空回收站，共粉碎 ${count} 项任务`,
    });
  };

  // Both legacy and complete backups commit through one versioned transaction.
  const handleImportTasks = async (newTasks: TaskNode[], newSettings?: AppSettings, full?: WorkspaceSnapshot) => {
    try {
      const current = await loadWorkspace();
      const restored = await importFullBackup(full || { ...current, data: { ...current.data, tasks: newTasks, settings: newSettings || current.data.settings } });
      tasksRef.current = restored.data.tasks; setTasks(restored.data.tasks);
      setSettings(previous => ({ ...previous, ...restored.data.settings }));
      setReviewSavedReports(restored.data.reports);
      undoManager.clear(); setUndoStackVersion(v => v + 1);
      setSaveStatus('saved');
      setToast({ id: 'import-' + Date.now(), type: 'complete', title: `成功导入 ${newTasks.length} 项任务` });
    } catch (error) { setStorageError((error as Error).message); throw error; }
  };

  // 17. Reset Seed Data
  const handleResetSeedData = () => {
    const initial = getInitialSeedTasks();
    updateTasksWithSave(initial, `重置为演示数据`, false);
    setToast({
      id: 'reset-seed-' + Date.now(),
      type: 'info',
      title: '已恢复初始演示数据',
    });
  };

  // View counts
  const openTasksCount = tasks.filter((t) => !t.deleted_at && t.status === 'open').length;
  const todayDateStr = getTodayDateString(0);
  const todayTasksCount = tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.status === 'open' &&
      (t.due_date === todayDateStr || t.planned_date === todayDateStr)
  ).length;
  const completedTasksCount = tasks.filter((t) => !t.deleted_at && t.status === 'done').length;
  const trashCount = tasks.filter((t) => t.deleted_at !== null).length;

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) || null
    : null;

  useEffect(() => {
    if (!isAndroid()) return;
    const back = async () => {
      if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return; }
      if (isCreateModalOpen) { setIsCreateModalOpen(false); return; }
      if (isTemplateModalOpen) { setIsTemplateModalOpen(false); return; }
      if (auxiliaryPanel.type !== 'none') { closeAuxiliaryPanel(); return; }
      if (pendingNavigationGuard.current && !(await pendingNavigationGuard.current())) return;
      if (currentView !== 'today') { setCurrentView('today'); return; }
      await NativeApp.minimizeApp();
    };
    window.addEventListener('todotree:navigate-back', back);
    return () => window.removeEventListener('todotree:navigate-back', back);
  }, [isSettingsModalOpen, isCreateModalOpen, isTemplateModalOpen, auxiliaryPanel.type, currentView]);

  const quickInputParent = quickInputParentId
    ? tasks.find((t) => t.id === quickInputParentId) || null
    : null;

  return (
    <div className="app-shell flex h-screen w-screen overflow-hidden bg-[#f8fafc] text-slate-800">
      {/* 1. Left Sidebar */}
      <Sidebar
        currentView={currentView}
        onViewChange={async (view) => {
            if (pendingNavigationGuard.current && !(await pendingNavigationGuard.current())) return;
          if (view === 'completed') {
            setIsCompletedDrawerOpen(true);
          } else {
            setCurrentView(view);
            setSelectedTaskId(null);
            if (view === 'review') setHasUnreadReview(false);
          }
        }}
        openTasksCount={openTasksCount}
        todayTasksCount={todayTasksCount}
        completedTasksCount={completedTasksCount}
        trashCount={trashCount}
        onOpenSettings={() => {
          setSettingsInitialTab('general');
          setIsSettingsModalOpen(true);
        }}
        hasUnreadReview={hasUnreadReview}
        onOpenCompletedDrawer={() => setIsCompletedDrawerOpen(true)}
      />

      {/* 2. Middle Main Workspace */}
      <main className="main-workspace flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        {/* Reconnection Alert Banner (Bounded Auto-Recovery & Diagnostic actions) */}
        {isServerDisconnected && (
          <div
            className={`text-white text-xs font-medium py-2 px-6 flex items-center justify-between shadow-xs z-50 transition-colors ${
              isTerminalDisconnected ? 'bg-rose-700' : 'bg-amber-600'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full bg-white ${
                  isTerminalDisconnected ? 'opacity-80' : 'animate-pulse'
                }`}
              />
              <span>
                {isTerminalDisconnected
                  ? '本地服务连接已断开，请检查 TodoTree 桌面宿主是否正在运行'
                  : `本地服务连接中断或正在恢复中，正在自动重新连接 (第 ${Math.min(
                      reconnectAttempt,
                      5
                    )}/5 次)...`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setReconnectAttempt(0);
                  setIsTerminalDisconnected(false);
                  checkServerConnection(true);
                }}
                className="px-2.5 py-0.5 bg-white/20 hover:bg-white/30 active:bg-white/40 text-white rounded font-medium text-xs transition-colors"
              >
                立即重试
              </button>
              {isTerminalDisconnected && (
                <button
                  onClick={handleCopyDiagnosticLog}
                  className="px-2.5 py-0.5 bg-white/10 hover:bg-white/20 text-white rounded font-medium text-xs transition-colors"
                >
                  复制诊断日志
                </button>
              )}
            </div>
          </div>
        )}

        {storageError && <StorageRecovery message={storageError} onRetry={async () => {
          const state = await retryPendingSave();
          const failed = failedSaveRef.current;
          if (failed?.recordUndo && JSON.stringify(failed.next) === JSON.stringify(state.data.tasks)) {
            undoManager.pushTaskDiff(failed.description, failed.before, state.data.tasks); setUndoStackVersion(v => v + 1);
          }
          failedSaveRef.current = null;
          tasksRef.current = state.data.tasks; setTasks(state.data.tasks);
          setSettings(previous => ({ ...previous, ...state.data.settings }));
          setLoaded(true); setStorageError(getPersistenceError()); setSaveStatus('saved');
        }} />}
        {(!loaded || batchBusy || storageError || saveStatus === 'saving') && <div className="absolute inset-0 z-30 bg-white/40" aria-label="正在保护数据" />}
        {/* Header (Hidden in review view as it has its own dedicated toolbar) */}
        {currentView !== 'review' && (
          <Header
            title={
              currentView === 'tree'
                ? '我的任务'
                : currentView === 'today'
                ? '今天'
                : currentView === 'quadrant'
                ? '四象限看板'
                : currentView === 'completed'
                ? '已完成'
                : '回收站'
            }
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenTemplateModal={() => setIsTemplateModalOpen(true)}
            onQuickNewTask={() => setIsCreateModalOpen(true)}
            saveStatus={saveStatus}
            isTabOwner={isTabOwner}
            onTakeOverLock={handleTakeOverLock}
            canUndo={undoManager.canUndo()}
            undoDescription={undoManager.getUpcomingUndoDescription()}
            onUndo={handleUndo}
          />
        )}

        {/* View Switcher Container */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {currentView === 'tree' && (
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <TaskTree
                tasks={tasks}
                onBulkAction={handleBulkAction}
                onPendingGuardChange={guard => { pendingNavigationGuard.current = guard; }}
                selectedTaskId={selectedTaskId}
                onSelectTask={handleSelectTask}
                onToggleComplete={handleToggleComplete}
                onArchiveCompleted={handleArchiveCompleted}
                onUpdateTitle={handleUpdateTitle}
                onUpdateQuadrant={handleUpdateQuadrant}
                onUpdateDue={handleUpdateDue}
                onAddChild={(parentId) => {
                  setQuickInputParentId(parentId);
                }}
                onAddTaskInline={handleAddTaskInline}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={handleDuplicateTask}
                onTogglePlannedToday={handleSetPlannedDate}
                onMoveNode={handleMoveNode}
                showCompleted={settings.show_completed}
                onOpenCompletedDrawer={() => openAuxiliaryPanel('completed')}
                onCloseCompletedDrawer={closeAuxiliaryPanel}
                isCompletedDrawerOpen={auxiliaryPanel.type === 'completed'}
                onToggleQuadrantQuick={() => {
                  if (auxiliaryPanel.type === 'quadrant_quick') {
                    closeAuxiliaryPanel();
                  } else {
                    openAuxiliaryPanel('quadrant_quick');
                  }
                }}
                isQuadrantQuickOpen={auxiliaryPanel.type === 'quadrant_quick'}
                reducedMotion={settings.reduced_motion}
                searchQuery={searchQuery}
                onShowErrorToast={(msg) =>
                  setToast({ id: 'err-' + Date.now(), type: 'error', title: msg })
                }
                onShowToastWithAction={(title, actionLabel, onAction) => {
                  setToast({
                    id: 'toast-' + Date.now(),
                    type: 'info',
                    title,
                    actionLabel,
                    onAction,
                  });
                }}
              />

              {/* Bottom Quick Input */}
              <QuickInputBar
                onAddTask={handleAddTask}
                selectedParentId={quickInputParentId}
                parentTitle={quickInputParent?.title}
                onClearParent={() => setQuickInputParentId(null)}
              />
            </div>
          )}

          {currentView === 'today' && (
            <TodayView
              tasks={tasks}
              timezone={settings.timezone}
              onToggleComplete={handleToggleComplete}
              onSelectTask={handleSelectTask}
              onNavigateToTree={(taskId) => {
                setCurrentView('tree');
                handleSelectTask(tasks.find((t) => t.id === taskId) || null);
              }}
              onUpdateTask={handleUpdateTask}
              onOpenCompletedDrawer={() => openAuxiliaryPanel('completed')}
            />
          )}

          {currentView === 'quadrant' && (
            <QuadrantWorkspace
              tasks={tasks}
              onUpdateQuadrant={handleUpdateQuadrant}
              onToggleComplete={handleToggleComplete}
              onSelectTask={handleSelectTask}
              selectedTaskId={selectedTaskId}
              onAddTask={handleAddTask}
              showCompleted={settings.show_completed}
              onToggleShowCompleted={() => {
                const updated = {
                  ...settings,
                  show_completed: !settings.show_completed,
                };
                setSettings(updated);
                saveSettingsToStorage(updated).catch(error => setStorageError(error.message));
              }}
              onOpenCompletedDrawer={() => openAuxiliaryPanel('completed')}
            />
          )}

          {currentView === 'completed' && (
            <CompletedView
              tasks={tasks}
              onRestoreTask={handleRestoreTask}
              onDeleteTask={handleDeleteTask}
              onSelectTask={handleSelectTask}
            />
          )}

          {currentView === 'trash' && (
            <TrashView
              tasks={tasks}
              onRestoreBatch={handleRestoreBatch}
              onRestoreSingleTask={handleRestoreSingleTaskFromTrash}
              onPermanentlyDeleteBatch={handlePermanentlyDeleteBatch}
              onPermanentlyDeleteTask={handlePermanentlyDeleteSingleTask}
              onClearAllTrash={handleClearAllTrash}
            />
          )}

          {currentView === 'review' && (
            <WorkReviewView
              tasks={tasks}
              timezone={settings.timezone}
              onOpenSettings={(tab) => {
                setSettingsInitialTab(tab || 'ai');
                setIsSettingsModalOpen(true);
              }}
              onNavigateToTask={(taskId) => {
                setCurrentView('tree');
                handleSelectTask(tasks.find((t) => t.id === taskId) || null);
              }}
              onOpenHistory={() => {
                loadSavedReports().then(setReviewSavedReports).catch(() => {});
                openAuxiliaryPanel('report_history');
              }}
              activeReportFromProps={reviewActiveReport}
              onSelectReport={(report) => setReviewActiveReport(report)}
            />
          )}
        </div>
      </main>

      {/* 3. Unified Right Auxiliary Panel (PRD Section 3.1: Exactly ONE open at a time) */}
      {auxiliaryPanel.type === 'completed' && (
        <CompletedDrawer
          isOpen={true}
          onClose={closeAuxiliaryPanel}
          tasks={tasks}
          onRestoreTask={handleRestoreTask}
          onSelectTask={handleSelectTask}
        />
      )}

      {auxiliaryPanel.type === 'report_history' && (
        <AuxiliaryPanel
          isOpen={true}
          onClose={closeAuxiliaryPanel}
          title="历史复盘报告"
          subtitle="查看与回溯此前生成的复盘报告"
          badge={reviewSavedReports.length}
          icon={<Sparkles className="w-4 h-4" />}
        >
          <ReportHistoryPanel
            savedReports={reviewSavedReports}
            activeReport={reviewActiveReport}
            onSelectReport={(report) => {
              setReviewActiveReport(report);
              closeAuxiliaryPanel();
            }}
            onDeleteReport={(id) => {
              deleteSavedReport(id).then(() => {
                setReviewSavedReports((prev) => prev.filter((r) => r.id !== id));
                if (reviewActiveReport?.id === id) {
                  setReviewActiveReport(null);
                }
              });
            }}
          />
        </AuxiliaryPanel>
      )}

      {auxiliaryPanel.type === 'quadrant_quick' && (
        <>
          {!isQuadrantDrawerMode && (
            <VerticalSplitter
              currentWidth={actualQuadrantWidth}
              minWidth={440}
              maxWidth={maxQuadrantWidth}
              defaultWidth={defaultQuadrantWidth}
              onResize={handleQuadrantResize}
              onResizeEnd={handleQuadrantResizeEnd}
              onResetDefault={handleQuadrantResetDefault}
              onDragStateChange={setIsDraggingSplitter}
            />
          )}
          <QuadrantPanel
            tasks={tasks}
            onUpdateQuadrant={handleUpdateQuadrant}
            onToggleComplete={handleToggleComplete}
            onSelectTask={handleSelectTask}
            selectedTaskId={selectedTaskId}
            isCollapsed={false}
            onToggleCollapse={closeAuxiliaryPanel}
            onClose={closeAuxiliaryPanel}
            width={actualQuadrantWidth}
            isDrawer={isQuadrantDrawerMode}
            isDraggingWidth={isDraggingSplitter}
          />
        </>
      )}

      {auxiliaryPanel.type === 'task_detail' && selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          allTasks={tasks}
          onClose={closeAuxiliaryPanel}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onDuplicateTask={handleDuplicateTask}
          onShowErrorToast={(msg) =>
            setToast({ id: 'drawer-err-' + Date.now(), type: 'error', title: msg })
          }
        />
      )}

      {/* 5. Modals */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        tasks={tasks}
        onAddTask={handleAddTask}
        isTabOwner={isTabOwner}
        onTakeOverLock={handleTakeOverLock}
      />

      <TemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        allTasks={tasks}
        onApplyTemplate={handleApplyTemplate}
        onShowErrorToast={(msg) =>
          setToast({ id: 'tpl-err-' + Date.now(), type: 'error', title: msg })
        }
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newSettings) => {
          setSettings(newSettings);
          saveSettingsToStorage(newSettings).catch(error => setStorageError(error.message));
        }}
        tasks={tasks}
        onImportTasks={handleImportTasks}
        onResetSeedData={handleResetSeedData}
        initialTab={settingsInitialTab}
      />

      <ParentCompleteModal
        isOpen={parentCompleteTarget !== null}
        parentTask={parentCompleteTarget}
        incompleteCount={parentCompleteIncompleteCount}
        onConfirm={handleConfirmCompleteParent}
        onCancel={() => setParentCompleteTarget(null)}
      />

      {/* 6. Floating 8s Toast / Undo Snackbar */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};
