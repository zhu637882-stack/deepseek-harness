# nautilus-studio 资产包来源与准入说明

- 来源：https://github.com/yeahdongcn/nautilus-studio @ `b9a30f02ffb5b00b8d1eb55da8e987504a2df9fa` · Apache-2.0（LICENSE 随包）
- 准入：manifest 条目 `nautilus-studio`（pure_module_adapter）· 目标阶段 C5R/E
- 上游验证基线：Python 3.12 下 75 个聚焦测试通过（manifest 记录）。

内容：`domain.py`（ContinuityState/SubjectCard/DialogueLine 字段思想）、
`dialogue_harness.py`（语速估算、说话人绑定、对白窗口规范化与校验）、
`estimator.py`（shot/project 渲染估算）、`anchor_policy.py`（首尾/间隔锚点
选择纯函数）。SHA 见 `PROVENANCE.sha256`。

接法：字段编译到 C5R 的 state_in_out、shot_dialogue_performance_contracts、
speech_breath_mouth_listener_frame_windows 及 E 的原生音画提示块。不把
Pydantic 模型装成 IMAGO 合同。

排除（manifest blocker）：大体量 planner、DB、runner、Provider adapter、
项目 ID 系统。边界：只读诊断与字段编译，不写状态、不联 Provider。
