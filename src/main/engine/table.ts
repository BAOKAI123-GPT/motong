import * as XLSX from 'xlsx'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TablePreview } from '../../shared/types'
import { sofficeConvert } from './soffice'
import { readWorkbook } from './read'

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** 读成二维数组（每格转成字符串，空格补 ''） */
function readAoA(buf: Buffer, ext: string): { aoa: string[][]; sheetName: string } {
  const wb = readWorkbook(buf, ext)
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  })
  return { aoa, sheetName }
}

export function previewTable(buf: Buffer, headerRow: number, ext: string): TablePreview {
  try {
    const { aoa, sheetName } = readAoA(buf, ext)
    if (aoa.length === 0) {
      return { ok: false, header: [], rows: [], totalRows: 0, error: '这个表格是空的' }
    }
    const hr = Math.max(0, Math.min(headerRow, aoa.length))
    const header = hr > 0 ? aoa[hr - 1] : []
    const data = aoa.slice(hr)
    return {
      ok: true,
      header,
      rows: data.slice(0, 8),
      totalRows: data.length,
      sheetName
    }
  } catch (e: any) {
    return { ok: false, header: [], rows: [], totalRows: 0, error: `读取失败：${e?.message ?? e}` }
  }
}

function sanitize(name: string): string {
  return (name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

export interface SplitParams {
  headerRow: number
  rowsPerFile: number
  outFormat: 'xlsx' | 'csv' | 'pdf'
  nameColumn?: number
}

/** 对话场景用：拆分结果返回内存里的文件数组（xlsx/csv），不落盘 */
export function splitTableToBuffers(
  buf: Buffer,
  ext: string,
  params: { headerRow: number; rowsPerFile: number; outFormat: 'xlsx' | 'csv'; nameColumn?: number },
  baseName: string
): { name: string; buffer: Buffer }[] {
  const { aoa } = readAoA(buf, ext)
  const hr = Math.max(0, Math.min(params.headerRow, aoa.length))
  const headerLines = hr > 0 ? aoa.slice(0, hr) : []
  const data = aoa.slice(hr)
  const per = Math.max(1, params.rowsPerFile || 1)
  if (data.length === 0) throw new Error('没有可拆分的数据行')
  const out: { name: string; buffer: Buffer }[] = []
  let idx = 0
  for (let i = 0; i < data.length; i += per) {
    idx++
    const group = data.slice(i, i + per)
    const block = [...headerLines, ...group]
    let prefix = ''
    if (params.nameColumn != null && group[0] && group[0][params.nameColumn] != null) {
      prefix = sanitize(String(group[0][params.nameColumn]))
    }
    const seq = String(idx).padStart(3, '0')
    const stem = prefix ? `${seq}-${prefix}` : `${baseName}-${seq}`
    const ws = XLSX.utils.aoa_to_sheet(block)
    if (params.outFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws)
      out.push({ name: `${stem}.csv`, buffer: Buffer.concat([BOM, Buffer.from(csv, 'utf8')]) })
    } else {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      out.push({ name: `${stem}.xlsx`, buffer: XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer })
    }
  }
  return out
}

/**
 * 按行拆分表格，写入 outDir，返回生成文件数。
 * headerRow 之前（含该行）的内容作为表头块，复制进每个拆出文件。
 */
export async function splitTable(
  buf: Buffer,
  params: SplitParams,
  outDir: string,
  baseName: string,
  ext: string
): Promise<number> {
  const { aoa } = readAoA(buf, ext)
  const hr = Math.max(0, Math.min(params.headerRow, aoa.length))
  const headerLines = hr > 0 ? aoa.slice(0, hr) : []
  const data = aoa.slice(hr)
  const per = Math.max(1, params.rowsPerFile || 1)
  if (data.length === 0) throw new Error('没有可拆分的数据行（请检查表头行设置）')

  let fileIndex = 0
  let loProfileDir: string | null = null

  for (let i = 0; i < data.length; i += per) {
    fileIndex++
    const group = data.slice(i, i + per)
    const block = [...headerLines, ...group]

    // 文件名：优先取指定列的值，否则用序号
    let prefix = ''
    if (params.nameColumn != null && group[0] && group[0][params.nameColumn] != null) {
      prefix = sanitize(String(group[0][params.nameColumn]))
    }
    const seq = String(fileIndex).padStart(3, '0')
    const stem = prefix ? `${seq}-${prefix}` : `${baseName}-${seq}`

    if (params.outFormat === 'csv') {
      const ws = XLSX.utils.aoa_to_sheet(block)
      const csv = XLSX.utils.sheet_to_csv(ws)
      await writeFile(join(outDir, `${stem}.csv`), Buffer.concat([BOM, Buffer.from(csv, 'utf8')]))
    } else {
      const ws = XLSX.utils.aoa_to_sheet(block)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      const xbuf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
      if (params.outFormat === 'xlsx') {
        await writeFile(join(outDir, `${stem}.xlsx`), xbuf)
      } else {
        // pdf：先落临时 xlsx，再用 LibreOffice 转 pdf
        if (!loProfileDir) loProfileDir = await mkdtemp(join(tmpdir(), 'wenshu-lo-'))
        const tmpIn = await mkdtemp(join(tmpdir(), 'wenshu-split-'))
        const xlsxPath = join(tmpIn, `${stem}.xlsx`)
        await writeFile(xlsxPath, xbuf)
        const pdfPath = await sofficeConvert(xlsxPath, 'pdf', loProfileDir)
        const pdfBuf = await import('node:fs/promises').then((m) => m.readFile(pdfPath))
        await writeFile(join(outDir, `${stem}.pdf`), pdfBuf)
      }
    }
  }
  return fileIndex
}
