# 在 macOS 本地运行青木

[English](qingmu-local.md) | 中文

本指南启动具有持久 SQLite 数据库的青木单用户专用实例，不升级其他易梦现场。前提：当前 Harness 已执行 `pnpm run build --profile qingmu`，具备 Node、Python 3、含 `.venv` 的易梦 Writer 工作区和 IMAGO Core。

## 初始化与打开

在 Harness 目录执行。初始化拒绝任何已存在的目标目录。默认目录是 `~/Library/Application Support/QingmuOS`；自定义实例须在每条命令后加 `--root /absolute/new/path`。

```sh
python3 scripts/qingmu-local.py init --yimeng-root /Users/a1234/yimeng-worktrees/qingmu-phase3-changeset-20260826 --core-root /Users/a1234/Downloads/imago-os-core
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
python3 scripts/qingmu-local.py status
```

打开 `status` 输出的 `webUrl`，选择“进入青木 OS”，首次使用时选“先以只读方式进入”，再选“青木制作台”。首次选项跳过模型配置，不改变已认证的编辑权限。`ready: true` 要求两个自有进程、API 的精确数据库/媒体身份、Host 的 loopback 监听和页面均通过核验。登录状态单独显示。这是具有剧本创作入口的持久集成环境，不代表完整产品验收。

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
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
```

停止保留数据，启动不重新播种项目。重启保持端口；已保存端口被占时失败，不停止占用者。重复启动返回同一存活实例。陈旧 PID 仅供诊断，命令绝不向其发信号。管理进程损坏或被外部强杀时会拒绝猜测，可能需操作员诊断其遗留子进程；不要按端口杀未知监听者。

专用本地账号使用 `private/login.json` 中的随机密码，由当前 macOS 用户的私有目录保护。`login` 向既有 API 提交该凭据，更新正常 24 小时 JWT，仅重启本实例 Host，不改业务数据、不重放命令。随后刷新浏览器。保存结果未知时先查原回执再决定重试，不要新建第二条命令。设备本地身份不是人工内容批准证明。能访问此 macOS 账号或 loopback 服务的主体拥有本地用户能力。

## 数据与备份参考

`storage/jason.db` 和 `storage/` 保存易梦数据与媒体；`dsh/` 为独立 Harness home/profile；`private/` 保存密钥、会话与配置；`logs/` 保存启动诊断。整个目录须保持私密，私密文件和备份均不得进入 Git。启动器清除继承凭据，不读取旧生产 `.env`，只绑定 `127.0.0.1`，付费 Provider 保持禁用。

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py restore --backup /absolute/backup/path --root /absolute/new/restore-path
python3 scripts/qingmu-local.py start --root /absolute/new/restore-path
python3 scripts/qingmu-local.py login --root /absolute/new/restore-path
```

备份要求已确认正常停机，每次新建带时间戳的目录，检查 SQLite 完整性及媒体 SHA-256。监督进程异常退出后，锁空闲不证明停机：持久 dirty 标记会阻止启动/备份并报告状态未知，需操作员诊断。恢复要求完整 storage 哈希清单，仅写不存在的新目录，保留来源实例，分配新进程身份并要求登录。修改绑定的代码工作区前保留已验证备份。代码回滚需停止本实例并回到记录的来源提交；不自动回滚数据库 schema。

启动器不安装系统自启动、不开放公网、不迁移正式数据、不运行 Provider 作业、不签收内容。详见[所有权决策](../../.agents/notes/implemented/architecture/2026-08-29-qingmu-local-instance.zh.md)。
