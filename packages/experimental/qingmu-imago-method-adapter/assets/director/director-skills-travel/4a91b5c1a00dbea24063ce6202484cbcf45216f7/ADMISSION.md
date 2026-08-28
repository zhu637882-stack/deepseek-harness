# director-skills-travel 资产包来源与准入说明

- 来源：https://github.com/kangarooking/director-skills @ `4a91b5c1a00dbea24063ce6202484cbcf45216f7` · MIT（LICENSE 随包）
- 准入：manifest 条目 `director-skills-travel`（selected_content_candidate）· 目标阶段 A2/C5R/E
- 上游验证基线：四个脚本编译通过；packet、prompt 和 timeline 检查实际运行；
  空 manifest 失败关闭（3 errors / 13 warnings，manifest 记录）。

内容：`travel-skill/SKILL.md`、6 个模板（project-brief / asset-register /
storyboard / shot-manifest / generation-log / qc-report）、4 个脚本
（`build_generation_packet.py`、`lint_prompt.py`、`lint_shot_manifest.py`、
`validate_timeline.py`——现成的 fail-closed lint 套件）。SHA 见
`PROVENANCE.sha256`。

排除：仓库其余 Director Skill 与不在候选清单的文件未带入。

本地修改（相对上游 commit，仅此一项）：为满足仓库 whitespace 门禁，
对 6 个文件（asset-register.csv、generation-log.csv、project-brief.md、
qc-report.md、storyboard.md、validate_timeline.py）做了行尾空白与
EOF 多余空行清理；无任何内容语义改动。PROVENANCE.sha256 按清理后
字节记录。

边界：manifest/packet/lint 只做工具与模板；不得接管 next-action、
不写 V6 状态、不产生批准语义。
