import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadDirectorStageCard,
  loadDirectorStageCards,
} from '../src/director-stage-cards.ts'
import type {
  DirectorStageCardContentResponse,
  DirectorStageCardsResponse,
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
      const value = result.value as DirectorStageCardsResponse
      expect(value.stageId).toBe('LSUQC')
      expect(value.cards.length).toBeGreaterThan(2)
    }
  })

  it('rejects extra, blank, and non-string stage card fields', async () => {
    for (const payload of [
      { stageId: 'C5R', unexpected: true },
      { stageId: '' },
      { stageId: ' ' },
      { stageId: 1 },
    ]) {
      const result = await handler('directorStageCardsMethod', payload, new AbortController().signal)
      expect(result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
  })

  it('rejects extra, blank, and non-string stage card content fields', async () => {
    for (const payload of [
      { repoId: 'arcreel', path: 'skills/video-workflow/SKILL.md', unexpected: true },
      { repoId: '', path: 'skills/video-workflow/SKILL.md' },
      { repoId: ' ', path: 'skills/video-workflow/SKILL.md' },
      { repoId: 'arcreel', path: '' },
      { repoId: 'arcreel', path: ' ' },
      { repoId: 1, path: 'skills/video-workflow/SKILL.md' },
      { repoId: 'arcreel', path: 1 },
    ]) {
      const result = await handler('directorStageCardMethod', payload, new AbortController().signal)
      expect(result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
  })

  it('exposes directorStageCardMethod with verified content', async () => {
    const result = await handler(
      'directorStageCardMethod',
      { repoId: 'arcreel', path: 'skills/video-workflow/SKILL.md' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as DirectorStageCardContentResponse
      expect(value.content.length).toBeGreaterThan(0)
    }
  })

  it('maps registered asset provenance drift to a failed request', async () => {
    const assetPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../assets/director/director-skill-core/47db7d9b951a9f27f7b4b727a6ca0e01ab56f7c6/assets/qc-checklist.md',
    )
    const original = await readFile(assetPath, 'utf8')
    try {
      await writeFile(assetPath, `${original}\ntampered`, 'utf8')
      const result = await handler(
        'directorStageCardMethod',
        { repoId: 'director-skill-core', path: 'assets/qc-checklist.md' },
        new AbortController().signal,
      )
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'bad-request', message: 'director_asset_sha256_mismatch' },
      })
    } finally {
      await writeFile(assetPath, original, 'utf8')
    }
  })

  it('returns cancellation before serving either endpoint', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(handler('directorStageCardsMethod', { stageId: 'C5R' }, controller.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect(handler(
      'directorStageCardMethod',
      { repoId: 'arcreel', path: 'skills/video-workflow/SKILL.md' },
      controller.signal,
    )).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
