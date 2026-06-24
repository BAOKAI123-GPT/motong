import { apiFetch } from './account'
import { normalizeBaseUrl } from '../shared/url'
import type { ModelInfo, ScanModelsResult, WsQuota } from '../shared/types'

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

// 简单启发式：给对话模型打分、识别识图模型
function scoreModel(id: string): { chatScore: number; vision: boolean } {
  const s = id.toLowerCase()
  let chatScore = 0
  if (/gpt-4o|gpt-4\.1|o3|o1|claude.*(opus|sonnet)|deepseek|qwen.*max|gemini.*(pro|1\.5|2)/.test(s))
    chatScore += 5
  if (/gpt-4|claude|glm-4|moonshot|kimi|doubao|ernie|yi-/.test(s)) chatScore += 3
  if (/turbo|chat|instruct/.test(s)) chatScore += 1
  if (/embed|whisper|tts|audio|image|dall|sd|flux|rerank|moderation/.test(s)) chatScore -= 5
  const vision = /4o|vision|vl|gemini|claude-3|claude.*(opus|sonnet)|qwen.*vl|glm-4v/.test(s)
  return { chatScore, vision }
}

export async function scanModels(baseUrl: string, apiKey: string): Promise<ScanModelsResult> {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/models`
  try {
    const res = await withTimeout(20000, (signal) =>
      fetch(url, { headers: authHeaders(apiKey), signal })
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        models: [],
        error: `中转站返回 ${res.status}：${body.slice(0, 200) || res.statusText}`
      }
    }
    const json: any = await res.json()
    const ids: string[] = Array.isArray(json?.data)
      ? json.data.map((m: any) => m?.id).filter((x: any) => typeof x === 'string')
      : Array.isArray(json)
        ? json.map((m: any) => m?.id ?? m).filter((x: any) => typeof x === 'string')
        : []
    if (ids.length === 0) {
      return { ok: false, models: [], error: '该中转站 /v1/models 没有返回任何模型' }
    }
    const models: ModelInfo[] = ids
      .map((id) => ({ id, ...scoreModel(id) }))
      .sort((a, b) => b.chatScore - a.chatScore)
    const best = models.filter((m) => m.chatScore > 0)
    return {
      ok: true,
      models,
      suggestedChatModel: best[0]?.id,
      suggestedVisionModel: models.find((m) => m.vision)?.id
    }
  } catch (e: any) {
    return {
      ok: false,
      models: [],
      error:
        e?.name === 'AbortError'
          ? '连接超时，请检查中转站 URL 与网络'
          : `无法连接中转站：${e?.message ?? e}`
    }
  }
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  ok: boolean
  text?: string
  error?: string
}

/** 通用对话补全，留给后续“模板填充 / 聊天记录解析”用 */
export interface RawMessage {
  role: string
  content?: unknown
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

export interface ChatRawResult {
  ok: boolean
  message?: RawMessage
  error?: string
  needLogin?: boolean
  needRecharge?: boolean
  scopeBlocked?: boolean
  quota?: WsQuota
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((p: any) => (p?.type === 'text' ? p.text : '')).join('')
  return ''
}

/**
 * 每一步对话都经过后端 /api/agent/chat：后端鉴权、文员范围审核、按套餐周额度计费、
 * 服务端代发中转站（密钥不在客户端）。工具仍在本机执行。
 */
export async function chatRaw(
  messages: RawMessage[],
  tools?: unknown[],
  reqId?: string,
  runId?: string
): Promise<ChatRawResult> {
  // agent 对话耗时较长（后端最长 ~90s 即返回结构化结果）：客户端超时给 100s（略高于后端，<网关上限），
  // 并对快速网络抖动重试 1 次——reqId 幂等，重试不会重复扣费。
  // runId：一整轮 agent run 的标识（多步共用），后端据此「一轮只扣 1 次」（按次计费）。
  const r = await apiFetch(
    '/api/agent/chat',
    { method: 'POST', body: JSON.stringify({ messages, tools, reqId, runId }) },
    { timeoutMs: 100000, retries: 1 }
  )
  const d: any = r.data || {}
  if (r.status === 401) return { ok: false, needLogin: true, error: d.error || '请先登录' }
  if (r.status === 402) return { ok: false, needRecharge: true, quota: d.quota, error: d.error }
  if (r.status === 400 && d.scopeBlocked) return { ok: false, scopeBlocked: true, error: d.error }
  if (!r.ok || !d.ok || !d.message) return { ok: false, error: d.error || `请求失败 (${r.status})` }
  return { ok: true, message: d.message, quota: d.quota }
}

/** 简单对话补全（模板填充/记忆总结用），同样经后端计费 */
export async function chatComplete(_profileId: string, messages: ChatMsg[]): Promise<ChatResult> {
  const r = await apiFetch('/api/agent/chat', { method: 'POST', body: JSON.stringify({ messages }) })
  const d: any = r.data || {}
  if (r.status === 401) return { ok: false, error: '请先登录' }
  if (r.status === 402) return { ok: false, error: d.error || '额度不足' }
  if (!r.ok || !d.ok || !d.message) return { ok: false, error: d.error || `请求失败 (${r.status})` }
  return { ok: true, text: contentText(d.message.content) }
}
