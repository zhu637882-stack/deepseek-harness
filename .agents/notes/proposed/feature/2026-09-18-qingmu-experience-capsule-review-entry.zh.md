# Agent Note：青木经验胶囊晋升进入驾驶舱

Status: proposed

[English](2026-09-18-qingmu-experience-capsule-review-entry.md) | 中文

## 问题

导演经验通道的读回侧已在 [2026-09-16](2026-09-16-qingmu-experience-capsule-readback.zh.md) 交付：`{{experience_capsules}}` 每次组装都重新读取 active 库，`mergeApprovedCapsules` 固定了晋升语义。那篇 Note 自己记下了缺口——「暂无操作者界面，晋升只能走 `promote_experience_capsules.py` CLI」。缺口至今仍在，runtime root 也显示了它的代价。`/Users/a1234/qingmu-native/experience-capsule-queue.json` 中有导演在真实退回后提交的五条胶囊（`SELF-cross-shot-read-last`、`SELF-guarded-save-fallback`、`SELF-closeup-frame-width-first`、`SELF-resave-unchanged-revision`、`SELF-two-shot-near-occlusion`）；`/Users/a1234/qingmu-native/experience-capsules-active.json` 中是一次性 seed 写入的十四条 `EXP-*`，`SELF-*` 为零。写入侧上线这两周里，导演关于自己学到的东西一条也没有回到导演。

CLI 不是坏了，是没人看见。晋升需要线上 venv、正确的 `--runtime-root`、先用 `--list` 才知道有东西在等、再给出准确的 id。驾驶舱没有任何位置报告「有胶囊待审」，于是闭合闭环的那一步只在操作者主动想起来时发生。这与分镜人审闸门、资产审计入口是同一类缺陷：机制已经完成，harness 没有入口。

它下面还压着两个较小的缺陷。提交工具用裸的 `readFile`/`writeFile` 读写队列，因此相近时刻提交的两条胶囊可能丢掉一条，写入中途崩溃还可能留下截断的队列。而 `loadActiveCapsules` 对损坏的库返回 `[]`，这对人设是正确的——导演必须照常运行——对一个人审面板却是错的：空列表读起来像「还没有入库任何胶囊」，掩盖了「没有任何经验正在被注入」这件事。

## 方案

一个文件层、两个 Host 路由、一个驾驶舱面板，以及这个面板成为第四个使用者后的共用登录块。

**胶囊文件层** —— [experience-capsule-files.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-files.ts) 接管两个文件。`CAPSULE_ID` 是唯一的 id 正则，此前在提交工具里另有一份。`loadQueuedCapsules` 与 `loadApprovedCapsules` 严格读取：超过 1 MiB 的文件、权限错误、非数组的队列、非法 JSON 都抛出带文件系统 `cause` 的 `CapsuleStoreError`，而文件不存在是首次写入前的正常状态，读作空。`writeCapsuleFile` 先写临时文件再 rename 到位，读者只会看到旧内容或新内容。`withCapsuleStoreLock` 用一条 promise 链把本进程内所有 read-modify-write 串行化；提交工具与晋升路由都取这把锁，因此导演在晋升写入期间追加的胶囊既不会从队列里被丢掉，也不会未经看见就被批准。两个 Python 脚本取不到这把锁，文档中把它们定位为部署期步骤，在没有导演会话提交时运行。

[experience-capsule-tools.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-tools.ts) 中的提交工具现在把这把锁内的裁剪与追加通过 rename 写入，保留它自己的 30 天期限与重复 id 拒绝。`capsuleQueuePathFor` 移到 [experience-capsule-store.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-store.ts)，与 `capsuleActiveStorePathFor` 并列，两个路径由同一个模块解析；`resolveCapsuleRuntimeRoot()` 取代了 `model-tools.ts` 中两份 `process.env.QINGMU_RUNTIME_ROOT ?? process.env.QINGMU_NATIVE_ROOT ?? ''`。`parseActiveCapsules` 从 `loadActiveCapsules` 中拆出，使严格读者与宽松的人设读者共用一份校验；`DEFAULT_RENDER_LIMIT` 改为导出的 `ACTIVE_CAPSULE_RENDER_LIMIT`，因为人审状态必须说明哪些已入库胶囊真的会到达模型。

**两个 Host 路由** —— [experience-capsule-review.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-review.ts) 注册 `GET /api/qingmu/experience-capsule-review` 与 `POST /api/qingmu/experience-capsule-review/promote`。读取返回一份 `qingmu-experience-capsule-review-v1` 文档：注入上限、落在上限内的已入库条数、每条带 `alreadyApproved` 标记的队列，以及 `stages` 必然存在、`injected` 由位置算出的 active 库。晋升请求体恰好是 `{ confirmed: true, ids: [...] }`，上限 8 KiB 与 64 个 id，每个 id 都要匹配 `CAPSULE_ID` 且拒绝重复；没有「全部批准」的形式，因此一次决定总是点名操作者读过的那些胶囊。面板读取之后已离开队列的 id 返回 409 并带上缺失的 id，因为队列在这次决定下面动过，操作者必须重新看。

两个路由都要求 `isTrustedApiRequest`，晋升额外要求 `isHumanBrowserWrite`。没有 runtime root 的部署返回 503 `experience_capsule_review_runtime_root_unconfigured`，而不是一份空的人审状态；本进程读不了的胶囊文件返回 503 `experience_capsule_review_store_unavailable`：「队列是空的」和「队列不可用」在操作者眼里不能是同一件事。晋升先写 active 库再裁剪队列，因此两步之间失败会留下「已入库且仍在队列」的胶囊——重新读取能同时看到两者，再次晋升会覆盖已入库的那条——相反的顺序则可能静默丢掉一条已批准的经验。

路由放在 bridge，而不是其他 human-review bridge 所在的 command adapter：adapter 是 bridge 的 peer 兼 dev 依赖，adapter 里的路由若 import bridge 状态就构成环。改为由 bridge 通过 adapter 的 `./src/*` 导出引入 `isHumanBrowserWrite`、`readJsonBody` 与 `jsonResponse`；`isHumanBrowserWrite` 是 [human-browser-bridge.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/human-browser-bridge.ts) 中新增的，从 `browserWriteHeaders` 抽出，使 origin、`authorization` 与 cookie 三项检查在转发型与非转发型路由之间只有一份。

注册走 [index.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/index.ts) 中的软 `ctx.inject(['webServer'], ...)`，包在返回两个 disposer 的 `host.effect(...)` 里。硬性 `export const inject = ['sessionProjections']` 不变，因为同一个包也挂载在导演 preset 作用域，那里没有浏览器可服务；没有 Host web server 的组合仍然加载，只是不提供人审路由。

**驾驶舱面板** —— [ExperienceCapsuleReview.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/ExperienceCapsuleReview.tsx) 挂载时读取一次，把队列渲染成每条一个勾选框，带症状、规则、提交时间与 `alreadyApproved` 标记，一行计数 `待审 / 已入库 / 本次注入 n/12`，active 库放在 `details` 之后。晋升按钮在勾选之前保持 disabled，只发送被勾选的 id；回执替换状态并回显 `promoted`。409 清空勾选并重新读取，使下一次决定针对真正在队列里的内容；403 显示登录表单，而不是猜测原因。刷新按钮位于始终渲染的操作行中，因此首次读取失败仍有重试入口——这一点在客户端 spec 发现之前是缺失的。没有 runtime root 的部署完全不渲染。这里不会定时勾选、晋升或重载：每次晋升都是操作者的一次点击。[QingmuCockpit.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/QingmuCockpit.tsx) 挂载它两次，一次在旧版 `overview` 页签，一次在五阶段框架的交付列 `details` 内；两种布局是 `applicationShell` 的互斥分支，因此只会挂载一个实例。

**共用登录块** —— [human-session.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/human-session.tsx) 收拢 `jsonObject`、`signInHumanSession` 与 `HumanSessionSignIn` 表单，此前 `EntityDraftHumanReview.tsx`、`StoryboardHumanReview.tsx`、`AssetReferenceAudit.tsx` 各有一份。资产审计那篇 Note 把它记为延期工作；第四个使用者让它到期。密码留在表单内部并在成功后丢弃，任何面板状态都无法记录或重发它。

## 范围与影响面

仅 harness。不改易梦（Writer）、不改 schema、无迁移、不做线上构建或部署：代码停在分支 `qingmu-self-learning-loop-20260916` 等待审阅。写作过程中没有对线上栈调用过任何一个路由；`/Users/a1234/qingmu-native` 下的胶囊文件只为上文引用的计数被读取过，方式是一次只读的 `json.load`。没有晋升任何胶囊：晋升是操作者的决定，也仍然是。两个路由不调用 Provider、不动预算、不写易梦状态——它们碰到的只有那两个胶囊文件。登录复用既有的 `/api/qingmu/editorial-handoff/human-session` 路由。

## 已考虑的替代方案

**保留 CLI。** 否决。它是对的，脚本化部署时仍然有用，但它自己什么都不报告，而闭环唯一的人审闸门应该出现在操作者本来就会看的地方。磁盘上的结构不变，因此两条通道的晋升语义一致，互不失效。

**让导演批准自己的胶囊。** 否决。这正是闸门本身：导演写下的关于自己的经验，在没有人读过的情况下进入它自己的下一轮提示词，是一次无界的自我写入——写入侧从一开始就落在队列而不是库里，原因就在这里。

**队列较短时自动晋升，或定时晋升。** 同样否决；而且它会让被注入的人设块在没有任何人做决定的情况下于轮次之间变化，从而移动提示词缓存前缀。

**把路由放进 command adapter，与其他 review bridge 并列。** 否决：adapter 是 bridge 的 peer 兼 dev 依赖，import bridge 状态必然成环。通过 adapter 的 `./src/*` 导出引入共用栅栏，既不反转依赖，又保持检查只有一份。

**定时轮询人审路由。** 否决。状态只在导演提交或操作者晋升时变化，这两件事操作者自己都看得见；定时器为省下点一次 `重新读取`，会永远读两个文件。

## 验收标准

- `pnpm exec vitest run packages/experimental/qingmu-director-context-bridge` —— 22 个文件、784 个测试通过、2 个跳过。新增测试为 `experience-capsule-files.spec.ts` 11 个、`experience-capsule-review.spec.ts` 11 个，以及 `loader-composition.spec.ts` 新增 1 个：后者启动真实的 Loader 与 WebServer，通过 HTTP 晋升一条被勾选的胶囊。
- `pnpm exec vitest run packages/experimental/client-ui-qingmu-cockpit --no-file-parallelism` —— 84 个文件、1219 个测试通过。18 个新增测试全部在 `experience-capsule-review.client.spec.tsx`。
- 路由 spec 逐条点名负例：服务端 `authorization` 头、跨源请求、无 cookie 请求在两个路由上都被拒绝；十四种不是「一组明确 id」的请求体——含多余字段、重复 id、65 个 id、超出上限的请求体、非 JSON 请求体——返回 400 且队列原封不动；不在队列中的 id 返回 409 并带上缺失的 id、什么都不写；runtime root 为空返回 503；进程读不了的库返回 503 而不是一份空人审。其晋升测试把两个文件读回，要求队列保留未勾选的胶囊、active 库为新→旧合并结果且复用的 id 被覆盖、随后一次读取与之一致。dispose 该 effect 会注销两个路由。
- 文件 spec 断言：锁一次只跑一个 read-modify-write，且任务失败后仍可用；队列与库缺失时读作空，而不可读、超大、非数组或非法 JSON 的文件抛出点名路径并保留文件系统 cause 的 `CapsuleStoreError`；写入通过 rename 替换整个文件并创建其目录；不可写路径被报告且不留临时文件。
- 客户端 spec 断言：挂载时不晋升任何胶囊；晋升按钮在勾选前保持 disabled，且只发送被勾选的 id；409 清空勾选并重新读取；403 走向登录、随后是一次可观察的重载而不是一份回执；任何晋升请求体都不携带凭据；晚于新读取返回的旧读取被丢弃；卸载时中止在途读取。
- 新后端模块覆盖率为语句、分支、函数、行四项 100%。面板为 95.94 / 97.33 / 93.75 / 100，`human-session.tsx` 为 96.15 / 94.11 / 100 / 100，未覆盖的行在「风险」中点名；`experience-capsule-files.ts` 为 98.07 / 100 / 90 / 100。
- 两个受限范围的 `pnpm run typecheck` 均退出 0。`oxlint -f unix` 对本次新增的任何文件，以及 `QingmuCockpit.tsx`、`locales.ts`、`human-browser-bridge.ts` 都没有发现。它在本次同样修改过的两个 bridge 文件里报了三处——`experience-capsule-tools.ts:50` 与 `model-tools.ts:317,339`——全部落在 diff 未触及的行范围内，属于既有基线而非本次引入。
- bridge README 中英双语都写明了挂载接口、两个文件与两个路由、写入顺序以及下文的限制，并重新记录了 `README.i18n.yaml`。
- 面板使用的 19 个 locale key 恰好是已定义的 19 个，每种语言各一次。

## 风险

**面板没有在真实浏览器中验证过。** 线上实例服务的是已部署的 harness 构建，因此只会显示旧界面；本地跑起来需要 `build:lib:host` 加一次 web 构建，而磁盘只剩 11 GiB，虽高于本项目 10 GiB 的停工线，但不足以花在只为一截图的构建上。面板改为通过 18 个针对桩 `fetch` 的测试来验证，桩断言了请求 URL、方法、credentials、cache 模式与请求体。这证明了组件自身的逻辑，不证明它渲染出来的样子；接线算已测试，布局算已审阅。

**晋升栅栏不是身份认证。** `isHumanBrowserWrite` 要求没有 `authorization` 头、`origin` 等于请求自己的 `host`、以及一个格式正确且不超过 8192 字节的 `jason_token` cookie。它从不向易梦的会话存储校验这个 cookie——只有登录代理能做这件事——因此本机上一个同时伪造 origin 头与貌似合理 cookie 的进程会被放行。这道栅栏拦住的是另一个源站上的页面和普通工具调用，拦不住有意为之的本机调用者；而这样的调用者本来也不需要它，因为以本用户身份运行的任何进程都已经能直接写这两个胶囊文件。这一点写在路由 JSDoc 与 bridge README 的 Known Limitations 中，不留作暗示。

**四个分支无法被测试到达。** 面板中 `promote` 的 `if (busy || ticked.length === 0) return` 与 `refresh` 的 `if (busy) return`，以及 `human-session.tsx` 中 `submit` 的守卫，都位于 `disabled` 按钮之后：对 disabled 元素触发 `fireEvent.click` 根本到不了 React 处理器，因此任何 DOM 级测试都覆盖不到。第四个是 `writeCapsuleFile` 中 `finally` 的清理箭头函数，只有 `rm` 自身被拒绝时才执行。它们是守卫，不是行为。

仓库的按文件 100% 门禁没有 `packages/experimental` 例外，而它对本包本来就是红的：用各自的 spec 测量，已提交的 `StoryboardHumanReview.tsx` 为 93.61 / 83.56 / 92.85 / 98.64，`AssetReferenceAudit.tsx` 为 84.44 / 72.36 / 92.85 / 92.30。本次新增的文件都高于这两者，`experience-capsule-review.ts` 四项均为 100。`human-browser-bridge.ts` 在两个包的测试下为 93.18 / 88.09 / 100 / 100，剩余未覆盖分支全部位于本次未触碰的 `readJsonBody` 与 `writerCode`；`browserWriteHeaders` 仍把 origin 与 `authorization` 检查放在读取 cookie 之前，与抽取之前一致，因此带服务端 token 的请求在解析 cookie 之前就被拒绝，既有的拒绝用例也仍能到达两个辅助函数。这是可达上限而非配置上限，差距在这里点名，而不是靠加一条例外来抹平。

**结果未知的晋升可能已经落地。** active 库写完之后出现的 503，意味着胶囊已入库而它的队列条目仍在。面板会报告失败并重新读取，再次晋升是覆盖而非重复，但操作者必须读状态才知道发生的是哪一种。两个文件之间没有事务。

**`scene-planning.client.spec.tsx` 在全量套件加覆盖率时抖动。** 不同轮次失败的是其中不同的测试；单独跑通过，加 `--no-file-parallelism` 也通过。它渲染的是 `ScenePlanningWorkspace`，本次改动没有碰过，因此抖动来自插桩时序，不是这里的回归。上文的驾驶舱计数正因如此取自 `--no-file-parallelism` 的一次运行。

**两个 Python 脚本与路由对并发写入的判断可能不一致。** 这把锁是进程内的。在导演会话正在提交时运行 `promote_experience_capsules.py`，是丢掉一条队列胶囊的唯一途径，这也是两个脚本仍定位为部署期步骤的原因。
