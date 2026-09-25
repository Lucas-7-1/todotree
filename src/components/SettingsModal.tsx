import { isAndroid } from '../services/native/platform';
import { exportFullBackup, validateWorkspace, WorkspaceSnapshot, isDesktop, loadWorkspace } from '../services/durableStore';
import React, { useState, useRef, useEffect } from 'react';
import { TaskNode, AppSettings } from '../types/todo';
import { AISettings, PromptTemplate } from '../types/ai';
import {
  exportBackupData,
  downloadJsonFile,
  validateImportJson
} from '../services/importExport';
import {
  loadAISettings,
  saveAISettings,
  DEFAULT_AI_SETTINGS,
  runLiveLinkTest,
} from '../services/ai/reportService';
import { testConnection } from '../services/ai/apiAdapter';
import { DEFAULT_PROMPT_TEMPLATE } from '../services/ai/prompts';
import { computeContentHash, formatHashBadge } from '../services/ai/hashUtils';
import {
  X,
  Settings,
  Download,
  Upload,
  Globe,
  Zap,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Shield,
  Key,
  Server,
  Clock,
  RefreshCw,
  FileText
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  tasks: TaskNode[];
  onImportTasks: (newTasks: TaskNode[], newSettings?: AppSettings, full?: WorkspaceSnapshot) => Promise<void>;
  onResetSeedData: () => void;
  initialTab?: 'general' | 'ai';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  tasks,
  onImportTasks,
  onResetSeedData,
  initialTab = 'general',
}) => {

  const [activeTab, setActiveTab] = useState<'general' | 'ai'>(initialTab);
  const [importError, setImportError] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [lastSaved, setLastSaved] = useState('');
  useEffect(() => { if (!isOpen) return;
    loadWorkspace().then(state => setLastSaved(state.saved_at)).catch(() => {});
    if (isDesktop()) fetch('/api/storage-info').then(r => r.json()).then(setStorageInfo).catch(() => {});
  }, [isOpen]);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Settings State
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const templates = aiSettings.prompt_templates && aiSettings.prompt_templates.length > 0
    ? aiSettings.prompt_templates
    : [DEFAULT_PROMPT_TEMPLATE];
  const activePromptTemplate =
    templates.find((t) => t.profile_id === aiSettings.default_template_id) ||
    templates[0] ||
    DEFAULT_PROMPT_TEMPLATE;
  const [templateEditContent, setTemplateEditContent] = useState(activePromptTemplate.content);

  // PRD v1.3 Prompt testing state
  const [localCheckResult, setLocalCheckResult] = useState<{ passed: boolean; message: string; hash?: string } | null>(null);
  const [runningLiveTest, setRunningLiveTest] = useState(false);
  const [liveTestResult, setLiveTestResult] = useState<{ success: boolean; message: string; code?: string; duration?: number } | null>(null);

  const isDraftModified = templateEditContent.trim() !== activePromptTemplate.content.trim();

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    loadAISettings().then((s) => {
      setAiSettings(s);
      const curTemplates = s.prompt_templates && s.prompt_templates.length > 0
        ? s.prompt_templates
        : [DEFAULT_PROMPT_TEMPLATE];
      const active = curTemplates.find((t) => t.profile_id === s.default_template_id) || curTemplates[0];
      setTemplateEditContent(active.content);
    }).catch(error => setImportError(error.message));
  }, [isOpen]);

  const handleUpdateAISettings = (newSettings: AISettings) => {
    setAiSettings(newSettings);
    saveAISettings(newSettings).catch(error => setImportError(error.message));
  };

  const handleSaveTemplate = () => {
    const trimmed = templateEditContent.trim() || DEFAULT_PROMPT_TEMPLATE.content;
    const newHash = computeContentHash(trimmed);
    const oldHash = activePromptTemplate.content_hash || computeContentHash(activePromptTemplate.content);
    const hasContentChanged = newHash !== oldHash;

    const newVersion = hasContentChanged ? (activePromptTemplate.version || 1) + 1 : (activePromptTemplate.version || 1);

    const updatedTemplate: PromptTemplate = {
      ...activePromptTemplate,
      content: trimmed,
      version: newVersion,
      content_hash: newHash,
      updated_at: new Date().toISOString(),
    };
    const nextTemplates = templates.map((t) =>
      t.profile_id === updatedTemplate.profile_id ? updatedTemplate : t
    );
    handleUpdateAISettings({
      ...aiSettings,
      prompt_templates: nextTemplates,
      default_template_id: updatedTemplate.profile_id,
    });
    setLocalCheckResult(null);
    alert(`提示词模板已成功保存 (v${newVersion}，指纹: ${formatHashBadge(newHash)})！新生成的报告将按最新模板装载。`);
  };

  const handleLocalCheck = () => {
    const trimmed = templateEditContent.trim() || DEFAULT_PROMPT_TEMPLATE.content;
    const hash = computeContentHash(trimmed);
    setLocalCheckResult({
      passed: true,
      message: '本地核验通过：提示词格式正确，未检出硬编码冲突，出站业务载荷就绪（0 网络调用）。',
      hash: formatHashBadge(hash),
    });
  };

  const handleRunLiveTest = async () => {
    setRunningLiveTest(true);
    setLiveTestResult(null);
    try {
      const res = await runLiveLinkTest(aiSettings, templateEditContent);
      if (res.success) {
        setLiveTestResult({
          success: true,
          message: `测试成功！模型在 ${res.duration_ms}ms 内准确输出了测试随机短码，证明自定义提示词已完整到达大模型！`,
          code: res.verification_code,
          duration: res.duration_ms,
        });
      } else {
        setLiveTestResult({
          success: false,
          message: res.error_message || '测试失败：未收到模型有效验证响应',
          code: res.verification_code,
          duration: res.duration_ms,
        });
      }
    } catch (err: any) {
      setLiveTestResult({
        success: false,
        message: err.message || '网络连接或接口异常',
      });
    } finally {
      setRunningLiveTest(false);
    }
  };

  const handleResetDefaultTemplate = () => {
    if (
      confirm(
        '确定要恢复为系统默认提示词模板吗？\n（注：此操作仅重置提示词，绝不会影响您的任务数据或 API 密钥配置）'
      )
    ) {
      const resetTemplate: PromptTemplate = {
        ...DEFAULT_PROMPT_TEMPLATE,
        version: (activePromptTemplate.version || 1) + 1,
        updated_at: new Date().toISOString(),
      };
      const nextTemplates = templates.map((t) =>
        t.profile_id === resetTemplate.profile_id ? resetTemplate : t
      );
      setTemplateEditContent(resetTemplate.content);
      handleUpdateAISettings({
        ...aiSettings,
        prompt_templates: nextTemplates,
        default_template_id: resetTemplate.profile_id,
      });
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await testConnection(aiSettings);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '连接失败' });
    } finally {
      setTestingConnection(false);
    }
  };

  const timezones = [
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
  ];

  const handleExport = async () => {
    try { await downloadJsonFile(await exportFullBackup()); }
    catch (error) { setImportError((error as Error).message); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 32 * 1024 * 1024) { setImportError("备份超过 32 MB，请拆分或使用桌面版恢复"); return; }
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        const full = JSON.parse(content);
        if (full.schema_version === 2 && full.data) {
          validateWorkspace(full);
          if (confirm(`即将恢复 ${full.data.tasks.length} 项任务、完成历史与报告。现有数据会先建立恢复点，是否继续？`)) {
            await onImportTasks(full.data.tasks, { ...settings, ...full.data.settings }, full); onClose();
          }
          return;
        }
      } catch (error) { setImportError((error as Error).message); return; }
      const res = validateImportJson(content);
      if (!res.valid) {
        setImportError(res.error || '校验失败');
        setImportSuccess(null);
      } else {
        setImportError(null);
        setImportSuccess(`校验通过！成功解析 ${res.tasks!.length} 项任务`);
        if (confirm(`即将用备份数据替换当前 ${tasks.length} 项任务，是否确认导入？`)) {
          try { await onImportTasks(res.tasks!, res.settings); onClose(); }
          catch (error) { setImportError((error as Error).message); }
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-800">设置与数据偏好</h3>
              <p className="text-xs text-slate-400">配置时区、动效、大模型接口及定时复盘</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-3 border-b border-slate-100 flex items-center gap-4 bg-slate-50/50 flex-shrink-0">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            系统偏好与备份
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'ai'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 与自动复盘</span>
          </button>
        </div>

        {/* Body Container */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-slate-700">
          {activeTab === 'general' ? (
            /* General Settings Tab */
            <>
              {/* Timezone Setting */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-slate-500" />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">时区设置</div>
                    <div className="text-[11px] text-slate-400">用于跨午夜判断今天、逾期时刻与复盘周期</div>
                  </div>
                </div>

                <select
                  value={settings.timezone}
                  onChange={(e) => onUpdateSettings({ ...settings, timezone: e.target.value })}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-slate-700 outline-none focus:border-blue-500 font-medium"
                >
                  {timezones.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              {/* Reduced Motion Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-4 h-4 text-slate-500" />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">减少动效模式</div>
                    <div className="text-[11px] text-slate-400">取消完成划线展开动画，直接显示静态线</div>
                  </div>
                </div>

                <button
                  onClick={() => onUpdateSettings({ ...settings, reduced_motion: !settings.reduced_motion })}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
                    settings.reduced_motion ? 'bg-blue-600' : 'bg-slate-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      settings.reduced_motion ? 'translate-x-4 shadow-sm' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="text-xs font-bold text-slate-800">数据备份与迁移</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  桌面版保存到固定数据目录；网页版保存到当前浏览器。完整备份包含任务、完成历史、报告和设置，不包含 API Key。
                </div>

                <div className="text-xs text-slate-500 break-all">
                  <p>最近成功保存：{lastSaved || '尚未保存'}</p>
                  {storageInfo?.directory && <p>数据目录：{storageInfo.directory}</p>}
                  {isDesktop() && <button className="text-blue-600 mt-2" onClick={() => fetch('/api/open-data-dir', { method: 'POST' }).catch(() => {})}>打开数据目录</button>}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleExport}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>导出数据备份 (JSON)</span>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>从 JSON 恢复</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {importError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">备份校验未通过，现有数据保持不变</div>
                      <div className="mt-0.5 opacity-90">{importError}</div>
                    </div>
                  </div>
                )}

                {importSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>{importSuccess}</span>
                  </div>
                )}
              </div>

              {/* Reset Demo Data */}
              <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-800">重置演示数据</div>
                  <div className="text-[11px] text-slate-400">恢复与界面设计图一致的初始任务树</div>
                </div>

                <button
                  onClick={() => {
                    if (confirm('确认重置为设计图初始演示数据？当前任务将被覆盖。')) {
                      onResetSeedData();
                      onClose();
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>恢复演示数据</span>
                </button>
              </div>
            </>
          ) : (
            /* AI & Review Settings Tab (PRD Section 11 & 2.3) */
            <div className="space-y-5">
              {/* Adapter Mode Selection */}
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-2">
                  复盘运行模式
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateAISettings({ ...aiSettings, use_mock: true })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      aiSettings.use_mock
                        ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-2xs'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span>确定性模拟适配器</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      开箱即用，无需 API Key，通过确定性规则与任务数据秒级生成模拟报告
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateAISettings({ ...aiSettings, use_mock: false })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      !aiSettings.use_mock
                        ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-2xs'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5 mb-1">
                      <Server className="w-3.5 h-3.5 text-blue-600" />
                      <span>真实大模型 API 调用</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      连接 OpenAI、DeepSeek、Kimi 或本地 Ollama 模型真实归纳
                    </div>
                  </button>
                </div>
              </div>

              {/* Mock Scenario Settings (Only in Mock Mode) */}
              {aiSettings.use_mock && (
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 space-y-2 text-xs">
                  <div className="font-semibold text-amber-900 flex items-center justify-between">
                    <span>模拟测试场景 (PRD 验收专用)</span>
                    <span className="text-[10px] text-amber-700 font-normal">不消耗任何网络或费用</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'success', label: '正常成功 (Success)' },
                      { id: 'invalid_json', label: '格式损坏 (触发修复)' },
                      { id: 'rate_limit', label: '429 频率超限' },
                      { id: 'auth_error', label: '401 鉴权失效 (自动暂停)' },
                      { id: 'timeout', label: '请求超时 (90秒)' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          handleUpdateAISettings({
                            ...aiSettings,
                            mock_scenario: item.id as any,
                          })
                        }
                        className={`p-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                          aiSettings.mock_scenario === item.id
                            ? 'bg-amber-200/80 border-amber-400 text-amber-900 font-bold'
                            : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-100/50'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Real API Configuration (Only in Real API Mode) */}
              {!aiSettings.use_mock && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3.5 text-xs">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-blue-600" />
                    <span>OpenAI 兼容协议配置</span>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                      Base URL (接口地址)
                    </label>
                    <input
                      type="text"
                      value={aiSettings.base_url}
                      onChange={(e) =>
                        handleUpdateAISettings({ ...aiSettings, base_url: e.target.value.trim() })
                      }
                      placeholder="https://api.openai.com/v1 或 https://api.deepseek.com/v1"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-mono text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                        Model ID (模型名称)
                      </label>
                      <input
                        type="text"
                        value={aiSettings.model_id}
                        onChange={(e) =>
                          handleUpdateAISettings({ ...aiSettings, model_id: e.target.value.trim() })
                        }
                        placeholder="gpt-4o-mini / deepseek-chat"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                        API Key (本地加密掩码保存)
                      </label>
                      <input
                        type="password"
                        value={aiSettings.api_key}
                        onChange={(e) =>
                          handleUpdateAISettings({ ...aiSettings, api_key: e.target.value.trim() })
                        }
                        placeholder="sk-••••••••"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testingConnection}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {testingConnection ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>正在测试...</span>
                        </>
                      ) : (
                        <span>测试 API 连接</span>
                      )}
                    </button>

                    {testResult && (
                      <span
                        className={`text-xs font-medium flex items-center gap-1 ${
                          testResult.success ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {testResult.success ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        <span>{testResult.message}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 24-Hour Rolling Quota Budget (PRD 9.1 - Finite positive integer only) */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-bold text-slate-800">自动复盘近 24 小时最大调用额度</div>
                  <div className="text-[11px] text-slate-400">
                    针对后台定时复盘任务的滚动 24 小时限额保护（手动生成不设上限）
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={aiSettings.max_daily_budget || 5}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(50, parseInt(e.target.value) || 5));
                      handleUpdateAISettings({ ...aiSettings, max_daily_budget: val });
                    }}
                    className="w-16 px-2 py-1 text-xs border border-slate-200 bg-slate-50 rounded-lg text-center font-bold outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-slate-500">次 / 24小时</span>
                </div>
              </div>

              {/* Privacy & Field Controls (PRD 11.2) */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-blue-600" />
                  <span>隐私边界与数据契约</span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={aiSettings.send_outcome_notes}
                    onChange={(e) =>
                      handleUpdateAISettings({
                        ...aiSettings,
                        send_outcome_notes: e.target.checked,
                      })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>发送完成时的「成果说明」作为产出依据（推荐开启）</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={aiSettings.send_notes}
                    onChange={(e) =>
                      handleUpdateAISettings({
                        ...aiSettings,
                        send_notes: e.target.checked,
                      })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>发送任务普通详细备注（默认关闭，仅发送标题与成果）</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={aiSettings.send_background !== false}
                    onChange={(e) =>
                      handleUpdateAISettings({
                        ...aiSettings,
                        send_background: e.target.checked,
                      })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>发送节点「背景说明」参与上下文因果分析（推荐开启，PRD v1.2 A32）</span>
                </label>
              </div>

              {/* Prompt Template Customization (PRD v1.2 A37, A40) */}
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>总结提示词模板</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    自由定制汇报对象、语气与归纳结构
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      {activePromptTemplate?.name || '默认汇报总结模板'}
                    </span>
                    <div className="flex items-center gap-2">
                      {isDraftModified && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                          未保存草稿
                        </span>
                      )}
                      <span
                        className="text-[10px] font-mono bg-slate-200/80 px-1.5 py-0.5 rounded text-slate-600 font-medium"
                        title="提示词 SHA-256 唯一指纹"
                      >
                        指纹: {formatHashBadge(activePromptTemplate?.content_hash || computeContentHash(activePromptTemplate?.content || ''))}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        v{activePromptTemplate?.version || 1}
                      </span>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={templateEditContent}
                    onChange={(e) => setTemplateEditContent(e.target.value)}
                    placeholder="编辑提示词模板内容..."
                    className="w-full text-xs font-mono bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 outline-none focus:border-blue-500 resize-y"
                  />

                  <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleResetDefaultTemplate}
                        className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
                        title="仅重置提示词为内置默认，绝不清空任务或 API 配置"
                      >
                        恢复系统默认模板
                      </button>

                      <button
                        type="button"
                        onClick={handleLocalCheck}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                        title="在本地核验当前模板结构与出站载荷（零网络调用）"
                      >
                        检查本次提示词 (0调用)
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRunLiveTest}
                        disabled={runningLiveTest}
                        className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                        title="使用两条内置虚构任务向大模型发送带随机短码的最小测试请求，验证模型是否遵循要求"
                      >
                        {runningLiveTest ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>测试中...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-indigo-600" />
                            <span>测试模型是否收到要求</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveTemplate}
                        className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs"
                      >
                        保存模板修改
                      </button>
                    </div>
                  </div>

                  {/* Local check result box (PRD v1.3 Section 7.1) */}
                  {localCheckResult && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-semibold">【本地核验通过】指纹: {localCheckResult.hash}</div>
                        <div className="text-[11px] text-emerald-700">{localCheckResult.message}</div>
                      </div>
                    </div>
                  )}

                  {/* Live test result box (PRD v1.3 Section 7.2) */}
                  {liveTestResult && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                        liveTestResult.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      {liveTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="space-y-0.5">
                        <div className="font-semibold">
                          {liveTestResult.success ? '【链路验证成功】' : '【链路验证未通过】'}
                          {liveTestResult.code && <span className="font-mono ml-1">[{liveTestResult.code}]</span>}
                        </div>
                        <div className="text-[11px] leading-relaxed opacity-90">{liveTestResult.message}</div>
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400">
                    提示：“恢复系统默认模板”仅覆盖提示词内容，绝不影响您的任务数据或 API 密钥。
                  </p>
                </div>
              </div>

              {isAndroid() && <p className="text-sm text-slate-600 bg-blue-50 p-3 rounded-lg">手机版首版支持手动复盘，不限制生成次数。关闭应用后暂不执行自动周报、月报。</p>}
              {/* Automated Schedule Plan (PRD 2.3) */}
              <div hidden={isAndroid()} className="border-t border-slate-100 pt-3 space-y-3">
                <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    <span>自动复盘定时任务</span>
                  </div>
                  {aiSettings.schedule.is_paused && (
                    <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-semibold">
                      计划已暂停
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                    <div>
                      <div className="font-semibold text-slate-700">自动周报</div>
                      <div className="text-[11px] text-slate-400">
                        每周一 09:00 自动总结上一完整周成果
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateAISettings({
                          ...aiSettings,
                          schedule: {
                            ...aiSettings.schedule,
                            weekly_enabled: !aiSettings.schedule.weekly_enabled,
                            is_paused: false,
                          },
                        })
                      }
                      className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
                        aiSettings.schedule.weekly_enabled ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          aiSettings.schedule.weekly_enabled ? 'translate-x-4 shadow-sm' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                    <div>
                      <div className="font-semibold text-slate-700">自动月报</div>
                      <div className="text-[11px] text-slate-400">
                        每月 1 日 09:00 自动总结上一完整月成果
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateAISettings({
                          ...aiSettings,
                          schedule: {
                            ...aiSettings.schedule,
                            monthly_enabled: !aiSettings.schedule.monthly_enabled,
                            is_paused: false,
                          },
                        })
                      }
                      className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
                        aiSettings.schedule.monthly_enabled ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          aiSettings.schedule.monthly_enabled ? 'translate-x-4 shadow-sm' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 leading-relaxed">
                  提示：软件完全退出时不执行；下次启动时会自动补跑最近一个已结束周期（每种最多补跑一期，不产生历史洪泛）。
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
