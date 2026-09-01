import { describe, expect, it } from 'vitest'
import {
  loadDirectorStageCard,
  loadDirectorStageCards,
} from '../src/director-stage-cards.ts'
import { createImagoMethodHandler } from '../src/index.ts'

describe('director stage cards method', () => {
  it('serves stage-scoped cards with guidance-only authority block', () => {
    const response = loadDirectorStageCards('C5R')
    expect(response.schema).toBe('qingmu.imago-director-stage-cards.v1')
    expect(response.stageId).toBe('C5R')
    expect(response.cards.length).toBeGreaterThan(4)
    expect(response.authority).toEqual({
      businessTruth: 'yimeng',
      methodSource: 'imago_os',
      guidanceOnly: true,
      providerCalls: 0,
      maximumCostCny: '0',
      humanDecisionInferred: false,
      selectionGranted: false,
      runtimeExecution: false,
    })
  })

  it('returns an explicit empty set for unknown stages', () => {
    expect(loadDirectorStageCards('ZZ9').cards).toEqual([])
  })

  it('serves card content only after provenance verification', async () => {
    const card = await loadDirectorStageCard('director-skill-core', 'assets/qc-checklist.md')
    expect(card.schema).toBe('qingmu.imago-director-stage-card-content.v1')
    expect(card.content.length).toBeGreaterThan(0)
    expect(card.contentSha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects a card outside the registry', async () => {
    await expect(loadDirectorStageCard('director-skill-core', 'smuggled.txt'))
      .rejects.toThrow('director_stage_card_not_registered')
    const listed = await loadDirectorStageCard('director-skill-core', 'assets/qc-checklist.md')
    expect(listed.content.length).toBeGreaterThan(0)
  })
})

describe('director stage cards handler endpoints', () => {
  const handler = createImagoMethodHandler({ attestationKey: '0'.repeat(64), coreRoot: '/tmp' } as never)

  it('exposes directorStageCardsMethod', async () => {
    const result = await handler('directorStageCardsMethod', { stageId: 'LSUQC' }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stageId).toBe('LSUQC')
      expect(result.value.cards.length).toBeGreaterThan(2)
    }
  })

  it('rejects malformed stage ids at the endpoint', async () => {
    const result = await handler('directorStageCardsMethod', { stageId: 'c5r' }, new AbortController().signal)
    expect(result.ok).toBe(false)
  })

  it('exposes directorStageCardMethod with verified content', async () => {
    const result = await handler(
      'directorStageCardMethod',
      { repoId: 'arcreel', path: 'skills/video-workflow/SKILL.md' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.content.length).toBeGreaterThan(0)
  })
})
