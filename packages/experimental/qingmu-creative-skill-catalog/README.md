# Qingmu creative skill catalog

English | [中文](README.zh.md)

This private experimental package builds a deterministic, versioned catalog of Chinese creative skill cards for Qingmu OS creation settings. Cards are product-facing methods rather than repository or `SKILL.md` names. The initial catalog covers writing, directing, camera, visual, sound, and QC.

## Integration contract

Call `buildCreativeSkillCatalog({ directorAssetsRoot, yimengStylePacks? })`. `directorAssetsRoot` is the existing IMAGO method adapter's `assets` directory. The optional `yimengStylePacks` value carries only the exact response bytes from the existing Yimeng `GET /api/style-packs` boundary. The package owns the admitted source revision, canonical snapshot SHA-256, source-content SHA-256, internal license reference, and read-only usage boundary. This package does not fetch Yimeng or add another read route.

The result uses schema `qingmu.creative-skill-catalog.v1`. Each card contains a stable ID, Chinese name and summary, category, version, method and content SHA-256 values, source and provenance, license boundary, supported scopes, inputs, outputs, conflicts, requirements, `defaultOff: true`, and `zeroProvider: true`. A creation-settings consumer may list or filter these cards by scope, then record an explicit user selection under its existing authority. Reading the catalog never selects or activates a card.

## Source and integrity boundary

Six built-in cards reuse only admitted content rows from `qingmu-imago-method-adapter`: the beat sheet, director book, shot plan, reference anchor, sound design sheet, and QC checklist. The adapter's registry, static stage-card assembly, complete package ledger, pinned commit, license, and file SHA remain the source authority. Repository IDs and paths appear only as traceable provenance; they are not the card display names.

The optional Yimeng projection accepts only the package-pinned canonical `style-pack-v1` snapshot, including exact group labels, pack version, and vertical-delivery fields. It hashes every projected pack but does not copy prompt fragments into the card. Unknown authorities, unapproved licenses, duplicate IDs, invalid scopes, malformed sources, changed provenance, content drift, relationship errors, and method-SHA drift fail closed. Canonical key ordering and fixed category/ID ordering make identical bytes produce identical output. Returned catalogs are deeply frozen so their SHA cannot become stale through mutation.

## Runtime boundary

This is a pure read-only library, not a Cordis plugin, loader, workflow, command, or Provider adapter. It performs no network request, database write, asset mutation, budget change, human approval, model invocation, or automatic activation. Its invariant companion only registers package ownership; catalog construction validates all runtime data.

## Model Experience

### Catalog construction

#### What the model sees

Nothing. `qingmu.creative-skill-catalog.v1` cards are local product metadata and are not model tools, prompt sections, or session events.

#### Token effect

None. Catalog construction adds no model-facing tokens.

#### KV Cache effect

None. No catalog data enters model context.

## Known Limitations and Deferred Work

- This slice does not wire the catalog into the launcher, client UI, Yimeng shell, or creation settings. Those consumers must use the public build result in a separately approved integration.
- Yimeng request authentication remains the existing read boundary's responsibility. This package accepts bytes only; source identity, revision, hashes, and license come from its fixed internal ledger, so caller assertions cannot create new source authority or publicly relicense internal style data.
- The initial built-in set exposes one useful method in each required category. Adding a source or changing a method is a versioned catalog change that must first enter the existing admission and license authority.
