import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TreeRow } from '../../services/taskMove';

/** Measured variable-height window; preserves full scroll extent and stable IDs.
 * Only the viewport plus overscan mounts, even after loading hundreds of nodes. */
export function MobileTreeWindow({ rows, scrollRef, renderRow }: {
  rows: TreeRow[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (row: TreeRow) => React.ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 30 });
  const measurable = typeof ResizeObserver !== 'undefined';
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (sizes.current.get(row.task.id) || 100));
    return result;
  }, [rows, revision]);
  useLayoutEffect(() => {
    const el = scrollRef.current, list = container.current;
    if (!el || !list || !measurable) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = Math.max(0, el.getBoundingClientRect().top - list.getBoundingClientRect().top - 400);
      const bottom = top + el.clientHeight + 800;
      let start = 0, end = rows.length;
      while (start < rows.length && offsets[start + 1] < top) start++;
      end = start;
      while (end < rows.length && offsets[end] < bottom) end++;
      setRange(old => old.start === start && old.end === end ? old : { start, end });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(el);
    return () => { el.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [offsets, rows.length, measurable, scrollRef]);
  const start = measurable ? Math.min(range.start, Math.max(0, rows.length - 1)) : 0;
  const end = measurable ? Math.max(start + 1, Math.min(range.end, rows.length)) : rows.length;
  useEffect(() => {
    if (!measurable || !container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.windowRow!;
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0 && Math.abs(height - (sizes.current.get(id) || 0)) > .5) { sizes.current.set(id, height); changed = true; }
      }
      if (changed && !frame) frame = requestAnimationFrame(() => { frame = 0; setRevision(n => n + 1); });
    });
    container.current.querySelectorAll('[data-window-row]').forEach(el => observer.observe(el));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [rows, start, end, measurable]);
  return <div className="m-tree-window" ref={container}>
    <div aria-hidden="true" style={{ height: offsets[start] || 0 }} />
    {rows.slice(start, end).map(row => <div key={row.task.id} data-window-row={row.task.id}>{renderRow(row)}</div>)}
    <div aria-hidden="true" style={{ height: Math.max(0, offsets[rows.length] - (offsets[end] || 0)) }} />
  </div>;
}
