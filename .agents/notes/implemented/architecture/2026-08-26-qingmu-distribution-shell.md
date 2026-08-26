# Agent Note: Qingmu OS begins as a Profile-owned distribution layer

Status: implemented

English | [中文](2026-08-26-qingmu-distribution-shell.zh.md)

## Problem

Qingmu OS must look and behave like one product while retaining Harness upgrades and its plugin-removal boundary. Editing sidebar and conversation source directly would make every upstream update a three-way product merge, and installing Qingmu into the user's existing `web` Profile would mix product state with a developer's normal Harness state.

The first deliverable also needs an honest boundary. Replacing three generic brand slots proves the distribution seam, but it does not yet replace every product string or the short-drama workflow.

## Decision

Qingmu is an ordered, isolated Profile composition: `dsh-base`, then `dsh-web-app`, then a private `dsh-experimental-qingmu-web` Bundle. The Bundle disables the official brand occupant and inserts a private Qingmu client plugin. The plugin fills only `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark`. A first-class named `qingmu` client build profile supplies `DSH_CLIENT_BUILD_PROFILE=qingmu`, `DSH_CLIENT_TITLE=青木 OS`, and the source commit; runtime brand plugins fail loudly when they do not match the compiled artifact profile. That build profile selects Qingmu-owned PWA metadata, favicon, welcome copy, a distinct acknowledgement version, and a provider-neutral first-run route into Models while leaving stock builds unchanged. Provider identities remain truthful inside Models settings.

The visible mark is an original Q/play/sprout vector rendered with `currentColor`. No DeepSeek artwork is copied. Internal package identifiers keep the repository's existing namespace while the experimental packages remain private; public Qingmu naming is a later distribution-repository decision.

The stock `web` runtime Profile remains unchanged. A Qingmu runtime Profile is created outside the source tree and installs the experimental Bundle and brand package explicitly. The distribution carries a deliberately narrow upstream patch queue for named client-build selection, Qingmu PWA assets, build-profile-owned welcome/model onboarding, and mismatch guards; each branch is covered by stock-versus-Qingmu tests.

## Alternatives considered

- Patching the generic sidebar and conversation packages was rejected because it would turn upstream Harness updates into repeated source merges.
- Reusing the stock `web` Profile was rejected because it would mix Qingmu product state with the user's normal Harness installation.
- Copying the complete `web-app` Bundle was rejected because it would fork a large roster that can remain upstream-owned.
- Mutating the welcome dialog from the DOM was rejected because it would be timing-sensitive, inaccessible, and invisible to source-level brand audits.

## Testing

Component tests prove fail-loud profile matching, all three slot occupants, teardown, public text, scalable mark geometry, and provider-neutral model onboarding. Client-build tests prove both named profiles resolve exact public environments. A Bundle composition test layers the real base, web-app, and Qingmu patches and proves that the official row is disabled while exactly one Qingmu row is mounted. The delivery additionally requires stock and Qingmu client builds, an isolated Profile config dump, and a live local browser smoke test including the no-model route.

## Consequences

Upstream Harness updates can be rebased below a small Qingmu layer. The runtime Bundle and brand package remain removable; removing the complete distribution also removes the four narrow build/PWA/onboarding/mismatch profile branches. The stock Profile remains usable for comparison and its tests guard the upstream behavior. This slice is intentionally not a complete white-label claim: remaining product strings and the IMAGO/Yimeng production surfaces stay visible in the phase ledger until their own plugins and tests land.
