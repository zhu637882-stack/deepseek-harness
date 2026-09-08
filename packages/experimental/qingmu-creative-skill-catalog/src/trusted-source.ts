/** Package-owned Yimeng source ledger. Callers cannot assert or override these values. */
export const YIMENG_STYLE_PACK_LEDGER = Object.freeze({
  authority: 'yimeng.style-pack-library' as const,
  schemaVersion: 'style-pack-v1' as const,
  sourceVersion: 'yimeng-style-pack-v1@f79971c693fa272c32093f62bb32b3f662e27bf1',
  canonicalSnapshotSha256: '830c0a885ce836594508a0378f291e45576775555f92bc6356e5310b444e841f',
  sourceContentSha256: '85cd7475157269c0737813bf1dce3adfcd715739d20517931bb0b049c3a0c573',
  license: 'LicenseRef-Qingmu-Yimeng-Internal' as const,
  usageBoundary: 'read-only-catalog-projection' as const,
})
