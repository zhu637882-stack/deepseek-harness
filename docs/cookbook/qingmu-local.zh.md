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

打开 `status` 输出的 `webUrl`，选择“进入青木 OS”，首次使用时选“先以只读方式进入”，再选“青木制作台”。首次选项跳过模型配置，不改变已认证的 Draft 命令权限。`ready: true` 要求两个自有进程、API 的精确数据库/媒体身份、Host 的 loopback 监听和页面均通过核验。登录状态单独显示。空实例没有项目；驾驶舱尚不能新建项目。这是持久集成环境，不代表完整产品验收。

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
