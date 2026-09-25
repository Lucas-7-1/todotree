import { Capacitor, registerPlugin } from '@capacitor/core';
import type { WorkspaceSnapshot } from '../durableStore';
export const isAndroid = () => Capacitor.getPlatform() === 'android';
import type { NativeDelta } from './workspaceDelta';
export { workspaceDelta } from './workspaceDelta';
export interface NativeStore {
  read(): Promise<WorkspaceSnapshot>;
  commit(options: { expected_revision: number; operation_id: string; changes: NativeDelta[]; settings: object; ai_settings: object; checkpoint: boolean }): Promise<{ revision: number; operation_id: string; saved_at: string }>;
  exportFile(options: { content: string; filename: string; mimeType?: string }): Promise<{ cancelled?: boolean }>;
  http(options: { id: string; url: string; method: string; headers: Record<string,string>; body?: string; timeout: number }): Promise<{ status: number; body: string }>;
  cancelHttp(options: { id: string }): Promise<void>;
}
export const NativeWorkspace = registerPlugin<NativeStore>('NativeWorkspace');
/** Native HTTP avoids browser CORS; cancellation disconnects the underlying request. */
export async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  if (!isAndroid()) return fetch(url, init);
  if (new URL(url).protocol !== 'https:') throw new Error('手机版模型接口必须使用 HTTPS');
  const id = crypto.randomUUID();
  const abort = () => { void NativeWorkspace.cancelHttp({ id }).catch(() => {}); };
  if (init.signal?.aborted) throw new DOMException('已取消', 'AbortError');
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await NativeWorkspace.http({ id, url, method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body as string | undefined, timeout: 90000 });
    if (init.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return new Response(result.body, { status: result.status });
  } finally { init.signal?.removeEventListener('abort', abort); }
}
