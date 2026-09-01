# Agent Note：把回传母版保存为未选择候选

状态：已实现

[English](2026-09-01-returned-master-candidate-ingest.md) | 中文

## 问题

回传母版预检成功只证明有界的技术事实，并不会把精确字节持久化到易梦 canonical 资产链。若浏览器在响应丢失后重新上传，而提交又没有稳定的单一回执血缘，还可能产生重复字节或记录。

## 决策

只有绑定的预检成功后，界面才显示单独的显式保存动作。Host 从认证 owner 以及不可变的下载、导入、预检、包、来源、投影、母版 SHA、大小与稳定回执坐标派生一份提交 capability。Writer 核验域分离 HMAC、当前来源绑定和物化字节，然后原子创建一条 canonical asset、一条回执、一条 ChangeSet 与一条 outbox 记录。字节写入实例私有 storage 根目录下的内容寻址路径。

响应不明时，Host 只记录 unknown 状态。恢复只执行原回执／列表 GET，绝不再次发送字节。并发点击与 Host 重启收敛到同一资产和回执；payload、来源、投影、预检或已存字节任一变化都会失败关闭。

## 已考虑的替代方案

不把结果只放在浏览器存储中，因为这会形成第二套资产真源，也无法在全新浏览器中恢复。不把预检暂存文件直接当正式媒体，因为临时所有权与清理规则不同于 canonical storage。不把入库解释为已选择或已发布，因为技术预检不是创意或发布决定。

## 验证

Writer 聚焦服务／API 测试覆盖 owner scope、HMAC 篡改、来源漂移、payload 冲突、文件与数据库回滚、已存字节篡改及 exactly-once 恢复。Host 与驾驶舱测试覆盖一次性 capability、并发点击、响应丢失后不二次上传的恢复、重启后访问、严格响应归一化与明确边界标签。

## 后果

保存后的资产始终是 episode-scoped、`Unselected`、质量 `pending`、未批准且未发布。不会创建 Provider、PromptIR、final output、Ready、stage、发布权威或人工签收。选择、质量审核、发布 manifest 检查与用户签收仍是之后的显式操作。
