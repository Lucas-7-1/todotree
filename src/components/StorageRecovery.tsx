import React, { useEffect, useState } from 'react';
import { getRecoveryCopy, isDesktop } from '../services/durableStore';
import { downloadJsonFile } from '../services/importExport';

export function StorageRecovery({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isDesktop()) fetch('/api/storage-info').then(r => r.json()).then(setInfo).catch(() => {}); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const recover = async (choice: object) => {
    if (!window.confirm('将使用所选恢复点。现有磁盘文件会保留副本，是否继续？')) return;
    await run(async () => {
      const r = await fetch('/api/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error || '恢复失败');
      window.location.reload();
    });
  };
  return <div role="alertdialog" aria-label="数据恢复" className="fixed inset-0 z-[100] bg-slate-900/25 flex items-center justify-center p-6">
    <div className="bg-white rounded-xl shadow-xl p-6 max-w-xl max-h-[85vh] overflow-auto space-y-4 text-sm">
      <h2 className="font-bold text-lg">数据尚未安全保存</h2>
      <p>{message}</p><p className="text-slate-500">已暂停编辑，避免覆盖原文件。请重试保存，或选择已校验的恢复点。</p>
      {info?.directory && <p className="break-all text-xs">数据目录：{info.directory}</p>}
      <div className="flex gap-3 flex-wrap">
        <button disabled={busy} onClick={() => run(onRetry)} className="px-3 py-2 bg-blue-600 text-white rounded">重试保存</button>
        <button onClick={() => window.location.reload()} className="px-3 py-2 border rounded">重新读取</button>
        <button onClick={() => run(async () => {
          const pending = getRecoveryCopy();
          if (pending) { const data = JSON.parse(JSON.stringify(pending.data)); delete data.ai_settings.api_key;
            await downloadJsonFile(JSON.stringify({ schema_version: 2, revision: pending.expected_revision, operation_id: pending.operation_id, saved_at: new Date().toISOString(), data }), 'TodoTree-Recovery.json'); }
        })} disabled={!getRecoveryCopy()} className="px-3 py-2 border rounded">导出待恢复副本</button>
        {isDesktop() && <button onClick={() => fetch('/api/open-data-dir', { method: 'POST' }).catch(() => {})}>打开数据目录</button>}
      </div>
      {getRecoveryCopy() && <button className="text-amber-700" onClick={() => {
        if (window.confirm('请先导出待恢复副本。放弃未确认写入，重新读取磁盘版本？')) {
          localStorage.removeItem('todotree_pending_v2'); window.location.reload();
        }
      }}>已导出副本，放弃未确认写入</button>}
      {info?.migrations?.map((m: any) => <button key={m.index} disabled={busy} className="block border p-2 rounded text-left w-full" onClick={() => recover({ migration: m.index })}>迁移 {m.task_count} 项任务：{m.path}</button>)}
      {info?.backups?.map((b: any) => <button key={b.name} disabled={busy} className="block border p-2 rounded text-left w-full" onClick={() => recover({ backup: b.name })}>恢复 {b.task_count} 项任务 · {b.saved_at} · {b.name}</button>)}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  </div>;
}
