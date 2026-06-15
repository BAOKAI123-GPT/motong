import { chatComplete } from '../relay'
import type { InfoEntry } from '../../shared/types'

export interface AiFillResult {
  ok: boolean
  values?: Record<string, string>
  missing?: string[]
  error?: string
}

const SYSTEM = `你是政企文书填充助手。根据「需求描述」和「企业信息库」，为模板的每个占位符给出填充值。
规则：
1. 只用信息库或需求描述里能得到的信息来填，绝不编造（编号、金额、日期、数量等没明确给出就不要猜）。
2. 能确定的放进 values；信息不足无法确定的，把占位符名放进 missing。
3. 占位符名要与给定列表完全一致。
4. 严格只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
格式：{"values":{"占位符名":"填充值"},"missing":["占位符名"]}`

function buildUser(placeholders: string[], info: InfoEntry[], description: string): string {
  const infoLines = info.length
    ? info.map((e) => `- ${e.label}（${e.category}）: ${e.value}`).join('\n')
    : '（信息库为空）'
  return `占位符列表：
${JSON.stringify(placeholders, null, 0)}

企业信息库：
${infoLines}

需求描述：
"""
${description || '（未提供，尽量用信息库填）'}
"""`
}

/** 从模型回复里抠出 JSON 对象 */
function parseJson(text: string): { values: Record<string, string>; missing: string[] } {
  let s = text.trim()
  // 去掉 ```json ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 截取首个 { 到末个 }
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  const obj = JSON.parse(s)
  const values: Record<string, string> = {}
  if (obj && typeof obj.values === 'object' && obj.values) {
    for (const [k, v] of Object.entries(obj.values)) values[k] = v == null ? '' : String(v)
  }
  const missing: string[] = Array.isArray(obj?.missing) ? obj.missing.map((x: unknown) => String(x)) : []
  return { values, missing }
}

export async function aiFillTemplate(
  profileId: string,
  placeholders: string[],
  info: InfoEntry[],
  description: string
): Promise<AiFillResult> {
  if (placeholders.length === 0) return { ok: true, values: {}, missing: [] }
  const res = await chatComplete(profileId, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUser(placeholders, info, description) }
  ])
  if (!res.ok) return { ok: false, error: res.error }
  try {
    const { values, missing } = parseJson(res.text || '')
    // 只保留属于模板的占位符
    const allow = new Set(placeholders)
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) if (allow.has(k)) clean[k] = v
    const stillMissing = placeholders.filter((p) => !clean[p] || clean[p].trim() === '')
    return { ok: true, values: clean, missing: Array.from(new Set([...missing, ...stillMissing])).filter((p) => allow.has(p)) }
  } catch (e: any) {
    return { ok: false, error: `AI 返回的内容无法解析为 JSON：${(res.text || '').slice(0, 120)}…` }
  }
}
