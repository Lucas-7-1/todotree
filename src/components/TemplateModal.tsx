import React, { useState } from 'react';
import { TaskNode } from '../types/todo';
import { getTodayDateString } from '../services/seedData';
import { getAncestorPath, getNodeDepth } from '../services/treeOperations';
import {
  X,
  Sparkles,
  Calendar,
  CheckCircle,
  FolderTree,
  Check
} from 'lucide-react';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: TaskNode[];
  onApplyTemplate: (items: { title: string; relativeDay: number | null; depth: number }[], targetParentId: string | null) => void;
  onShowErrorToast: (msg: string) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  onApplyTemplate,
  onShowErrorToast,
}) => {
  if (!isOpen) return null;

  const [selectedTemplate, setSelectedTemplate] = useState<'blank' | 'today' | 'simple' | 'seven_day'>('simple');
  const [targetParentId, setTargetParentId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('新敏捷项目');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const todayStr = getTodayDateString(0);

  const templates = [
    {
      id: 'blank' as const,
      name: '空白任务',
      desc: '单节点任务，日期与象限全留空',
      preview: [
        { title: '待办任务', relativeDay: null, depth: 1 }
      ]
    },
    {
      id: 'today' as const,
      name: '今天完成',
      desc: '单节点任务，截止日期预填为今天',
      preview: [
        { title: '今天重点任务', relativeDay: 0, depth: 1 }
      ]
    },
    {
      id: 'simple' as const,
      name: '简单项目',
      desc: '父项＋准备、执行、检查三个子项，日期留空',
      preview: [
        { title: projectTitle || '新敏捷项目', relativeDay: null, depth: 1 },
        { title: '准备工作', relativeDay: null, depth: 2 },
        { title: '落地执行', relativeDay: null, depth: 2 },
        { title: '验收检查', relativeDay: null, depth: 2 },
      ]
    },
    {
      id: 'seven_day' as const,
      name: '7天小项目',
      desc: '预设 7 天周期的标准项目节点',
      preview: [
        { title: projectTitle || '7天交付计划', relativeDay: 7, depth: 1 },
        { title: '立项与方案确定 (T)', relativeDay: 0, depth: 2 },
        { title: '核心研发与推进 (T+3)', relativeDay: 3, depth: 2 },
        { title: '最终交付与复盘 (T+7)', relativeDay: 7, depth: 2 },
      ]
    },
  ];

  const activeTpl = templates.find(t => t.id === selectedTemplate)!;

  const handleConfirm = () => {
    if (isSubmitting) return; // Prevent double submission
    setIsSubmitting(true);

    // Check depth
    let parentDepth = 0;
    if (targetParentId) {
      const parent = allTasks.find(t => t.id === targetParentId);
      if (parent) {
        parentDepth = getNodeDepth(allTasks, parent);
      }
    }

    const maxTplDepth = Math.max(...activeTpl.preview.map(p => p.depth));
    if (parentDepth + maxTplDepth > 5) {
      onShowErrorToast(`模板最大深度达到 ${parentDepth + maxTplDepth} 层，超过系统最大 5 层限制`);
      setIsSubmitting(false);
      return;
    }

    onApplyTemplate(activeTpl.preview, targetParentId);
    setIsSubmitting(false);
    onClose();
  };

  const candidateParents = allTasks.filter(t => !t.deleted_at);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-800">快捷任务模板</h3>
              <p className="text-xs text-slate-400">快速生成标准任务与拆解项目结构</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Template Choice Tabs */}
          <div className="grid grid-cols-2 gap-2">
            {templates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => setSelectedTemplate(tpl.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedTemplate === tpl.id
                    ? 'border-blue-500 bg-blue-50/50 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-xs text-slate-800 flex items-center justify-between">
                  <span>{tpl.name}</span>
                  {selectedTemplate === tpl.id && (
                    <Check className="w-3.5 h-3.5 text-blue-600" />
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                  {tpl.desc}
                </div>
              </button>
            ))}
          </div>

          {/* Project Title customizer (for project templates) */}
          {(selectedTemplate === 'simple' || selectedTemplate === 'seven_day') && (
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">
                项目主标题
              </label>
              <input
                type="text"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="例如：2026 Q4 产品研发计划"
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Target Location Picker */}
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-slate-400" />
              <span>放置位置</span>
            </label>
            <select
              value={targetParentId || ''}
              onChange={(e) => setTargetParentId(e.target.value ? e.target.value : null)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">(创建为根大类)</option>
              {candidateParents.map(p => {
                const ancestors = getAncestorPath(allTasks, p);
                const pathStr = ancestors.length > 0 ? `${ancestors.join(' / ')} / ` : '';
                return (
                  <option key={p.id} value={p.id}>
                    作为「{pathStr}{p.title}」的子项
                  </option>
                );
              })}
            </select>
          </div>

          {/* Live Preview List */}
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">结构与日期实际预览：</div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 font-mono text-xs">
              {activeTpl.preview.map((item, idx) => {
                const computedDate = item.relativeDay !== null ? getTodayDateString(item.relativeDay) : '未设日期';
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-slate-700"
                    style={{ paddingLeft: `${(item.depth - 1) * 16}px` }}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-slate-400">└─</span>
                      <span className="font-sans font-medium text-xs truncate">
                        {item.title}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200/80 flex-shrink-0">
                      {computedDate}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm shadow-blue-500/20 transition-all"
          >
            确认创建
          </button>
        </div>
      </div>
    </div>
  );
};
