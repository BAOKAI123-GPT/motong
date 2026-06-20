// 会话级文件缓存：让「上传过/生成过的文件」在多轮对话里持续可用，
// 用户第二轮说「把刚才那个文件改成…」时无需重传，模型仍能按稳定 id 引用并让工具读取。
//
// 设计要点：
// - 按 convId 维护一份文件列表（稳定 id + 名称 + base64）。
// - 上传文件的 id 跨轮稳定（uX）；生成文件沿用本轮 ctx 里的 gX id。
// - 只缓存在主进程内存里，进程退出即清；不写盘、不进 IndexedDB（避免大对象持久化）。
// - 内容（base64）只在主进程内保存，跨轮注册进 ctx 后由 read_file 等工具按需读取，
//   不会每轮把全部历史文件 base64 重新塞给 LLM（详见 loop.ts 的摘要逻辑）。

export interface CachedFile {
  /** 跨轮稳定的引用 id，如 u1 / g2 */
  id: string
  name: string
  /** 文件二进制 base64（不含 data: 前缀） */
  base64: string
  /** 来源：上传 or 本会话生成 */
  origin: 'upload' | 'generated'
}

/** 单会话最多缓存的文件数（防止极端长会话占满内存，超出按 FIFO 淘汰最早的上传/生成文件） */
const MAX_FILES_PER_CONV = 40

const store = new Map<string, CachedFile[]>()

/** 取某会话当前已缓存的文件（按加入顺序） */
export function getConvFiles(convId: string): CachedFile[] {
  if (!convId) return []
  return store.get(convId) ?? []
}

function trim(list: CachedFile[]): CachedFile[] {
  return list.length > MAX_FILES_PER_CONV ? list.slice(list.length - MAX_FILES_PER_CONV) : list
}

/**
 * 把本轮新上传的文件并入会话缓存，并返回它们被分配的稳定 id（uX）。
 * 用名称去重：同名再次上传视为同一文件并刷新内容（覆盖 base64），id 不变。
 */
export function addUploads(
  convId: string,
  files: { name: string; base64: string }[]
): { id: string; name: string; base64: string }[] {
  if (!convId) {
    // 无 convId（理论上不应发生）时退化为本轮临时 id，不进缓存。
    return files.map((f, i) => ({ id: `u${i + 1}`, name: f.name, base64: f.base64 }))
  }
  const list = store.get(convId) ?? []
  const assigned: { id: string; name: string; base64: string }[] = []
  let maxUploadSeq = list.reduce((mx, f) => {
    const m = /^u(\d+)$/.exec(f.id)
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx
  }, 0)

  for (const f of files) {
    const existing = list.find((c) => c.origin === 'upload' && c.name === f.name)
    if (existing) {
      existing.base64 = f.base64
      assigned.push({ id: existing.id, name: existing.name, base64: existing.base64 })
    } else {
      maxUploadSeq += 1
      const entry: CachedFile = { id: `u${maxUploadSeq}`, name: f.name, base64: f.base64, origin: 'upload' }
      list.push(entry)
      assigned.push({ id: entry.id, name: entry.name, base64: entry.base64 })
    }
  }
  store.set(convId, trim(list))
  return assigned
}

/**
 * 把本轮生成的文件并入会话缓存，使下一轮可继续引用（如对生成的送货单再修改）。
 * 同名生成文件覆盖刷新内容，id 沿用本轮 ctx 分配的 gX。
 */
export function addGenerated(
  convId: string,
  files: { id: string; name: string; base64: string }[]
): void {
  if (!convId || !files.length) return
  const list = store.get(convId) ?? []
  for (const f of files) {
    const existing = list.find((c) => c.id === f.id || (c.origin === 'generated' && c.name === f.name))
    if (existing) {
      existing.base64 = f.base64
      existing.name = f.name
    } else {
      list.push({ id: f.id, name: f.name, base64: f.base64, origin: 'generated' })
    }
  }
  store.set(convId, trim(list))
}

/** 删除某会话缓存（用户删除对话时调用，及时释放内存） */
export function dropConv(convId: string): void {
  store.delete(convId)
}
