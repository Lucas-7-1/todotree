# TodoTree Android 首版

基于 `gpt-6-persistence-multiselect-20260924` 的独立 Android 分支。复用桌面任务生命周期，不依赖 Windows 宿主或局域网电脑。

## 已实现

- Capacitor 8 / Android，应用 ID `com.lucas.todotree`，Android 7.0（API 24）及以上。
- 底部导航：今天、任务、四象限、复盘、更多；全屏任务详情、已完成抽屉；小屏单列象限。
- 子节点原位输入支持可点击“保存”；点击“多选”或长按任务行进入多选，滚动手势取消长按。
- 复用父子闭环、划线保留、“搞定”、批量操作、撤销和完成日历。
- Android SQLite 独立存储，任务和完成事件同事务写入；revision 校验、operation_id 幂等重试；仅变更记录跨原生桥及写盘。
- 保存失败暂停编辑，并提供待恢复副本导出。新版本不得在读取失败时用空数据覆盖数据库。
- API Key 使用 Android Keystore AES-GCM 加密后存储；不写入 WebView localStorage，不进入备份文件。模型调用经原生 HTTPS，禁止带凭据跨站重定向，支持超时和取消。
- 系统文件选择器导入 JSON 备份；系统“另存为”导出完整备份、Markdown 和诊断文件。不申请整个手机存储空间权限。
- 导入前恢复点和每日首次写入前快照保存在应用内部，合计保留最新 14 份。不等同于手机外备份。

## 当前边界

- 手机与电脑不自动同步；使用设置里的完整备份导入/导出迁移。导入会替换手机现有工作区，不是合并。
- 首版只支持手动 AI 复盘。关闭应用后不承诺定时执行；自动计划控件在 Android 隐藏，服务层拒绝 scheduled 调用。
- AI 默认仍是明确标记的本地模拟模式。使用真实模型需在设置中关闭模拟并填写 HTTPS 地址、模型名和自己的 Key。
- SQLite 数据在正常关闭、重启手机后保留；卸载或清除应用数据会删除本地数据库和内部快照。请定期将 JSON 备份导出到应用之外。
- 初次加载仍读取完整工作区到内存；增量写入减少桥接和磁盘开销，但不是无限数据量的性能保证。
- 已做 TypeScript、Web 构建和自动化回归；Android 真机的键盘、返回键、权限选择器、断电恢复和升级保留数据需要验收。未验收项不可宣称通过。

## 本地编译

需要 Node 22+、JDK 21、Android SDK 36 / build-tools 36。

```sh
npm ci
npm test
npm run android:sync
cd android
./gradlew assembleDebug
```

Debug 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。
正式安装包用 `assembleRelease`，配置以下环境变量：

- TODOTREE_KEYSTORE：仓库外密钥文件路径
- TODOTREE_STORE_PASSWORD
- TODOTREE_KEY_ALIAS：默认 todotree
- TODOTREE_KEY_PASSWORD

未配置密钥时 release 输出未签名包，不能直接安装。密钥、密码不得放进仓库。后续更新必须沿用同一应用 ID 和签名证书，递增 versionCode，才能覆盖升级并保留数据。

## CI

`.github/workflows/android.yml` 对 `gpt-6-android-v1` 的代码推送构建，也支持手动运行。输出调试 APK 与未签名 release APK。不同 runner 的调试签名不稳定；CI debug 包仅用于临时测试，不能当作长期升级渠道。

## 验收顺序

1. 安装后飞行模式新建父、子、孙任务；关闭应用并重新打开，确认数据仍在。
2. 父项有两个分支，仅完成其中一条时划线保留；全部完成自动归档；“搞定”可提前归档已完成分支；撤销恢复完整关系。
3. 多选两条任务批量完成；失败不清除选择，重试不重复生成完成记录。
4. 导出备份到下载目录；导入后任务、回收站、日历、报告完整；备份不含 Key。
5. 真实模型测试连接并手动生成，断网有错误提示，重新尝试不重复并发调用。
6. 360/393/430 宽度检查导航、抽屉、五层任务、软键盘；Android 返回键先收起键盘/详情，再回到今天。
7. 同签名高版本覆盖安装后，原数据和 Key 可读取。
