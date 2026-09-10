# Qingmu OS Web distribution Bundle

English | [中文](README.zh.md)

This private Bundle is the Qingmu OS distribution layer over the stock Harness `base` and `web-app` bundles. It disables the official brand occupant row, inserts the Qingmu browser brand, then composes the loopback-only Yimeng read adapter, the stateless IMAGO method adapter, the separately pluggable command adapter, and the production cockpit in dependency order. Generic sidebar and conversation packages remain stock Harness components.

An isolated Qingmu profile should compose the bundle order `dsh-base`, `dsh-web-app`, then `dsh-experimental-qingmu-web`. The profile is runtime state and remains separate from the stock `web` profile.

The IMAGO method adapter resolves its Core root from a non-blank explicit Cordis `config.coreRoot`, then falls back to `IMAGO_OS_CORE_ROOT` when that setting is absent, empty, or whitespace-only. Either resolved value must be an absolute path. A non-blank explicit configuration takes precedence over the environment variable, invalid values fail closed, and this distribution patch contains no machine-specific root.

The same Host also requires a raw, untrimmed `QINGMU_IMAGO_ATTESTATION_KEY` of at least 32 UTF-8 bytes. The key is environment-only: it is not a Cordis field or browser value, and this distribution patch contains neither a key nor a placeholder secret.

## Native director sessions

This bundle ships the `qingmu-director` agent preset, displayed as 青木导演, through `dsh.bundle.agentPresets`. The profile launcher registers its package-relative root alongside the stock modes; no installation path or copied user preset is needed. The Qingmu patch selects it as the profile default, subject to the native user default setting. Stock profiles and existing sessions keep their modes. Users can select this preset through the native mode picker for a new or blank session; populated conversations are not switched automatically.

The preset composes a complete director persona and the context bridge's [native director tools](../qingmu-director-context-bridge/README.md). It can save an explicitly requested reference-draft or script-dialogue edit through the existing Writer handlers. It does not add shell, arbitrary filesystem, self-modification, Provider, adoption or approval tools. The existing cockpit must bind the selected shot to that same session. If no shot is bound, the tool reports it rather than inventing a project. The cockpit can adopt a logged prompt suggestion into an editable draft; this is not the complete creative workflow.

The preset mounts the native skill filesystem provider with only its packaged roots, and the native `skill` tool. The Web bundle leaves discovery to presets; this creative preset does not scan unrelated installed project skills. The [source manifest](agent-presets/qingmu-director/skills/sources.json) records repository revisions, upstream hashes and adapted hashes. This includes text references and templates; excluded binary examples are listed explicitly. The [resource reader](../qingmu-director-context-bridge/src/skill-resources.ts) verifies bundle hashes and paginates without silent truncation. Reading a method does not itself save a director plan or demonstrate creative quality.

## Model Experience

### Qingmu director preset

#### What the model sees

Only `qingmu-director` sessions receive the stable Chinese persona in [agent.cordis.yml](agent-presets/qingmu-director/agent.cordis.yml) and scoped native tool schemas. The persona uses actual Writer context and the bundled cinematic-director and ai-visual-director methods, reading linked references through the scoped resource reader. Script and director decisions govern dialogue, performance and camera choreography; upstream numeric heuristics are advisory. Performance, camera and reference edits follow the saved reference draft through read, preview and user-requested save. It preserves dialogue verbatim; explicit canonical dialogue replacements use the existing ChangeSet tools before reconciling the reference draft. Source changes require rereading context and methods rather than rebinding old text to a new hash. PromptIR field suggestions remain available for explicit field edits or shots without a reference draft; first drafts also require that no Draft or Ready already exists. Saving a working draft does not generate or approve media. Its exact model input is pinned through a keyless native-loop snapshot.

#### Token effect

The fixed persona and available scoped schemas are present on each request from this preset. Full context and method bodies are requested on demand; no complete method library is injected at startup. Suggestions refer to their original read receipt without repeating those bodies.

#### KV Cache effect

The persona and schemas form a stable prefix for this preset. Requested context and method text enter ordinary tool results and consume tokens on demand; other modes receive no added text.

## Known Limitations and Deferred Work

- The cockpit reads Yimeng's authoritative business projection and currently exposes the bounded `episode_script` flow plus the first `element_profile` vertical slice for props. Actor and scene editing remain deferred; neither flow authorizes a paid Provider or infers human signoff.
- The separate stateless IMAGO adapter now projects prop field guidance, checklists, work orders, and review cards into the cockpit. It does not copy IMAGO state or expose a second Stage/DAG.
- The source package stays private and experimental while the product distribution namespace is being established.
- Existing populated sessions do not gain this preset, and a saved user default can override the distribution default. Read-tool tests do not prove browser binding, real-provider judgment, proposal adoption, or production deployment.
