import { describe, expect, it } from 'vitest'
import { localMediaUrl } from '../src/local-media-url.ts'

const signature = 'a'.repeat(64)
const query = `?expires=1788767261&signature=${signature}`
const source = `https://old.example/yimeng-golden/api/media/media_ingest_6${query}`
describe('local Writer media links', () => {
  it.each(['/api/qingmu/assets/6', '/signed/rotated-url', 'not a URL'])('preserves legacy relative sources without breaking the projection', (value) => {
    expect(localMediaUrl(value, 'asset_ingest_6', 'http://127.0.0.1:65269')).toBe(value)
  })
  it('supports the same IPv4 loopback range as the configured adapter', () => {
    expect(localMediaUrl(source, 'asset_ingest_6', 'http://127.0.0.2:65269')).toContain('http://127.0.0.2:65269/api/media/')
  })
  it('preserves the signed media capability and uses only the configured local upstream', () => {
    expect(localMediaUrl(source, 'asset_ingest_6', 'http://127.0.0.1:65269'))
      .toBe(`http://127.0.0.1:65269/api/media/media_ingest_6${query}`)
  })
  it.each([
    source.replace('media_ingest_6', 'media_other'), source.replace(signature, 'invalid'),
    source + '&token=secret', source + '#fragment', source.replace('https://', 'https://user:pass@'),
    source.replace('&signature=', '&signature=a&signature='),
  ])('does not promote malformed or differently scoped URLs', (value) => {
    expect(localMediaUrl(value, 'asset_ingest_6', 'http://127.0.0.1:65269')).toBe(value)
  })
  it('never sends signed links to an external configured host', () => {
    expect(() => localMediaUrl(source, 'asset_ingest_6', 'https://external.example')).toThrow('loopback')
  })
})
