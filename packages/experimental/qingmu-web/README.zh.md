# 青木 OS Web 发行 Bundle

[English](README.md) | 中文

这个私有 Bundle 是青木 OS 叠加在 Harness 原生 `base` 与 `web-app` Bundle 之上的发行配置。它停用官方品牌占位行，插入青木浏览器品牌，再按“易梦本机只读适配器 → 无状态 IMAGO 方法适配器 → 可独立插拔的命令适配器 → 青木制作驾驶舱”的顺序组装。通用侧边栏和会话能力继续使用 Harness 原生组件。

独立的青木 Profile 应按 `dsh-base`、`dsh-web-app`、`dsh-experimental-qingmu-web` 的顺序组装。Profile 属于运行时状态，与原生 `web` Profile 分离。

IMAGO 方法适配器优先从 Cordis 非空白的显式 `config.coreRoot` 解析 Core 根目录；该设置缺失、为空或仅含空白时，再读取 `IMAGO_OS_CORE_ROOT`。解析结果必须是绝对路径；非空白显式配置优先于环境变量，无效值失败关闭，发行 patch 不包含任何机器专属根目录。

同一 Host 还要求通过环境提供原始、不 trim 且至少包含 32 个 UTF-8 字节的 `QINGMU_IMAGO_ATTESTATION_KEY`。该密钥只属于环境，不是 Cordis 字段或浏览器值；发行 patch 既不包含密钥，也不包含占位秘密。

## 原生导演会话

本组合包通过 `dsh.bundle.agentPresets` 携带显示为“青木导演”的 `qingmu-director` Agent 预设。Profile 启动器将其包内相对根目录与原生模式一起注册，无须写入安装绝对路径或复制用户预设。青木 patch 将其选为 profile 默认值，但原生用户默认设置仍可覆盖。原生 profile 与已有会话保持原模式。用户可在新会话或空会话中通过原生模式选择器选用此预设；已有内容的会话不会自动切换。

预设组装完整导演角色提示与上下文桥的[原生读取和建议工具](../qingmu-director-context-bridge/README.zh.md)。它不增加 shell、任意文件操作、自修改、Provider、采用、保存或批准工具。现有驾驶舱必须将所选镜头绑定到同一个会话。未绑定镜头时，工具如实报告，不编造项目。驾驶舱可将已记录提示词建议采用到可编辑草稿；这不等于完整创作流程。

## 模型体验

### 青木导演预设

#### 模型看到什么

只有 `qingmu-director` 会话收到 [agent.cordis.yml](agent-presets/qingmu-director/agent.cordis.yml) 中的固定中文角色提示和限定作用域的原生工具 schema。角色提示要求先读取真实 Writer 上下文与完整 IMAGO 方法，再进行导演工作；区分场景意图与镜头设计，PromptIR 读取器可用时可提出单字段完整替换建议，不声称保存、生成或批准内容。免密钥原生循环快照锁定其实际模型输入。

#### Token 影响

本预设每次请求携带固定角色提示与已可用的作用域工具 schema。完整上下文和方法正文按需读取，不在启动时注入整个方法库。建议引用原始读取回执，不重复这些正文。

#### KV Cache 影响

角色提示与 schema 构成本预设的稳定前缀。按需读取的上下文与方法正文进入普通工具结果并消耗 token；其他模式不增加文本。

## 已知限制与暂缓事项

- 驾驶舱读取易梦权威业务投影，目前暴露受限的 `episode_script` 流程，以及首个只覆盖道具的 `element_profile` 纵切；人物与场景编辑仍暂缓。两条流程都不会授权付费 Provider 或推断人工签收。
- 独立的无状态 IMAGO 适配器现已向驾驶舱投影道具字段提示、检查清单、工作单与审核卡；它不会复制 IMAGO 状态，也不会暴露第二套 Stage/DAG。
- 在产品发行命名空间确立前，源码包保持私有实验状态。
- 已有内容的会话不会自动获得此预设，已保存的用户默认值也可覆盖发行默认值。读取工具测试不证明网页绑定、真实提供方判断、建议采用或生产部署。
