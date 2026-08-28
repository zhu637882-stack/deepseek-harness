# ai-visual-director 资产包来源与准入说明

- 来源：https://github.com/jijiutong/ai-visual-director @ `b47f664ca00c50539c5365109e9360f82170972d` · MIT（LICENSE 随包）
- 准入：manifest 条目 `ai-visual-director`（selected_content_candidate）· 目标阶段 C5R/D/E
- 上游验证基线：11 个 unit 与 9 个 integration 结构测试通过（证明文件与顺序，不证明创作质量）。

内容：4 张引擎规则卡（reference-anchor / consistency-engine /
video-prompt-assembly / shot-budget）、2 张规则（continuity-check /
video-reference-assets）、4 个模板（full-board / sound-design-sheet /
character-sheet / scene-card）。仓库实际为 8 个子 Skill 文件（清单报告
已纠正旧报告的"9 个"）。SHA 见 `PROVENANCE.sha256`。

排除（manifest blocker）：`state-commit.md`、`project-manager.md`、
`project-graph.md`、一键零确认与全链路 task router——与 V6 next-action、
费用门禁和唯一机器合同冲突。其余不在候选清单的文件未带入。

边界：只做方法卡与 findings-only evaluator 素材；不写状态、不绕过
工作集边界。
