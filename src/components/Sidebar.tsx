import React from 'react';
import { ViewType } from '../types/todo';
import {
  ListTodo,
  Calendar,
  LayoutGrid,
  CheckCircle2,
  Trash2,
  Settings,
  ChevronRight,
  GitFork,
  Sparkles
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  openTasksCount: number;
  todayTasksCount: number;
  completedTasksCount: number;
  trashCount: number;
  onOpenSettings: () => void;
  hasUnreadReview?: boolean;
  onOpenCompletedDrawer?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onViewChange,
  openTasksCount,
  todayTasksCount,
  completedTasksCount,
  trashCount,
  onOpenSettings,
  hasUnreadReview = false,
  onOpenCompletedDrawer,
}) => {
  const navItems = [
    {
      id: 'tree' as ViewType,
      label: '全部任务',
      icon: ListTodo,
      badge: openTasksCount > 0 ? openTasksCount : null,
    },
    {
      id: 'today' as ViewType,
      label: '今天',
      icon: Calendar,
      badge: todayTasksCount > 0 ? todayTasksCount : null,
    },
    {
      id: 'quadrant' as ViewType,
      label: '四象限',
      icon: LayoutGrid,
    },
    {
      id: 'completed' as ViewType,
      label: '已完成',
      icon: CheckCircle2,
      badge: completedTasksCount > 0 ? completedTasksCount : null,
    },
    {
      id: 'review' as ViewType,
      label: '工作复盘',
      icon: Sparkles,
      unreadDot: hasUnreadReview,
    },
  ];

  return (
    <aside className="w-[208px] h-screen flex-shrink-0 bg-white border-r border-slate-200/80 flex flex-col justify-between select-none">
      {/* Top Logo */}
      <div>
        <div className="h-16 px-5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/30">
            <GitFork className="w-5 h-5 rotate-90" />
          </div>
          <span className="font-bold text-lg text-slate-800 tracking-tight">TodoTree</span>
        </div>

        {/* Main Nav Items */}
        <nav className="px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'completed' && onOpenCompletedDrawer) {
                    onOpenCompletedDrawer();
                  } else {
                    onViewChange(item.id);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.unreadDot && (
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse shadow-xs" title="有新的自动复盘报告" />
                )}
                {item.badge !== null && item.badge !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Utility Items */}
      <div className="p-3 border-t border-slate-100 space-y-1">
        <button
          onClick={() => onViewChange('trash')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
            currentView === 'trash'
              ? 'bg-blue-50 text-blue-600 font-semibold'
              : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
          }`}
        >
          <div className="flex items-center gap-3">
            <Trash2 className="w-4 h-4 text-slate-400" />
            <span>回收站</span>
          </div>
          {trashCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              {trashCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 transition-all"
        >
          <Settings className="w-4 h-4 text-slate-400" />
          <span>设置</span>
        </button>

        {/* User Profile Mini Bar */}
        <div className="pt-2">
          <div className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors group">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                S
              </div>
              <span className="text-xs font-medium text-slate-700">个人空间</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
          </div>
        </div>
      </div>
    </aside>
  );
};
