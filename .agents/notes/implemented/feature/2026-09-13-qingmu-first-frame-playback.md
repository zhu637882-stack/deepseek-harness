# Agent Note: Qingmu first-frame candidate playback

Status: implemented

English | [中文](2026-09-13-qingmu-first-frame-playback.zh.md)

## Problem

Native sessions can read task state through Host authentication, but browser image elements cannot attach that service credential. An unsigned Writer media URL therefore returns 401 after successful generation.

## Decision

Writer signs the materialized candidate's media ID with its existing expiring media-access mechanism after checking project and task scope. The command adapter accepts only that relative media path with one expiry and signature, then resolves it against the configured Writer origin. Reading the same request renews the link without submitting another task.

## Alternatives considered

Putting the owner token in the browser would expose unrelated account authority. A separate media proxy would duplicate the signed playback mechanism already used for video candidates.

## Consequences

Candidate preview works without human cookies. Media signing grants neither creative acceptance nor official selection. Tests cover signature binding, expiry and adapter URL restrictions; real browser verification checks image decoding and project restoration.
