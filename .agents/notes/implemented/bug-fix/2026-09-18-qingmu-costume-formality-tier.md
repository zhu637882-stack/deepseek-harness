# Agent Note: Qingmu costume formality tier in the character asset skill

Status: implemented

English | [中文](2026-09-18-qingmu-costume-formality-tier.zh.md)

## Problem

The character asset skill told the director how to restrain costume decoration and never told it how to choose a garment class, so every occasion collapsed into one restrained default. Section 1.1 carried two brakes — "身份高低不直接等于金色多少" and "选择与身份相关的三至五个辨识特征，不罗列整本服装词典" — and no throttle. An emperor at an enthronement, a sky sacrifice or a grand court audience was therefore designed under the same rules as an emperor reading memorials at his desk, and the operator's report on the live period drama was that the imperial dress was not splendid enough and that the likely cause was insufficient specificity — the design was 没有细化, not carried down to named parts.

The missing step was not vocabulary. The same section already requires 内外穿着层次、领襟和闭合方式、袖型与下装、腰带及鞋履, and requires fabric to be distinguished by 厚薄、垂坠、织纹与光泽 with pattern position and size stated. What it lacked was the prior decision that fixes which of those a given occasion demands: nothing derived a formality level from the scene, so the restraint rules applied at full force to a ceremonial design and read as a license to omit the ceremony's own required parts.

Closing the gap meant editing a pinned creative-method bundle, which records provenance mechanically. [skill-resources.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/skill-resources.ts) refuses to serve a resource whose on-disk digest differs from the recorded one, so an edit that did not re-record the digest would have removed the skill from the director's reach entirely rather than updating it.

## Decision

[character-asset/SKILL.md](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/skills/character-asset/SKILL.md) now makes the formality tier an explicit design step in section 1.1, placed before silhouette because the tier fixes which silhouette is even correct.

The tier is derived from the script's current occasion, not from the character's rank: 皇帝日常批奏折是常服，登基、祭天、大朝会是冕服. Historical subjects use that era's own forms, named in the skill as 常服、吉服、礼服、冕服; invented subjects use one equivalent ladder the film defines for itself. Each tier carries a required-parts list — 冕服 requires 冠冕形制与旒数、上衣下裳分色、章纹的位置与数量、蔽膝、佩绶、玉带、舄履, and 礼服与吉服 require the corresponding 冠饰、袍服分色、章纹或补子、腰带与履 — while 常服 keeps the existing three-to-five identifiers. A missing part at a high tier is recorded as an unfinished design rather than as restraint, and when the script does not state the occasion the director derives one tier from the dramatic situation and marks the derivation instead of defaulting to 常服.

Three existing mechanisms now carry the tier rather than a new one being invented. The tier and its required parts go into `locked_features`. Changing tier follows section 2's variant suffix rule, so an emperor's everyday robe and his ceremonial robe are two numbered variants and an approved version is never overwritten. The restraint sentence keeps its force but names its governor: 装饰密度随礼仪规格档位升降.

Within a tier the baseline richness still scales with the wearer's status: the tier caps the design and the status floors it. An emperor's everyday robe is gold-woven ochre silk with its dragon medallion, not a plain robe, and a poor household's formal dress is not gilded by sitting in a high tier. This second half is what the live evidence demanded, recorded in Consequences below.

Section 8's checklist gains `礼仪规格档位已定，该档必备件写齐（无服饰角色标 not_applicable）`, which is what turns the rule into a gate the asset must pass rather than prose the director may skip.

[sources.json](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/skills/sources.json) re-records `files["SKILL.md"]` for `character-asset` and extends that entry's `adaptation` string, which the reader tool serves alongside the content. `upstreamFiles` still points at upstream revision `678edc06`, and `adaptedFiles` already listed `SKILL.md`, so the entry continues to report itself as a Qingmu adaptation of an Apache-2.0 source rather than as upstream text.

## Alternatives considered

**Soften or delete the restraint sentence.** Rejected. "身份高低不直接等于金色多少" prevents the opposite failure — gilding a poor household because its member holds a title — and the defect was a missing selector, not a wrong limit. Removing the brake would buy splendour everywhere and lose the era and status legibility the same section requires.

**Add a numeric splendour dial the director sets per character.** Rejected. A dial untethered from the occasion reproduces the original defect in a new form: the director would still be choosing density from taste, and section 1.1 already states that numbers in these packages are not permanent limits. A tier derived from a fact the script states — which ceremony this scene is — can be checked against the script.

**Put the rule in `production-design`, which this skill already reads first.** Rejected. That bundle is shared with `scene-asset` and `prop-asset`, where a garment formality ladder has no referent, and the required-parts lists are costume-specific. Placing them where section 8's costume checklist can enforce them keeps one home per fact.

**Sync a newer upstream `ai-film-skills` revision instead of authoring the rule.** Rejected. The measured upstream revision carries no formality tier, so a sync would not have closed this gap; it would also have required re-deriving every per-file digest in a registry whose `open-film-writer` and `open-film-camera` entries no longer exist upstream. A sync remains worth doing on its own merits, separately from this fix.

## Consequences

The change buys the specificity the operator asked for, in a form the skill can check: the director must name an occasion-derived tier and enumerate that tier's parts before the asset passes QC, and 常服 versus 冕服 becomes two locked variants instead of one design drifting between scenes. It also makes the restraint rule legible as conditional rather than absolute, which removes the reading under which a ceremonial scene was correctly drawn plain.

It costs one more required field per costumed character, so a minor background figure now needs an explicit tier or an explicit `not_applicable`. The required-parts lists are Chinese imperial by example; a non-Chinese historical subject must map its own equivalent ladder, and the skill says the era's own forms govern rather than presenting the four names as universal.

The effect on generated costumes is observable only in a real asset run — no test asserts that a director picks 冕服 for a 大朝会, and this change did not add one, because the assertion would test a model's reading of prose rather than a code path. What is mechanically pinned is the registry invariant: [skill-resources.spec.ts](../../../../packages/experimental/qingmu-director-context-bridge/tests/skill-resources.spec.ts) recomputes every bundled file's digest against `sources.json` and requires `adaptedFiles` membership to equal `files` differing from `upstreamFiles`, so a future edit that forgets the digest fails the suite, and the reader tool fails closed in production. The suite passes at 759 tests with 2 pre-existing skips. No snapshot fixture embeds this skill's prose, so the keyless replay needed no re-recording.

The adaptation mechanism this change used is the one established by the [creative methods Agent Note](../architecture/2026-09-11-qingmu-creative-methods.md).

Read-only inspection of the live period project shaped the second half of the rule and also closed a false lead. The emperor's latest surviving turnaround — the only one of its three versions not library-deleted, and like every image asset of this project still `Unselected` — renders its 245-character design faithfully: 翼善冠 with two short wings and no bead strands, ochre round-collar robe, dense brocade ground, chest dragon medallion, leather belt with jade buckle, black cloth boots all present. The reported plainness was therefore not a rendering failure and not a missing detail; it was the design's own word choices, 暗赭金, a dark jade buckle and black cloth boots, which the status floor now corrects. The same inspection refutes a scene-side cause for the companion complaint that the emperor's position is wrong in many places: the 御书房 design names its axis explicitly (carved desk on the north wall, seat behind it, large screen centred behind the seat as the room's axis marker) and the compiled shot prompts name 案后北侧, 面朝南 and explicit camera coordinates, so a misplaced emperor in a generated frame is a generation-fidelity matter for the asset audit and the shot issue rule loop, not a missing scene rule. No scene rule was added on this evidence.
