# 在 macOS 本地运行青木

[English](qingmu-local.md) | 中文

本指南启动具有持久 SQLite 数据库的青木单用户专用实例，不升级其他易梦现场。同一个启动器拥有易梦 API、DSh Host/导演服务和易梦六阶段前端。前提：当前 Harness 已按青木 profile 完成构建，具备 Node 20、Python 3、含 `.venv` 且已用 `QINGMU_LOCAL_RUNTIME_PROXY=1` 完成前端生产构建的易梦 Writer 工作区，以及 IMAGO Core。初始化会记录首份本地构建身份；任一工作区或其产物变化后，须先停止实例、完成两边构建，再运行 `record-build`，然后才可再次启动。

## 初始化与打开

在 Harness 目录执行。初始化拒绝任何已存在的目标目录。默认目录是 `~/Library/Application Support/QingmuOS`；自定义实例须在每条命令后加 `--root /absolute/new/path`。

```sh
python3 scripts/qingmu-local.py init --yimeng-root /absolute/path/to/yimeng-writer --core-root /absolute/path/to/imago-os-core --frontend-node /absolute/path/to/node20
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
python3 scripts/qingmu-local.py status
```

打开 `status` 输出的唯一 `entryUrl`。它建立正常的 HttpOnly 本地会话并直接进入青木品牌的易梦项目工作区，不先展示通用 DSh 对话或额外青木弹窗。`ready: true` 要求 API、限定范围的文本 Worker、DSh Host、前端四个自有子进程，以及 API 的精确数据库/媒体身份、DSh Host 监听/页面和六阶段前端监听/页面分别通过核验；状态字段保持分开，便于诊断。六阶段页面嵌入限定范围的导演工作区。规划保存或 GET-only 恢复后，外层页面只接受准确 iframe origin/source 和项目/剧集范围，重读 canonical 规划与导演上下文，刷新工作流投影，并定位已保存镜头。被拒绝或陈旧的通知保持可见，且不会制造假成功。这是持久集成环境，不代表完整产品验收。

<a id="write-the-first-script"></a>

## 保存第一份剧本

1. 在空态输入项目名称，选择“新建项目与第 1 集”。已有项目也可点击“新建项目”。易梦原子创建一个项目、第一季和首集。
2. 在“剧本与资产”粘贴文字或选择 UTF-8 `.txt` 文件（最多 128 KiB、64000 字、1000 行）。每场戏以“场景一：地点”开头，动作和对白各占一行。
3. 选择“解析并保存预览草稿”。检查场景/动作/对白分类，用“保存校正”修正说话人。此步只保存解析草稿。
4. 选择“确认导入并保存剧本”。下方展示已存剧本及版本。刷新或重启后读回同一份服务端剧本。资产、分镜和 Take 仍为空，需另行创建；此动作不启动阶段或生成，也不授予内容批准。

响应丢失时，先使用“读取创建恢复”或“读取恢复 / 刷新预览”。输入保留在本浏览器，权威草稿与剧本保存在易梦。显式重试同一意图不会重复原操作。剧本版本变化且已确认原导入不存在时，“保留文字，按当前版本重新准备”解锁保留文字但不提交。未完成的草稿索引只可在仍为当前草稿时通过显式同键重试补齐。浏览器恢复存储不是备份；新浏览器可恢复已存数据，不能恢复未提交的本地文字。

<a id="plan-one-scene"></a>

## 规划一场戏

1. 保存剧本后打开“导演工作区”，选择一场文本场景并点击“建立本场镜头”。初始两张卡只复制原文动作/对白；空的叙事和画面字段不是生成建议。
2. 填写镜头名称、叙事目的、画面描述、动作和时长（0.5–30 秒），核对对白分配。最多增加到八个镜头。选择“预览保存影响”，再选择“确认保存规划”。
3. 保存的场景、对白人物和镜头拥有真实易梦 ID 及原始来源行绑定。选择一个镜头，修改字段并显式保存新结构版本。刷新或重启读回同一对象。参考媒体和首个合法 PromptIR 仍是独立前提；结构 Ready 不是内容批准。

结果未知时先选择“读取恢复”，再考虑重试。确认原回执不存在且新读取的剧本来源未变后，可显式按最新版本重新准备被拒意图。如果另一会话已初始化该场景，“保留输入副本，载入已存在镜头”留下仅本浏览器的副本，并载入已有对象，不覆盖它们。变化的剧本来源不能静默重新绑定。未提交文字可在同一浏览器普通重入后恢复，但不能在删除浏览器存储后恢复。

## 停止、重启与更新登录

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py record-build
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
```

停止保留数据。`record-build` 要求实例正常停止且 Writer/Harness 工作树干净，然后在 `build-manifest/current.json` 中原子绑定两边提交、Core 工作区状态、frontend BUILD_ID、必要 Host 产物 SHA-256、端口和数据根；旧记录保留在 `build-manifest/history/`。启动和 `status` 会把该记录与磁盘实况对比；身份缺失或漂移时失败关闭。启动不重新播种项目。重启保持端口；已保存端口被占时失败，不停止占用者。重复启动返回同一存活实例。陈旧 PID 仅供诊断，命令绝不向其发信号。管理进程损坏或被外部强杀时会拒绝猜测，可能需操作员诊断其遗留子进程；不要按端口杀未知监听者。

管理进程被外部中断后，只能在实例保持停止时，用公开状态中的精确实例 ID 执行 `recover-crash`。命令会持有生命周期锁，并核验带代际号的进程账本、所有已记录 PID、每个 loopback 端口、控制 socket、数据库/WAL 句柄和 immutable 完整性；它不发送信号，也不调用 Provider。持久恢复意图保证中断后可安全重复；只要意图尚未清理，启动和备份都会继续失败关闭，直至同一命令完成收尾。

```sh
python3 scripts/qingmu-local.py recover-crash --instance-id EXACT_INSTANCE_ID
```

专用本地账号使用 `private/login.json` 中的随机密码，由当前 macOS 用户的私有目录保护。`login` 向既有 API 提交该凭据，更新正常 24 小时 JWT，仅重启本实例 Host 与前端，让两者取得更新后的私密会话；它不改业务数据、不重放命令。随后重新打开 `status` 输出的 `entryUrl`，让浏览器取得新的 HttpOnly Cookie；只刷新原项目地址会继续携带旧 Cookie。保存结果未知时先查原回执再决定重试，不要新建第二条命令。设备本地身份不是人工内容批准证明。能访问此 macOS 账号或 loopback 服务的主体拥有本地用户能力。

## 轮换本机私密凭据

怀疑本机实例凭据被暴露时，先正常停止并创建一次非覆盖 cold backup；确认当前 Harness/Writer 工作树干净后，用公开 `status` 中的精确实例 ID 执行：

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py rotate-private-credentials --instance-id EXACT_INSTANCE_ID
```

轮换只允许在停止锁内运行。它一次性重生 JWT 签名、attestation、控制、导演执行、编辑交接五类本机密钥，更新 `qingmu-local` 的随机登录密码及数据库中该用户唯一一行的密码哈希，并清除旧 session。随后自动重绑当前构建身份、启动实例，在同一 launcher 进程内确认旧密码和既有旧 session 均返回未授权，再使用新密码登录。命令和 audit receipt 只报告类别、布尔、时间、权限和公开构建身份，不输出凭据或其哈希。实例 ID 不符、实例正在运行、账号不是精确一行、私密文件不是当前用户的 `0600` 普通文件、存在未知同类私密字段或任一步失败时均失败关闭；提交前的受控失败会恢复一致停止态。

轮换完成后应再执行一次 `stop`、`start`、`status`，确认完整重启仍为 `ready: true` 且构建身份匹配。旧 cold backup 会保留，但 `restore` 现在总会为新目录重生上述五类凭据和本机登录密码、同步新数据库密码哈希并丢弃旧 session，因此不会让备份内的旧认证值重新生效。

## 数据与备份参考

`storage/jason.db` 和 `storage/` 保存易梦数据与媒体；`dsh/` 为独立 Harness home/profile；`private/` 保存密钥、会话与配置；`logs/` 保存启动诊断。整个目录须保持私密，私密文件和备份均不得进入 Git。启动器清除继承凭据，不读取旧生产 `.env`，只绑定 `127.0.0.1`，付费 Provider 保持禁用。

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py restore --backup /absolute/backup/path --root /absolute/new/restore-path
python3 scripts/qingmu-local.py record-build --root /absolute/new/restore-path
python3 scripts/qingmu-local.py start --root /absolute/new/restore-path
python3 scripts/qingmu-local.py login --root /absolute/new/restore-path
```

备份要求已确认正常停机，每次新建带时间戳的目录，检查 SQLite 完整性以及 storage、audit 和 build manifest 的 SHA-256。构建身份缺失时只记录 `unknown_missing`，不进行推断。监督进程异常退出后，锁空闲不证明停机：持久 dirty 标记会阻止启动/备份并报告状态未知，直至上述显式失败关闭恢复成功。恢复要求完整哈希清单，仅写不存在的新目录，保留来源实例并分配新进程身份；恢复过程会全量 rekey 本机私密凭据和登录认证，复制的构建身份会保持不匹配，直至 `record-build` 将其绑定到新目录。修改绑定的代码工作区前保留已验证备份。代码回滚需停止本实例并回到记录的来源提交；不自动回滚数据库 schema。

启动器不安装系统自启动、不开放公网、不迁移正式数据、不运行 Provider 作业、不签收内容。详见[所有权决策](../../.agents/notes/implemented/architecture/2026-08-29-qingmu-local-instance.zh.md)。
