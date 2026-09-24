/** A short, non-interactive visual copy; business commits never depend on animation callbacks. */
export function animateArchivedRows(ids: Set<string>, reducedMotion: boolean): void {
  if (!ids.size || reducedMotion || typeof document === 'undefined') return;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '45' });
  let count = 0;
  for (const row of document.querySelectorAll<HTMLElement>('[data-task-id]')) {
    if (!ids.has(row.dataset.taskId!)) continue;
    const rect = row.getBoundingClientRect();
    if (!rect.height || rect.bottom < 0 || rect.top > window.innerHeight || count++ >= 40) continue;
    const copy = row.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-task-id');
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    copy.querySelectorAll('input,button,select,textarea,a').forEach(el => el.setAttribute('tabindex', '-1'));
    Object.assign(copy.style, { position: 'absolute', top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: 'white', margin: '0' });
    layer.append(copy);
  }
  if (!layer.childElementCount) return;
  document.body.append(layer);
  if (typeof layer.animate !== 'function') { layer.remove(); return; }
  const animation = layer.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(10px)' }], { duration: 200, easing: 'ease-out' });
  animation.finished.then(() => layer.remove(), () => layer.remove());
  setTimeout(() => layer.remove(), 300);
}
