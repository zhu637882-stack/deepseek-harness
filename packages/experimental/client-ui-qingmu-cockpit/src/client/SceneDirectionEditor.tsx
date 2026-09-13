/** Edits authored shot direction while retaining unexposed department fields and dialogue sources. */
import type { PlanningShot, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { ShotLayoutEditor } from './ShotLayoutEditor.tsx'
import type { ShotLayoutContext } from './ShotLayoutEditor.tsx'

const departmentLabels = {
  generationContext: '本镜沿用的全片设定',
  blocking: '人物站位与调度', cameraAngle: '景别与机位', cameraMovement: '运镜设计',
  coveragePlan: '本段景别、焦点与切点', editorialContext: '前后段剪辑衔接', performance: '表演设计', lighting: '光影设计',
} as const
const groupLabels = {
  soundPlan: { ambience: '环境与空间声', foley: '动作拟音', music: '配乐安排' },
  continuity: { start: '镜头开始状态', end: '镜头结束状态' },
  imageStage: { camera: '首帧取景范围', blocking: '首帧人物位置与朝向', state: '首帧道具与连接状态' },
} as const

function record(value: unknown): YimengCommandJsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as YimengCommandJsonObject : null
}

/** Changes only the edited value; the planning workspace owns persistence and stale-source handling. */
export function SceneDirectionEditor({ value, onChange, layoutContext }: {
  value: PlanningShot['directorPlan']
  onChange: (value: YimengCommandJsonObject) => void
  layoutContext?: ShotLayoutContext | undefined
}) {
  const plan = value ?? {}
  const dialogues: readonly unknown[] = Array.isArray(plan.dialoguePlan) ? plan.dialoguePlan : []
  function textField(label: string, content: unknown, write: (text: string) => void) {
    if (content !== undefined && typeof content !== 'string') return <p key={label}>{label}含结构化内容，可在下方完整设计中查看。</p>
    return <label key={label}>{label}<textarea aria-label={label} rows={3} value={content ?? ''}
      onChange={(event) => { write(event.target.value) }} /></label>
  }
  return <details><summary>本镜完整导演设计</summary>
    <p>修改后与镜头一起保存。请同时核对画面、动作和相邻镜头，避免留下相互矛盾的安排。</p>
    <p>本段内的切镜写在“本段景别、焦点与切点”；与前后段的接镜、声桥写在“前后段剪辑衔接”，供成片剪辑使用。旧设计不会自动改写。</p>
    <p>“本镜沿用的全片设定”整理本镜需要的年代、人物、空间、光线和道具状态。填写后生成采用这份整理稿，全片原设定保留；留空沿用原有方式。动作、对白和各部门的具体设计仍在下方分别编辑。</p>
    <p>首帧取景沿用已绑定场景的共用格局，填写动作开始时看见的范围、人物位置和物件状态；后续动作写入调度和结束状态。留空时使用本镜机位和开始状态。</p>
    {layoutContext && <ShotLayoutEditor context={layoutContext} value={plan.imageCamera} onChange={(camera) => {
      onChange({ ...plan, imageCamera: camera === null ? null : {
        position: [...camera.position], target: [...camera.target], verticalFov: camera.verticalFov,
        ...(camera.roll === undefined ? {} : { roll: camera.roll }),
      } })
    }} />}
    {Object.entries(departmentLabels).map(([field, label]) => textField(label, plan[field], (text) => {
      onChange({ ...plan, [field]: text })
    }))}
    {Object.entries(groupLabels).map(([group, labels]) => {
      const current = record(plan[group])
      if (plan[group] !== undefined && current === null) return <p key={group}>
        {group === 'soundPlan' ? '声音设计' : group === 'imageStage' ? '首帧取景' : '接续设计'}含其他格式，可在下方完整设计中查看。
      </p>
      return <div key={group}>{Object.entries(labels).map(([field, label]) =>
        textField(label, current?.[field], (text) => { onChange({ ...plan, [group]: { ...current, [field]: text } }) }))}</div>
    })}
    {dialogues.map((entry, index) => {
      const dialogue = record(entry)
      if (!dialogue) return null
      return <div key={index}>
        <p>{typeof dialogue.character === 'string' ? dialogue.character : '对白'}：{typeof dialogue.line === 'string' ? dialogue.line : ''}</p>
        {textField(`对白 ${index + 1} 的语气与表演`, dialogue.delivery, (text) => {
          onChange({ ...plan, dialoguePlan: dialogues.map((item, i) => i === index ? { ...dialogue, delivery: text } : item) })
        })}
      </div>
    })}
    <details><summary>查看完整设计数据</summary><pre>{JSON.stringify(plan, null, 2)}</pre></details>
  </details>
}
