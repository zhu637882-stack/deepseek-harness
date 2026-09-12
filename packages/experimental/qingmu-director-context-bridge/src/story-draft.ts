/** A completed native writing turn, reconstructed without exposing model reasoning. */
export interface StoryDraftResult {
  readonly lastSeq: number
  readonly running: boolean
  readonly finished: boolean
  readonly text: string
  readonly script: string
  readonly error: string
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/**
 * Read final screenplay text from durable native events after the submitted request's baseline.
 * @param entries A native history page, which may also contain tool and reasoning events.
 * @param afterSeq Last sequence observed before this request.
 * @returns Only completed assistant text and the explicitly fenced screenplay; errors stay visible.
 */
export function readStoryDraft(entries: readonly unknown[], afterSeq: number): StoryDraftResult {
  let lastSeq = afterSeq, start = -1, end = -1, text = '', error = ''
  for (const entry of entries) {
    const event = record(record(entry).event), data = record(event.data)
    if (typeof event.seq !== 'number' || event.seq <= afterSeq) continue
    lastSeq = Math.max(lastSeq, event.seq)
    if (event.type === 'turn/start') { start = event.seq; text = ''; error = '' }
    if (event.type === 'assistant/message') {
      const content = record(data.message).content
      if (Array.isArray(content) && !content.some(part => record(part).type === 'tool-call')) {
        text = content.filter(part => record(part).type === 'text')
          .map(part => record(part).text).filter((part): part is string => typeof part === 'string').join('\n')
      }
    }
    if (event.type === 'turn/end') {
      end = event.seq
      const reason = record(data.reason)
      if (reason.kind === 'error') {
        const message = record(reason.error).message
        error = typeof message === 'string' ? message : '编剧调用失败，请检查模型设置。'
      } else if (reason.kind !== 'completed') error = '编剧已停止，当前稿尚未完成。'
    }
  }
  const finished = end >= 0 && end > start
  const script = finished && !error ? /```(?:txt|text)\s*\n([\s\S]*?)```/i.exec(text)?.[1]?.trim() ?? '' : ''
  return { lastSeq, running: start > end, finished, text: finished ? text : '', script, error }
}

/** A writing-only native session uses the current project's explicit source, never a shot binding. */
export interface NativeStoryPort {
  /** Create or resume the caller's retained session; does not send a model request. */
  prepare(sessionId: string): Promise<void>
  /** Submit exactly one writing request through the existing DSH provider. */
  send(sessionId: string, text: string, scope?: { projectId: string; episodeId: string; purpose: string }): Promise<void>
  /** Read durable progress; reading never resumes or repeats a model request. */
  read(sessionId: string, afterSeq: number): Promise<StoryDraftResult>
}
