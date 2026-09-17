# Agent Note：青木资产参考图质检的驾驶舱入口

Status: proposed

[English](2026-09-18-qingmu-asset-reference-audit-entry.md) | 中文

## 问题

Writer 侧已经拥有一套完整的逐张图像质检。在 writer 仓（`workflow-pilot-20260909/writer`）里，`ConsistencyService.run`（`backend/src/jason/apps/studio/consistency_service.py:4826`）为每张资产提交一次 `vision.audit` 调用，带 `route_key="b4_5.consistency"`、`audit_layer="asset"`、`audit_mode="frame"`（第 4910 行），按 `_rubric_for_asset`（第 1371 行）打分，用 `merge_asset_production_quality(quality_status="passed" if passed else "failed")`（第 5001 行）写回判定，并为失败项生成 `_repair_prompt_for_asset`（第 1723 行）。`POST /api/projects/{project_id}/episodes/{episode_id}/asset-references/audit/preflight`（`backend/src/jason/apps/studio/api.py:9671`）以 `dry_run=True` 为一批调用报价，`POST .../audit/start`（`api.py:9718`）通过 `task_center.consume_asset_reference_audit_preflight_and_create_parent`（`backend/src/jason/domain/task_center.py:11943`）消费该报价，后者要求 `requested_by_user_id`、`project_id`、`episode_id`、`source_lock_hash`、`call_plan_hash`、`confirmation_text` 完全相等，并要求 `allowed = 1` 且未过期。`asset_reference_batch_worker.py:18` 执行入队的父任务，只接受 `actor:{identity_board, turnaround_front}`、`scene:{scene_reference}`、`prop:{prop_reference}`。

harness 侧完全够不到这些。两个 harness 检出里对 `asset-references` 的引用数为零，既没有桥也没有驾驶舱界面。因此这套质检从未运行过，对 live 运行库的四次独立只读查询互相印证：`provider_preflights` 有 78 行 `capability = 'vision.audit'`，全部是 `qingmu.candidate_review.native_video`（74 行）或 `qingmu.working_cut.sound_review`（4 行），没有任何 `b4_5.consistency` 行，没有任何 `workflow.asset_reference_batch` 行，78 行的 `consumed_by_task_id` 全为空；`generation_tasks` 中 `route_key LIKE 'b4_5%'` 为 0 行、`capability = 'workflow.asset_reference_batch'` 为 0 行；`consistency_checks` 为空表；204 张已落地的图像资产（`prop_reference` 72 张、`scene_reference` 54 张、`turnaround_front` 37 张，每张都有 sha256 和本地文件）全部仍是 `quality_status = 'pending'`。

后果不止于资产阶段。因为没有任何资产拿到过机器判定，`quality_status` 永远停在 `pending`，于是没有任何失败理由可以喂给 `shot_issue_rules`，胶囊自学习回路在输入端就被饿死。这与分镜预生产人审闸门是同一类缺陷：Writer 侧已经做完，harness 侧没有入口。

## 方案

按本仓已验证过的 `entity-draft-review` 与分镜人审模板，补一个命令桥和一块驾驶舱面板。不需要读桥：报价响应本身就是状态。

**命令桥** —— [asset-reference-audit.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/asset-reference-audit.ts) 注册两个精确 Host 路由 `/api/qingmu/asset-reference-audit/quote` 与 `/api/qingmu/asset-reference-audit/start`。两者都只转发调用者自己的 `jason_token=` cookie（上限 8192 字节，含 CR 或 LF 即拒绝），拒绝任何携带 `authorization` 的请求，要求 `isTrustedApiRequest`，并要求 `origin === http://${host}`、转发时把 `origin` 与 `host` 改写为上游值，以对齐 Writer 侧的 `require_human_browser_cookie_write`。查询参数必须恰好是 `projectId` 与 `episodeId`；报价请求体必须恰好是 `auditMode` 与 `assetIds`；开始请求体必须是这两项加上 `preflightId`、`sourceLockHash`、`callPlanHash`、`confirmationText` 和字面量 `confirmed: true`。请求上限 64 KiB，响应上限 256 KiB，`content-length` 小于实际请求体即拒绝。

桥自身不持有任何花费策略 —— `allowed` 与 `quoteAllowed` 仍由 Writer 决定 —— 但它拒绝转发与"免费报价"承诺自相矛盾的报价：`providerCalls` 必须为 `0`，`budgetMutation` 与 `taskMutation` 必须为 `false`，`readOnly` 必须为 `true`，`imageRegeneration` 必须为 `false`，`callCount` 必须等于 `manifest.length`，`authorizationCapCny` 必须存在且不低于 `estimatedCny`。每条 manifest 项必须恰好携带 Writer 发出的那 19 个键，且 `capability`、`routeKey`、`imageRegeneration`、`auditMode` 是被校验而非被透传的，所以一条声称 `image.generate`、首帧路由键或会重生成图像的 manifest 项会被报为 502，而不会以一个 operator 可能授权的价格抵达浏览器。开始回执只在 `accepted === true` 且 `task.capability === 'workflow.asset_reference_batch'` 时被接受。

结果分类沿用分镜桥。5xx、传输失败、以及任何回执无法校验的 2xx 都归为 502，因为两个路由都在响应之前改动 Writer 状态 —— 报价写入一条 preflight 行，开始消费它并入队一批付费任务 —— 所以动作可能已经落地，调用方必须重读而不是重发。只有确定的、小于 400 的 Writer 拒绝才归为 409，并在 Writer 通过 FastAPI `detail` 报告理由码时原样携带。上游 401 或 403 归为 401，让面板把 operator 带回登录。

这道守卫不再逐桥复制。[human-browser-bridge.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/human-browser-bridge.ts) 现在持有 `browserWriteHeaders`、`readJsonBody`、`jsonResponse`、`writerCode`、`isRecord` 的唯一一份，本桥与分镜人审桥都从它导入。在此之前分镜桥带着这五者的逐字节相同副本；再来第三份就意味着 cookie 上限、origin 规则或可转发的理由码模式一旦要改，就得同时改三处。每个桥保留自己的字节上限并作为参数传给 `readJsonBody`，因为两个上限是由 Writer 不同的字段限制推出来的。`entity-draft-review.ts` 保留自己的守卫，它确实不同：它同时服务读与写，所以只在写上强制 origin 校验，且 GET 不带 JSON content type。

**驾驶舱面板** —— [AssetReferenceAudit.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/AssetReferenceAudit.tsx)，由 [QingmuCockpit.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/QingmuCockpit.tsx) 在资产视图内、且已绑定分集时才渲染，并以项目、分集、质检模式三者为 key，因此切换范围会丢弃上一份报价。挂载时不发任何请求：取报价是一次按钮点击，质检模式在 `new_candidates` 与 `rule_reaudit` 之间显式选择，切换模式会丢掉屏幕上已有的报价。报价渲染预计金额与封顶金额、调用次数、过期时间、Writer 逐张给出的 `validationErrors` 原文，以及每张图一行 manifest，标明其 role、label、价格、闸门是否放行、是否从未质检过。

开始按钮只在 `quoteReady` 为真且 manifest 非空时渲染，并且在 operator 勾选"我已逐张看过上面的清单"之前保持禁用。它把 Writer 自己的 `confirmationText` 原样回传，连同 Writer 用来绑定 preflight 的四个字段，所以中途变了的报价会被 Writer 拒绝，而不会被悄悄重新定价。遇到 502 时面板同时丢掉勾选和报价，因此结果未知的一批绝不可能被同一次点击重发；operator 必须重新取一次报价。花钱只由 operator 的点击决定，这里没有定时器、挂载钩子或其他路由成功后的自动取价与自动开始。

桥通过包内 [index.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/index.ts) 的 `ctx.effect(...)` 注册，并返回两个 `webServer.register` 的 disposer，所以卸载时精确注销这两条路由。

## 范围与影响面

仅 harness。不改 Writer，不改 schema，不加迁移。不做 live 构建、部署或运行根写入：代码停在分支 `qingmu-self-learning-loop-20260916` 等待审阅。编写过程中也没有对 live 调用过任一路由，因为免费报价仍会写入一行 `provider_preflights`，而开始会花钱；两者都留给 operator。面板自身不调用 provider，桥也不假设 Writer 的免费承诺，而是拿回执去校验它。登录复用既有的 `/api/qingmu/editorial-handoff/human-session`，不新增第二条凭据通道。

## 已考虑的替代方案

**让导演 agent 发起质检。** 否决。这批调用是付费的，能入队付费 `vision.audit` 的 agent 等于把 operator 从花费决定里移走。agent 可以读质检产出的 `quality_status`；只有 operator 能买它。

**挂载时自动取报价，让面板始终显示价格。** 否决。报价不调用 provider，但不是零写入：每次都插入一行 30 分钟过期的 preflight。一个每次切换分集都取价的面板会在没人索要任何东西的情况下把那张表填满。

**在桥里加一道花费上限。** 否决。`provider_gate.preflight` 已经根据项目授权算出 `allowed` 与 `quoteAllowed`。harness 里的第二道上限等于把一个可调参数复制到两个仓，两边迟早不一致。桥只转发 Writer 的决定，并拒绝那些与自身声明的不变量矛盾的报价。

**接受浏览器传来的逐张资产 id。** 保留但加约束：桥转发 `assetIds`，每项按 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` 校验，拒绝重复，上限 100 项与 Writer 自己的 `max_length` 一致。面板始终发空列表，所以取的是整集报价，而更窄的选择留给将来的界面，无需改桥。

## 验收标准

- `pnpm exec vitest run packages/experimental/client-ui-qingmu-cockpit packages/experimental/qingmu-yimeng-command-adapter` —— 122 个文件、2256 个测试通过，4 个既有跳过。新增 23 个测试：桥 15 个，客户端 8 个。
- 桥测试逐条点名了承重的反向用例：声称 `providerCalls: 1` 的报价被拒；覆写 `routeKey`、`capability` 或 `imageRegeneration` 的 manifest 项被拒；封顶低于预计、`callCount` 与 manifest 不一致都被拒；缺少字面量 `confirmed: true` 的开始请求根本到不了上游；服务令牌、跨源请求、无 cookie 请求都在任何上游调用之前被拒；503、传输失败、以及回执里写着错误 capability 的情况，全部报为未知而不是拒绝。
- 客户端测试断言：挂载时不发请求；报价成立之前没有开始按钮、勾选之前按钮禁用；报价被消费后消失，因此无法开始第二批；结果未知时丢掉勾选并且全程只发出一次 `confirmed: true`；被阻断的报价显示逐张理由且完全没有开始按钮。
- `pnpm run typecheck` 退出码 0。
- 对改动的六个文件运行 `oxlint`，0 错误。命令适配器的 `index.ts` 报了 7 个错误，位置都在本次未触碰的行；单独对该文件的 `HEAD` 版本跑同一检查复现全部 7 个，因此属于基线，不是本次引入。
- `pnpm run duplication` 报 265 处克隆，其中 7 处涉及本次新增的文件。该门在本分支基线上就是红的：另外 258 处完全不提这些文件，而新面板加入的那处登录表单克隆在 `EntityDraftHumanReview.tsx` 与 `StoryboardHumanReview.tsx` 之间早已存在。抽取共享守卫让计数下降而不是上升 —— 抽取之前的同一次测量报 268 处，其中 10 处涉及新文件。
- 面板使用的 32 个 locale 键与定义的 32 个完全一致，两种语言各定义一次。

## 风险

**浏览器 → Host → Writer 整链未做端到端验证。** 下一步应当补一个形如 [qingmu-entity-draft-human-review.e2e.ts](../../../../apps/web/tests/qingmu-entity-draft-human-review.e2e.ts) 的 e2e，这里刻意没有包含：它需要 qingmu profile 的客户端构建、Playwright Chromium 和 Writer fixture venv，而写作时宿主磁盘只剩 9.1 GiB，低于本项目停止重活的 10 GiB 线。桥所校验的字段名改为逐一读 live Writer 源码确认，包括 `api.py:9575` 处的 manifest 键集合与 `api.py:9745` 处的四个绑定字段。源码一致不等于跑过一遍真实 transcript，所以这套接线应视为已审阅、未证实。

**较早的资产可能全部无法取价。** 报价要通过 `_public_media_url` 解析每张图，而质检路径上的 `_require_real_url` 只接受 HTTPS URL 或不超过 20 MB 的 base64 图像 data URL，同时生成出的资产链接 24 小时过期。链接已过期、文件又大到无法内联的资产会全部落进 `validationErrors` 的 `public_provider_media_url_missing`，产出一份 manifest 为空的被阻断报价。这是失败即关闭、不花一分钱，但表现出来就是"质检无法开始"。确认它需要对 live 真取一次报价，那是 operator 的动作。

**Writer 的 422 会被报成 409。** Pydantic 拒绝桥自己发出的上游请求体时，会呈现为一次确定的拒绝，而不是桥的缺陷。它失败即关闭、不会入队重复批次，但会把诊断引向错误方向。

**回执读不出来的开始会把已入队的批次留在身后。** 502 告诉 operator 结果未知并拒绝重发，但 harness 没有能读回 `generation_tasks` 的路由，所以确认那批是否落地只能直接查运行库。补一个批次状态的读桥是自然的后续，本次未包含。

**三个人审面板仍各自带着一份登录表单。** `EntityDraftHumanReview.tsx`、`StoryboardHumanReview.tsx` 与新增的 `AssetReferenceAudit.tsx` 重复了同样的凭据输入和同样的登录辅助函数，克隆检测报出四对。抽出一份共享的登录块会动到两个已提交、已审阅的面板，所以本次止步于桥层守卫 —— 那里重复的代码决定谁有权花钱。面板层的抽取是一次独立的简化。
