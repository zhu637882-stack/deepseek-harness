# jellyfish 资产包来源与准入说明

- 来源仓库：https://github.com/Forget-C/Jellyfish
- 固定 commit：`a9678194ddf2d9be3ccbe78d4287d87d5089e123`
- 许可证：Apache-2.0（LICENSE 随包保留）
- 准入清单：`imago-v6-director-open-source-asset-manifest-20260828.json`
  条目 `jellyfish`（disposition: pure_module_adapter）
- IMAGO 目标阶段：A2、C5R、ARF、E、F
- 上游验证基线：243 个 Python 文件静态解析通过、9 个相关测试通过
  （manifest 记录）。

## 本目录内容（TOOL_PROVIDER 候选）

4 个纯模块：`script_processing.py`（镜头/实体/证据区间/一致性问题
Schema）、`shot_preparation_state.py`（资产/对白/动作节拍准备态）、
`shot_video_readiness.py`（时长/提示词/参考帧/模型/活动任务前置
检查）、`shot_video_prompt_pack.py`（动作/邻镜/轴线/连续性/资产/
摄影的结构化提示包）。逐文件 SHA 见 `PROVENANCE.sha256`。

## 接法（按融合方案 H1）

Schema 字段映射到 A2/C5R/ARF/E 的青木合同外壳；readiness 只作为
**附加诊断**，最终可执行性仍由 IMAGO 工作集边界与易梦 ProviderGate
判断。

## 按 manifest 排除、未带入的部分

- SQLAlchemy 业务态、Provider 提交态、任务数据库、项目身份系统
  （manifest blocker：service 层与 SQLAlchemy/Provider task 模型耦合）。
- 本包绝不能替代 ProviderGate（manifest blocker）。

## 使用边界

只读诊断与提示包生成；不写状态、不提交 Provider、不接近预算或
批准语义。
