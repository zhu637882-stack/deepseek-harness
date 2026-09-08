/** Public data contract for the inert Qingmu creative skill catalog. */

export const CREATIVE_SKILL_CATEGORIES = [
  'writing', 'director', 'camera', 'visual', 'sound', 'qc',
] as const

/** Product-facing creative method category. */
export type CreativeSkillCategory = typeof CREATIVE_SKILL_CATEGORIES[number]

/** Supported inheritance coordinates for a creative method. */
export const CREATIVE_SKILL_SCOPES = ['project', 'episode', 'scene', 'shot'] as const

/** One allowed creation-settings scope. */
export type CreativeSkillScope = typeof CREATIVE_SKILL_SCOPES[number]

/** Reviewed license identity admitted by this catalog version. */
export type CreativeSkillLicenseId =
  | 'MIT'
  | 'Apache-2.0'
  | 'LicenseRef-Qingmu-Yimeng-Internal'

/** License identity and the narrower catalog usage boundary. */
export interface CreativeSkillLicense {
  readonly id: CreativeSkillLicenseId
  readonly usageBoundary:
    | 'attribution-retained-read-only-method-reference'
    | 'read-only-catalog-projection'
}

/** One source already admitted by the IMAGO director-asset registry. */
export interface ImagoDirectorAssetSource {
  readonly kind: 'imago-director-asset'
  readonly authority: 'qingmu-imago-method-adapter'
  readonly repoId: string
  readonly repository: string
  readonly path: string
}

/** One style entry projected from the existing Yimeng style-pack response. */
export interface YimengStylePackSource {
  readonly kind: 'yimeng-style-pack'
  readonly authority: 'yimeng.style-pack-library'
  readonly sourceVersion: string
  readonly packId: string
}

/** Closed source union for catalog cards. */
export type CreativeSkillSource = ImagoDirectorAssetSource | YimengStylePackSource

/** Git and provenance-ledger binding for an admitted IMAGO source. */
export interface ImagoDirectorAssetProvenance {
  readonly kind: 'git-ledger'
  readonly commit: string
  readonly provenanceSha256: string
}

/** Package-pinned source and canonical response binding for a Yimeng style projection. */
export interface YimengStylePackProvenance {
  readonly kind: 'canonical-snapshot'
  readonly snapshotSha256: string
  readonly sourceContentSha256: string
}

/** Closed provenance union matching the source union. */
export type CreativeSkillProvenance =
  | ImagoDirectorAssetProvenance
  | YimengStylePackProvenance

/** Product-facing, inert, versioned creative method card. */
export interface CreativeSkillCard {
  readonly id: string
  readonly nameZh: string
  readonly summaryZh: string
  readonly category: CreativeSkillCategory
  readonly version: string
  readonly methodSha256: string
  readonly contentSha256: string
  readonly source: CreativeSkillSource
  readonly provenance: CreativeSkillProvenance
  readonly license: CreativeSkillLicense
  readonly scopes: readonly CreativeSkillScope[]
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly conflictsWith: readonly string[]
  readonly requires: readonly string[]
  readonly defaultOff: true
  readonly zeroProvider: true
}

/** Deterministically ordered and hashed catalog projection. */
export interface CreativeSkillCatalog {
  readonly schema: 'qingmu.creative-skill-catalog.v1'
  readonly version: '1.0.0'
  readonly activation: 'default-off-explicit-selection-only'
  readonly providerCalls: 0
  readonly cards: readonly CreativeSkillCard[]
  readonly catalogSha256: string
}

/** Exact bytes returned by the existing Yimeng read boundary. Source identity stays package-owned. */
export interface YimengStylePackProjectionSource {
  readonly bytes: Uint8Array
}

/** Inputs accepted by the read-only catalog builder. */
export interface BuildCreativeSkillCatalogOptions {
  /** The existing imago adapter's `assets` directory. */
  readonly directorAssetsRoot: string
  /** Optional authenticated GET /api/style-packs response bytes. */
  readonly yimengStylePacks?: YimengStylePackProjectionSource
}
