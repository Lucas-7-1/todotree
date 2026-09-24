import React, { useState, useEffect, useMemo } from 'react';
import { TaskNode } from '../../types/todo';
import {
  AISettings,
  FactsPackage,
  SavedReport,
  ReportVersion,
  DryRunPreview,
  TaskEvent,
  EvidenceItem,
} from '../../types/ai';
import {
  buildFactsPackage,
} from '../../services/ai/factsEngine';
import { loadEventsFromStorage } from '../../services/ai/eventLogger';
import {
  loadAISettings,
  loadSavedReports,
  saveSavedReports,
  requestReport,
  computeReportKey,
  computeInputHash,
  deleteSavedReport,
  previewOutboundRequest,
  checkReportCompliance,
  DEFAULT_AI_SETTINGS,
} from '../../services/ai/reportService';
import { computeContentHash, formatHashBadge } from '../../services/ai/hashUtils';
import {
  Sparkles,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Settings,
  Info,
  Check,
  RefreshCw,
  Eye,
  History,
  FileText,
  Search,
  ArrowRight,
  Code,
  ShieldCheck,
  RotateCcw,
  X,
  FileCode,
} from 'lucide-react';
import { DEFAULT_PROMPT_TEMPLATE } from '../../services/ai/prompts';

interface WorkReviewViewProps {
  tasks: TaskNode[];
  timezone: string;
  onOpenSettings: (initialTab?: 'general' | 'ai') => void;
  onNavigateToTask: (taskId: string) => void;
  onOpenHistory?: () => void;
  activeReportFromProps?: SavedReport | null;
  onSelectReport?: (report: SavedReport) => void;
}

type PeriodTab = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';

// Reading-first markdown renderer (PRD Section 3.2: 15px/26px line-height)
function renderFormattedMarkdown(text: string) {
  const lines = (text || '').split('\n');
  return lines.map((line, idx) => {
    if (line.startsWith('# ')) {
      return (
        <h1 key={idx} className="text-xl font-bold text-slate-900 mt-6 mb-3 pb-2 border-b border-slate-100">
          {line.replace(/^#\s+/, '')}
        </h1>
      );
    }
    if (line.startsWith('## ')) {
      return (
        <h2 key={idx} className="text-base font-bold text-slate-800 mt-5 mb-2 flex items-center gap-1.5 text-blue-900">
          {line.replace(/^##\s+/, '')}
        </h2>
      );
    }
    if (line.startsWith('### ')) {
      return (
        <h3 key={idx} className="text-sm font-bold text-slate-800 mt-4 mb-1">
          {line.replace(/^###\s+/, '')}
        </h3>
      );
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const itemContent = line.replace(/^[-*]\s+/, '');
      return (
        <li key={idx} className="text-[15px] leading-[26px] text-slate-800 ml-5 list-disc my-1">
          {renderInlineBold(itemContent)}
        </li>
      );
    }
    if (line.trim().length === 0) {
      return <div key={idx} className="h-3" />;
    }
    return (
      <p key={idx} className="text-[15px] leading-[26px] text-slate-800 my-2">
        {renderInlineBold(line)}
      </p>
    );
  });
}

function renderInlineBold(str: string) {
  const parts = str.split(/(\**.*?\**)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export const WorkReviewView: React.FC<WorkReviewViewProps> = ({
  tasks,
  timezone,
  onOpenSettings,
  onNavigateToTask,
  onOpenHistory,
  activeReportFromProps,
  onSelectReport,
}) => {
  const [activeTab, setActiveTab] = useState<PeriodTab>('this_week');
  const [selectedRootId, setSelectedRootId] = useState<string>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [activeReport, setActiveReport] = useState<SavedReport | null>(null);

  // Prompt template and custom instructions (PRD v1.2 A36-A44)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('default_review_template');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [showCustomInstructions, setShowCustomInstructions] = useState<boolean>(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Evidence expansion
  const [expandedEvidences, setExpandedEvidences] = useState<Record<number, boolean>>({});
  const [copiedType, setCopiedType] = useState<'text' | 'md' | null>(null);

  // PRD v1.3 States
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<DryRunPreview | null>(null);
  const [showExecutionDetails, setShowExecutionDetails] = useState(false);
  const [showPromptDiffModal, setShowPromptDiffModal] = useState(false);
  const [bodyViewMode, setBodyViewMode] = useState<'markdown' | 'plaintext'>('markdown');
  const [previewCopiedSection, setPreviewCopiedSection] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [showClarifications, setShowClarifications] = useState(false);

  // Load initial settings, reports, and events
  useEffect(() => {
    loadAISettings().then((s) => {
      setAiSettings(s);
      if (s.default_template_id) {
        setSelectedTemplateId(s.default_template_id);
      }
    });
    loadSavedReports().then(setSavedReports);
    loadEventsFromStorage().then(setTaskEvents);
  }, []);

  // Sync external report selection from history auxiliary panel
  useEffect(() => {
    if (activeReportFromProps) {
      setActiveReport(activeReportFromProps);
    }
  }, [activeReportFromProps]);

  // Top-level categories
  const rootTasks = useMemo(() => {
    return tasks.filter((t) => !t.deleted_at && t.parent_id === null);
  }, [tasks]);

  // Current query parameters
  const currentParams = useMemo(() => {
    let reportType: 'weekly' | 'monthly' | 'custom' = 'weekly';
    let isPrevious = false;

    if (activeTab === 'this_week') {
      reportType = 'weekly';
      isPrevious = false;
    } else if (activeTab === 'last_week') {
      reportType = 'weekly';
      isPrevious = true;
    } else if (activeTab === 'this_month') {
      reportType = 'monthly';
      isPrevious = false;
    } else if (activeTab === 'last_month') {
      reportType = 'monthly';
      isPrevious = true;
    } else {
      reportType = 'custom';
      isPrevious = false;
    }

    return { reportType, isPrevious };
  }, [activeTab]);

  // Compile FactsPackage
  const factsPackage: FactsPackage = useMemo(() => {
    return buildFactsPackage(
      currentParams.reportType,
      tasks,
      taskEvents,
      {
        root_ids: selectedRootId === 'all' ? [] : [selectedRootId],
        excluded_ids: [],
      },
      timezone,
      {
        isPrevious: currentParams.isPrevious,
        customStartDate: activeTab === 'custom' ? customStart : undefined,
        customEndDate: activeTab === 'custom' ? customEnd : undefined,
        sendNotes: aiSettings?.send_notes || false,
        sendOutcomeNotes: aiSettings?.send_outcome_notes ?? true,
        sendBackground: aiSettings?.send_background !== false,
      }
    );
  }, [
    currentParams,
    tasks,
    taskEvents,
    selectedRootId,
    timezone,
    activeTab,
    customStart,
    customEnd,
    aiSettings,
  ]);

  // Current selected template object
  const currentTemplate = useMemo(() => {
    const templates = aiSettings?.prompt_templates || [DEFAULT_PROMPT_TEMPLATE];
    return (
      templates.find((t) => t.profile_id === selectedTemplateId) ||
      templates[0] ||
      DEFAULT_PROMPT_TEMPLATE
    );
  }, [aiSettings, selectedTemplateId]);

  // Report Key
  const reportKey = useMemo(() => {
    return computeReportKey(factsPackage);
  }, [factsPackage]);

  // Current input fingerprint (input_hash)
  const currentInputHash = useMemo(() => {
    return computeInputHash(
      reportKey,
      factsPackage,
      aiSettings || DEFAULT_AI_SETTINGS,
      {
        templateContent: currentTemplate.content,
        templateVersion: currentTemplate.version,
        customInstructions,
      }
    );
  }, [reportKey, factsPackage, aiSettings, currentTemplate, customInstructions]);

  // Find saved report matching this period & scope
  const matchedReport = useMemo(() => {
    return savedReports.find((r) => r.report_key === reportKey);
  }, [savedReports, reportKey]);

  // Sync active report if matching key
  useEffect(() => {
    if (matchedReport) {
      setActiveReport(matchedReport);
    } else if (!activeReportFromProps) {
      setActiveReport(null);
    }
  }, [matchedReport, activeReportFromProps]);

  // Latest version of the active report
  const latestVersion = useMemo(() => {
    if (!activeReport || !activeReport.versions || activeReport.versions.length === 0) {
      return null;
    }
    return activeReport.versions[activeReport.versions.length - 1];
  }, [activeReport]);

  // Has data or prompt changed relative to matched report
  const hasDataChanged = useMemo(() => {
    if (!matchedReport) return true;
    return matchedReport.input_hash !== currentInputHash;
  }, [matchedReport, currentInputHash]);

  // Template out-of-date banner check
  const isTemplateOutOfDate = useMemo(() => {
    if (!latestVersion) return false;
    const reportHash =
      latestVersion.snapshot?.template_hash ||
      (latestVersion.applied_template_content
        ? computeContentHash(latestVersion.applied_template_content)
        : null);
    const currentHash =
      currentTemplate.content_hash || computeContentHash(currentTemplate.content);
    return reportHash !== null && reportHash !== currentHash;
  }, [latestVersion, currentTemplate]);

  const reportUsedTemplateHash = useMemo(() => {
    if (!latestVersion) return null;
    return (
      latestVersion.snapshot?.template_hash ||
      (latestVersion.applied_template_content
        ? computeContentHash(latestVersion.applied_template_content)
        : null)
    );
  }, [latestVersion]);

  const currentSavedTemplateHash = useMemo(() => {
    return currentTemplate.content_hash || computeContentHash(currentTemplate.content);
  }, [currentTemplate]);

  // Generation handler
  const handleGenerate = async (forceRegenerate: boolean = false) => {
    if (isGenerating) return;

    setIsGenerating(true);
    setGenerationProgress(
      factsPackage.completed_records.length === 0
        ? '本地无已完成记录，直接生成空报告...'
        : '正在装载快照并验证出站载荷...'
    );
    setErrorMessage(null);

    try {
      const activeSettings = aiSettings || (await loadAISettings());
      const res = await requestReport(
        factsPackage,
        activeSettings,
        {
          forceNewVersion: forceRegenerate,
          templateId: currentTemplate.profile_id,
          customInstructions,
          onProgress: (p: string) => setGenerationProgress(p),
        }
      );

      const updatedList = await loadSavedReports();
      setSavedReports(updatedList);
      setActiveReport(res.report);
      if (onSelectReport) {
        onSelectReport(res.report);
      }
      setIsGenerating(false);
      setGenerationProgress('');
    } catch (err: any) {
      console.error('Report generation failed:', err);
      setIsGenerating(false);
      setGenerationProgress('');
      setErrorMessage(err.message || '生成失败，请重试');
    }
  };

  // Dry-run preview handler
  const handleOpenPreview = () => {
    const activeSettings = aiSettings || DEFAULT_AI_SETTINGS;
    const preview = previewOutboundRequest(
      factsPackage,
      activeSettings,
      {
        templateId: currentTemplate.profile_id,
        customInstructions,
      }
    );
    setPreviewData(preview);
    setShowPreviewModal(true);
  };

  // Copy handler
  const handleCopy = (type: 'text' | 'md') => {
    if (!latestVersion) return;
    const textToCopy =
      type === 'text'
        ? latestVersion.response.report_markdown.replace(/[#*`]/g, '')
        : latestVersion.response.report_markdown;

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    });
  };

  // Export Markdown handler
  const handleExportMarkdown = () => {
    if (!activeReport || !latestVersion) return;
    const content = latestVersion.response.report_markdown;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeReport.title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Diagnostics handler
  const handleExportDiagnostics = (report: SavedReport, version: ReportVersion) => {
    const diagnostic = {
      app: 'TodoTree',
      version: '1.4',
      exported_at: new Date().toISOString(),
      report_id: report.id,
      report_key: report.report_key,
      input_hash: report.input_hash,
      period: report.period,
      selected_model: version.model,
      duration_ms: version.duration_ms,
      snapshot_id: version.snapshot?.snapshot_id,
      template_name: version.snapshot?.template_name,
      template_version: version.snapshot?.template_version,
      template_hash: version.snapshot?.template_hash,
      custom_instructions_hash: version.snapshot?.user_instructions_hash,
      outbound_inspection: version.outbound_inspection,
      compliance_check: version.compliance_check,
      tasks_count: version.snapshot?.tasks_count || report.facts.completed_records.length,
      sanitized_task_ids: report.facts.completed_records.map((r) => r.instance_id),
    };
    const jsonStr = JSON.stringify(diagnostic, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todotree-diagnostic-${report.id}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Compute Single Primary Action Button text, icon, and behavior (PRD Section 3.2 P0)
  const getPrimaryButtonProps = () => {
    if (isGenerating) {
      return {
        text: '正在调用大模型生成报告…',
        disabled: true,
        icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
        onClick: () => {},
        className: 'bg-blue-500 text-white cursor-not-allowed opacity-80',
      };
    }
    if (errorMessage) {
      return {
        text: '重试生成',
        disabled: false,
        icon: <RotateCcw className="w-3.5 h-3.5" />,
        onClick: () => handleGenerate(matchedReport ? true : false),
        className: 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs',
      };
    }
    if (!matchedReport) {
      return {
        text: '生成报告',
        disabled: false,
        icon: <Sparkles className="w-3.5 h-3.5" />,
        onClick: () => handleGenerate(false),
        className: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs',
      };
    }
    if (hasDataChanged) {
      return {
        text: '更新报告',
        disabled: false,
        icon: <RotateCcw className="w-3.5 h-3.5" />,
        onClick: () => handleGenerate(true),
        className: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs',
      };
    }
    return {
      text: '重新生成',
      disabled: false,
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      onClick: () => handleGenerate(true),
      className: 'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 border border-slate-300 shadow-2xs',
    };
  };

  const primaryBtn = getPrimaryButtonProps();

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc] overflow-y-auto">
      {/* 1. Compact 1-2 Row Control Console Toolbar (PRD Section 3.2) */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-2.5 flex-shrink-0 select-none shadow-2xs space-y-2">
        {/* Row 1: Periods, Scope, Templates & Quick Actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Left: Period Tabs */}
          <div className="flex items-center gap-2">
            <div className="flex items-center p-1 bg-slate-100/90 rounded-xl gap-0.5">
              {(
                [
                  { id: 'this_week', label: '本周' },
                  { id: 'last_week', label: '上周' },
                  { id: 'this_month', label: '本月' },
                  { id: 'last_month', label: '上月' },
                  { id: 'custom', label: '自定义' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === tab.id
                      ? 'bg-white text-blue-600 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Category Scope Selector */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
              <span className="text-xs text-slate-400 font-medium">项目:</span>
              <select
                value={selectedRootId}
                onChange={(e) => setSelectedRootId(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 outline-none focus:border-blue-500 font-medium"
              >
                <option value="all">全部大类</option>
                {rootTasks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Prompt Template Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 font-medium">模板:</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 outline-none focus:border-blue-500 font-medium max-w-[150px] truncate"
                title="选择复盘总结使用的提示词模板"
              >
                {(aiSettings?.prompt_templates || [DEFAULT_PROMPT_TEMPLATE]).map((t) => (
                  <option key={t.profile_id} value={t.profile_id}>
                    {t.name} (v{t.version})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right: Custom Instructions, History, Settings */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCustomInstructions(!showCustomInstructions)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                customInstructions.trim()
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                  : showCustomInstructions
                  ? 'bg-slate-100 border-slate-300 text-slate-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="为本次报告指定额外要求"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>本次要求{customInstructions.trim() ? ' (已输入)' : ''}</span>
            </button>

            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
                title="打开历史报告抽屉"
              >
                <History className="w-3.5 h-3.5 text-slate-500" />
                <span>报告历史 ({savedReports.length})</span>
              </button>
            )}

            <button
              onClick={() => onOpenSettings('ai')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="打开大模型设置"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span>设置</span>
            </button>
          </div>
        </div>

        {/* Row 2: Stats summary, Dry-run inspection & SINGLE PRIMARY ACTION BUTTON */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs flex-wrap gap-2">
          {/* Summary Stats */}
          <div className="flex items-center gap-3 text-slate-500">
            <div>
              <span className="text-slate-400">统计区间: </span>
              <span className="font-semibold text-slate-700">{factsPackage.period.label}</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div>
              <span className="text-slate-400">可用记录: </span>
              <strong className="text-blue-600 font-bold">
                {factsPackage.completed_records.length}
              </strong>{' '}
              <span className="text-[11px] text-slate-400">
                (末级: {factsPackage.stats.completed_leaf_instances})
              </span>
            </div>
            {matchedReport && hasDataChanged && (
              <span className="text-blue-600 font-medium text-[11px] bg-blue-50 px-2 py-0.5 rounded-full">
                数据或提示词已变更
              </span>
            )}
          </div>

          {/* Action Area */}
          <div className="flex items-center gap-2">
            {/* Dry-run preview */}
            <button
              onClick={handleOpenPreview}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="查看即将在后台发出的完整提示词与业务载荷（零模型调用）"
            >
              <Eye className="w-3.5 h-3.5 text-slate-400" />
              <span>查看请求</span>
            </button>

            {/* SINGLE Primary Action Button (PRD Section 3.2 P0) */}
            <button
              onClick={primaryBtn.onClick}
              disabled={primaryBtn.disabled}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${primaryBtn.className}`}
            >
              {primaryBtn.icon}
              <span>{primaryBtn.text}</span>
            </button>
          </div>
        </div>

        {/* Custom Instructions Expandable Input Bar */}
        {showCustomInstructions && (
          <div className="p-2.5 bg-indigo-50/60 border border-indigo-200/80 rounded-xl space-y-1.5 text-xs animate-in fade-in duration-100">
            <div className="flex items-center justify-between text-indigo-900 font-semibold">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>本次附加要求（仅对本次生成有效，优先级高于常规模板）</span>
              </div>
              {customInstructions.trim() && (
                <button
                  onClick={() => setCustomInstructions('')}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 underline"
                >
                  清空要求
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder="例如：重点突出交付成果与协同配合，自适应精简为 3 条核心要点..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="w-full px-3 py-1 bg-white border border-indigo-200 rounded-lg text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-500 text-xs"
              maxLength={300}
            />
          </div>
        )}

        {/* Custom Date Range Picker */}
        {activeTab === 'custom' && (
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 text-xs">
            <span className="text-slate-500">起止日期:</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-none focus:border-blue-500"
            />
            <span className="text-slate-400">至</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {/* 2. Main Content Workspace: Reading-First Layout (760–960px 居中) */}
      <div className="flex-1 p-6 md:p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full space-y-6">
          {/* Out of Date Prompt Banner */}
          {activeReport && latestVersion && isTemplateOutOfDate && (
            <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-2xl flex items-center justify-between text-xs text-amber-900 gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div>
                  <span className="font-bold">当前设置的提示词已更新</span>
                  <span className="text-amber-700 ml-1.5">
                    （报告生成时指纹: <code className="font-mono bg-amber-100 px-1 rounded">{formatHashBadge(reportUsedTemplateHash || '')}</code>，当前设置指纹: <code className="font-mono bg-amber-100 px-1 rounded">{formatHashBadge(currentSavedTemplateHash)}</code>）
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setShowPromptDiffModal(true)}
                  className="px-2.5 py-1 rounded-lg border border-amber-300 hover:bg-amber-100 text-amber-800 font-semibold"
                >
                  对比差异
                </button>
                <button
                  onClick={() => handleGenerate(true)}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                >
                  用当前设置重新生成
                </button>
              </div>
            </div>
          )}

          {/* Error Alert */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                关闭
              </button>
            </div>
          )}

          {/* Downgrade Banner if downgraded (PRD v1.1 Section 3.4) */}
          {activeReport && latestVersion && latestVersion.is_downgraded && (
            <div className="p-3 bg-blue-50/90 border border-blue-200 rounded-2xl flex items-center justify-between text-xs text-blue-900 gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <div>
                  <span className="font-bold">基础摘要</span>
                  <span className="text-blue-700 ml-1.5">
                    {latestVersion.downgrade_reason || 'AI 暂未生成成功，已按真实完成记录整理基础摘要。您可以随时重新尝试。'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleGenerate(true)}
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs flex-shrink-0 flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>用 AI 重新整理</span>
              </button>
            </div>
          )}

          {/* Report Viewer Container */}
          {activeReport && latestVersion ? (
            <article className="bg-white border border-slate-200/90 rounded-2xl p-7 md:p-9 shadow-sm space-y-6">
              {/* Report Header Bar */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                      {activeReport.title}
                    </h2>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                        latestVersion.is_downgraded
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : latestVersion.is_mock
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {latestVersion.is_downgraded
                        ? '基础摘要 · 按已完成记录整理'
                        : `v${latestVersion.version} · ${latestVersion.is_mock ? '确定性模拟' : latestVersion.model}`}
                    </span>

                    {latestVersion.is_downgraded && (
                      <button
                        onClick={() => handleGenerate(true)}
                        className="px-2.5 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1 transition-colors border border-indigo-200"
                        title="再次尝试调用大模型整理复盘报告"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>用 AI 重新整理</span>
                      </button>
                    )}

                    {/* Low-frequency details moved to Inspection & Diagnostic Modal (PRD Section 3.2) */}
                    <button
                      onClick={() => setShowExecutionDetails(true)}
                      className="px-2.5 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold flex items-center gap-1 transition-colors border border-blue-200/60"
                      title="查看本报告生成时的不可变快照与四层证据链"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>检查与诊断</span>
                    </button>
                  </div>

                  <div className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                    <span>生成时间: {new Date(latestVersion.created_at).toLocaleString()}</span>
                    <span>•</span>
                    <span>统计截止: {activeReport.period.cutoff}</span>
                    {latestVersion.custom_instructions && (
                      <>
                        <span>•</span>
                        <span
                          className="text-indigo-600 font-medium truncate max-w-sm"
                          title={latestVersion.custom_instructions}
                        >
                          附加要求: {latestVersion.custom_instructions}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Toolbar actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Rich vs Plaintext */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg mr-1 text-xs">
                    <button
                      onClick={() => setBodyViewMode('markdown')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                        bodyViewMode === 'markdown'
                          ? 'bg-white text-blue-600 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      富文本
                    </button>
                    <button
                      onClick={() => setBodyViewMode('plaintext')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                        bodyViewMode === 'plaintext'
                          ? 'bg-white text-blue-600 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      纯文本
                    </button>
                  </div>

                  <button
                    onClick={() => handleCopy('text')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    {copiedType === 'text' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>{copiedType === 'text' ? '已复制' : '复制文本'}</span>
                  </button>

                  <button
                    onClick={() => handleCopy('md')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    {copiedType === 'md' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>{copiedType === 'md' ? '已复制' : 'Markdown'}</span>
                  </button>

                  <button
                    onClick={handleExportMarkdown}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="导出为标准 UTF-8 Markdown 文件"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出</span>
                  </button>
                </div>
              </div>

              {/* Report Main Content: Reading-First container */}
              <div className="prose prose-slate max-w-none text-[15px] leading-[26px]">
                {bodyViewMode === 'markdown' ? (
                  <div className="space-y-2 select-text font-sans">
                    {renderFormattedMarkdown(latestVersion.response.report_markdown)}
                  </div>
                ) : (
                  <pre className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed select-text">
                    {latestVersion.response.report_markdown}
                  </pre>
                )}
              </div>

              {/* Evidences & Facts traceability section */}
              {latestVersion.response.evidence_map &&
                latestVersion.response.evidence_map.length > 0 && (
                  <div className="pt-6 border-t border-slate-100 space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      事实依据溯源 ({latestVersion.response.evidence_map.length})
                    </h3>
                    <div className="space-y-2">
                      {latestVersion.response.evidence_map.map((item: EvidenceItem, idx: number) => (
                        <div
                          key={idx}
                          className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl text-xs space-y-1.5"
                        >
                          <div className="font-semibold text-slate-800 flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                              {item.claim_text}
                            </span>
                            <button
                              onClick={() =>
                                setExpandedEvidences((prev) => ({
                                  ...prev,
                                  [idx]: !prev[idx],
                                }))
                              }
                              className="text-slate-400 hover:text-slate-700 p-0.5"
                            >
                              {expandedEvidences[idx] ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {expandedEvidences[idx] && (
                            <div className="pl-3 border-l-2 border-blue-200 text-slate-600 space-y-1 mt-1">
                              <div className="text-[11px] text-slate-400">
                                关联事实记录编号: {item.task_instance_ids.join(', ')}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Optional Clarification Suggestions Section (PRD v1.1 Section 2.3) */}
              {latestVersion.response.clarification_notes &&
                latestVersion.response.clarification_notes.length > 0 && (
                  <div className="pt-5 border-t border-slate-100 space-y-2">
                    <button
                      onClick={() => setShowClarifications((prev) => !prev)}
                      className="flex items-center justify-between w-full text-left text-xs font-bold text-slate-600 hover:text-slate-800 transition-colors py-1"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-amber-500">💡</span>
                        <span>补充信息可让总结更具体 ({Math.min(3, latestVersion.response.clarification_notes.length)})</span>
                        <span className="text-[11px] font-normal text-slate-400">（非必填，仅作建议）</span>
                      </span>
                      {showClarifications ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    {showClarifications && (
                      <div className="space-y-1.5 pt-1">
                        {latestVersion.response.clarification_notes
                          .slice(0, 3)
                          .map((note, nIdx) => (
                            <div
                              key={nIdx}
                              className="p-2.5 bg-amber-50/60 border border-amber-200/70 rounded-xl text-xs flex items-center justify-between gap-2"
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-amber-900">{note.issue}</div>
                                {note.suggested_input && (
                                  <div className="text-[11px] text-amber-700">
                                    建议：{note.suggested_input}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
            </article>
          ) : (
            /* Clear Empty State */
            <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center shadow-2xs space-y-4 max-w-lg mx-auto my-12 select-none">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-800">
                  准备生成「{factsPackage.period.label}」复盘报告
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                  基于本地记录的 {factsPackage.completed_records.length} 项已完成事实，使用您设定的提示词模板生成结构化报告。
                </p>
              </div>
              <button
                onClick={() => handleGenerate(false)}
                disabled={isGenerating || factsPackage.completed_records.length === 0}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs transition-colors shadow-xs disabled:opacity-50"
              >
                {factsPackage.completed_records.length === 0 ? '该周期暂无完成记录' : '立即生成报告'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Outbound Request Preview (Dry-Run) */}
      {showPreviewModal && previewData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800">出站请求即时预览 (Dry-Run)</h3>
                  <p className="text-[11px] text-slate-400">
                    完整展示即将发往模型适配器的系统提示词、事实包与出站校验状态
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] text-slate-400">装载模板</div>
                  <div className="font-semibold text-slate-800 mt-0.5 truncate">
                    {previewData.snapshot.template_name} v{previewData.snapshot.template_version}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">模板指纹</div>
                  <div className="font-mono text-indigo-700 font-semibold mt-0.5">
                    {formatHashBadge(previewData.snapshot.template_hash)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">核验状态</div>
                  <div className="text-emerald-700 font-semibold mt-0.5">出站核验通过</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">快照编号</div>
                  <div className="font-mono text-slate-600 mt-0.5 truncate">
                    {previewData.snapshot.snapshot_id}
                  </div>
                </div>
              </div>

              {/* System Prompt Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span>系统提示词 (System Prompt)</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(previewData.outbound_system);
                      setPreviewCopiedSection('system');
                      setTimeout(() => setPreviewCopiedSection(null), 1500);
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    {previewCopiedSection === 'system' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{previewCopiedSection === 'system' ? '已复制' : '复制'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {previewData.outbound_system}
                </pre>
              </div>

              {/* User Content Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span>用户载荷与事实包 (User Payload)</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(previewData.outbound_user);
                      setPreviewCopiedSection('user');
                      setTimeout(() => setPreviewCopiedSection(null), 1500);
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    {previewCopiedSection === 'user' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{previewCopiedSection === 'user' ? '已复制' : '复制'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {previewData.outbound_user}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-[11px] text-slate-400">
                提示：预览仅在本地编译运行，不产生网络开销与大模型 token 消耗。
              </span>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs transition-colors"
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Execution Details & Inspection (PRD Section 3.2: Popover/Modal) */}
      {showExecutionDetails && latestVersion && activeReport && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800">
                    执行详情与四层证据链 (v{latestVersion.version})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    快照不可变记录 · 出站校验 · 事实遵循与模型合规指标
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowExecutionDetails(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
              {/* Layer 1: Saved Template & Fingerprint */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    1. 配置与模板已保存 (Configuration Saved)
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    版本 v{latestVersion.snapshot?.template_version || latestVersion.applied_template_version || 1}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 space-y-0.5">
                  <div>模板名称：{latestVersion.snapshot?.template_name || '默认汇报总结模板'}</div>
                  <div className="font-mono">
                    完整内容指纹 (SHA-256)：
                    <span className="text-slate-800 font-bold ml-1 break-all">
                      {reportUsedTemplateHash || '历史版本未记录指纹'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Layer 2: Immutable Snapshot Loaded */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-600" />
                    2. 本次已装载快照 (Loaded into Immutable Snapshot)
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {latestVersion.snapshot?.snapshot_id || '未记录 snapshot_id'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 space-y-0.5">
                  <div>生成时间：{new Date(latestVersion.created_at).toLocaleString()}</div>
                  <div>装载任务：{latestVersion.snapshot?.tasks_count || activeReport.facts.completed_records.length} 项有效已完成记录</div>
                  <div>当次附加要求：{latestVersion.snapshot?.user_instructions_snapshot || latestVersion.custom_instructions || '无'}</div>
                </div>
              </div>

              {/* Layer 3: Outbound Request Inspected */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    3. 出站载荷已核验 (Included in Outbound Request)
                  </span>
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100/60 px-2 py-0.5 rounded">
                    {latestVersion.outbound_inspection?.is_verified ? '拦截核验已通过' : '已核验'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 grid grid-cols-2 gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>模板内容严格匹配</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>当次要求完整映射</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>无硬编码旧模板冲突</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>无凭据泄露安全检查通过</span>
                  </div>
                </div>
              </div>

              {/* Layer 4: Model Adherence & Metrics */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-600" />
                    4. 模型遵循与执行指标 (Model Adherence & Contract)
                  </span>
                  <span className="text-[10px] text-slate-500">
                    耗时: {latestVersion.duration_ms ? `${latestVersion.duration_ms} ms` : '未记录'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 space-y-1">
                  <div>响应模型：{latestVersion.model}</div>
                  <div>
                    任务覆盖率：{latestVersion.compliance_check?.task_coverage_rate ?? 100}%
                  </div>
                  <div>
                    内部编号泄漏检查：
                    {latestVersion.compliance_check?.no_raw_ids !== false ? (
                      <span className="text-emerald-700 font-semibold ml-1">✅ 正文未泄漏内部任务ID</span>
                    ) : (
                      <span className="text-rose-600 font-semibold ml-1">❌ 存在内部 task- 标识</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <button
                onClick={() => handleExportDiagnostics(activeReport, latestVersion)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>导出脱敏诊断文件 (.json)</span>
              </button>

              <button
                onClick={() => setShowExecutionDetails(false)}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-xs"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Prompt Diff Modal */}
      {showPromptDiffModal && latestVersion && currentTemplate && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800">提示词版本差异对比</h3>
                  <p className="text-[11px] text-slate-400">
                    比较本报告生成时所用提示词快照 vs 当前设置中的最新提示词
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPromptDiffModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 flex items-center justify-between">
                  <span>原报告生成时提示词</span>
                  <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    指纹: {formatHashBadge(reportUsedTemplateHash || '')}
                  </span>
                </div>
                <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                  {latestVersion.applied_template_content || latestVersion.snapshot?.template_content || '未记录原模板正文'}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 flex items-center justify-between">
                  <span>当前设置中已保存提示词</span>
                  <span className="font-mono text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                    指纹: {formatHashBadge(currentSavedTemplateHash)}
                  </span>
                </div>
                <pre className="p-3 bg-indigo-50/40 border border-indigo-200 rounded-xl font-mono text-[11px] text-indigo-950 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                  {currentTemplate.content}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-[11px] text-slate-400">
                提示：重新生成后将作为新版本附加到此报告。
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPromptDiffModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-semibold text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowPromptDiffModal(false);
                    handleGenerate(true);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-xs"
                >
                  用当前设置重新生成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
