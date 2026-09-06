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
