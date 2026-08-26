# Qingmu OS browser brand

English | [中文](README.zh.md)

This private distribution plugin fills the generic sidebar mark, sidebar name, and blank-conversation hero mark only when `DSH_CLIENT_BUILD_PROFILE=qingmu`. It renders the public product name `青木 OS` and an original Q/play/sprout vector mark. The surrounding first-class `qingmu` build profile owns the browser title, PWA metadata, welcome notice, and provider-neutral model onboarding. Loading this plugin into a non-Qingmu client artifact fails loudly instead of producing a half-branded shell.

The three occupants install through one declaration-aware slot effect, so the plugin can load before or after the sidebar and conversation declarers and leaves no partial brand state during teardown.

## Model Experience

None, as this browser-only plugin registers no prompt, schema, tool, result, or provider route.

#### KV Cache effect

None. The package assembles no prompt and sends no provider request.

## Known Limitations and Deferred Work

- This package intentionally owns only the three brand slots. Title, PWA metadata, welcome copy, and model onboarding are implemented by narrow Qingmu build-profile branches in the surrounding distribution.
- Provider identities remain truthful inside Models settings; Qingmu does not relabel third-party services.
- The current PWA asset is a scalable SVG. A production installer still needs platform-specific icon sizes and signing assets.
- The package is private and experimental until the Qingmu distribution repository and publication namespace are fixed.
