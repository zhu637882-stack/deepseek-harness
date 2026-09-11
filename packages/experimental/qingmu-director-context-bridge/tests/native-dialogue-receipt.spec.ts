import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { retainNativeToolReceipt, toolValues } from '../src/native-draft.ts'

const tool = 'qingmu_read_dialogue'
const callId = CallId('read-1')
const full = { receiptId: 'input-1', source: { script: { text: '完整剧本'.repeat(20000) } } }

function pending() {
  const session = Session.create(SessionId('receipt-owner'))
  session.append('tool/call', { turn: 0, step: 0, callId, name: tool, arguments: '{}' })
  const visible = retainNativeToolReceipt(session, callId, tool, full, { receiptId: full.receiptId, editableLines: ['有人吗？'] })
  return { session, visible }
}

describe('session-owned full dialogue receipts', () => {
  it('requires an actual successful view, then replays without rereading or writing', () => {
    const { session, visible } = pending()
    expect(toolValues(session, tool)).toEqual([])
    session.append('tool/result', { turn: 0, step: 0,
      message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: JSON.stringify(visible) }] }) }, { surfaceOp: 'append' })
    expect(toolValues(session, tool)).toEqual([full])
    const resumed = Session.create(session.id, JSON.parse(JSON.stringify(session.events)))
    expect(toolValues(resumed, tool)).toEqual([full])
    expect(toolValues(Session.create(SessionId('other-session')), tool)).toEqual([])
    expect(toolValues(session, 'qingmu_stage_dialogue_edit')).toEqual([])
  })

  it.each(['failed', 'spill', 'different-view', 'different-value', 'wrong-call', 'wrong-step', 'missing-record'] as const)(
    'does not accept a %s result as a usable receipt', (mode) => {
      const { session, visible } = pending()
      if (mode === 'different-value') session.append('qingmu-director-dialogue/receipt', {
        callId, toolName: tool, value: { forged: true }, visibleSha256: session.events.at(-1)!.type === 'qingmu-director-dialogue/receipt'
          ? (session.events.at(-1)!.data as { visibleSha256: string }).visibleSha256 : '',
      })
      const text = mode === 'spill' ? JSON.stringify(visible).slice(0, 50) + '\n(full result stored elsewhere)'
        : JSON.stringify(mode === 'different-view' ? { ...visible, editableLines: ['别的台词'] } : visible)
      session.append('tool/result', { turn: 0, step: mode === 'wrong-step' ? 1 : 0,
        message: createToolResultMessage({ callId: mode === 'wrong-call' ? CallId('other-call') : callId,
          content: [{ type: 'text', text }], isError: mode === 'failed' }) }, { surfaceOp: 'append' })
      const events = mode === 'missing-record' ? session.events.filter(e => e.type !== 'qingmu-director-dialogue/receipt') : session.events
      expect(toolValues({ events }, tool)).toEqual([])
    })

  it('refuses oversized model views before retaining a receipt', () => {
    const session = Session.create(SessionId('too-large'))
    expect(() => retainNativeToolReceipt(session, callId, tool, full, { text: '中'.repeat(16000) })).toThrow('未截断')
    expect(session.events.some(e => e.type === 'qingmu-director-dialogue/receipt')).toBe(false)
  })
})
