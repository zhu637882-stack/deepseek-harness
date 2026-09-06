import { expect, it } from 'vitest'
import { runNativeDirectorExample } from '../examples/model-tools-keyless.ts'

it('runs the keyless shipped-preset example through the native loop', async () => {
  const result = await runNativeDirectorExample()
  expect(result.preset).toBe('qingmu-director')
  expect(result.system).toContain('你是青木的导演助手')
  expect(result.calls).toEqual(['qingmu_read_bound_context', 'qingmu_get_imago_method'])
  expect(result.methodInNextRequest).toBe(true)
  expect(result.rootTools).toEqual([])
  expect(result).toMatchSnapshot()
})

it('records a native prompt suggestion from a real read and exposes it through the Host facade', async () => {
  const result = await runNativeDirectorExample(true)
  expect(result.calls).toEqual(['qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit'])
  expect(result.tools).toContain('qingmu_propose_prompt_edit')
  expect(result.methodInNextRequest).toBe(true)
  expect(result.draftProposal).toMatchObject({ ok: true, value: { status: 'current', proposal: {
    field: 'imageGenPrompt', before: '她站在门口。', after: '她停在门口，门在画面左侧；背面中景，不要求正脸。',
  } } })
  expect(JSON.parse(result.results[0]!)).toMatchObject({ methods: [{ requestedResourceId: null }, { requestedResourceId: 'rough_final_feedback' }] })
  expect(JSON.stringify(result.draftProposal)).not.toContain('sources')
  expect(JSON.stringify(result.draftProposal)).not.toContain('contextSnapshot')
  expect(result.rootTools).toEqual([])
})
