/** Stable failure code for catalog admission, provenance, or integrity errors. */
export type CreativeSkillCatalogErrorCode =
  | 'creative_skill_catalog_category_missing'
  | 'creative_skill_card_invalid'
  | 'creative_skill_duplicate_id'
  | 'creative_skill_json_invalid'
  | 'creative_skill_license_not_allowed'
  | 'creative_skill_scope_invalid'
  | 'creative_skill_sha_drift'
  | 'creative_skill_source_invalid'
  | 'creative_skill_source_unknown'

/** Fail-closed catalog error whose message is its stable machine-readable code. */
export class CreativeSkillCatalogError extends Error {
  /** Stable machine-readable failure reason. */
  readonly code: CreativeSkillCatalogErrorCode

  constructor(code: CreativeSkillCatalogErrorCode) {
    super(code)
    this.name = 'CreativeSkillCatalogError'
    this.code = code
  }
}
