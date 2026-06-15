// 免 API key 的联网搜索：抓 DuckDuckGo HTML 端点 + 取网页正文。尽力而为，可能因站点变动失效。
// 在 Electron 主进程运行（无 CORS）。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}
/** DDG 跳转链接 //duckduckgo.com/l/?uddg=<编码真实地址> → 还原 */
function realUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      /* ignore */
    }
  }
  return href.startsWith('//') ? 'https:' + href : href
}

async function withTimeout<T>(ms: number, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fn(c.signal)
  } finally {
    clearTimeout(t)
  }
}

/** 搜索，返回前若干条结果 */
export async function webSearch(query: string, limit = 8): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`
  const res = await withTimeout(20000, (signal) =>
    fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh' }, signal })
  )
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)
  const html = await res.text()
  const hits: SearchHit[] = []
  // 标题+链接
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  // 摘要
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = snipRe.exec(html))) snippets.push(stripTags(sm[1]))
  let lm: RegExpExecArray | null
  let i = 0
  while ((lm = linkRe.exec(html)) && hits.length < limit) {
    const title = stripTags(lm[2])
    if (!title) continue
    hits.push({ title, url: realUrl(lm[1]), snippet: snippets[i] || '' })
    i++
  }
  return hits
}

/** 取网页正文（去标签、截断），供模型阅读 */
export async function fetchPageText(url: string, maxChars = 4000): Promise<string> {
  try {
    const res = await withTimeout(15000, (signal) =>
      fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh' }, signal })
    )
    if (!res.ok) return ''
    let html = await res.text()
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    return stripTags(html).slice(0, maxChars)
  } catch {
    return ''
  }
}
