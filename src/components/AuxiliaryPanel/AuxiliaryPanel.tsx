import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type AuxiliaryPanelType =
  | 'none'
  | 'completed'
  | 'report_history'
  | 'task_detail'
  | 'quadrant_quick';

export interface AuxiliaryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: string | number;
  icon?: React.ReactNode;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  widthClass?: string; // default w-[420px]
}

export const AuxiliaryPanel: React.FC<AuxiliaryPanelProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  icon,
  children,
  headerActions,
  widthClass = 'w-[420px]',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc key listener to close panel
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile Backdrop overlay */}
      <div
        className="fixed inset-0 bg-slate-900/25 backdrop-blur-2xs z-40 md:hidden animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Main Drawer Container */}
      <aside
        ref={panelRef}
        className={`mobile-full-panel fixed top-0 right-0 bottom-0 ${widthClass} max-w-full bg-white border-l border-slate-200/90 shadow-2xl z-40 flex flex-col select-none animate-in slide-in-from-right duration-200`}
        role="dialog"
        aria-label={title}
      >
        {/* Drawer Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold flex-shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 tracking-tight truncate">
                  {title}
                </h2>
                {badge !== undefined && (
                  <span className="text-xs font-semibold px-2 py-0.5 bg-blue-100/70 text-blue-700 rounded-full flex-shrink-0">
                    {badge}
                  </span>
                )}
              </div>
              {subtitle && (
                <p className="text-[11px] text-slate-400 truncate max-w-[280px]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {headerActions}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors"
              title="关闭 (Esc)"
              aria-label="关闭面板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {children}
        </div>
      </aside>
    </>
  );
};
