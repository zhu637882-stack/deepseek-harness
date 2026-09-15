# Agent Note: Qingmu writing history pages

Status: implemented

English | [中文](2026-09-15-qingmu-writing-history-pages.zh.md)

## Problem

A long creative turn can move its start outside the latest 64-message history page. Reading that page alone loses the running state and prevents an idle, interrupted session from reaching native recovery.

## Decision

The existing writing reader follows the Host's backward history cursor until it observes a turn boundary, reaches the request baseline, or exhausts history. Each cursor must move backward. The complete observed interval then enters the existing live-session check and interruption recovery.

## Alternatives considered

Increasing the page size leaves a different fixed failure threshold. Treating missing boundaries as completed would permit incomplete drafts. Replaying the prompt risks duplicate model work.

## Consequences

Long unfinished turns require additional read-only history calls. Completed results and short turns retain one-page reads. Recovery uses the same session and never sends a prompt or changes navigation. Focused tests cover both live and interrupted multi-page turns; this does not verify provider-generated media quality.
