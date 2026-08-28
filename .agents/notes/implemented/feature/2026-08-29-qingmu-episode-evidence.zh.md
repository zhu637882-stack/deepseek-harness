# Agent Note：青木单集证据与显式核验

状态：已实现

[English](2026-08-29-qingmu-episode-evidence.md) | 中文

## 问题

Take 选择、技术 QC、审核、批准与整集核验属于不同权威。静态面板不能证明真实核验器可调用，旧报告不能证明当前就绪。即使 SQLite 只读连接也可能创建 WAL 辅助文件。

## 决策

易梦验证现有项目读取权限，投影 canonical 记录，在有界子进程运行核验器并保持原始事实不变。路径和 store 来自当前请求绑定配置，不接受浏览器输入；POST 只接收来源 SHA。私有子进程不加载仓库环境文件或 Provider 凭证。

Ledger GET 不执行探测。来源哈希绑定数据库镜像、本地媒体、探测 sidecar、交付规格与逐镜 canonical 记录，并在前后复查。DB/WAL 一致复制到临时读取快照；包括 TaskCenter 在内的 SQLite 读取均在快照上完成，不迁移、不写业务目录。原来源变化即拒绝；保留 WAL 提交，不用 immutable 模式忽略数据。

Harness 负责校验和展示。显式核验单并发、后端硬超时，显示结果前必须读取新 Ledger。范围切换、刷新和错误都会丢弃旧结果；canonical 核验、审核、QC、生命周期与人工签收不会合成为新的批准。

## 考虑过的替代方案

- 调用 final/evidence 导出路由会合成或写入证据，违反只读范围。
- 浏览器/API double 不能证明真实鉴权、SQLite、媒体与 canonical 核验器路径。
- SQLite immutable 模式会遗漏已提交 WAL；普通只读模式可能在业务库旁创建 WAL/SHM。
- 从单个 `ok` 推断正式放行会抹去独立人工权威。

## 验证索引

- 后端：`tests/test_qingmu_episode_evidence.py`、`tests/test_verify_episode.py`、`tests/test_studio_api_modularity.py`。
- Host：`packages/experimental/qingmu-yimeng-read-adapter/tests/episode-evidence.spec.ts` 及相关适配器测试。
- UI：`packages/experimental/client-ui-qingmu-cockpit/tests/episode-evidence.client.spec.tsx`。
- 真实链路：`apps/web/tests/qingmu-episode-evidence.e2e.ts` 启动易梦 Writer 的 `scripts/qingmu_evidence_ledger_fixture.py`，再走真实 Chromium、构建后的 Host RPC 和实际 FastAPI。复用现有本地 Take 媒体及模拟 JWT 身份，不替换核验器。
- `pnpm run build --profile qingmu` 后执行 `DSH_CLIENT_BUILD_PROFILE=qingmu DSH_SNAPSHOT=replay QINGMU_E75_YIMENG_ROOT=/absolute/writer/path IMAGO_OS_CORE_ROOT=/absolute/core/path pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/qingmu-episode-evidence.e2e.ts`。Writer 需已有 Python 测试环境与本地 ffprobe/ffmpeg。

## 后果

2026-08-29 验证：后端 E7-5/canonical 核验器/路由注册测试 93/93，退出 0；read-adapter 包在最后空集与跨来源校验补充前通过 500 项，随后改动的证据合同 9/9，退出 0。UI 证据测试 9/9、驾驶舱测试 27/27，退出 0。Host/client TypeScript、青木构建及改动 TypeScript lint 均退出 0。真实浏览器 refresh 和独立新 fixture 的 replay 各 1/1，退出 0：canonical `ok=false`、`missing_final_output`、导演执行证据缺失、一个镜头有视频覆盖、陈旧 SHA 拒绝，整个 fixture 目录字节保持不变；未观察到自动核验。

一次有界独立复审发现 P1：Ledger 快照限制泄漏到 canonical TaskCenter 读取。修复为直接只读任务访问，快照策略保留在 E7-5 边界；大库和后续提交回归通过。同一 Reviewer 复核 PASS，无未解决 P0/P1；无效 JWT 预检、空集和跨 feed 绑定检查也已核验。

不完整 fixture 仍暴露既有通用 workflow blocker 形状不匹配（缺少 `workflow.blockers[0].reason`）。独立鉴权的 Ledger 可用且通过测试，不把该投影视为有效。本测试没有验收其他驾驶舱流程或最终导演台体验。

不执行 Provider、付费、业务库/批准/签收写入、导出、部署或 push。临时测试身份不是真实人工签收。导演静态资产仍 inert；该只读切片不证明写后读恢复、重启持久化、E8 交接或最终产品验收。
