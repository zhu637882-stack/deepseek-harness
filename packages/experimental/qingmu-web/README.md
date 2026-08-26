# Qingmu OS Web distribution Bundle

English | [中文](README.zh.md)

This private Bundle is the Qingmu OS distribution layer over the stock Harness `base` and `web-app` bundles. It disables the official brand occupant row, inserts the Qingmu browser brand, then composes the loopback-only Yimeng read adapter, the stateless IMAGO method adapter, the separately pluggable command adapter, and the production cockpit in dependency order. Generic sidebar and conversation packages remain stock Harness components.

An isolated Qingmu profile should compose the bundle order `dsh-base`, `dsh-web-app`, then `dsh-experimental-qingmu-web`. The profile is runtime state and remains separate from the stock `web` profile.

The IMAGO method adapter resolves its Core root from a non-blank explicit Cordis `config.coreRoot`, then falls back to `IMAGO_OS_CORE_ROOT` when that setting is absent, empty, or whitespace-only. Either resolved value must be an absolute path. A non-blank explicit configuration takes precedence over the environment variable, invalid values fail closed, and this distribution patch contains no machine-specific root.

The same Host also requires a raw, untrimmed `QINGMU_IMAGO_ATTESTATION_KEY` of at least 32 UTF-8 bytes. The key is environment-only: it is not a Cordis field or browser value, and this distribution patch contains neither a key nor a placeholder secret.

## Model Experience

None, as this distribution patch changes browser composition without registering model-facing behavior.

#### KV Cache effect

None. No model-facing tokens are added.

## Known Limitations and Deferred Work

- The cockpit reads Yimeng's authoritative business projection and currently exposes the bounded `episode_script` flow plus the first `element_profile` vertical slice for props. Actor and scene editing remain deferred; neither flow authorizes a paid Provider or infers human signoff.
- The separate stateless IMAGO adapter now projects prop field guidance, checklists, work orders, and review cards into the cockpit. It does not copy IMAGO state or expose a second Stage/DAG.
- The source package stays private and experimental while the product distribution namespace is being established.
