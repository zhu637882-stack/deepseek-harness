# storyboard-skill 资产包来源与准入说明

- 来源仓库：https://github.com/Zhekinmaksim/Storyboard
- 固定 commit：`76a78c55922d1b007b1478aafb6faaf672487e53`
- 许可证：MIT（LICENSE 随包保留）
- 准入清单：`imago-v6-director-open-source-asset-manifest-20260828.json`
  条目 `storyboard-skill`（disposition: pure_module_adapter）
- IMAGO 目标阶段：C5R、PREVIS
- 上游验证基线：53 测试收集、51 离线通过、2 个 OpenRouter 实时
  测试因无 Key 跳过（manifest 记录）。

## 本目录内容（TOOL_PROVIDER 候选）

5 个纯模块脚本：`scene.py`（Shot/人物/视线/轴线/环境数据结构与容错
解析）、`render.py`（确定性 SVG 分镜渲染）、`packet.py`（镜头表/摄影
说明/对白/连续性交接包）、`director_notes.py` 与 `iterate.py`
（定点修改与结构化 revision 合并）。逐文件 SHA 见 `PROVENANCE.sha256`。

## 接法（按融合方案 H1）

写 `IMAGO C5R → Storyboard Scene` 与 `Storyboard Packet → PREVIS
工作稿` 两个转换器；输出仍是 proxy，不得晋升为正式资产。调用经
Python SDK / 文件协议，进程内运行、禁网。

## 按 manifest 排除、未带入的文件

- `scripts/parse.py`、`scripts/critique.py`：内含 OpenRouter/Kimi
  Provider 调用，未获授权也未验证（manifest blocker）。
- `scripts/director_memory.py`：不能成为项目创作权威（manifest blocker）。
- `kimi_client.py`、`gallery_store.py`、`gif_export.py`、`enrich.py`、
  `character_bible.py` 等其余脚本：不在 manifest 候选清单。

## 使用边界

只产出确定性工具回执与 PREVIS proxy；不写 V6 stage state、不调用
Provider、不联网、不成为第二真源。
