import { isAndroid, NativeWorkspace } from './native/platform';
import { TaskNode, AppSettings } from '../types/todo';
import { validateWorkspace, type WorkspaceSnapshot } from './durableStore';
import { MAX_BACKUP_BYTES, parseBackupObject, verifyWorkspaceBackup } from './backupCodec';

export interface BackupData {
  schema_version: number;
  exported_at: string;
  tasks: TaskNode[];
  settings: AppSettings;
}

export function exportBackupData(tasks: TaskNode[], settings: AppSettings): string {
  const data: BackupData = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    tasks,
    settings,
  };
  return JSON.stringify(data, null, 2);
}

export interface DownloadResult { cancelled?: boolean; verified?: boolean; byte_count?: number; }
export async function downloadJsonFile(content: string, filename = `TodoTree-Backup-${new Date().toISOString().split('T')[0]}.json`): Promise<DownloadResult> {
  parseBackupObject(content);
  return downloadTextFile(content, filename, 'application/json');
}

export async function downloadTextFile(content: string, filename: string, mimeType = 'text/plain'): Promise<DownloadResult> {
  if (!content || new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) throw new Error('导出内容为空或超过 32 MB，未创建文件');
  if (isAndroid()) return NativeWorkspace.exportFile({ content, filename, mimeType });
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  try { a.click(); }
  finally {
    a.remove();
    // Some browsers start reading the blob after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return {}; // The browser has started a download; it cannot attest to the saved file.
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  tasks?: TaskNode[];
  settings?: Partial<AppSettings>;
  workspace?: WorkspaceSnapshot;
  source_version?: 1 | 2;
}

export function validateImportJson(jsonStr: string): ValidationResult {
  let parsed: any;
  try {
    parsed = parseBackupObject(jsonStr);
  } catch (e: any) {
    return { valid: false, error: e.message };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: '备份数据必须是一个有效的 JSON 对象' };
  }

  if (parsed.format === 'todotree-health') return { valid: false, error: '这是健康备份，请到健康模式的备份入口恢复；任务未改变' };
  if (typeof parsed.format === 'string' && parsed.format.includes('journal')) return { valid: false, error: '这是手帐备份，请到手帐模式的备份入口恢复；任务未改变' };
  if (parsed.format !== undefined && parsed.format !== 'todotree-workspace') return { valid: false, error: '这不是支持的 TodoTree 任务备份，现有数据未改变' };
  if (parsed.schema_version === 2 && parsed.data) {
    try { validateWorkspace(parsed); }
    catch (error) { return { valid: false, error: (error as Error).message }; }
    return { valid: true, tasks: parsed.data.tasks, settings: parsed.data.settings, workspace: parsed, source_version: 2 };
  }
  if (parsed.schema_version !== 1) {
    return { valid: false, error: typeof parsed.schema_version === 'number'
      ? `不支持任务备份版本 ${parsed.schema_version}，请使用相应新版导入；现有数据未改变`
      : '缺失或非法的 schema_version 版本号' };
  }

  if (!Array.isArray(parsed.tasks)) {
    return { valid: false, error: '缺失或非法的 tasks 任务列表' };
  }
  if (parsed.settings !== undefined && (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings))) {
    return { valid: false, error: '旧版备份中的设置格式损坏，现有数据未改变' };
  }

  const tasks: TaskNode[] = parsed.tasks.map((task: any, index: number) => task && typeof task === 'object' ? {
    parent_id: null, root_bucket: task.parent_id ? null : 'categories', note: '', sort_order: index + 1,
    completed_at: null, archived_at: null, due_type: 'none', due_date: null, due_at: null,
    quadrant: null, planned_date: null, deleted_at: null, deletion_batch_id: null, ...task,
  } : task);
  const idSet = new Set<string>();

  // 1. Check ID uniqueness and basic fields
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || !t.id || typeof t.id !== 'string') {
      return { valid: false, error: `第 ${i + 1} 个任务 ID 缺失或非法` };
    }
    if (idSet.has(t.id)) {
      return { valid: false, error: `发现重复的任务 ID: ${t.id}` };
    }
    idSet.add(t.id);

    if (typeof t.title !== 'string' || t.title.trim().length === 0) {
      return { valid: false, error: `任务「${t.id}」的标题不能为空` };
    }

    if (t.quadrant !== null && !['Q1', 'Q2', 'Q3', 'Q4'].includes(t.quadrant)) {
      return { valid: false, error: `任务「${t.title}」存在非法的四象限值: ${t.quadrant}` };
    }

    if (t.status !== 'open' && t.status !== 'done') {
      return { valid: false, error: `任务「${t.title}」状态必须为 open 或 done` };
    }
  }

  // 2. Check parent reference validity (no orphan parents)
  for (const t of tasks) {
    if (t.parent_id !== null) {
      if (!idSet.has(t.parent_id)) {
        return { valid: false, error: `任务「${t.title}」引用的父节点 ID 不存在: ${t.parent_id}` };
      }
    }
  }

  // 3. Cycle detection and depth check (<= 5 levels)
  const taskMap = new Map<string, TaskNode>(tasks.map(t => [t.id, t]));
  for (const t of tasks) {
    let depth = 1;
    let curr = t;
    const visited = new Set<string>([curr.id]);

    while (curr.parent_id) {
      if (visited.has(curr.parent_id)) {
        return { valid: false, error: `检测到任务层级存在循环引用：${curr.title} 包含环路` };
      }
      visited.add(curr.parent_id);
      const parent = taskMap.get(curr.parent_id);
      if (!parent) break;
      depth++;
      if (depth > 5) {
        return { valid: false, error: `任务「${t.title}」深度达到 ${depth} 层，超出系统最大 5 层限制` };
      }
      curr = parent;
    }
  }

  // 4. Invariant check: done parent cannot have open un-deleted descendants
  for (const t of tasks) {
    if (t.status === 'done' && !t.deleted_at) {
      // Find all active descendants
      const descendants = tasks.filter(child => !child.deleted_at && child.parent_id === t.id);
      for (const d of descendants) {
        if (d.status === 'open') {
          return { valid: false, error: `数据不一致：已完成的父项「${t.title}」下存在未完成的有效子项「${d.title}」` };
        }
      }
    }
  }

  return {
    valid: true,
    tasks,
    settings: parsed.settings,
    source_version: 1,
  };
}

/** Settings and programmatic imports share the same parser and checksum verification. */
export async function prepareTaskBackup(content: string): Promise<ValidationResult> {
  const result = validateImportJson(content);
  if (result.valid && result.workspace) {
    try { await verifyWorkspaceBackup(result.workspace); }
    catch (error) { return { valid: false, error: (error as Error).message }; }
  }
  return result;
}
