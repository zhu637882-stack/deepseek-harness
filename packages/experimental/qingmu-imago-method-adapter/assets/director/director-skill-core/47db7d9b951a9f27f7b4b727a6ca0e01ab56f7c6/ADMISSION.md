# director-skill-core 资产包来源与准入说明

- 来源仓库：https://github.com/wuwangzhang1216/DirectorSKILL
- 固定 commit：`47db7d9b951a9f27f7b4b727a6ca0e01ab56f7c6`（上游 tag v2.0.0）
- 许可证：MIT（LICENSE 随包保留）。上游对导演风格模块另有
  "只覆盖高层方法、不得复制具体表达" 的说明，随包一并遵守。
- 准入清单：`imago-v6-director-open-source-asset-manifest-20260828.json`
  条目 `director-skill-core`（disposition: selected_content_candidate）。
- IMAGO 目标阶段：CDEV、C5R、D、E、LSUQC、human-editor-after-LSUQC。

## 本目录内容

内容包（无运行时代码）：6 个模板、2 个参考（含 19 个失败码）、
30 条评测记录。逐文件 SHA-256 见 `PROVENANCE.sha256`。

## 按 manifest 排除、未带入的文件

- `assets/sound-plan-template.md`：其"导入时静音生成视频"默认与
  V6 原生音画策略冲突（manifest blocker）。需要声源/窗口/交接字段时
  另行走 clean-room 提炼，不复制原文。
- `assets/edit-timeline-template.md`：属于 LSUQC 之后的人类剪辑交接
  （manifest blocker），不在本批次范围。
- `references/director_styles/`（20 个导演名文件）：不得把"模仿某导演"
  作为生成指令，也不复制电影具体镜头（manifest blocker）。如需导演
  风格技术卡，必须 clean-room 重写为高层技术描述。
- `references/ai-video-tool-adapters.md`、`cinematic-language.md` 等
  其余文件：不在 manifest 候选清单，未带入。

## 使用边界

本目录是内容暂存库，不自动成为活跃 Skill。任何使用必须经
`src/director-assets/registry.ts` 注册并遵守：
只产出方法卡、检查卡、Finding 与评测输入；不写 V6 stage state、
不替代 next-action、不授权费用、不提交 Provider、不批准媒体、
不记录人类签收。
