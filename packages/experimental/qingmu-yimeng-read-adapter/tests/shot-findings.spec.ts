import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { normalizeShotFindingFeed } from '../src/shot-findings.ts'
import { FINDING_REQUEST as request, findingFeed, findingSha } from './shot-finding-fixture.ts'

const normalize = (value: unknown) => normalizeShotFindingFeed(value, request, findingSha)
const signal = () => new AbortController().signal
const authorTextFields = ['timecode', 'observation', 'ownerReason', 'suggestion', 'reworkScope', 'evidenceRefs'] as const
const pythonOnlyWhitespace = [
  { name: 'NEL', value: '\u0085' }, { name: 'U+001C', value: '\u001c' },
  { name: 'U+001D', value: '\u001d' }, { name: 'U+001E', value: '\u001e' }, { name: 'U+001F', value: '\u001f' },
] as const

describe('Shot Finding read-only ledger projection', () => {
  it('preserves explicit attribution, multiline author text, duplicate evidence, and server identity', () => {
    const feed = findingFeed()
    expect(normalize(feed)).toEqual(feed)
    expect(normalize(feed).items[0]?.observation).toBe('  怀表换手；请看原片。\n保留原文。')
    expect(normalize(feed).items[0]?.evidenceRefs).toHaveLength(2)
  })

  it.each(authorTextFields)('preserves Python-nonblank U+FEFF author field %s verbatim', (field) => {
    const feed = findingFeed()
    const value = field === 'evidenceRefs' ? ['\ufeff', '\ufeff'] : '\ufeff'
    const changed = { ...feed, items: feed.items.map(item => ({ ...item, [field]: value })) }
    expect(normalize(changed)).toEqual(changed)
  })

  it('preserves U+FEFF-wrapped subject and ledger identifiers without changing their hashes', () => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('fixture subject missing')
    const ids = { projectId: '\ufeffproject-finding\ufeff', episodeId: '\ufeffepisode-finding\ufeff', frameId: '\ufeffframe-z\ufeff' }
    const subject = { ...feed.subject, ...ids, assetId: '\ufeffvideo-z\ufeff' }
    const snapshotSha256 = findingSha(subject)
    const changed = { ...feed, ...ids, subject, snapshotSha256,
      items: feed.items.map(item => ({ ...item, id: '\ufefffinding-one\ufeff', eventId: '\ufeffevent-one\ufeff',
        actorId: '\ufeffreviewer-one\ufeff', subject, subjectSnapshotSha256: snapshotSha256 })) }
    expect(normalizeShotFindingFeed(changed, ids, findingSha)).toEqual(changed)
  })

  it.each(pythonOnlyWhitespace)('rejects Python-blank $name in every author text field', ({ value }) => {
    const feed = findingFeed()
    for (const field of authorTextFields) {
      const replacement = field === 'evidenceRefs' ? [value] : value
      expect(() => normalize({ ...feed, items: feed.items.map(item => ({ ...item, [field]: replacement })) })).toThrow()
    }
  })

  it.each(pythonOnlyWhitespace)('rejects leading and trailing Python whitespace $name in ledger and asset IDs', ({ value }) => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('fixture subject missing')
    for (const id of [`${value}identifier`, `identifier${value}`]) {
      for (const field of ['id', 'eventId', 'actorId', 'earliestOwner']) {
        expect(() => normalize({ ...feed, items: feed.items.map(item => ({ ...item, [field]: id })) })).toThrow()
      }
      const subject = { ...feed.subject, assetId: id }
      const snapshotSha256 = findingSha(subject)
      expect(() => normalize({ ...feed, subject, snapshotSha256,
        items: feed.items.map(item => ({ ...item, subject, subjectSnapshotSha256: snapshotSha256 })) })).toThrow()
    }
  })

  it('keeps historical records separate after the selected video changes or disappears', () => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('fixture subject missing')
    const current = { ...feed.subject, assetId: 'video-new', assetVersion: 3, assetSha256: 'f'.repeat(64) }
    const history = feed.items.map(item => ({ ...item, currentBinding: false }))
    const changed = { ...feed, subject: current, snapshotSha256: findingSha(current), items: history }
    expect(normalize(changed).items[0]?.currentBinding).toBe(false)
    expect(normalize(changed).items[0]?.subject.assetId).toBe('video-z')
    expect(normalize({ ...feed, subject: null, snapshotSha256: null,
      availability: { status: 'unavailable', reason: 'selected_video_unavailable' }, items: history }).capabilities.canRecordFinding).toBe(true)
  })

  it.each(['projectId', 'episodeId', 'frameId'])('rejects root %s drift', (field) => {
    expect(() => normalize({ ...findingFeed(), [field]: 'other' })).toThrow()
  })

  it.each([
    ['frameNo', 0], ['frameNo', true], ['frameNo', 1.5], ['frameNo', Number.NaN],
    ['storyboardRevision', -1], ['storyboardRevision', Number.MAX_SAFE_INTEGER + 1], ['storyboardRevision', false],
    ['assetVersion', Number.POSITIVE_INFINITY], ['assetVersion', '2'], ['assetSha256', 'A'.repeat(64)],
    ['assetId', '\ud800'], ['frameContentSha256', null], ['frameId', 'not-this-shot'], ['projectId', 'line\nbreak'],
  ])('rejects invalid current %s=%s even with a matching hash', (field, value) => {
    const feed = findingFeed()
    const subject = { ...feed.subject, [field]: value }
    expect(() => normalize({ ...feed, subject, snapshotSha256: findingSha(subject) })).toThrow()
  })

  it('preserves zero revision/version but rejects unbound subjects, extra authority, and false availability', () => {
    const feed = findingFeed()
    const subject = { ...feed.subject, storyboardRevision: 0, assetVersion: 0 }
    expect(normalize({ ...feed, subject, snapshotSha256: findingSha(subject), items: [] }).subject).toEqual(subject)
    for (const changed of [
      { ...feed, snapshotSha256: '0'.repeat(64) }, { ...feed, approve: true },
      { ...feed, subject: { ...feed.subject, selected: true } },
      { ...feed, availability: { status: 'unavailable', reason: 'lost' } },
      { ...feed, capabilities: { canRecordFinding: 'true' } },
      { ...feed, capabilities: { canRecordFinding: true, canApprove: true } },
      { ...feed, subject: null, snapshotSha256: null, availability: { status: 'unavailable', reason: null } },
    ]) expect(() => normalize(changed)).toThrow()
  })

  it.each([
    ['status', 'CLOSED'], ['status', 'WAIVED'], ['actorRole', 'approver'], ['severity', 'INFO'],
    ['severity', ['MAJOR']], ['severity', ['BLOCKER']], ['severity', { value: 'MINOR' }],
    ['timecode', ''], ['observation', '  '], ['evidenceRefs', []], ['evidenceRefs', ['']],
    ['earliestOwner', ' F '], ['ownerReason', null], ['suggestion', ''], ['reworkScope', ''],
    ['authSessionId', 'raw-session-token'], ['methodProjectionSha256', null], ['rulesSha256', 'x'],
    ['currentBinding', false], ['currentBinding', 1], ['subjectSnapshotSha256', '0'.repeat(64)],
  ])('rejects malformed or promoted record %s', (field, value) => {
    const feed = findingFeed()
    expect(() => normalize({ ...feed, items: feed.items.map(item => ({ ...item, [field]: value })) })).toThrow()
  })

  it('rejects duplicate ledger identities, historical cross-Shot records, and new approval fields', () => {
    const feed = findingFeed()
    const record = feed.items[0]
    if (record === undefined) throw new Error('fixture record missing')
    expect(() => normalize({ ...feed, items: [record, record] })).toThrow()
    expect(() => normalize({ ...feed, items: [{ ...record, approved: true }] })).toThrow()
    const subject = { ...record.subject, frameId: 'other' }
    expect(() => normalize({ ...feed, items: [{ ...record, subject,
      subjectSnapshotSha256: findingSha(subject), currentBinding: false }] })).toThrow()
  })

  it('uses one authenticated GET with exactly three IDs and no body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(findingFeed()))
    const handler = createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => 'host-token' })
    expect(await handler('shotFindings', request, signal())).toEqual({ ok: true, value: findingFeed() })
    expect(fetch).toHaveBeenCalledOnce()
    const call = fetch.mock.calls[0]
    expect(call?.[0]).toBe('http://127.0.0.1:18815/api/qingmu/projects/project-finding/episodes/episode-finding/frames/frame-z/findings')
    expect(call?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(call?.[1]?.headers).get('authorization')).toBe('Bearer host-token')
    expect(call?.[1]?.body).toBeUndefined()
    fetch.mockClear()
    expect(await handler('shotFindings', { ...request, finding: {} }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves a legal U+FEFF frame ID through the handler URL, subject, and snapshot SHA', async () => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('fixture subject missing')
    const ids = { ...request, frameId: '\ufeffframe-z\ufeff' }
    const subject = { ...feed.subject, ...ids }
    const snapshotSha256 = findingSha(subject)
    const response = { ...feed, ...ids, subject, snapshotSha256,
      items: feed.items.map(item => ({ ...item, subject, subjectSnapshotSha256: snapshotSha256 })) }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
    const handler = createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => 'host-token' })
    expect(await handler('shotFindings', ids, signal())).toEqual({ ok: true, value: response })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:18815/api/qingmu/projects/project-finding/episodes/episode-finding/frames/%EF%BB%BFframe-z%EF%BB%BF/findings')
  })

  it.each([{ name: 'space', value: ' ' }, ...pythonOnlyWhitespace.slice(0, 2)])(
    'rejects leading and trailing $name in each handler ID without a network request', async ({ value }) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(findingFeed()))
      const handler = createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => 'host-token' })
      for (const field of ['projectId', 'episodeId', 'frameId'] as const) {
        for (const id of [`${value}${request[field]}`, `${request[field]}${value}`]) {
          expect(await handler('shotFindings', { ...request, [field]: id }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
          expect(fetch).not.toHaveBeenCalled()
        }
      }
    },
  )
})
