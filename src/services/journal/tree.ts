import { JournalEntry, journalTitle } from './model';
export const JOURNAL_MAX_DEPTH = 5;
export interface JournalMove {
  id: string; parent_id: string | null; book_id: string; before_id?: string | null;
  expected_version: number; target_version?: number;
}
export function normalizeJournal(e: JournalEntry): JournalEntry {
  return { ...e, parent_id: e.parent_id || null, sort_order: e.sort_order || 0, deletion_batch_id: e.deletion_batch_id || null };
}
export const compareSiblings = (a: JournalEntry, b: JournalEntry) =>
  (a.sort_order || 0) - (b.sort_order || 0) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
export function journalIndex(entries: JournalEntry[]) {
  const byId = new Map(entries.map(e => [e.id, normalizeJournal(e)]));
  const children = new Map<string | null, JournalEntry[]>();
  for (const e of byId.values()) { const bucket = children.get(e.parent_id) || []; bucket.push(e); children.set(e.parent_id, bucket); }
  for (const bucket of children.values()) bucket.sort(compareSiblings);
  const descendants = (id: string) => {
    const rows: JournalEntry[] = [], seen = new Set([id]), queue = [...(children.get(id) || [])];
    for (let i = 0; i < queue.length; i++) {
      const e = queue[i]; if (seen.has(e.id)) throw Error('事件层级存在循环'); seen.add(e.id); rows.push(e);
      queue.push(...(children.get(e.id) || []));
    }
    return rows;
  };
  const path = (id: string) => {
    const rows: JournalEntry[] = [], seen = new Set([id]); let pid = byId.get(id)?.parent_id;
    while (pid) { if (seen.has(pid)) throw Error('事件层级存在循环'); seen.add(pid); const e = byId.get(pid); if (!e) throw Error('所属事件不存在'); rows.unshift(e); pid = e.parent_id; }
    return rows;
  };
  const validate = () => {
    for (const e of byId.values()) {
      const chain = path(e.id);
      if (chain.length >= JOURNAL_MAX_DEPTH) throw Error('事件最多支持 5 层');
      if (chain.some(p => p.book_id !== e.book_id)) throw Error('父子事件必须属于同一本手帐');
      if (!e.deleted_at && chain.some(p => p.deleted_at)) throw Error('所属事件在回收站，请先恢复或移为独立事件');
    }
  };
  const summary = (e: JournalEntry) => ({...e,
    child_count: (children.get(e.id) || []).filter(c => !c.deleted_at).length,
    path: path(e.id).map(p => ({id:p.id,title:journalTitle(p),event_date:p.event_date})),
    description:e.description.slice(0,180), reflection:e.reflection.slice(0,180)
  });
  return { byId, children, descendants, path, validate, summary };
}
export function planJournalMove(entries: JournalEntry[], move: JournalMove) {
  const index = journalIndex(entries), node = index.byId.get(move.id), target = move.parent_id ? index.byId.get(move.parent_id) : null;
  if (!node || node.deleted_at || node.version !== move.expected_version) throw Error('记录已变化，请刷新后移动');
  if (move.parent_id && (!target || target.deleted_at)) throw Error('目标事件不存在或已删除');
  if (target && move.target_version !== undefined && target.version !== move.target_version) throw Error('目标事件已变化，请重新选择');
  if (target && target.book_id !== move.book_id) throw Error('目标手帐不匹配');
  const subtree = [node, ...index.descendants(node.id)];
  if (subtree.some(e => e.id === move.parent_id)) throw Error('不能移入自身或自己的细节');
  const peers = (index.children.get(move.parent_id) || []).filter(e => !e.deleted_at && e.id !== node.id && e.book_id === move.book_id);
  let at = peers.length;
  if (move.before_id) { at = peers.findIndex(e => e.id === move.before_id); if (at < 0) throw Error('排序位置已变化，请重试'); }
  const prev = peers[at-1]?.sort_order, next = peers[at]?.sort_order;
  const changes = new Map<string, JournalEntry>();
  for (const e of subtree) if (e.id === node.id || e.book_id !== move.book_id) changes.set(e.id, {...e, book_id:move.book_id});
  const proposed = prev === undefined ? (next ?? 1024)-1024 : next === undefined ? prev+1024 : (prev+next)/2;
  changes.set(node.id, {...changes.get(node.id)!,parent_id:move.parent_id,sort_order:proposed});
  if (next !== undefined && prev !== undefined && next-prev < 0.0001) {
    peers.splice(at,0,changes.get(node.id)!);
    peers.forEach((e,i) => changes.set(e.id,{...e,sort_order:(i+1)*1024}));
  }
  const now = new Date().toISOString();
  for (const [id,e] of changes) changes.set(id,{...e,version:e.version+1,updated_at:now});
  journalIndex(entries.map(e=>changes.get(e.id)||e)).validate();
  return { before:[...changes.keys()].map(id=>index.byId.get(id)!), after:[...changes.values()] };
}
