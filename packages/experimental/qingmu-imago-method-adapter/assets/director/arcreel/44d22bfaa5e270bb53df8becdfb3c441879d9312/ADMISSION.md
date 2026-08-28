# arcreel 资产包来源与准入说明

- 来源：https://github.com/ArcReel/ArcReel @ `44d22bfaa5e270bb53df8becdfb3c441879d9312`
- 许可证：**仅 skills/ 子目录为 MIT**（本包 LICENSE 即该子目录许可）。
  仓库根为 AGPL-3.0 + Section 7 notice，**根许可文件与主程序一律未带入**，
  任何对主程序的吸收都必须另行法务评估。
- 准入：manifest 条目 `arcreel`（selected_content_candidate）· 目标阶段 E/LSUQC
- 上游验证基线：Documentation-only（manifest 记录）。

内容：`skills/video-workflow/`（SKILL.md + plan-safety / generation-modes /
generation-results 三份参考）——MIT 的 Video Workflow Skill。SHA 见
`PROVENANCE.sha256`。

排除（manifest blocker）：主应用代码不进青木；AGPL 部分零接触。

边界：按需方法参考；不复制其流程编排、不接其状态、不成为第二 DAG。
