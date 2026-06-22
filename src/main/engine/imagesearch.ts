// PPT 自动配图：经后端 /api/ws/search 的图片模式取图（服务端在国内、可达外网图源），
// 客户端不直连外网图（国内常被墙/超时）。返回原图地址 + 来源页(用于在 PPT 上标出处)。
import { apiFetch } from '../account'

export interface ImageHit {
  url: string
  source: string
  title: string
}

/** 按关键词搜图，返回若干候选（含来源页 URL，便于标注出处） */
export async function imageSearch(query: string, limit = 6): Promise<ImageHit[]> {
  const r = await apiFetch<{ ok?: boolean; images?: ImageHit[] }>(
    '/api/ws/search',
    { method: 'POST', body: JSON.stringify({ image: true, query, limit }) },
    { timeoutMs: 25000 }
  )
  if (!r.ok || !r.data?.ok) return []
  return r.data.images || []
}

/** 经后端代下载某张图的字节（国内直连外网图不稳，由服务端代取）。失败返回 null。 */
export async function fetchImageBytes(url: string): Promise<{ buf: Buffer; mime: string } | null> {
  const r = await apiFetch<{ ok?: boolean; base64?: string; mime?: string }>(
    '/api/ws/search',
    { method: 'POST', body: JSON.stringify({ fetchImage: url }) },
    { timeoutMs: 25000 }
  )
  if (!r.ok || !r.data?.ok || !r.data.base64) return null
  return { buf: Buffer.from(r.data.base64, 'base64'), mime: r.data.mime || 'image/jpeg' }
}
