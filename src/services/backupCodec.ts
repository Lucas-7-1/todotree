import type { WorkspaceSnapshot } from './durableStore';

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export const TASK_BACKUP_FORMAT = 'todotree-workspace';

// Sort object keys only. Array order (task ranks, history and reports) is significant.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    }
    return item;
  });
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Schema 2 remains the cross-platform contract. Extra metadata is optional for old readers. */
export async function encodeWorkspaceBackup(state: WorkspaceSnapshot): Promise<string> {
  const copy = JSON.parse(JSON.stringify(state)) as WorkspaceSnapshot;
  delete copy.data.ai_settings.api_key;
  const integrity = { algorithm: 'sha256', data_sha256: await digest(copy.data) };
  const text = JSON.stringify({ ...copy, format: TASK_BACKUP_FORMAT, exported_at: new Date().toISOString(), integrity }, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('任务备份超过 32 MB，未创建不完整文件；请先减少诊断记录或使用桌面数据目录备份');
  }
  return text;
}

/** Old v2 files without a checksum remain importable. A present checksum must pass. */
export async function verifyWorkspaceBackup(value: unknown): Promise<void> {
  const backup = value as { data?: unknown; integrity?: { algorithm?: unknown; data_sha256?: unknown } };
  if (backup.integrity === undefined) return;
  if (!backup.integrity || backup.integrity.algorithm !== 'sha256' ||
      typeof backup.integrity.data_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(backup.integrity.data_sha256)) {
    throw new Error('备份完整性校验信息损坏，请重新导出；现有数据未改变');
  }
  if (await digest(backup.data) !== backup.integrity.data_sha256) {
    throw new Error('备份内容与校验值不一致，文件可能被修改或损坏；现有数据未改变');
  }
}

export function parseBackupObject(content: string): Record<string, any> {
  if (typeof content !== 'string' || !content.replace(/^\uFEFF/, '').trim()) {
    throw new Error('所选文件没有读到内容，可能是空文件或尚未下载的云端文件；请保存到手机本地后重试，或从旧版重新导出');
  }
  const text = content.replace(/^\uFEFF/, '').trim();
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 32 MB，未导入');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch {
    throw new Error('文件内容不完整或 JSON 格式损坏。请从旧版重新导出完整 JSON；不会尝试补齐内容或覆盖现有数据');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请选择 TodoTree 导出的任务备份 JSON 文件');
  return value as Record<string, any>;
}

/** Windows UTF-8 BOM and UTF-16 exports are decoded explicitly, never silently replaced. */
export function decodeBackupBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('备份文件编码损坏，请使用旧版导出的原始 JSON 文件'); }
}

export async function readBackupFile(file: File): Promise<string> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过 32 MB，未导入');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取备份，请将文件下载到本机后重新选择'));
    reader.onabort = () => reject(new Error('备份读取被中断，请重试'));
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result) : reject(new Error('备份读取失败，没有获得文件内容'));
    reader.readAsArrayBuffer(file);
  });
  if (buffer.byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 32 MB，未导入');
  if (file.size > 0 && buffer.byteLength !== file.size) throw new Error('文件没有读取完整，请下载到本机后重试');
  return decodeBackupBytes(buffer);
}
