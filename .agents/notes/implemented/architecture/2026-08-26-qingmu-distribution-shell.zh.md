# Agent Note：青木 OS 从 Profile 自有发行层开始

Status: implemented

[English](2026-08-26-qingmu-distribution-shell.md) | 中文

## 问题

青木 OS 需要在用户眼里成为一个完整产品，同时保留 Harness 的升级能力和插件可移除边界。直接修改侧边栏与会话源码，会让每次上游升级都变成产品代码的三方合并；把青木装进用户现有的 `web` Profile，又会把产品状态与开发者日常 Harness 状态混在一起。

第一份交付还必须明确边界。替换三个通用品牌 slot 可以证明发行层接缝成立，但还不代表所有产品文案或短剧工作流都已完成替换。

## 决策

青木采用有序、隔离的 Profile 组装：先 `dsh-base`，再 `dsh-web-app`，最后叠加私有的 `dsh-experimental-qingmu-web` Bundle。Bundle 停用官方品牌占位者并插入私有青木客户端插件。插件只填充 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark`。一等命名 `qingmu` 客户端构建 Profile 统一提供 `DSH_CLIENT_BUILD_PROFILE=qingmu`、`DSH_CLIENT_TITLE=青木 OS` 和源码 commit；运行时品牌插件与编译产物 Profile 不一致时会明确失败。同一构建 Profile 还选择青木自有的 PWA 元数据、favicon、欢迎文案、独立确认版本，以及 Provider 中立的“进入模型设置”首次引导，原生构建保持不变。真实 Provider 名称仍会在模型设置中如实保留。

可见标记是原创的 Q、播放符号与新芽组合矢量，并使用 `currentColor` 适配主题，没有复制 DeepSeek 图形。实验包保持私有时，内部包标识沿用仓库既有命名空间；公开青木命名空间留到独立发行仓库决策。

原生 `web` 运行 Profile 保持不变。青木运行 Profile 在源码树外创建，并显式安装实验 Bundle 和品牌包。发行层保留一组刻意收窄的上游补丁：命名客户端构建选择、青木 PWA 资产、构建 Profile 自有的欢迎/模型引导，以及错配保护；每个分支都由原生与青木对照测试覆盖。

## 考虑过的替代方案

- 放弃直接修改通用侧边栏与会话包，因为这会让每次 Harness 上游更新都变成重复的源码合并。
- 放弃复用原生 `web` Profile，因为这会把青木产品状态与用户日常 Harness 安装混在一起。
- 放弃复制完整的 `web-app` Bundle，因为这会分叉一整套本可继续由上游维护的插件清单。
- 放弃在 DOM 中事后替换欢迎弹窗，因为它对时序敏感、可访问性差，也无法被源码级品牌审计覆盖。

## 测试

组件测试证明 Profile 错配明确失败、三个 slot 占位者、卸载、公开号文字、可缩放标记几何及 Provider 中立模型引导。客户端构建测试证明两个命名 Profile 都能解析出精确的公开环境。Bundle 组装测试叠加真实 base、web-app 与青木 patch，证明官方行被停用且只挂载一个青木行。交付还必须包含原生与青木客户端构建、隔离 Profile 配置 dump，以及覆盖“无模型”路径的本地真实浏览器冒烟。

## 后果

以后可以在小型青木层之下更新 Harness 上游。运行时 Bundle 与品牌包仍可移除；若要移除完整青木发行层，还需同时移除四处狭窄的构建/PWA/引导/错配 Profile 分支。原生 Profile 仍可用于对照，其测试负责守住上游行为。本阶段有意不声称完成全量白标：其余产品文案以及 IMAGO/易梦生产界面会继续留在阶段账本中，直到各自插件与测试落地。
