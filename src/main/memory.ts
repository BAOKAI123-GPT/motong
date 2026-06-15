import { configStore } from './store'
import { chatComplete } from './relay'
import { summarizeFile } from './engine/filecontent'
import type { MemoryEntry } from '../shared/types'

/** 记忆总字符预算；超过就先总结、再不行就从最早删起 */
const LIMIT = 8000
/** 总结后保留的“最近条目”目标体量 */
const KEEP_RECENT = 4800
/** 单条记忆最长 */
const MAX_ENTRY = 4000

function total(mems: MemoryEntry[]): number {
  return mems.reduce((s, m) => s + m.text.length, 0)
}

/** 拼成给对话注入的记忆文本（空则返回空串） */
export function memoryContext(): string {
  const mems = configStore.getMemories()
  if (!mems.length) return ''
  return mems
    .map((m) => {
      const tag =
        m.source === 'summary' ? '【已总结】' : m.source === 'file' ? '【文件】' : ''
      return `- ${tag}${m.text}`
    })
    .join('\n')
    .slice(0, LIMIT + 2000)
}

/** 存一条记忆，必要时触发压缩 */
export async function addMemory(text: string, source: MemoryEntry['source']): Promise<void> {
  const t = (text || '').trim()
  if (!t) return
  configStore.addMemory(t.slice(0, MAX_ENTRY), source)
  await compactIfNeeded()
}

/** 把一个文件的要点存入记忆 */
export async function addFileMemory(name: string, buf: Buffer): Promise<void> {
  let note = `文件「${name}」`
  try {
    const s = await summarizeFile(name, buf)
    if (s.meta) note += `（${s.meta}）`
    if (s.placeholders?.length) note += `，占位符：${s.placeholders.join('、')}`
    if (s.text) note += `\n要点：\n${s.text.slice(0, 1500)}`
  } catch {
    /* 读不出就只记文件名 */
  }
  await addMemory(note, 'file')
}

/** 超限时：先用大模型把最早的条目总结成提纲；失败则从早往后删除 */
async function compactIfNeeded(): Promise<void> {
  let mems = configStore.getMemories()
  if (total(mems) <= LIMIT) return

  // 从最新往回保留 KEEP_RECENT 体量，其余（较早的）拿去总结
  const recent: MemoryEntry[] = []
  let acc = 0
  for (let i = mems.length - 1; i >= 0; i--) {
    acc += mems[i].text.length
    if (acc <= KEEP_RECENT) recent.unshift(mems[i])
  }
  const older = mems.slice(0, mems.length - recent.length)

  if (older.length >= 1) {
    try {
      const pid = configStore.getActiveProfileId()
      if (!pid) throw new Error('无可用中转站')
      const res = await chatComplete(pid, [
        {
          role: 'system',
          content:
            '你是记忆整理助手。把用户给的若干条零散记忆浓缩成一份简洁提纲：分点列出，务必保留关键事实（公司/人名、数字、合同号/单号、物料代码、约定、偏好、文件要点），删掉寒暄与冗余。只输出提纲本身，不要解释。'
        },
        { role: 'user', content: older.map((m) => m.text).join('\n---\n').slice(0, 12000) }
      ])
      if (!res.ok || !res.text) throw new Error(res.error || '总结失败')
      const summary = configStore.mintMemory(
        '记忆提纲：\n' + res.text.trim(),
        'summary',
        older[0].createdAt
      )
      configStore.setMemories([summary, ...recent])
    } catch {
      evictOldest()
    }
  } else {
    evictOldest()
  }

  // 兜底：仍超限就继续从早往后删
  if (total(configStore.getMemories()) > LIMIT) evictOldest()
}

/** 从最早的记忆开始删，直到不超限 */
function evictOldest(): void {
  let mems = configStore.getMemories()
  while (total(mems) > LIMIT && mems.length > 0) mems = mems.slice(1)
  configStore.setMemories(mems)
}
