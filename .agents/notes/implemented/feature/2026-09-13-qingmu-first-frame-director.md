# Agent Note: Qingmu first-frame director input

Status: implemented

English | [中文](2026-09-13-qingmu-first-frame-director.zh.md)

## Problem

A shot could inherit both older world-layout proposals and its current shared scene. Native directors could reconcile video sources but could not inspect the actual first-frame image preparation.

## Decision

Expose the existing Writer shooting preview through the native command adapter and a bound director tool. The cockpit supplies an editable starting-image instruction. The primary directing method reads full current sources, saves a reconciled segment context and independent still, then inspects the actual compiled prompt. Working references retain their exact IDs, hashes and purposes. Existing source freshness, plan persistence, generation and adoption remain in their owning modules.

## Alternatives considered

Deleting world prose by keyword loses creative intent. Another compiler would diverge from the submitted request. The shared preview keeps one production path and lets the director resolve meaning.

## Consequences

Directors inspect the real input without paid image generation. Old projects keep their source and save path; edits preserve unrelated directing fields. Preparation may retain a local preview file but neither queues media nor grants approval. Semantic reconciliation and image fidelity require separate verification.

Live verification found a missing compatibility-target update after the skill body changed. The source manifest now includes reviewed prior versions and the previous release; the existing compatibility regression covers all current targets. Planning read failures appear in the shooting assistant with a read-only retry, preserving the typed request and preventing a send until recovery.
