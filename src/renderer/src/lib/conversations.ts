// 本地对话历史（IndexedDB，按设备保存，近零成本）。对标 CoGPT 的多对话历史。
export interface ConvMeta {
  id: string
  title: string
  updatedAt: number
}
export interface ConvFull extends ConvMeta {
  messages: unknown[]
}

const DB_NAME = 'motong-conv'
const STORE = 'conv'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function convId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function convSave(c: ConvFull): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(c)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function convList(): Promise<ConvMeta[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const out: ConvMeta[] = []
    const tx = db.transaction(STORE, 'readonly')
    const cur = tx.objectStore(STORE).openCursor()
    cur.onsuccess = () => {
      const c = cur.result
      if (c) {
        const v = c.value as ConvFull
        out.push({ id: v.id, title: v.title, updatedAt: v.updatedAt })
        c.continue()
      } else resolve(out.sort((a, b) => b.updatedAt - a.updatedAt))
    }
    cur.onerror = () => reject(cur.error)
  })
}

export async function convLoad(id: string): Promise<ConvFull | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(id)
    r.onsuccess = () => resolve((r.result as ConvFull) || null)
    r.onerror = () => reject(r.error)
  })
}

export async function convDel(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
