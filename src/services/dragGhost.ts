/**
 * Helper to create a compact, elegant drag ghost preview for tasks.
 * Matches the design mockup:
 * - Dedicated drag grip handle
 * - Bold task title
 * - Ancestor path (e.g. "工作 / 采购调研")
 * - Calendar icon + deadline label (e.g. "📅 明天")
 */
export function createDragGhost(title: string, path: string, dateLabel?: string | null): HTMLElement {
  const ghost = document.createElement('div');
  ghost.id = 'todotree-drag-ghost';
  ghost.style.position = 'fixed';
  ghost.style.top = '-1000px';
  ghost.style.left = '-1000px';
  ghost.style.zIndex = '999999';
  ghost.style.pointerEvents = 'none';
  ghost.style.padding = '10px 14px';
  ghost.style.background = '#ffffff';
  ghost.style.border = '1px solid #e2e8f0';
  ghost.style.borderRadius = '14px';
  ghost.style.boxShadow = '0 20px 35px -5px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.06)';
  ghost.style.display = 'flex';
  ghost.style.alignItems = 'flex-start';
  ghost.style.gap = '10px';
  ghost.style.maxWidth = '240px';
  ghost.style.minWidth = '160px';
  ghost.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Left grip icon
  const gripEl = document.createElement('div');
  gripEl.style.color = '#94a3b8';
  gripEl.style.marginTop = '2px';
  gripEl.style.flexShrink = '0';
  gripEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  ghost.appendChild(gripEl);

  // Content container
  const contentEl = document.createElement('div');
  contentEl.style.display = 'flex';
  contentEl.style.flexDirection = 'column';
  contentEl.style.gap = '3px';
  contentEl.style.overflow = 'hidden';
  contentEl.style.flex = '1';

  // Title element
  const titleEl = document.createElement('div');
  titleEl.style.fontSize = '13px';
  titleEl.style.fontWeight = '700';
  titleEl.style.color = '#0f172a';
  titleEl.style.lineHeight = '1.3';
  titleEl.style.whiteSpace = 'nowrap';
  titleEl.style.overflow = 'hidden';
  titleEl.style.textOverflow = 'ellipsis';
  titleEl.textContent = title;
  contentEl.appendChild(titleEl);

  // Path element
  if (path && path.trim().length > 0) {
    const pathEl = document.createElement('div');
    pathEl.style.fontSize = '11px';
    pathEl.style.fontWeight = '500';
    pathEl.style.color = '#64748b';
    pathEl.style.lineHeight = '1.2';
    pathEl.style.whiteSpace = 'nowrap';
    pathEl.style.overflow = 'hidden';
    pathEl.style.textOverflow = 'ellipsis';
    pathEl.textContent = path;
    contentEl.appendChild(pathEl);
  }

  // Date element with calendar icon
  if (dateLabel && dateLabel !== '-') {
    const dateEl = document.createElement('div');
    dateEl.style.display = 'flex';
    dateEl.style.alignItems = 'center';
    dateEl.style.gap = '4px';
    dateEl.style.fontSize = '11px';
    dateEl.style.fontWeight = '500';
    dateEl.style.color = '#64748b';
    dateEl.style.marginTop = '2px';
    dateEl.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span>${dateLabel}</span>
    `;
    contentEl.appendChild(dateEl);
  }

  ghost.appendChild(contentEl);
  document.body.appendChild(ghost);
  return ghost;
}

export function cleanupDragGhost(ghost: HTMLElement | null) {
  if (ghost && ghost.parentNode) {
    ghost.parentNode.removeChild(ghost);
  }
  const existing = document.getElementById('todotree-drag-ghost');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}
