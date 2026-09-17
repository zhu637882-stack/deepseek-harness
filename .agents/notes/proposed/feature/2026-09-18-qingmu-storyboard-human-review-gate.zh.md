# Agent Note：青木分镜预生产人工审核闸门

Status: proposed

[English](2026-09-18-qingmu-storyboard-human-review-gate.md) | 中文

## 问题

Writer 侧早已有一套完整的分镜预生产人工审核闸门。在 writer 仓（`workflow-pilot-20260909/writer`）里，`GET /api/episodes/{episode_id}/storyboard-human-review` 返回整集审核状态（`backend/src/jason/apps/studio/api.py:22463`），同一路径的 `POST` 原子接受当前这一份确切帧集合（`api.py:22544`），逐帧路由在 `api.py:22482`。过闸正是解除 `storyboard_human_review_required` 阻塞码的动作，而 `_require_storyboard_human_review_gate`（`api.py:963`）会在后续首帧与视频提交前强制检查它。

青木驾驶舱没有任何界面能触达这三条路由。`client-ui-qingmu-cockpit` 里没有一处调用它们，两个 yimeng adapter 也没有为它们注册桥。后果是可度量的而非推测的：live 库 `command_receipts` 有 181 行，其中**没有一行**是分镜人审回执，也就是说这个闸门从未在驾驶舱里被通过过。于是操作员在驾驶舱里走到一个无法推进的流水线阶段，既没有推进它的控件，也没有任何提示说出阻塞码是什么。

## 方案

按本仓已验证的 `entity-draft-review` 模板，把缺失的入口补成读桥、写桥与一块驾驶舱面板。

**读桥**——[storyboard-human-review.ts](../../../../packages/experimental/qingmu-yimeng-read-adapter/src/storyboard-human-review.ts) 注册 exact Host 路由 `/api/qingmu/storyboard-human-review/state`。它只接受 GET，不写任何东西。它只转发调用者本人的 `jason_token=` cookie（上限 8192 字节，含 CR 或 LF 即拒），拒绝任何携带 `authorization` 的请求，并要求 `isTrustedApiRequest`。状态到达浏览器前，`validState` 不信任摘要字段，而是从帧列表本身重新推导：`totalCount` 必须等于 `items.length`，`acceptedCount` 必须等于报告 `accepted` 的帧数，`accepted` 必须等于 `items.length > 0 && acceptedCount === items.length`——与 Writer 在 `storyboard_human_review_service.py:1355` 用的 `bool(items) and …` 是同一条规则。一份声称闸门已过、却与自己的帧列表矛盾的状态会被判 409 拒绝，而不是被当作可过闸门显示出来，因此空帧集合永远不可能读成已接受。

**写桥**——[storyboard-human-review.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/storyboard-human-review.ts) 注册 exact Host 路由 `/api/qingmu/storyboard-human-review/accept`。它额外要求 `origin === http://${host}`，并把转发出去的 `origin` 与 `host` 改写为上游值，与 Writer 侧的 `require_human_browser_cookie_write` 对齐。每条 item 的键被限制为 `frameId` 与 `expectedFrameDigest`；Writer 的 item 模型还接受 `prompt_override`、`preflight_id`、`model`、`resolution`，而那几项会把该帧路由进一条**付费** preflight 权限，所以在这里拒绝它们，才能保证无论浏览器提交什么，这个决定都停在 `providerCalls: 0`。一个 2xx 若回执读不出来、或不能确认所审帧集合，报 502 而不是 409：Writer 把整个集合放在一个事务里提交，因此这种情况下接受可能已经落库，调用方必须重新读取状态，而不是换一个幂等键重提、写出一份重复审核。只有确定的 400 以下拒绝才成为 409，并在 Writer 给出原因码时原样带上。

**驾驶舱面板**——[StoryboardHumanReview.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/StoryboardHumanReview.tsx)，由 [QingmuCockpit.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/QingmuCockpit.tsx) 仅在剧集已绑定后渲染，并按剧集加 key，因此切换剧集会丢弃上一份决定状态。浏览器不发送任何身份字段：由 Host 桥用自然人本人的 cookie 认证。接受需要一段非空的手写备注加一次显式勾选，且状态报告已接受时控件完全不出现。遇到 502，面板保留幂等键与备注以便重试是精确重放，但**清掉勾选**，因此任何东西都不会被隐式接受。遇到 401 则丢掉幂等键（两座桥都在任何事务之前就拒绝），把操作员送回显式登录。

两座桥都在各自包的 `index.ts` 里经 `ctx.effect(...)` 注册并返回 `webServer.register` 的 disposer，因此卸载会注销该 exact 路由。

## 范围与波及面

仅 harness。不改 Writer、不改 schema、无迁移。不做任何 live 构建、部署或运行时根写入：代码停在分支 `qingmu-self-learning-loop-20260916` 供审阅。面板不调用任何 Provider、不改动任何预算，而写桥是**对着回执核验**这条承诺（`providerCalls === 0`、`budgetMutation === false`），不是假定它成立。读桥复用既有的 `entity-draft-review` 登录路由 `/api/qingmu/editorial-handoff/human-session`（[editorial-handoff-download.ts:48](../../../../packages/experimental/qingmu-yimeng-read-adapter/src/editorial-handoff-download.ts)），不新开第二条凭据通道。

## 备选方案

**复用 `api.py:22482` 的逐帧路由。** 否决。它的请求模型带 `prompt_override`、`preflight_id`、`model`、`resolution`，因此经它接受的帧可能被路由进一条付费 preflight 权限。一个用途在于记录人类创作决定的闸门，不应该能顺带花钱。带两键 item 形状的整集路由做不到这件事。

**让导演 Agent 驱动接受。** 否决。哪一版分镜好到可以投产是操作员的创作决定。一个能自己过闸的 Agent，等于把人类从唯一一个把守下游付费生成的检查点上移走。

**只显示阻塞码文本，把旧页面留作入口。** 否决。那会让驾驶舱流水线仍停在一个驾驶舱无法推进的阶段，而这正是被报告的缺陷本身。

## 验收标准

- `pnpm exec vitest run packages/experimental/qingmu-yimeng-read-adapter packages/experimental/qingmu-yimeng-command-adapter packages/experimental/client-ui-qingmu-cockpit`——148 个文件、2955 个测试通过，4 个既有 skip。新增 27 个测试为每个面各 9 个。
- client spec 按名字断言了吃重的否定用例：已通过的闸门不提供接受控件；结果未知时只保留一个幂等键且绝不隐式接受；被桥拒绝的状态会被显示出来，而不是当成空的可过闸门。
- `pnpm run typecheck` 退出 0。
- `oxlint` 扫这七个改动文件退出 0。仓级 lint 门在本分支基线上就是红的（1045 个错误全在本次未触碰的文件里，集中在 `reference-video-tools-composition.spec.ts` 与 `PromptIrWorkspace.tsx`）；本次改动贡献为零。
- 面板用到的 29 个 locale 键与定义的 29 个完全一致，中英两侧皆然。初稿定义了却从未引用的三个键被剪掉，而不是留成死键。

## 风险

**浏览器 → Host → Writer 这条链未做端到端验证。** 照 [qingmu-entity-draft-human-review.e2e.ts](../../../../apps/web/tests/qingmu-entity-draft-human-review.e2e.ts) 的形状写一个 `qingmu-storyboard-human-review.e2e.ts` 是正确的下一步，本次刻意没有包含：它需要 qingmu profile 的客户端构建、Playwright Chromium 与 Writer fixture 的 venv，而撰写时宿主磁盘只剩 9.1 GiB，低于本项目停止重活的 10 GiB 线。桥所校验的字段名改为通过阅读 live Writer 源码确认——`episode_status` 在 `storyboard_human_review_service.py:1347` 返回 `version`/`projectId`/`episodeId`/`storyboardRevision`/`frameSetDigest`/`totalCount`/`acceptedCount`/`accepted`/`blockerCode`/`items`/`providerCalls`/`budgetMutation`，`accept_episode_review` 在第 1940 行返回 `acceptedCount`/`totalCount`/`frameSetDigest`/`items[{frameId, checkId}]`/`providerCalls`/`budgetMutation`，`STORYBOARD_HUMAN_REVIEW_VERSION` 在第 26 行为 `storyboard-preproduction-human-review-v1`——但源码一致不等于一份真实执行过的 transcript。e2e 跑通之前，这套接线应视为已审阅、未证实。

**读桥把一集状态上限设为 4 MiB。** 状态里每帧嵌一份 `frame_status`，各自带着该帧提示词、preflight 结论、来源摘要与已存审核。live 剧集最多 49 帧，因此这个上限约合每帧 85 KiB。远大于此的剧集会以无效失败关闭而不是被截断，方向是对的，但表现会是「闸门读不出来」。

**Writer 的 422 被报成 409。** 若 pydantic 拒绝了桥自己发出的上游请求体，会表现为一次确定的拒绝，而不是桥的缺陷。它失败关闭、不可能写出重复审核，但会把诊断引向错误方向。
