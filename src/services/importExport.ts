import { TaskNode, AppSettings, QuadrantType } from '../types/todo';
import { getNodeDepth } from './treeOperations';

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

export function downloadJsonFile(content: string, filename = `TodoTree-Backup-${new Date().toISOString().split('T')[0]}.json`): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  tasks?: TaskNode[];
  settings?: AppSettings;
}

export function validateImportJson(jsonStr: string): ValidationResult {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    return { valid: false, error: 'JSON 格式解析失败：' + e.message };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: '备份数据必须是一个有效的 JSON 对象' };
  }

  if (typeof parsed.schema_version !== 'number') {
    return { valid: false, error: '缺失或非法的 schema_version 版本号' };
  }

  if (!Array.isArray(parsed.tasks)) {
    return { valid: false, error: '缺失或非法的 tasks 任务列表' };
  }

  const tasks: TaskNode[] = parsed.tasks;
  const idSet = new Set<string>();

  // 1. Check ID uniqueness and basic fields
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.id || typeof t.id !== 'string') {
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
  };
}
