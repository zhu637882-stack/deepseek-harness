/**
 * Point an existing signed Writer media link at the configured local Writer.
 * The signature, expiry and asset name are preserved; no credentials are added
 * and no remote request is made. Called only after the workflow SHA checks.
 */
export function localMediaUrl(source: string, assetId: string, upstream: string): string {
  return localSignedMediaUrl(source, assetId.replace(/^asset_/, 'media_'), upstream)
}

/** Resolve a signed media capability using the media identity supplied by Writer. */
export function localSignedMediaUrl(source: string, mediaId: string, upstream: string): string {
  const base = new URL(upstream)
  if (!['http:', 'https:'].includes(base.protocol) || !(base.hostname === 'localhost' || base.hostname === '[::1]' || /^127\.(?:\d+\.){2}\d+$/.test(base.hostname))) {
    throw new Error('media upstream must be the configured loopback Writer')
  }
  let url: URL
  try { url = new URL(source) } catch { return source }
  if (!/^media_[A-Za-z0-9_-]+$/.test(mediaId)
    || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
    || !url.pathname.endsWith(`/api/media/${mediaId}`)
    || !/^\d+$/.test(url.searchParams.get('expires') ?? '')
    || !/^[a-f0-9]{64}$/.test(url.searchParams.get('signature') ?? '')
    || [...url.searchParams.keys()].sort().join(',') !== 'expires,signature') {
    // Non-signed or alternate legacy formats are not rewritten into a local capability.
    return source
  }
  const local = new URL(`/api/media/${mediaId}`, base)
  local.search = url.search
  return local.href
}
