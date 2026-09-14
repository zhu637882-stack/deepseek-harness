# Agent Note: Reference observation uncertainty

Status: implemented

English | [中文](2026-09-15-reference-observation-uncertainty.zh.md)

## Problem

During a real batch preparation, the visual observer called a wall-mounted board a sealed window. The director then chose an older courtyard with a known misplaced sign. All image versions were available: this was an interpretation and comparison error, not a missing catalog entry.

## Decision

The observer separates visible structure from inferred purpose, including ambiguous panels and openings. Batch selection compares the requested correction, remaining defects and new defects across versions; an inferred label alone cannot justify returning to a known defective version. The existing prompt-based observation digest prevents reuse of observations made under the previous instructions.

## Alternatives considered

**Always choose the latest image.** A newer image can introduce another defect.

**Hard-code a project's chosen image.** This would not improve selection in another project.

## Consequences

The focused bridge and batch tests pass with updated request snapshots (116 tests). These instructions improve evidence handling but do not guarantee visual judgment or generated continuity. The real revised batch must still be inspected before submission.
