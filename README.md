# TodoTree - 个人树状任务管理系统 (v1.1)

> 深度工作分解、四象限决策、今日聚焦与智能复盘四位一体的个人树状任务管理工具。支持纯离线单文件运行与 Windows 原生免安装桌面宿主。

---

## 🌟 核心特性与架构全景

### 1. 树状大纲与多重视图一体化
- **无限层级结构**：父子任务树状大纲展开，支持直观的折叠/展开、拖拽重排与树状连接线；具备最大 5 层深度防护与循环引用检测。
- **三种主视图无缝切换**：
  - **树状大纲 (Tree View)**：结构化梳理目标与子任务层级。
  - **清单视图 (List View)**：扁平化清单展示所有活动任务。
  - **项目分组视图 (Project Group View)**：按顶层根项目汇聚归类。
- **四象限看板 (Quadrant Workspace)**：
  - 基于艾森豪威尔法则（重要且紧急 Q1、重要不紧急 Q2、紧急不重要 Q3、不重要不紧急 Q4）。
  - **260px 未分类侧滑抽屉**：默认收起，顶部工具栏提供「未分类 (N)」按需展开，避免侵占主看板空间；象限空态紧凑化至 180–220px。
- **全部任务精细化体验**：
  - 单行紧凑工具栏，支持组合筛选（关键词、四象限、截止周期、项目）；
  - 支持快捷「象限速览」抽屉随时调出；
  - **4 种独立空状态引导**：暂无任何任务（引导快捷新建或模板）、当前筛选无结果（引导一键清空筛选）、分类下暂无任务（引导在此分类下录入）、全部任务已完成（庆贺插画与归档入口）；
  - 底部快速录入栏固定 46px 紧凑高度，预留安全防遮挡内边距。

### 2. 今日执行与完成日历 (TodayView Completion Calendar)
- **双 Tab 视图**：在「今天」入口中提供「今日执行 | 完成日历」切换与今日成就速览。
- **标准 42 格月历网格**：
  - 严格 6 行 × 7 列（周一至周日完整对齐），包含上月补齐与下月补齐；
  - 精确映射用户本地时区（默认 `Asia/Shanghai`）。
- **严格分离叶子完成与分支闭环**：
  - 绿色「完成 N 条」（叶子节点任务）与蓝色「闭环 M 项」（上级父任务分支）独立呈现，**禁止加总混淆**；
  - 格内高频任务预览上限限制为 2 条，多出部分折叠为 `+N` 紧凑徽标。
- **日详情抽屉 (Day Details Panel)**：
  - 点击单元格展开按所属项目分组的完成清单；
  - 清晰呈现精确完成时点、完成方式徽标（手动勾选 / 自动闭环）及产出备注（Outcome Note）；
  - 撤销（Undo）或恢复（Restore）操作时，日历完成数即时精确扣减。

### 3. 流畅退场动效与极速性能 (P0)
- **批量事件原子写入**：
  - 采用 `logTaskCompletionsBatch` 与 `logTaskUncompletionsBatch`，彻底消除分支完成时逐个记录导致的 N+1 次并发磁盘/HTTP 写入；
  - 整树分支完成耗时从 >180ms 压缩至 **< 10ms**。
- **单一阶段渐隐平移退场动效**：
  - 废弃复杂的阶梯式坍塌，采用 `opacity-0 -translate-y-1` 整组 200ms (`cubic-bezier(0.4, 0, 0.2, 1)`) 退出过渡；
  - 内置 400ms 安全保底定时器，防止极端动画丢失产生幽灵节点；
  - 开启减弱动效 (`reduced_motion`) 时动画时长自动置为 0ms 瞬间离场。

### 4. 全局右侧单辅助面板容器规范 (Single Auxiliary Panel)
- **420px 统一侧滑容器**：统一接管任务详情抽屉、已完成记录抽屉、历史复盘报告抽屉与四象限速览。
- **绝对互斥规范**：同一时刻有且仅有一个抽屉展开。打开任一新抽屉时平滑切换，绝不堆叠多层抽屉，主工作区宽度保持稳定。

### 5. 事实驱动的工作复盘 (Work Review)
- **1-2 行紧凑型操作台**：集成周期快捷切换（本周/上周/本月/上月/自定义）。
- **单主按钮动态状态机**：移除并排冗余按钮，同一时刻仅呈现 1 个主按钮（生成报告 / 更新报告 / 重新生成 / 正在调用大模型生成报告… / 重试生成）。
- **阅读优先正文容器**：报告正文容器限制在 760–960px 舒适阅读区，正文字体 15px，行高 26px。
- **低频检视弹窗**：出站载荷预览、提示词快照与哈希防篡改指纹收敛至检视弹窗。

### 6. 数据安全与桌面级稳定性保障
- **双通道本地持久化**：原生 HTTP API + IndexedDB + LocalStorage，断网完全离线运行。
- **文件原子写入与备份**：写入 `.tmp` 成功后保留 `.bak` 备份并原子替换，确保 `tasks.json` 等绝不产生空文件或数据损坏。
- **单实例独占守护**：Windows 命名互斥体 `Local\TodoTree_SingleInstance_Mutex_2026` 确保单实例运行，避免多进程抢占端口与覆盖数据。
- **有限指数退避重试**：心跳服务断连时按 1s/2s/4s/8s/15s 有限重试 5 次，5 次后转入静态诊断态并支持一键复制诊断日志；监听页面 `beforeunload`，防止页面 F5 刷新时误报断连。
- **增量撤销重做 (Undo/Redo)**：支持最多 50 步操作撤销（`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`），只记录字段级 Diff，不存全量快照。
- **软删除安全回收站**：保留原删除批次与时间戳，支持单项/批次彻底粉碎与整树恢复。

---

## 嵌套任务与闭环更新

- 已完成子任务可划线保留，通过「搞定」单独归档；全部子任务完成时父分支自动归档。
- 嵌套新增支持最多 5 层，在已完成节点下新增时自动重新开启父链。
- 执行 `npm test` 运行真实业务模块与 React 交互回归测试。
- [行为、验证与 Windows 重新打包说明](docs/nested-task-closure.md)。现有 EXE 需重新编译后才包含本次修改。

## 🚀 快速启动与使用

### 方式一：Windows 原生桌面免安装版 (推荐)
直接双击项目根目录下的 **`TodoTree.exe`** 即可启动。
- 采用轻量 C# / .NET 4.0 原生宿主，单文件自包含。
- 自动检测并启动本地轻量 HTTP 服务，自动调用 Edge/Chrome 现代浏览器窗口。

### 方式二：纯静态单文件极速版
直接双击打开根目录下的 **`TodoTree_一键直达.html`**。
- 全应用所有 HTML、CSS 样式、JS 逻辑与图标均内联于单文件中。
- 无需任何后端环境或网络连接，数据自动持久化于浏览器 LocalStorage。

### 方式三：源码本地开发
```bash
# 1. 安装项目依赖
npm install

# 2. 启动 Vite 开发服务器 (支持热重载)
npm run dev

# 3. 生产环境编译打包
npm run build

# 4. 生成单文件 HTML
node bundle-singlefile.mjs
```

### 方式四：编译桌面宿主 EXE (Windows)
使用 Windows 自带的 .NET Framework C# 编译器编译宿主程序：
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /r:System.Web.Extensions.dll /out:TodoTree.exe /resource:dist\TodoTree_一键直达.html desktop-host\Program.cs desktop-host\DurableWorkspace.cs
```

---

## 📁 项目目录结构

```text
todotree/
├── desktop-host/               # C# 原生桌面宿主源码
│   └── Program.cs              # 单实例互斥、端口自适应、HTTP API 服务与文件原子写入
├── src/                        # 前端 React + TypeScript 核心源码
│   ├── components/             # UI 组件库
│   │   ├── AuxiliaryPanel/     # 统一 420px 互斥辅助侧边栏容器
│   │   ├── CompletedDrawer/    # 已完成任务抽屉
│   │   ├── CompletedView/      # 已完成专属视图
│   │   ├── Quadrant/           # 四象限看板与 260px 未分类侧滑抽屉
│   │   ├── TaskDrawer/         # 任务详情编辑抽屉
│   │   ├── TaskTree/           # 任务树核心组件 (过滤器、树节点行、空态)
│   │   ├── TodayView/          # 今日执行与 42 格完成日历核心组件
│   │   ├── TrashView/          # 回收站与批次恢复组件
│   │   ├── WorkReview/         # 工作复盘视图与报告历史面板
│   │   ├── Header.tsx          # 64-72px 标准顶栏
│   │   ├── Sidebar.tsx         # 208px 标准侧边栏
│   │   ├── QuickInputBar.tsx   # 46px 紧凑快速录入栏
│   │   └── Toast.tsx           # 右下角浮动提示组件
│   ├── services/               # 业务逻辑与数据驱动层
│   │   ├── ai/                 # AI 复盘事实包引擎、提示词、报告服务与批量事件日志
│   │   ├── calendarService.ts  # 42 格月历网格生成、时区转换与项目分组
│   │   ├── storage.ts          # 本地存储双通道读写与多标签页锁
│   │   ├── treeOperations.ts   # 树深度、祖先链、移动校验算法
│   │   └── undoManager.ts      # 50 步增量撤销重做管理器
│   ├── types/                  # TypeScript 类型定义 (todo.ts, ai.ts)
│   ├── App.tsx                 # 顶层状态协调器与单辅助面板管理器
│   └── main.tsx                # React 挂载入口
├── tests/                      # 自动化测试套件
│   ├── run_v1_1_merged_tests.mjs          # 完成日历、动效退场性能、UI 规范验收测试
│   ├── run_stability_and_archive_tests.mjs# 服务连接稳定性与父子闭环递归测试
│   ├── run_incremental_v1_1_tests.mjs     # 组合筛选过滤、原位录入与二次确认测试
│   ├── run_ai_tests.mjs                   # AI 事实包引擎与模型校验测试
│   ├── run_v1_1_tests.mjs                 # 增量撤销栈与字段 Diff 测试
│   ├── run_v1_2_tests.mjs                 # 软删除批次与孤儿恢复测试
│   └── run_v1_3_tests.mjs                 # 提示词指纹与视图切换测试
├── bundle-singlefile.mjs       # 单文件内联打包构建脚本
├── TodoTree.exe                # 预编译 Windows 原生可执行程序
├── package.json                # 项目依赖与脚本配置
├── tailwind.config.js          # Tailwind CSS 样式配置
├── tsconfig.json               # TypeScript 编译配置
└── vite.config.ts              # Vite 构建设定
```

---

## 🧪 自动化测试与质量保障

项目全量包含 **8 大自动化测试套件，共计 91 项测试，100% 全部通过**：

```bash
# 运行稀疏信息工作总结与新增子节点失效修复测试 (PRD v1.1 CH01-CH11 & AI01-AI12)
node tests/run_v1_1_sparse_ai_and_subtask_tests.mjs

# 运行增量合并测试 (日历算法、退场时序、UI 互斥规范)
node tests/run_v1_1_merged_tests.mjs

# 运行稳定性与归档退出测试
node tests/run_stability_and_archive_tests.mjs

# 运行组合检索与原位录入测试
node tests/run_incremental_v1_1_tests.mjs

# 运行 AI 事实包与额度校验测试
node tests/run_ai_tests.mjs

# 运行撤销重做栈与 Diff 测试
node tests/run_v1_1_tests.mjs

# 运行回收站软删除与孤儿恢复测试
node tests/run_v1_2_tests.mjs

# 运行提示词指纹与检视器测试
node tests/run_v1_3_tests.mjs
```

---

## 🛠 技术栈

- **前端核心**：React 18 + TypeScript + Vite 6
- **样式与动效**：Tailwind CSS + Lucide Icons + Canvas-Confetti
- **桌面原生宿主**：C# / .NET Framework 4.0 (`HttpListener` + Win32 Mutex)
- **本地存储**：IndexedDB + LocalStorage + 本地 JSON 文件原子落盘

---

## 📄 授权与许可

本项目采用 [MIT 许可证](LICENSE) 开源。

## Persistence and multi-select update

See [migration, recovery, batch operations and Windows validation](docs/persistence-and-bulk-operations.md). The new host requires `System.Web.Extensions.dll` and `desktop-host/DurableWorkspace.cs` when compiling. The previously tracked EXE and dist files are not this source revision; rebuild before distributing.
