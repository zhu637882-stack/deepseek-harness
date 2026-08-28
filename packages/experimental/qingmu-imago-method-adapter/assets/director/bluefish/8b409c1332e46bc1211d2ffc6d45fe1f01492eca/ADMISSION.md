# bluefish 资产包来源与准入说明

- 来源：https://github.com/bluefish2026/BlueFish @ `8b409c1332e46bc1211d2ffc6d45fe1f01492eca` · Apache-2.0（LICENSE 随包）
- 准入：manifest 条目 `bluefish`（pure_module_adapter）· 目标阶段 D/E
- 上游验证基线：三条隔离的 prompt-builder 断言通过（manifest 记录）。

内容：`bluefish-server/app/services/prompt_builder.py`（提示词变量/模板
编译器）与其测试。SHA 见 `PROVENANCE.sha256`。

已知缺陷（manifest blocker，接线前必须修复）：
1. 未解析占位符目前**静默残留**——接入前必须改为失败关闭；
2. 不得把 PromptIR 压平成字符串拼接——必须保留结构化字段语义。

边界：只做 D/E 适配器的模板编译件；修复失败关闭前不得进入任何
工作单加载链。
