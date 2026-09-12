import { expect, it } from 'vitest'
import { prepareWorkingCut } from '../src/working-cut.ts'
const helpers={ inputError:(s:string)=>new Error(s),responseError:(s:string)=>new Error(s) }
it('uses an exact scoped route and refuses foreign response scope',()=>{
  const p=prepareWorkingCut('renderWorkingCut',{ projectId:'p',episodeId:'e',command:{ requestId:'r',clips:[] } },helpers)
  expect(p.path).toBe('/api/qingmu/projects/p/episodes/e/working-cut/render');expect(p.method).toBe('POST')
  expect(()=>p.normalize({ schema:'qingmu-working-cut-v1',projectId:'other',episodeId:'e',shots:[],cuts:[],revision:0,providerCalls:0,humanApprovalChanged:false })).toThrow('scope invalid')
  expect(()=>prepareWorkingCut('readWorkingCut',{ projectId:'../p',episodeId:'e' },helpers)).toThrow('scope invalid')
})
it('routes explicit sound review writes through the same owner-scoped adapter', () => {
  const command = { revisionId: 'revision', assetId: 'film', sha256: 'a'.repeat(64) }
  const request = prepareWorkingCut('reviewWorkingCutSound', { projectId: 'p', episodeId: 'e', command }, helpers)
  expect(request.path).toBe('/api/qingmu/projects/p/episodes/e/working-cut/sound-review')
  expect(request.method).toBe('POST')
  expect(request.body).toEqual(command)
  const state = { schema: 'qingmu-working-cut-v1', projectId: 'p', episodeId: 'e', revision: 1,
    shots: [], cuts: [{ soundReview: { state: 'pending', advisoryOnly: true, taskId: 'review' } }],
    providerCalls: 0, humanApprovalChanged: false }
  expect(request.normalize(state)).toEqual(state)
  expect(() => request.normalize({ ...state, episodeId: 'foreign' })).toThrow('scope invalid')
  expect(() => prepareWorkingCut('readWorkingCut', { projectId: 'p', episodeId: 'e', command }, helpers)).toThrow('field invalid')
})
