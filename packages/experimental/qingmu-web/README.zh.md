# 青木 OS Web 发行 Bundle

[English](README.md) | 中文

这个私有 Bundle 是青木 OS 叠加在 Harness 原生 `base` 与 `web-app` Bundle 之上的发行配置。它停用官方品牌占位行，插入青木浏览器品牌，再按“易梦本机只读适配器 → 无状态 IMAGO 方法适配器 → 可独立插拔的命令适配器 → 青木制作驾驶舱”的顺序组装。通用侧边栏和会话能力继续使用 Harness 原生组件。

独立的青木 Profile 应按 `dsh-base`、`dsh-web-app`、`dsh-experimental-qingmu-web` 的顺序组装。Profile 属于运行时状态，与原生 `web` Profile 分离。

IMAGO 方法适配器优先从 Cordis 非空白的显式 `config.coreRoot` 解析 Core 根目录；该设置缺失、为空或仅含空白时，再读取 `IMAGO_OS_CORE_ROOT`。解析结果必须是绝对路径；非空白显式配置优先于环境变量，无效值失败关闭，发行 patch 不包含任何机器专属根目录。

同一 Host 还要求通过环境提供原始、不 trim 且至少包含 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`。该密钥只属于环境，不是 Cordis 字段或浏览器值；发行 patch 既不包含密钥，也不包含占位秘密。

## 模型体验

无，因为这个发行 patch 只改变浏览器组装，不注册面向模型的行为。

#### KV Cache 影响

无。没有增加面向模型的 Token。

## 已知限制与暂缓事项

- 驾驶舱读取易梦权威业务投影，目前暴露受限的 `episode_script` 流程，以及首个只覆盖道具的 `element_profile` 纵切；人物与场景编辑仍暂缓。两条流程都不会授权付费 Provider 或推断人工签收。
- 独立的无状态 IMAGO 适配器现已向驾驶舱投影道具字段提示、检查清单、工作单与审核卡；它不会复制 IMAGO 状态，也不会暴露第二套 Stage/DAG。
- 在产品发行命名空间确立前，源码包保持私有实验状态。
