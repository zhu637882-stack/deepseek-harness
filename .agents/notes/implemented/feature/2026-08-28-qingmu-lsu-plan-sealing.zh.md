# Agent Note：青木完整范围 LSU 计划封存

状态：已实现

[English](2026-08-28-qingmu-lsu-plan-sealing.md) | 中文

## 问题

生产单元绑定和经独立批准的 C5F 制作蓝图锁已经是易梦的持久事实，但 E5-5 仍缺少一次准确的完整范围 LSU 生产计划封存。若把单个绑定、历史回执或 Harness 本地快照当作当前计划权威，就会允许部分范围或过期规则进入生产管道，并在易梦之外形成第二套业务真相。

## 决策

只读适配器增加 `lsuPlanSource`。它只接受项目、剧集坐标和 Host 派生的当前 C5F 锁规则 SHA，随后发送一次认证无正文 GET。准确的非空主体包含按序排列的当前生产单元绑定和已独立批准的 `PRODUCTION_BLUEPRINT_LOCK` 血缘。历史封存仍可作为证据读取，但只有完整主体和规则代际都匹配时才能报告为当前。

Method 适配器增加 `lsuPlanMethod`。受信 Host 重建当前生产单元规则与锁规则，派生锁规则 SHA，读取准确易梦来源，调用当前 Core 的 `scripts/compile_qingmu_lsu_plan_method.py`，再重新读取来源和全部规则。主体、绑定、制作蓝图锁、文件字节、规则哈希或定义任一漂移都会失败关闭。Host 独立核验编译器投影，并使用既有服务端专属 HMAC 密钥签名。Method 保持无状态，只授予尝试显式易梦事务的权限。

命令适配器增加 `sealLsuPlan`、`recoverLsuPlanSeal` 和 `probeLsuPlanAuthority`。封存意图只包含坐标、预期当前主体 SHA、上一计划修订/SHA 的 CAS 对，以及一个可见 ASCII 幂等键。调用方提供的 Method、actor、自然人身份、session、批准和锁声明都会被拒绝。受信 Host 调用当前已加载的 Method 能力，校验完整主体、定义、规则代际、投影 SHA 和 HMAC，然后只向易梦发送一次 POST。

易梦仍是唯一业务权威。它在认证事务中重新核对完整当前生产单元范围和已批准 C5F 制作蓝图锁，执行 CAS，并把结果写入既有 ChangeSet、domain-outbox 和 command-receipt 三本账。回执只授予 `planSealed: true`；它不创建 Stage 批准、锁激活、返修、Provider 调用、推断人工签收或第二套 DAG。

结果不确定的 POST 绝不重试。恢复使用原主体 SHA、计划 CAS 坐标和幂等键发送一次无正文 GET，不要求今天的 Method 密钥或历史 bearer 会话仍相同。当前权威探针始终先调用新鲜 Method，再让易梦判断最新历史封存是否仍匹配今日完整主体和两组规则代际。普通读取和旧回执绝不授予当前权威。

## 考虑过的替代方案

**逐个封存生产单元。** 这不能证明完整分集范围与已批准制作蓝图锁作为同一个原子计划代际被封存。

**在 Harness 保存权威计划。** 这会复制易梦业务状态，并把插件控制面变成与易梦竞争的生产真相。

**接受历史 Method，或在响应丢失后重试。** 前者可能复活旧规则，后者可能追加第二次业务写入。新鲜编译与只查回执能守住原事务边界。

## 影响

适配器聚焦测试覆盖准确请求/响应 schema、非空有序范围、规范哈希、规则与来源漂移、Host HMAC 绑定、CAS 坐标、只发一次 POST、凭据反射、只读 GET 恢复和新鲜当前权威探针。真实 Cordis Loader/Connection/WebServer 组合调用当前 Core 编译器，只使用隔离的易梦 HTTP 双替身，故意丢失封存响应，关闭并恢复 Method 能力，轮换 HMAC 密钥和 bearer 令牌，在不出现第二次 POST 的情况下恢复原回执，随后执行新鲜权威探针。

本检查点不增加 UI、Stage 实例、Stage 批准、锁激活、返修执行、Provider 调用、Worker、推断签收、正式数据库迁移、部署或 push。

---
