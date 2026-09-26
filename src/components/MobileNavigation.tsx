import React, { useEffect, useState } from 'react';
import { CalendarDays, ListTodo, LayoutGrid, Sparkles, Menu, X, CheckCircle, Trash2, Settings } from 'lucide-react';
import type { ViewType } from '../types/todo';
interface Props { currentView: ViewType; onViewChange: (view: ViewType) => void; onOpenSettings: () => void; onOpenCompletedDrawer?: () => void; completedTasksCount: number; trashCount: number }
export function MobileNavigation(p: Props) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const close = (e: Event) => { e.preventDefault(); setMore(false); };
    window.addEventListener('todotree:back', close);
    return () => window.removeEventListener('todotree:back', close);
  }, [more]);
  const items = [{ id: 'today', text: '今天', icon: CalendarDays }, { id: 'tree', text: '项目', icon: ListTodo }, { id: 'quadrant', text: '四象限', icon: LayoutGrid }, { id: 'review', text: '复盘', icon: Sparkles }] as const;
  return <>
    <nav className="mobile-navigation" aria-label="手机主导航">
      {items.map(({ id, text, icon: Icon }) => <button key={id} aria-current={p.currentView === id ? 'page' : undefined} onClick={() => { setMore(false); p.onViewChange(id); }}><Icon size={21}/><span>{text}</span></button>)}
      <button onClick={() => setMore(true)} aria-expanded={more}><Menu size={21}/><span>更多</span></button>
    </nav>
    {more && <div className="mobile-more-backdrop" onClick={() => setMore(false)}>
      <section className="mobile-more" role="dialog" aria-label="更多功能" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3"><strong>我的 TodoTree</strong><button onClick={() => setMore(false)} aria-label="关闭更多"><X size={20}/></button></div>
        <button onClick={() => { setMore(false); p.onOpenCompletedDrawer?.(); }}><CheckCircle size={19}/>已完成 <span>{p.completedTasksCount}</span></button>
        <button onClick={() => { setMore(false); p.onViewChange('trash'); }}><Trash2 size={19}/>回收站 <span>{p.trashCount}</span></button>
        <button onClick={() => { setMore(false); p.onOpenSettings(); }}><Settings size={19}/>设置与备份</button>
        <p className="text-xs text-slate-500 mt-4 leading-6">数据保存在此设备。可在设置中导出备份，或导入电脑上的备份。当前不自动同步。</p>
      </section>
    </div>}
  </>;
}
