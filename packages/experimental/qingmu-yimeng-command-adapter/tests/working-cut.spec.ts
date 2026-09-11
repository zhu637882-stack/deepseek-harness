import { expect, it } from 'vitest'
import { prepareWorkingCut } from '../src/working-cut.ts'
const helpers={ inputError:(s:string)=>new Error(s),responseError:(s:string)=>new Error(s) }
it('uses an exact scoped route and refuses foreign response scope',()=>{
  const p=prepareWorkingCut('renderWorkingCut',{ projectId:'p',episodeId:'e',command:{ requestId:'r',clips:[] } },helpers)
  expect(p.path).toBe('/api/qingmu/projects/p/episodes/e/working-cut/render');expect(p.method).toBe('POST')
  expect(()=>p.normalize({ schema:'qingmu-working-cut-v1',projectId:'other',episodeId:'e',shots:[],cuts:[],revision:0,providerCalls:0,humanApprovalChanged:false })).toThrow('scope invalid')
  expect(()=>prepareWorkingCut('readWorkingCut',{ projectId:'../p',episodeId:'e' },helpers)).toThrow('scope invalid')
})
