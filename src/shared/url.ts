/** 规范化中转站 base url：去掉结尾斜杠、补全协议、去掉误填的 /v1 */
export function normalizeBaseUrl(raw: string): string {
  let u = (raw || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  u = u.replace(/\/+$/, '')
  // 用户常把 /v1 一起填进来，统一去掉，由调用处拼接
  u = u.replace(/\/v1$/i, '')
  return u
}
