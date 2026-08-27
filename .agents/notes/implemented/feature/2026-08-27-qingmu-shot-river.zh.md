# Agent Note: 青木 Shot River

Status: implemented

[English](2026-08-27-qingmu-shot-river.md) | 中文

## 问题

Shot River 需要把易梦的镜头顺序、节奏与当前参考绑定传入驾驶舱和无状态 IMAGO 方法。如果画布编辑直接复用这个更丰富的请求，也会改变既有 Hero Frame 写入约定的哈希。

## 决策

易梦故事板 frame ID 仍是唯一 Shot 身份，`frameNo` 仍是排序权威。只读适配器归一化该顺序；驾驶舱在关系详情、Hero Frame 画布和 PromptIR 之间共享临时的所选 Shot，不存储新的排序或选择权威。

E5-3 方法接收时长、对白原文与时间，以及当前参考可用性和最小资产血缘。操作只有 `inspectCanonicalShotRelations` 与 `inspectShotRiverRhythmAndReferences`。Host 在签发方法证明前检查完整投影；浏览器拒绝过期的关系字段和不一致的重复元素绑定。

E5-3 的关系、投影与所选 Shot 哈希采用 `qingmu.e5-3-seconds-binary64-hash-projection.v1` 的 schema/subject 包装。只有固定秒值字段在哈希时变为大端 binary64 十六进制；数值输入输出不变，null 保持 null，负零与零一致。输入快照哈希仍绑定准确 stdin 字节。这样把 Python/JavaScript 的指数写法差异隔离在证明之外，无需修改通用 canonical 序列化器。

Hero/E5-2 接收明确收窄的 ID 图，保留原有哈希、提案、预览与确认提交路径。响应丢失后，即使权威已前进到新修订，恢复也保留原修订和 Shot 坐标，以 GET-only 方式取回回执。

## 考虑过的替代方案

**持久化第二份镜头列表或按 ID 排序。** 两者都会与易梦既有身份和帧序竞争；界面直接从权威派生这两项信息。

**舍入秒值或修改所有 canonical 哈希。** 舍入会改变合法节奏，修改通用序列化器会影响无关证明；带域标识的秒值专用哈希投影只用于 E5-3。

**把丰富请求原样传入 Hero。** 节奏与参考字段是只读输入，不代表扩展 E5-2 写入约定；显式收窄保留这一边界。

## 后果

同一个 canonical Shot 可以连续查看与编辑，无需增加数据库、DAG 或状态机。缺失的参考绑定仍显示为缺失，不虚构也不批准。本切片不授予 Provider、Worker、选择执行、创意批准、签收或发布权限，也不表示 Epic 5 剩余工作已完成。
