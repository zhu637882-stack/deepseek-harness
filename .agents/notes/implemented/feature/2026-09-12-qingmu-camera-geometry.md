# Agent Note: Qingmu camera geometry from shared scene coordinates

Status: implemented

## Problem

Real asset-design trials retained scene prose but inverted furniture facing after changing camera. An independent image observer repeated the inversion despite correctly describing the original seat direction.

## Decision

Add one local director tool computing horizontal camera relations from explicit shared coordinates and meaningful object-front vectors. Asset and scene prompts and the scene skill instruct directors to identify source facts, estimates and uncertainty, retain one layout across viewpoints, and save adopted conclusions through existing design fields. No new scene database, automatic approval, model route, or paid call is introduced.

## Alternatives considered

A second vision model was tried and still made the orientation error. Repeated image generation would not fix contradictory input. A 3D reconstruction or rendering framework requires additional geometry evidence and deployment resources; it is not implied by this planar helper.

## Validation

Exercise opposite viewpoints, translation/rotation/scale invariance, behind-camera and field-of-view classification, edge-on and unknown fronts, and invalid inputs. The shipped YAML preset/native loop test records the real tool output and supplies it to the following model request; registration disposal is checked. Refresh older example fixture wiring for the already-shipped compaction plugin.

## Risks

Coordinates are authored assumptions, not measured geometry. The tool does not determine height, occlusion, hidden surfaces or model obedience; those still require image review. Director choices and screenplay exceptions remain authoritative.
