import React from 'react';
import { SavedReport } from '../../types/ai';
import { History, Trash2, Calendar, FileText } from 'lucide-react';

interface ReportHistoryPanelProps {
  savedReports: SavedReport[];
  activeReport: SavedReport | null;
  onSelectReport: (report: SavedReport) => void;
  onDeleteReport?: (reportId: string) => void;
}

export const ReportHistoryPanel: React.FC<ReportHistoryPanelProps> = ({
  savedReports,
  activeReport,
  onSelectReport,
  onDeleteReport,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
      {savedReports.length === 0 ? (
        <div className="text-center py-16 text-xs text-slate-400 space-y-1.5 select-none">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
            <History className="w-5 h-5" />
          </div>
          <p className="font-semibold text-slate-600">暂无已保存的复盘报告</p>
          <p className="text-[11px] text-slate-400">生成的报告将在此永久归档，支持追溯与导出</p>
        </div>
      ) : (
        savedReports.map((r) => {
          const isSelected = activeReport?.id === r.id;
          const lv = r.versions[r.versions.length - 1];
          return (
            <div
              key={r.id}
              onClick={() => onSelectReport(r)}
              className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all group ${
                isSelected
                  ? 'bg-blue-50/80 border-blue-300 shadow-2xs'
                  : 'bg-white border-slate-200/90 hover:bg-slate-50/90 hover:border-slate-300'
              }`}
            >
              <div className="font-bold text-slate-800 mb-1 flex items-center justify-between">
                <span className="truncate pr-2">{r.title}</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                  v{r.latest_version}
                </span>
              </div>

              <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                <span>
                  {r.period.display_start} 至 {r.period.display_end}
                </span>
              </div>

              <div className="text-[10px] text-slate-400 mt-2 flex items-center justify-between pt-1.5 border-t border-slate-100">
                <span>生成于 {new Date(r.updated_at).toLocaleDateString()}</span>
                <div className="flex items-center gap-2">
                  {lv?.is_mock && (
                    <span className="text-amber-600 font-semibold bg-amber-50 px-1 rounded">
                      模拟
                    </span>
                  )}
                  {onDeleteReport && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteReport(r.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 transition-all"
                      title="删除此报告"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
