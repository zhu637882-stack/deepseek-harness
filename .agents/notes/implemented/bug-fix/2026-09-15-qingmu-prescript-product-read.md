# Agent Note: Product reads before screenplay confirmation

Status: implemented

English | [中文](2026-09-15-qingmu-prescript-product-read.zh.md)

## Problem

The native screenwriter calls `qingmu_read_asset_design` to inspect uploaded product references in a new project. Writer reused its save precondition for this read, returning `asset_design_script_required` before a screenplay existed.

After confirmation, the asset prompt received only the screenplay and visual settings. Character, voice and room descriptions outside the screenplay block in the original brief were absent, inviting new guesses.

## Decision

The read uses the existing owner-scoped planning source lookup without requiring a script. The adapter models absent `script` and `scriptSha256` as null. Creative settings and product references remain available. Existing-script freshness checks and the save precondition remain in Writer.

Creative settings include the hash-validated original `initialBrief`. The existing asset prompt carries it as supporting source material, with current screenplay, saved design and explicit revisions taking precedence over old prose and stage instructions. It does not copy the brief into image prompts or grant execution authority.

## Alternatives considered

**Create a placeholder script first.** Rejected because reading an upload should not create a formal screenplay or imply that the writing stage finished.

## Consequences

Writing can inspect its own product inputs. Clients must tolerate a missing screenplay during read-only discovery. This does not permit asset-design saves or generation without their existing prerequisites. Writer regression tests exercise a fresh product project, cross-owner rejection and unchanged storage after reads and rejected saves; adapter tests retain the null fields and references across the GET boundary.

The initial brief increases design context by its original size. Writer tests retain its exact contents; the UI test passes outside-screenplay character and room details through the actual composer input. Visual execution still requires generated-media inspection.
