/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

const isQingmuBuild = process.env.DSH_CLIENT_BUILD_PROFILE === 'qingmu'

/** Qingmu starts provider-neutral; real provider names remain available in Models settings. */
export const DEEPSEEK_ONBOARDING_ENABLED = !isQingmuBuild

/** Qingmu replaces provider-specific first-run setup with the neutral Models route. */
export const QINGMU_MODEL_ONBOARDING_ENABLED = isQingmuBuild

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = isQingmuBuild ? 'qingmu-2026-08-26.1' : '2026-08-13.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
const upstreamWelcomeNoticeCopy = {
  zh: {
    title: '内测声明',
    body: 'DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。',
    continueLabel: '继续',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
    continueLabel: 'Continue',
  },
} as const

const qingmuWelcomeNoticeCopy = {
  zh: {
    title: '青木 OS 早期共创说明',
    body: '青木 OS 正在面向小型 AI 影视创作团队进行早期本地验证。当前阶段优先验证创作驾驶舱、项目事实视图与可插拔工作流；未经明确授权，系统不会调用付费生成、写入正式业务数据、部署生产环境，也不会代替创作者完成人物、场景、道具、提示词、镜头或成片签收。\n\n青木 OS 以可插拔智能体底座承载协作，以易梦空间的人机共创流程组织剧本与资产，以 IMAGO OS V6 的机器合同、血缘、质检和人工终审门禁约束生产。能力会按可移除插件逐步接入，并为关键动作保留可回放证据。',
    continueLabel: '进入青木 OS',
  },
  en: {
    title: 'Qingmu OS Early Collaboration Notice',
    body: 'Qingmu OS is in early local validation for small AI film teams. This stage focuses on the production cockpit, project truth views, and pluggable workflows. Without explicit authorization, the system will not invoke paid generation, write production business data, deploy to production, or approve characters, environments, props, prompts, shots, or finished media on behalf of creators.\n\nQingmu OS combines a pluggable agent foundation with Yimeng Space human-in-the-loop creation and IMAGO OS V6 machine contracts, lineage, quality control, and human final-review gates. Capabilities will arrive as removable plugins with replayable evidence for consequential actions.',
    continueLabel: 'Enter Qingmu OS',
  },
} as const

/** Build-profile-owned product notice; the stock build remains byte-for-byte upstream copy. */
export const WELCOME_NOTICE_COPY = isQingmuBuild ? qingmuWelcomeNoticeCopy : upstreamWelcomeNoticeCopy
