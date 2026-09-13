/** Full creative plans use the existing Writer planning transaction and native log. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DirectorContextSnapshot, ScenePlanningState, ScenePlanningResult, WorkingCutState, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { ReferenceVideoDraftResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'
import { digest, retainNativeToolReceipt, toolValues } from './native-draft.ts'
import { assertNativeTurnTarget } from './native-prompt-target.ts'
import type { DirectorContextBindingState } from './types.ts'

interface BoundRead {
  session: Session
  state: DirectorContextBindingState
  context: DirectorContextSnapshot
  seq: number | undefined
}
interface Input {
  schema: 'qingmu.native-director-plan.v1'
  receiptId: string
  scope: DirectorContextBindingState['binding']['scope']
  context: DirectorContextSnapshot
  planning: ScenePlanningState
}
interface Ports {
  readBoundContext(exec: ToolRunContext): Promise<BoundRead>
  boundedJson(value: unknown): JsonValue
}

function assertCurrent(current: BoundRead, exec: ToolRunContext): void {
  exec.signal.throwIfAborted()
  assertNativeTurnTarget(current.session, exec.callId)
  if (current.session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq !== current.seq) throw new Error('镜头选择已变化，请重新读取导演设计。')
}

function continuation(before: DirectorContextSnapshot, after: DirectorContextSnapshot, result: ScenePlanningResult) {
  const stable = ({
    storyboard: _storyboard, shot: _shot, sourceTime: _time, contextSnapshotSha256: _hash, selectedReferences, ...rest
  }: DirectorContextSnapshot) => ({
    ...rest, selectedReferences: selectedReferences.map(({ mediaUrl: _url, ...reference }) => reference),
  })
  // The shot is revisioned creative data. The save receipt pins its new revision;
  // script, cast, references and other context must still match the admitted read.
  if ((result.action !== 'edit_automatic' && result.action !== 'edit_requirements')
    || result.projectId !== before.projectId || result.episodeId !== before.episodeId
    || result.shotId !== before.shotId || after.shot.id !== before.shot.id
    || digest(stable(before)) !== digest(stable(after))
    || digest(after.storyboard) !== digest(result.storyboard)) return null
  return { before: before.contextSnapshotSha256, after: after.contextSnapshotSha256 }
}

/** Register complete read/save operations inside the owning native agent scope. */
export function registerDirectorPlanTools(ctx: Context, ports: Ports): void {
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  ctx.tools.register(defineTool({
    name: 'qingmu_preview_first_frame',
    description: 'Read the selected shot’s actual compiled first-frame image prompt, exact ordered references and composition preview. Uses the same preparation as the shooting page. No image generation, adoption or approval. Reconcile the current full film source with the bound scene and starting state using qingmu_read_director_plan, qingmu_read_reference_draft and qingmu_save_director_plan, then preview again. This inspects instructions, not image pixels or the quality of a future result.',
    parameters: { referenceImages: { type: 'json', description: 'Optional ordered 1..9 working images from the current project, each {assetId, assetSha256, purpose}. Obtain exact IDs and SHAs from current reference tools; purpose states what to inherit and how the image relates to this starting instant. No guessed assets, URLs or boxes. Omission uses the shot’s formal references. Missing formal references can be resolved by explicitly choosing actual working images.' } }, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '核对首帧实际生成输入' }),
    async execute(args, exec) {
      if (Object.keys(args).some(key => key !== 'referenceImages')) throw new Error('首帧预览只接受当前镜头的参考图片。')
      const current = await ports.readBoundContext(exec)
      assertCurrent(current, exec)
      const { projectId, episodeId, shotId } = current.state.binding.scope
      const response = await ctx.qingmuYimengCommand('previewShootingFirstFrame', { projectId, episodeId, frameId: shotId,
        ...(args.referenceImages === undefined ? {} : { referenceImages: args.referenceImages }) }, exec.signal)
      assertCurrent(current, exec)
      if (!response.ok) throw new Error(`首帧输入核对失败：${response.error.message}`)
      return ports.boundedJson({ schema: 'qingmu.native-first-frame-preview.v1', preview: response.value, providerCalls: 0,
        humanApprovalChanged: false, guidance: 'The preview contains the complete prompt actually prepared for the image model. Compare it with the current bound scene, script exceptions, actor blocking, support/contact, prop scale and start state. Resolve contradictory versions in the saved source, not by appending another incompatible instruction. generationContext replaces unscoped film prose while the current scene and still remain; compare all of them. Preserve the director’s video actions, camera movement, speech and sound when editing the starting image. A preview may retain a local preparation record; it never queues or charges an image request. Pixel inspection and creative acceptance remain separate.' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_import_acoustic_response',
    description: 'Import one bundled room impulse response from the acousticPresets catalog returned by qingmu_read_working_cut into the bound episode. Local, no provider charge; repeated imports recover the same source. This is an effect input, not ambience/music or a measurement of the film set. Importing neither changes the edit nor applies reverb.',
    parameters: { presetId: { type: 'string', required: true, description: 'Exact ID from the current acousticPresets catalog.' } }, output,
    presentCall: () => ({ card: 'generic', kind: 'edit', title: '加入空间声学响应' }),
    async execute(args, exec) {
      if (!exec.agent) throw new Error('空间响应导入需要当前导演会话。')
      assertNativeTurnTarget(exec.agent.session, exec.callId, true)
      const current = await ports.readBoundContext(exec)
      assertCurrent(current, exec)
      const { projectId, episodeId } = current.state.binding.scope
      const scope = { projectId, episodeId }
      const response = await ctx.qingmuYimengCommand('uploadWorkingCutAudio', { ...scope, command: { presetId: args.presetId } }, exec.signal)
      assertCurrent(current, exec)
      if (!response.ok) throw new Error(response.error.message)
      const cut = response.value as WorkingCutState
      const source = cut.audioLibrary?.find(item => item.presetId === args.presetId)
      if (!source) throw new Error('空间响应导入结果未确认，请读取当前音频素材。')
      return ports.boundedJson({ scope, source, providerCalls: 0,
        guidance: 'Read qingmu_read_working_cut again before saving a cue with this response. Preserve dry sound, choose wet gain and tail from the scene design, and audition the mix. Do not add the IR itself as a soundtrack.' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_working_cut',
    description: 'Read the current episode assembled cut, retained versions and imported audio sources. Plan music cues, uninterrupted scene ambience, Foley and dialogue on film time after editing. Source URLs are for actual listening, not evidence that listening happened. No provider calls.',
    parameters: {}, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取整片剪辑与声音' }),
    async execute(_args, exec) {
      const current = await ports.readBoundContext(exec)
      const { projectId, episodeId } = current.state.binding.scope
      const scope = { projectId, episodeId }
      const response = await ctx.qingmuYimengCommand('readWorkingCut', scope, exec.signal)
      assertCurrent(current, exec)
      if (!response.ok) throw new Error(response.error.message)
      return ports.boundedJson({ schema: 'qingmu.native-working-cut.v1', scope, cut: response.value,
        receiptId: digest({ scope, cut: response.value }), providerCalls: 0,
        guidance: 'Use qingmu_save_working_cut with this receipt to save clips, audioCues and soundPlan. shots.editorialContext contains the director\'s adjoining-segment edit and sound-bridge intentions. Reconcile them against the chosen clips and actual film timing; they are notes, not applied edits. For a first assembly, shots.selectedAssetId identifies the source chosen in shooting; null is unchosen, never substitute the newest candidate silently. Existing cut choices take precedence over later Take selection. Audio cues require an exact assetId/sha256 from audioLibrary or videoAudioSources. videoAudioSources exposes completed shot videos and rendered cut versions in this episode; use their audio independently across picture cuts without downloading or importing a second file. On an audio cue, optional sourceAudioMode original/speech_effects/speech/effects/music selects the full mix or a local separated component. effects includes ambience AND action Foley, not a magically clean room tone; choose source intervals accordingly. Modes other than original require audioSeparation.available. Sources without audio cannot be used. Separation occurs in the existing render task and verified cache, with no paid API. Adjust matching picture clip sound deliberately to avoid doubled voices or ambience; cue extraction does not mute the original clip. Import local WAV/MP3/M4A/FLAC in the delivery page. acousticPresets lists bundled recorded room responses; use qingmu_import_acoustic_response with an exact presetId to add one locally, then reread this cut before saving. A bundled IR is an effect input, never a standalone music or ambience cue. Do not invent an asset or claim an unavailable music generator ran. Environment stays continuous under speech. A cue may explicitly set loop {durationSec, crossfadeSec} to repeat its trimmed sound with equal-power crossfades across picture cuts. durationSec is the complete bed length before room tail (at least source trim length, at most 600); crossfadeSec must be positive and strictly less than half the trim. Use only deliberately repeatable content; this repeats all source sounds and does not align musical beats or remove dialogue. Fades and gain points apply once over the complete bed. Music and ambience have independent timing, fades and optional gainPoints for director-timed volume changes. Use actual film timing for dialogue ducking and gradual recovery; do not infer speech times from shot duration. Native mixed audio stays original unless a clip explicitly chooses sourceAudioMode. silent disables picture audio without separation or model runtime; use it when an independent cue supplies the complete dialogue/ambience mix. A rendered cut is an immutable sound source at its saved edit timing; later picture reorders or trims require reconciling that cue, not stretching it automatically. When audioSeparation.available is true, speech_effects extracts speech and effects while removing estimated music; speech extracts dialogue only. This runs locally during export, caches results and may lose details. Preserve original media and audition before accepting; plan continuous music on independent whole-cut cues. An independent cue can apply a retained mono/stereo room impulse response with space {assetId, sha256, wetDb, tailSec}. The response must be a genuine IR, at most 10 seconds, imported in this episode; ordinary speech/music/ambience recordings are not IRs. Convolution adds reflections while retaining direct sound. Its explicit tail continues beyond the source trim or complete looped bed across cuts, must fit the film and cannot exceed the IR duration. Fades and gain points cover the extended cue. Choose the acoustic perspective from the scene and listen before applying; this is not separation or automatic removal of existing reverberation.' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_save_working_cut',
    description: 'Save the assembled-film clips, independent sound cues and director sound plan to a retained editable revision. Optionally render a local MP4 when authorized. Music/ambience/effect/dialogue cues can span shots. No paid model, source replacement or human signoff. Retry identical arguments after an uncertain result.',
    parameters: {
      receiptId: { type: 'string', required: true },
      cut: { type: 'json', required: true, description: 'Object with clips (frameId, assetId, sha256, inSec, outSec, optional sourceGainDb, sourceAudioMode original/silent/speech_effects/speech and reframe), audioCues (assetId, sha256, kind music/ambience/effect/dialogue, startSec on assembled film, inSec/outSec on source, gainDb -60..6, fadeInSec/fadeOutSec, optional sourceAudioMode original/speech_effects/speech/effects/music, gainPoints and space) and soundPlan string. Cue sources may come from audioLibrary or videoAudioSources. Optional loop {durationSec, crossfadeSec} repeats the source trim, crossfading each join. durationSec must be at least the source trim and at most 600 seconds, crossfadeSec positive and less than half the trim. Bed plus optional room tail must fit the film. Fades and gainPoints span the complete bed plus tail. Omission plays once. This repeats every sound in the trim, so choose an intentionally repeatable passage; no beat matching or speech removal is inferred. Independent cue timing is not tied to the picture cuts. space is optional {assetId, sha256, wetDb:-60..6, tailSec:0..10}, referencing an imported mono/stereo room IR of at most 10 seconds in this episode. tailSec cannot exceed the IR duration, and source duration plus tail must fit the film. Gain points and fades cover this extended cue; original direct sound remains. Apply only to intentionally chosen independent cues, after checking source acoustics; ordinary music or ambience recordings cannot substitute for IR files. gainPoints: 2..64 points {timeSec, gainDb}; strictly increasing assembled-film seconds within this cue, relative gain -60..6 dB added to cue gain. Values interpolate in dB and hold outside first/last points. Use paired points around dialogue for gradual ducking/recovery; omission preserves constant cue gain. reframe is an optional static crop {zoom:1..4, x:0..1, y:0..1}; x/y travel left/top to right/bottom within the remaining source, .5 centers. Omit to keep the original frame. Crop is rounded to even pixels before scaling, preserves timing/audio and reduces retained resolution; it cannot repair hidden world geometry. Source trims cannot exceed source duration; the complete bed and room tail cannot exceed the film. Lowering sourceGainDb also lowers its dialogue and ambience; never treat it as music separation.' },
      render: { type: 'boolean', description: 'Default false: save without rendering. True requests local MP4 composition, not creative approval.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'edit', title: '保存整片剪辑与声音' }),
    async execute(args, exec) {
      if (!exec.agent) throw new Error('需要当前导演会话。')
      const current = await ports.readBoundContext(exec)
      assertCurrent(current, exec)
      const input = toolValues(current.session, 'qingmu_read_working_cut').findLast(value => (value as { receiptId?: string } | null)?.receiptId === args.receiptId) as {
        schema: string
        scope: { projectId: string; episodeId: string }
        cut: { revision: number }
      } | undefined
      const { projectId, episodeId } = current.state.binding.scope
      if (!input || input.schema !== 'qingmu.native-working-cut.v1' || digest({ scope: input.scope, cut: input.cut }) !== args.receiptId
        || digest(input.scope) !== digest({ projectId, episodeId })) throw new Error('请先读取当前整片剪辑。')
      const cut = args.cut
      if (!cut || typeof cut !== 'object' || Array.isArray(cut) || Object.keys(cut).some(key => !['clips', 'audioCues', 'soundPlan'].includes(key))) throw new Error('剪辑只接受镜头、声音轨和声音设计。')
      const command = { ...cut, requestId: `cut-${digest({ receipt: args.receiptId, cut }).slice(0, 40)}`, expectedRevision: input.cut.revision }
      const response = await ctx.qingmuYimengCommand(args.render === true ? 'renderWorkingCut' : 'saveWorkingCut',
        { projectId, episodeId, command }, exec.signal)
      assertCurrent(current, exec)
      if (!response.ok) throw new Error(response.error.message)
      return ports.boundedJson({ schema: 'qingmu.native-working-cut-result.v1', cut: response.value,
        providerCalls: 0, humanApprovalChanged: false, guidance: 'Read the saved result and listen to the actual MP4 at shot/cue joins. Export success does not prove sound continuity, dialogue quality or creative acceptance.' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_director_plan',
    description: 'Read the complete saved director plan for the selected shot, canonical script and planning revisions. Full film, world and asset designs are supplied separately by qingmu_read_reference_draft in saved.directorSource.prompt; read that current source before authoring generationContext. Session history is not the current film design. All selected-shot creative fields are available, including unfamiliar method output. No generation or approval.',
    parameters: {}, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取完整导演设计' }),
    async execute(_args, exec) {
      const current = await ports.readBoundContext(exec)
      const scope = current.state.binding.scope
      const response = await ctx.qingmuYimengCommand('readScenePlanning', { projectId: scope.projectId, episodeId: scope.episodeId }, exec.signal)
      assertCurrent(current, exec)
      if (!response.ok) throw new Error(`导演设计读取失败：${response.error.message}`)
      const planning = response.value as ScenePlanningState
      if (digest(planning.storyboard) !== digest(current.context.storyboard) || planning.scriptRevision !== current.context.script.revision || planning.scriptSha256 !== current.context.script.sha256) throw new Error('读取期间剧本或分镜已变化，请重新读取。')
      const selectedShot = planning.frameRequirements?.find(shot => shot.id === scope.shotId)
      if (!selectedShot) throw new Error('当前镜头未在分镜中找到。')
      const source = { scope, context: current.context, planning }
      const input = { schema: 'qingmu.native-director-plan.v1', receiptId: digest(source), ...source,
        guidance: 'Save creative fields with qingmu_save_director_plan. receiptId identifies this planning read for saving; it is not directorSource.sha256. Read qingmu_read_reference_draft and its sourceAlignment to check whether the saved generation draft still matches its source. Omitted imagePromptCn preserves the starting still; supply it to replace that description alongside directorPlan.visual when both change. Script identities and provenance remain protected. Explicit empty values clear decisions; omitted fields stay. Script dialogue text changes use the dialogue edit tools. Speakers, actions, camera moves and overlaps follow the script and director, with no fixed one-speaker rule.', providerCalls: 0 }
      const { schema, projectId, episodeId, scriptRevision, scriptSha256, storyboard } = planning
      const shotFields: Record<string, unknown> = { ...selectedShot.directorPlan, ...selectedShot }
      const shotContext = Object.fromEntries(Object.entries(current.context.shot).filter(([key, value]) =>
        key === 'id' || key === 'title' || !(key in shotFields) || digest(value) !== digest(shotFields[key])))
      const visibleContext = { ...current.context, shot: shotContext }
      return ports.boundedJson(retainNativeToolReceipt(current.session, exec.callId, 'qingmu_read_director_plan',
        ports.boundedJson(input), { ...input,
          context: visibleContext,
          completeShotDesign: 'planning.frameRequirements[0]; identical fields in context.shot are not repeated; differing values remain visible for reconciliation',
          planning: { schema, projectId, episodeId, scriptRevision, scriptSha256, storyboard,
            frameRequirements: [selectedShot] },
          episodeContinuity: planning.frameRequirements?.map(shot => ({ shotId: shot.id, frameNo: shot.frameNo,
            title: shot.title, continuity: shot.directorPlan?.continuity ?? null })),
          filmSource: { tool: 'qingmu_read_reference_draft', arguments: { page: 1 }, field: 'saved.directorSource.prompt',
            guidance: 'This shot read does not include the complete film bible or current asset/world designs. Read the named current source before authoring generationContext; never fill missing facts from older session descriptions. Reconcile its current shared layout, participants, prop states and script exceptions with this shot. State a real source conflict explicitly instead of merging incompatible versions. After saving, read back the actual production prompt and check semantics, including participant count and action state, not only field presence.' },
          coverage: 'Complete selected-shot design and bound script, cast, scene, style and adjacent-shot context. Episode continuity lists saved start/end states in storyboard order, not observed media. Compare adjoining states and explain intended cuts, time jumps and action ellipses from the script; do not force unrelated scenes to share a state. Save only the selected shot; other changes need their own shot selection. Other full planning copies are retained in the session receipt, not repeated here.',
        }))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_save_director_plan',
    description: 'Save the requested full creative design into the canonical shot: narrative, camera/coverage, acting, dialogue delivery/subtext, lighting, sound, continuity and additional skill output. Patch top-level creative fields; include complete nested values. Keep scripted words and speaker identities; edit those through script tools. This updates the actual source used by reference video compilation and invalidates stale dependent material. No paid generation. Retry identical arguments, including imagePromptCn when supplied, after an uncertain response.',
    parameters: {
      receiptId: { type: 'string', required: true, description: 'Receipt from qingmu_read_director_plan in this session.' },
      directorPlan: { type: 'json', required: true, description: 'Creative fields only. Use visual for the complete current-shot visual design, superseding legacy visual description; imagePromptCn separately describes its starting still. Revise both explicitly when both change. Optional imageStage contains camera, blocking and state for the STARTING image, using the bound scene layout; do not include the later action result. With an existing sceneLayout, optional imageCamera (position, target, verticalFov, roll) produces the same deterministic composition image as qingmu_preview_scene_layout and is submitted with the first-frame request. Preview that view before saving; do not move fixed room objects to fit a new camera. Clear imageCamera explicitly to use text framing alone. No scenePlanning, sourceBinding, creativePlanSchema, clearedShootingFields, runtimeRepairDirectives, promptRepairHistory or internal underscore keys. coveragePlan describes cuts, framing and focus WITHIN this generated segment. Optional generationContext is a nonempty string applying the full film/world/asset/department context specifically to this segment. After reading all relevant sources, retain its era and script exceptions, identities, material/space/light details and applicable methods; do not copy other segments\' actions or dialogue. Production uses this authored context instead of the unscoped film bible; the complete bible remains in research and source freshness. All other current-shot execution fields still reach generation in full. An omitted or empty context retains legacy compilation. This is an authored reconciliation, not a keyword filter or an automatic quality verdict. Optional editorialContext retains adjoining-segment edit instructions, overlaps and postproduction sound bridges for the working cut, excluded from video generation. Keep this segment\'s entry/exit, internal cuts and sound in execution fields. When revising legacy mixed coverage, reconcile the full design explicitly; never delete by keywords or impose one shot/speaker. No fixed list of creative methods.' },
      imagePromptCn: { type: 'string', description: 'Optional complete replacement for the starting-image description, saved atomically with the director design. Omit to preserve it; empty string explicitly clears it. Maximum 20000 characters. Does not regenerate or replace existing images.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'edit', title: '保存完整导演设计' }),
    async execute(args, exec) {
      if (!exec.agent) throw new Error('导演设计需要当前会话。')
      const session = exec.agent.session
      assertNativeTurnTarget(session, exec.callId, true)
      const input = toolValues(session, 'qingmu_read_director_plan')
        .findLast(value => (value as Partial<Input> | null)?.receiptId === args.receiptId) as Partial<Input> | undefined
      if (!input?.scope || !input.context || !input.planning || input.schema !== 'qingmu.native-director-plan.v1' || digest({ scope: input.scope, context: input.context, planning: input.planning }) !== args.receiptId) throw new Error('请先读取当前导演设计。')
      const selected = session.events.findLast(event => event.type === 'qingmu-director-context/state')
      if (selected?.type !== 'qingmu-director-context/state' || !selected.data || digest(selected.data.binding.scope) !== digest(input.scope)) throw new Error('镜头选择已变化。')
      const scope = input.scope
      const shot = input.planning.frameRequirements?.find(shot => shot.id === scope.shotId)
      if (!shot || !input.planning.storyboard || !input.planning.scriptSha256) throw new Error('当前剧本或分镜版本缺失。')
      if (args.directorPlan === null || typeof args.directorPlan !== 'object' || Array.isArray(args.directorPlan)) throw new Error('directorPlan 必须是对象。')
      const request = { action: input.planning.canonicalStoryboard ? 'edit_automatic' : 'edit_requirements',
        shotId: input.scope.shotId, imagePromptCn: args.imagePromptCn ?? shot.imagePromptCn,
        expectedScriptRevision: input.planning.scriptRevision, expectedScriptSha256: input.planning.scriptSha256,
        expectedStoryboardRevision: input.planning.storyboard.version, expectedStoryboardSha256: input.planning.storyboard.sourceHash,
        directorPlan: args.directorPlan }
      const coordinates = { projectId: input.scope.projectId, episodeId: input.scope.episodeId,
        idempotencyKey: `qingmu-director-${digest({ sessionId: session.id, receiptId: args.receiptId, request })}`, request } as YimengCommandJsonObject
      const recovered = await ctx.qingmuYimengCommand('recoverScenePlanning', coordinates, exec.signal)
      let result: ScenePlanningResult
      if (recovered.ok) result = recovered.value as ScenePlanningResult
      else {
        if (recovered.error.message !== 'Yimeng rejected command (HTTP 404: planning_receipt_not_found)') throw new Error(`保存结果无法核实：${recovered.error.message}；没有新提交。`)
        const current = await ports.readBoundContext(exec)
        assertCurrent(current, exec)
        if (current.context.contextSnapshotSha256 !== input.context.contextSnapshotSha256) throw new Error('导演设计来源已变化，请重新读取并合并修改。')
        if (typeof args.directorPlan.generationContext === 'string' && args.directorPlan.generationContext.trim()) {
          const fullRead = toolValues(session, 'qingmu_read_reference_draft').findLast((value) => {
            const read = value as { scope?: unknown; saved?: ReferenceVideoDraftResponse } | null
            return read?.saved?.directorSource && read.scope && digest(read.scope) === digest(scope)
          }) as { saved: ReferenceVideoDraftResponse } | undefined
          if (!fullRead) throw new Error('编写本镜继承设定前，请用 qingmu_read_reference_draft 读取 saved.directorSource.prompt 中当前完整的全片、世界与资产设计；镜头设计读取和会话旧描述不能替代它。')
          const sourceRead = await ctx.qingmuYimengRead('referenceVideoDraft', { projectId: scope.projectId, frameId: scope.shotId }, exec.signal)
          assertCurrent(current, exec)
          if (!sourceRead.ok) throw new Error(`全片导演来源无法核实，未保存：${sourceRead.error.message}`)
          const source = (sourceRead.value as ReferenceVideoDraftResponse).directorSource
          if (!source || digest(source) !== digest(fullRead.saved.directorSource)) throw new Error('全片、世界或资产设计已变化，请重新读取 qingmu_read_reference_draft，并按当前来源整理 generationContext。')
        }
        const saved = await ctx.qingmuYimengCommand('saveScenePlanning', coordinates, exec.signal)
        if (!saved.ok) throw new Error(`未确认保存结果，请保留相同内容重试：${saved.error.message}`)
        result = saved.value as ScenePlanningResult
      }
      let next: { before: string; after: string } | null = null
      try {
        const refreshed = await ctx.qingmuYimengCommand('readDirectorContext', input.scope, exec.signal)
        assertNativeTurnTarget(session, exec.callId, true)
        if (refreshed.ok && !recovered.ok) next = continuation(input.context, refreshed.value as DirectorContextSnapshot, result)
      } catch { /* Report the confirmed write even if refreshing its continuation fails. */ }
      return ports.boundedJson({ schema: 'qingmu.native-director-plan-saved.v1', scope: input.scope,
        result: { ...result, recovered: recovered.ok }, continuation: next, providerCalls: 0, mediaGenerated: false,
        guidance: 'The canonical director plan is saved. Reconcile the reference draft against this new design before preview or generation; existing clips have not been regenerated or approved.' })
    },
  }))
}
