// 联网搜索：改为走后端 cogpt.art 的 /api/ws/search（服务器在国内、用 Bing），
// 不再在客户端本机直连 DuckDuckGo（中国大陆被墙，会报“无网络”）。
// 好处：搜索引擎以后在服务端改即可，无需重发客户端。
import { apiFetch } from '../account'

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

/** 搜索，返回前若干条结果（经后端 Bing） */
export async function webSearch(query: string, limit = 8): Promise<SearchHit[]> {
  const r = await apiFetch<{ ok?: boolean; hits?: SearchHit[]; error?: string }>('/api/ws/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit })
  })
  if (!r.ok || !r.data?.ok) {
    if (r.status === 401) throw new Error('登录已过期，请重新登录后再搜索')
    throw new Error(r.data?.error || '联网搜索暂时不可用，请稍后再试')
  }
  return r.data.hits || []
}

/** 取网页正文（经后端） */
export async function fetchPageText(url: string, maxChars = 4000): Promise<string> {
  const r = await apiFetch<{ ok?: boolean; text?: string }>('/api/ws/search', {
    method: 'POST',
    body: JSON.stringify({ url, maxChars })
  })
  if (!r.ok || !r.data?.ok) return ''
  return r.data.text || ''
}
