# Agent Note: Preserve director selection during source refresh

Status: implemented

English | [中文](2026-09-15-director-selection-refresh.zh.md)

## Problem

Saving a director plan changed the storyboard revision. The cockpit replaced its browser lease during the resulting refresh, so the same request could no longer save its reference draft despite unchanged shot selection.

## Decision

Separate selection lease lifetime from context reads. Revision and explicit refresh retain the lease; shot, session, connection changes and unmount release it. Context hashes still refresh and stale reads remain discarded. Host selection and source checks remain enforced.

## Validation

97 focused component, bridge and native-request tests pass, including unchanged selection refresh, reconnect, unmount and rejection after actual target changes. Real browser continuation is verified after deployment.
