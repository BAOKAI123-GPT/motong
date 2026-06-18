// 记忆库 / 信息库 跨端同步：登录时从云端拉取，变更时推送（云端为准，last-write-wins）。
// 同账号网页与客户端互通、永久保存；软件更新不丢（重装后登录即从云端恢复）。
import { apiFetch, isLoggedIn } from './account'
import { configStore } from './store'
import type { InfoEntry, MemoryEntry } from '../shared/types'

async function pull(kind: 'memory' | 'info'): Promise<unknown[] | null> {
  const r = await apiFetch<{ ok?: boolean; json?: string }>(`/api/ws/data?kind=${kind}`, { method: 'GET' })
  if (!r.ok || typeof r.data?.json !== 'string') return null
  try {
    const arr = JSON.parse(r.data.json)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

function push(kind: 'memory' | 'info', list: unknown[]): void {
  if (!isLoggedIn()) return
  void apiFetch('/api/ws/data', {
    method: 'POST',
    body: JSON.stringify({ kind, json: JSON.stringify(list) })
  }).catch(() => {})
}

/** 登录 / 启动时：用云端数据覆盖本地（云端为准）。云端为空则把本地推上去做首次播种。 */
export async function syncPull(): Promise<void> {
  if (!isLoggedIn()) return
  try {
    const mem = await pull('memory')
    if (mem) configStore.setMemories(mem as MemoryEntry[])
    else push('memory', configStore.getMemories())

    const info = await pull('info')
    if (info) configStore.setInfoEntries(info as InfoEntry[])
    else push('info', configStore.getInfoEntries())
  } catch {
    /* 离线则用本地，不报错 */
  }
}

export function pushMemories(): void {
  push('memory', configStore.getMemories())
}
export function pushInfo(): void {
  push('info', configStore.getInfoEntries())
}
