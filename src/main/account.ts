import Store from 'electron-store'

// 翰文账号 / 后端对接（仅主进程持有 token，渲染层拿不到，防泄露）。
// 后端就是 CoGPT 那套（cogpt.art）；本地联调可用 WS_API_BASE 覆盖。
export const API_BASE = (process.env.WS_API_BASE || 'https://cogpt.art').replace(/\/+$/, '')

interface SessionSchema {
  token?: string
  phone?: string
}
const store = new Store<SessionSchema>({ name: 'wenshu-session' })

export function getToken(): string | undefined {
  return store.get('token')
}
export function getPhone(): string | undefined {
  return store.get('phone')
}
export function isLoggedIn(): boolean {
  return !!store.get('token')
}
export function setSession(token: string, phone: string): void {
  store.set('token', token)
  store.set('phone', phone)
}
export function clearSession(): void {
  store.delete('token')
  store.delete('phone')
}

export interface ApiResult<T = any> {
  ok: boolean
  status: number
  data: T
}

/** 带 JWT 的后端请求。
 *  - timeoutMs：单次请求超时（AbortController）。普通接口 30s；agent 对话需更久(见 chatRaw 传 100s)。
 *  - retries：仅对「快速发生的网络错误」(非超时、<20s) 重试，避免慢挂叠加；reqId 幂等保证重试不重复扣费。
 *  失败时把 undici 的 e.cause(code/errno) 一并记录与回传，便于区分 DNS/TLS/连接被网关切断。 */
export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined)
  }
  const tok = getToken()
  if (tok) headers.Authorization = `Bearer ${tok}`
  const timeoutMs = opts.timeoutMs ?? 30000
  const retries = opts.retries ?? 0
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const t0 = Date.now()
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: ctrl.signal })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data: data as T }
    } catch (e: any) {
      lastErr = e
      const isTimeout = e?.name === 'AbortError'
      const causeCode = e?.cause?.code || e?.cause?.errno || e?.cause?.message || ''
      console.warn('[apiFetch] 请求失败', {
        path,
        attempt,
        name: e?.name,
        message: e?.message,
        cause: causeCode
      })
      // 快速失败的网络错误才重试（瞬时连接抖动）；超时或慢挂不重试，避免叠加等待
      const fast = Date.now() - t0 < 20000
      if (isTimeout || attempt >= retries || !fast) {
        const msg = isTimeout
          ? '请求超时了，请检查网络后重试，或把需求/文件拆小一点'
          : `连不上服务器：${e?.message ?? e}${causeCode ? `（${causeCode}）` : ''}`
        return { ok: false, status: 0, data: { error: msg } as T }
      }
      await new Promise((r) => setTimeout(r, 800)) // 退避后重试
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: 0, data: { error: `连不上服务器：${lastErr?.message ?? lastErr}` } as T }
}

// —— 认证 ——
export async function sendCode(phone: string): Promise<ApiResult> {
  return apiFetch('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone }) })
}
export async function login(phone: string, code: string): Promise<ApiResult<{ ok?: boolean; token?: string; error?: string }>> {
  const r = await apiFetch<{ ok?: boolean; token?: string; error?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, code })
  })
  if (r.ok && r.data?.token) setSession(r.data.token, phone)
  return r
}
export function logout(): void {
  clearSession()
}

// —— 翰文账户 / 套餐 / 支付 / 版本 ——
export async function me(): Promise<ApiResult> {
  return apiFetch('/api/ws/me', { method: 'GET' })
}
export async function tiers(): Promise<ApiResult> {
  return apiFetch('/api/ws/tiers', { method: 'GET' })
}
export async function payCreate(tier: string): Promise<ApiResult> {
  return apiFetch('/api/ws/pay/create', { method: 'POST', body: JSON.stringify({ tier }) })
}
export async function payStatus(outTradeNo: string): Promise<ApiResult> {
  return apiFetch(`/api/pay/status?outTradeNo=${encodeURIComponent(outTradeNo)}`, { method: 'GET' })
}
export async function appVersion(): Promise<ApiResult> {
  return apiFetch('/api/ws/app-version', { method: 'GET' })
}
