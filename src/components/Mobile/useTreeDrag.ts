import { RefObject, useEffect, useRef, useState } from 'react';
import { TaskNode } from '../../types/todo';
import { TaskMove, validateTaskMove } from '../../services/taskMove';
import { indexMobileTasks } from '../../services/mobileTasks';

export interface DropPreview { taskId: string; kind: 'before' | 'after' | 'inside' | 'ancestor'; label: string; move?: TaskMove; error?: string }
interface Options {
  enabled: boolean;
  blockedReason: string;
  tasks: TaskNode[];
  scope: string;
  scrollRef: RefObject<HTMLDivElement>;
  onMove: (move: TaskMove) => Promise<boolean>;
  onNotice: (message: string) => void;
  onExpand: (id: string) => void;
  onMore: () => void;
}

/** Native non-passive touchmove is attached before the hold. Before activation,
 * vertical movement is left to the browser. After activation it belongs to drag. */
export function useTreeDrag(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const [temporaryExpanded, setTemporaryExpanded] = useState<Set<string>>(new Set());
  const floatingRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<() => void>(() => {});
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const host = options.scrollRef.current;
    if (!host || !options.enabled) return;
    let held: ReturnType<typeof setTimeout> | undefined;
    let movedAfterHold = false;
    let frame = 0, active = false, candidate: string | null = null, originX = 0, originY = 0, x = 0, y = 0;
    let baseline: TaskNode[] | null = null;
    let current: DropPreview | null = null, lastKey = '', dwellKey = '', dwellAt = 0;
    let touchId: number | null = null;
    let dragIndex = indexMobileTasks(latest.current.tasks);
    const validations = new Map<string, string | null>();
    const temporarilyOpened = new Set<string>();
    const validate = (move: TaskMove) => {
      const key = JSON.stringify(move);
      if (!validations.has(key)) validations.set(key, validateTaskMove(latest.current.tasks, move));
      return validations.get(key)!;
    };
    const finish = (commit: boolean) => {
      clearTimeout(held); held = undefined;
      if (commit && active) { cancelAnimationFrame(frame); tick(); }
      cancelAnimationFrame(frame);
      if (active) suppressClickUntil.current = Date.now() + 450;
      const move = commit && active && current?.move;
      const error = commit && active && current?.error;
      const changed = baseline && latest.current.tasks !== baseline;
      active = false; candidate = null; touchId = null; current = null;
      setSourceId(null); setPreview(null); setTemporaryExpanded(new Set());
      document.documentElement.classList.remove('m-dragging');
      if (error) latest.current.onNotice(error);
      if (move && !changed) void latest.current.onMove(move).then(ok => {
        if (ok && move.parentId) latest.current.onExpand(move.parentId);
        if (!ok) latest.current.onNotice('移动未保存，原位置已保留。');
      }).catch(() => latest.current.onNotice('移动未保存，请重试。'));
      else if (move && changed) latest.current.onNotice('任务数据已变化，请重新拖动。');
    };
    cancelRef.current = () => finish(false);
    const tick = () => {
      if (!active || !candidate) return;
      const opts = latest.current;
      if (opts.blockedReason || opts.tasks !== baseline) { finish(false); return; }
      if (floatingRef.current) floatingRef.current.style.transform = `translate3d(${Math.max(12, Math.min(x - 110, window.innerWidth - 252))}px,${y - 76}px,0)`;
      if (!movedAfterHold) { frame = requestAnimationFrame(tick); return; }
      const bounds = host.getBoundingClientRect();
      let scrolling = false;
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        const speed = y < bounds.top + 48 ? -Math.ceil((bounds.top + 48 - y) / 5) : y > bounds.bottom - 48 ? Math.ceil((y - bounds.bottom + 48) / 5) : 0;
        const old = host.scrollTop;
        host.scrollTop += speed;
        scrolling = old !== host.scrollTop;
        if (speed > 0 && host.scrollHeight - host.scrollTop - host.clientHeight < 180) opts.onMore();
      }
      const hit = document.elementFromPoint(x, y);
      const ancestor = hit?.closest<HTMLElement>('[data-drop-parent]');
      const row = hit?.closest<HTMLElement>('[data-tree-row]');
      const index = dragIndex;
      const source = index.byId.get(candidate)!;
      let next: DropPreview | null = null;
      if (ancestor && host.parentElement?.contains(ancestor)) {
        const id = ancestor.dataset.dropParent || null;
        const anchor = ancestor.dataset.dropAnchor;
        const move: TaskMove = { taskId: candidate, parentId: id, placement: anchor ? 'after' : 'end', anchorId: anchor, expectedParentId: source.parent_id };
        const error = validate(move);
        next = { taskId: id || 'root', kind: 'ancestor', label: error || `移出到「${id ? index.byId.get(id)?.title : '顶级项目'}」`, error: error || undefined, move: error ? undefined : move };
        dwellKey = '';
      } else if (row && host.contains(row) && row.dataset.treeRow !== candidate) {
        const target = index.byId.get(row.dataset.treeRow!);
        if (target) {
          const rect = row.getBoundingClientRect();
          const ratio = (y - rect.top) / rect.height;
          const inside = ratio >= .28 && ratio <= .72;
          const kind = inside ? 'inside' : ratio < .28 ? 'before' : 'after';
          const key = `${target.id}:${kind}`;
          if (key !== dwellKey || scrolling) { dwellKey = key; dwellAt = performance.now(); }
          const move: TaskMove = { taskId: candidate, parentId: inside ? target.id : target.parent_id, anchorId: target.id, placement: inside ? 'end' : kind as 'before' | 'after', expectedParentId: source.parent_id };
          const error = validate(move);
          const ready = !inside || performance.now() - dwellAt >= 600;
          const parentTitle = move.parentId ? index.byId.get(move.parentId)?.title : '顶级项目';
          next = { taskId: target.id, kind,
            label: error || (inside ? ready ? `移入「${target.title}」，作为子任务` : `停留以移入「${target.title}」` : `放到「${parentTitle}」下 ·「${target.title}」${kind === 'before' ? '之前' : '之后'}`),
            error: error || undefined, move: ready && !error ? move : undefined };
          if (inside && ready && !error && !temporarilyOpened.has(target.id)) {
            temporarilyOpened.add(target.id); setTemporaryExpanded(old => new Set([...old, target.id]));
          }
        }
      } else dwellKey = '';
      current = next;
      const key = JSON.stringify(next);
      if (key !== lastKey) { lastKey = key; setPreview(next); }
      frame = requestAnimationFrame(tick);
    };
    const start = (target: EventTarget | null, px: number, py: number) => {
      const title = (target as Element)?.closest<HTMLElement>('[data-drag-title]');
      if (!title || !host.contains(title)) return;
      candidate = title.dataset.dragTitle!;
      originX = x = px; originY = y = py;
      held = setTimeout(() => {
        if (!candidate) return;
        if (latest.current.blockedReason) { latest.current.onNotice(latest.current.blockedReason); finish(false); suppressClickUntil.current = Date.now() + 450; return; }
        if (document.documentElement.classList.contains('keyboard-open')) {
          (document.activeElement as HTMLElement)?.blur(); latest.current.onNotice('已保留输入，请再次长按拖动'); finish(false); return;
        }
        active = true; movedAfterHold = false; current = null; baseline = latest.current.tasks; dragIndex = indexMobileTasks(baseline); validations.clear(); temporarilyOpened.clear(); lastKey = ''; dwellKey = '';
        setSourceId(candidate); document.documentElement.classList.add('m-dragging');
        navigator.vibrate?.(12);
        frame = requestAnimationFrame(tick);
      }, 300);
    };
    const move = (px: number, py: number, e: Event) => {
      x = px; y = py;
      if (active) { if (Math.hypot(x - originX, y - originY) > 8) movedAfterHold = true; if (e.cancelable) e.preventDefault(); }
      else if (candidate && Math.hypot(x - originX, y - originY) > 8) finish(false);
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { finish(false); return; }
      touchId = e.touches[0].identifier; start(e.target, e.touches[0].clientX, e.touches[0].clientY);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) { finish(false); return; }
      const t = Array.from(e.touches).find(t => t.identifier === touchId);
      if (t) move(t.clientX, t.clientY, e);
    };
    const touchEnd = (e: TouchEvent) => { if (active && e.cancelable) e.preventDefault(); finish(true); };
    const cancel = () => finish(false);
    const mouseDown = (e: MouseEvent) => { if (e.button === 0) start(e.target, e.clientX, e.clientY); };
    const mouseMove = (e: MouseEvent) => { if (candidate) move(e.clientX, e.clientY, e); };
    const mouseUp = () => finish(true);
    const click = (e: Event) => { if (active || Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } };
    const back = (e: Event) => { if (active) { e.preventDefault(); e.stopImmediatePropagation(); finish(false); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') back(e); };
    const context = (e: Event) => { if (candidate || (e.target as Element).closest('[data-drag-title]')) e.preventDefault(); };
    const visibility = () => { if (document.hidden) finish(false); };
    host.addEventListener('touchstart', touchStart, { passive: true });
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd, { passive: false });
    document.addEventListener('touchcancel', cancel);
    host.addEventListener('mousedown', mouseDown);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
    document.addEventListener('click', click, true);
    host.addEventListener('contextmenu', context);
    window.addEventListener('todotree:back', back, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      finish(false);
      host.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', cancel);
      host.removeEventListener('mousedown', mouseDown);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
      document.removeEventListener('click', click, true);
      host.removeEventListener('contextmenu', context);
      window.removeEventListener('todotree:back', back, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [options.enabled, options.scope, options.scrollRef]);
  return { sourceId, preview, temporaryExpanded, floatingRef, cancel: () => cancelRef.current() };
}
