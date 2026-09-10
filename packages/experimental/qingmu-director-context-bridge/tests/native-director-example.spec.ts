import { expect, it } from 'vitest'
import { runNativeDirectorExample } from '../examples/model-tools-keyless.ts'

it('previews imported sourceLineId dialogue through the shipped preset and native loop', async () => {
  const result = await runNativeDirectorExample('dialogue')
  expect(result.calls).toEqual(['qingmu_read_dialogue', 'qingmu_preview_dialogue_edit'])
  const input = JSON.parse(result.results[0]!) as { editableLines: unknown[] }
  expect(input.editableLines).toEqual([expect.objectContaining({ lineId: 'line_000003', timingVerified: false, plannedStartSec: null })])
  expect(JSON.parse(result.results[1]!)).toMatchObject({ lineId: 'line_000003', after: '请问，还有人在吗？',
    affectedShots: [{ shotId: 'example-shot', frameNo: 1, title: '门口呼喊' }], providerCalls: 0, businessStateChanged: false })
  expect({ calls: result.calls, results: result.results }).toMatchSnapshot()
})

it('runs the keyless shipped-preset example through the native loop', async () => {
  const result = await runNativeDirectorExample()
  expect(result.preset).toBe('qingmu-director')
  expect(result.system).toContain('你是青木的导演助手')
  expect(result.calls).toEqual(['qingmu_read_bound_context', 'qingmu_get_imago_method'])
  expect(result.methodInNextRequest).toBe(true)
  expect(result.rootTools).toEqual([])
  expect(result.readiness).toMatchObject({ status: 'missing-tools', presetId: 'qingmu-director',
    missingTools: ['qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit', 'qingmu_read_first_draft', 'qingmu_propose_first_draft',
      'qingmu_read_reference_draft', 'qingmu_preview_reference_draft', 'qingmu_save_reference_draft',
      'qingmu_read_director_plan', 'qingmu_save_director_plan'] })
  expect(result.ordinaryReadiness).toMatchObject({ status: 'missing-tools', tools: [] })
  expect(result.inactiveReadiness).toMatchObject({ status: 'inactive', tools: [] })
  expect(result).toMatchSnapshot()
})

it('records a native prompt suggestion from a real read and exposes it through the Host facade', async () => {
  const result = await runNativeDirectorExample(true)
  expect(result.calls).toEqual(['qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit'])
  expect(result.tools).toContain('qingmu_propose_prompt_edit')
  expect(result.readiness).toMatchObject({ status: 'mounted', presetId: 'qingmu-director', missingTools: [] })
  expect(result.readiness.tools).toHaveLength(11)
  expect(result.methodInNextRequest).toBe(true)
  expect(result.draftProposal).toMatchObject({ ok: true, value: { status: 'current', proposal: {
    field: 'imageGenPrompt', before: '她站在门口。', after: '她停在门口，门在画面左侧；背面中景，不要求正脸。',
  } } })
  expect(JSON.parse(result.results[0]!)).toMatchObject({ methods: [{ requestedResourceId: null }, { requestedResourceId: 'rough_final_feedback' }] })
  expect(JSON.stringify(result.draftProposal)).not.toContain('sources')
  expect(JSON.stringify(result.draftProposal)).not.toContain('contextSnapshot')
  expect(result.rootTools).toEqual([])
})

it('authors a first-draft suggestion through the shipped preset and actual native loop', async () => {
  const result = await runNativeDirectorExample('first')
  expect(result.calls).toEqual(['qingmu_read_first_draft', 'qingmu_propose_first_draft'])
  expect(result.methodInNextRequest).toBe(true)
  expect(result.draftProposal).toMatchObject({ ok: true, value: { status: 'current', proposal: {
    schema: 'qingmu.native-first-draft-proposal.v1', editableProjection: { imageGenPrompt: '她站在门口。' },
  } } })
  expect(result.rootTools).toEqual([])
  expect({ tools: result.tools, calls: result.calls, results: result.results, proposal: result.draftProposal }).toMatchSnapshot()
})


it('writes in an unbound native session and recovers the completed screenplay for the story UI', async () => {
  const result = await runNativeDirectorExample('story')
  expect(result.calls).toEqual(['skill', 'skill', 'qingmu_read_skill_resource'])
  expect(result.writingInRequest).toBe(true)
  expect(result.storyDraft).toMatchObject({ finished: true, running: false, error: '',
    script: '场景一：修理店·傍晚\n动作：父亲收起工具，女儿扶住门。\n老周：下班了。' })
  expect({ calls: result.calls, writingInRequest: result.writingInRequest,
    script: result.storyDraft?.script }).toMatchSnapshot()
})
