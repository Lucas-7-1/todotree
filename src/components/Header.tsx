import React, { useState } from 'react';
import { Search, Plus, Sparkles, Check, RefreshCw, AlertTriangle, Undo2 } from 'lucide-react';
import { SaveStatus } from '../services/storage';

interface HeaderProps {
  title: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenTemplateModal: () => void;
  onQuickNewTask: () => void;
  saveStatus: SaveStatus;
  isTabOwner: boolean;
  onTakeOverLock: () => void;
  canUndo?: boolean;
  undoDescription?: string | null;
  onUndo?: () => void;
  showSearch?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  searchQuery,
  onSearchChange,
  onOpenTemplateModal,
  onQuickNewTask,
  saveStatus,
  isTabOwner,
  onTakeOverLock,
  canUndo = false,
  undoDescription,
  onUndo,
  showSearch = false,
}) => {
  const [showSearchInput, setShowSearchInput] = useState(false);

  // Format today's date in Chinese: e.g. 9月23日 · 周三
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[now.getDay()];
  const dateSubtitle = `${month}月${day}日 · ${weekday}`;

  return (
    <header className="workspace-header min-h-[64px] max-h-[72px] px-6 py-2 flex items-center justify-between border-b border-slate-100 bg-white">
      <div className="header-heading">
        <div className="header-title-line flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          
          {/* Save Status Badge */}
          {saveStatus === 'saved' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
              <Check className="w-3 h-3" />
              已保存
            </span>
          )}
          {saveStatus === 'saving' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-medium">
              <RefreshCw className="w-3 h-3 animate-spin" />
              保存中
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle className="w-3 h-3" />
              保存失败
            </span>
          )}

          {/* Multi-tab Lock Warning */}
          {!isTabOwner && (
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
              <span>当前为只读标签页</span>
              <button
                onClick={onTakeOverLock}
                className="underline font-semibold hover:text-amber-900"
              >
                点击接管编辑
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1 font-medium">{dateSubtitle}</p>
      </div>

      <div className="header-actions flex items-center gap-3">
        {/* Search (PRD Section 3.1: Remove duplicate search icon in toolbar) */}
        {showSearch && (
          showSearchInput ? (
            <div className="relative">
              <input
                type="text"
                autoFocus
                placeholder="搜索任务或备注..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={() => {
                  if (!searchQuery) setShowSearchInput(false);
                }}
                className="w-56 pl-8 pr-3 py-1.5 text-xs bg-slate-100 rounded-lg border border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          ) : (
            <button
              onClick={() => setShowSearchInput(true)}
              className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-50 hover:text-slate-900 transition-colors"
              title="搜索"
            >
              <Search className="w-4 h-4" />
            </button>
          )
        )}

        {/* Permanent Undo button (PRD v1.1 Section 5.1) */}
        <button
          type="button"
          onClick={onUndo}
          aria-label="撤销最近操作"
          disabled={!canUndo}
          className="header-undo flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={canUndo ? `撤销: ${undoDescription || '最近操作'} (Ctrl+Z)` : '无可撤销操作 (Ctrl+Z)'}
        >
          <Undo2 className="w-3.5 h-3.5 text-slate-600" />
          <span>撤销</span>
        </button>

        {/* Templates button */}
        <button
          onClick={onOpenTemplateModal}
          className="desktop-template-button flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>快捷模板</span>
          <span className="text-[10px] text-slate-400">∨</span>
        </button>

        {/* New Task button */}
        <button
          onClick={onQuickNewTask}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>新建任务</span>
        </button>
      </div>
    </header>
  );
};
