import type { WorkspaceData } from '../durableStore';
export interface NativeDelta { collection: string; id: string; value: string | null; position?: number }
const collections = { tasks: 'id', events: 'event_id', reports: 'id', attempts: 'attempt_id' } as const;
/** Only changed records cross the native bridge; one SQLite transaction commits them together. */
export function workspaceDelta(before: WorkspaceData, after: WorkspaceData): NativeDelta[] {
  const changes: NativeDelta[] = [];
  for (const [collection, field] of Object.entries(collections)) {
    const old = new Map<string,string>((before as any)[collection].map((r: any) => [r[field], JSON.stringify(r)]));
    const seen = new Set<string>();
    const oldPositions = new Map<string,number>((before as any)[collection].map((r: any, i: number) => [r[field], i]));
    let position = 0;
    for (const row of (after as any)[collection]) {
      const id = row[field];
      if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`数据编号异常：${collection}`);
      seen.add(id);
      const value = JSON.stringify(row);
      if (old.get(id) !== value || oldPositions.get(id) !== position) changes.push({ collection, id, value, position });
      position++;
      old.delete(id);
    }
    old.forEach((_, id) => changes.push({ collection, id, value: null }));
  }
  return changes;
}
