import { PDFDocument } from 'pdf-lib'

/** 合并多个 PDF（按给定顺序），返回合并后的 PDF buffer */
export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('没有可合并的 PDF')
  const out = await PDFDocument.create()
  for (const b of buffers) {
    const src = await PDFDocument.load(b, { ignoreEncryption: true })
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return Buffer.from(await out.save())
}

/** 读取 PDF 总页数 */
export async function pdfPageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  return doc.getPageCount()
}

/** 把 PDF 每一页拆成单独的单页 PDF，返回 [{ page, buffer }] */
export async function splitEachPage(buf: Buffer): Promise<{ page: number; buffer: Buffer }[]> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true })
  const total = src.getPageCount()
  const result: { page: number; buffer: Buffer }[] = []
  for (let i = 0; i < total; i++) {
    const one = await PDFDocument.create()
    const [p] = await one.copyPages(src, [i])
    one.addPage(p)
    result.push({ page: i + 1, buffer: Buffer.from(await one.save()) })
  }
  return result
}

/**
 * 解析页码范围串，如 "1-3,5,8-10" → 0 基索引数组（去重、保序、忽略越界）。
 */
export function parsePageRanges(spec: string, total: number): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const part of spec.split(/[,，]/)) {
    const s = part.trim()
    if (!s) continue
    const m = /^(\d+)\s*[-~]\s*(\d+)$/.exec(s)
    if (m) {
      let a = parseInt(m[1], 10)
      let b = parseInt(m[2], 10)
      if (a > b) [a, b] = [b, a]
      for (let p = a; p <= b; p++) push(p)
    } else if (/^\d+$/.test(s)) {
      push(parseInt(s, 10))
    } else {
      throw new Error(`页码格式不对：「${s}」。示例：1-3,5,8-10`)
    }
  }
  function push(oneBased: number): void {
    const idx = oneBased - 1
    if (idx >= 0 && idx < total && !seen.has(idx)) {
      seen.add(idx)
      out.push(idx)
    }
  }
  if (out.length === 0) throw new Error('没有有效页码（可能都超出了总页数）')
  return out
}

/** 按 0 基索引提取若干页，合成一个新 PDF */
export async function extractPages(buf: Buffer, indices: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  pages.forEach((p) => out.addPage(p))
  return Buffer.from(await out.save())
}
