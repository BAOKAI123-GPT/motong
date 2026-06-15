import ExcelJS from 'exceljs'
import { writeFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sofficeConvert, findSoffice } from './soffice'

/** 由 AI 提供的结构化表格描述，用来生成送货单/报价单/对账单等专业表格 */
export interface SpreadsheetSpec {
  /** 不含扩展名的文件名，如 “送货单-XX公司-20260614” */
  filename: string
  /** 顶部大标题，如 “送货单” */
  title?: string
  /** 标题下的信息块：左右两栏文本行（发货方/收货方、单号日期等） */
  infoLeft?: string[]
  infoRight?: string[]
  /** 表头列 */
  columns: { header: string; width?: number }[]
  /** 数据行，每行按列顺序给值 */
  rows: (string | number)[][]
  /** 合计行（可选，按列对齐） */
  totalsRow?: (string | number)[]
  /** 底部备注/签字行 */
  note?: string
  /** 输出格式，默认 xlsx */
  outputs?: ('xlsx' | 'pdf')[]
}

export interface GeneratedFile {
  name: string
  /** 文件内容 base64（不含 data: 前缀） */
  base64: string
}

const THIN = { style: 'thin' as const, color: { argb: 'FF888888' } }
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF7' }
}

function buildWorkbook(spec: SpreadsheetSpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 }
  })
  const n = Math.max(1, spec.columns.length)
  let r = 0

  if (spec.title) {
    r++
    ws.mergeCells(r, 1, r, n)
    const c = ws.getCell(r, 1)
    c.value = spec.title
    c.font = { bold: true, size: 16 }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(r).height = 26
  }

  // 信息块：左栏放左半列，右栏放右半列
  const infoRows = Math.max(spec.infoLeft?.length || 0, spec.infoRight?.length || 0)
  if (infoRows > 0) {
    const half = Math.max(1, Math.ceil(n / 2))
    for (let i = 0; i < infoRows; i++) {
      r++
      if (spec.infoLeft?.[i]) {
        ws.mergeCells(r, 1, r, half)
        const c = ws.getCell(r, 1)
        c.value = spec.infoLeft[i]
        c.alignment = { horizontal: 'left' }
      }
      if (spec.infoRight?.[i] && n > half) {
        ws.mergeCells(r, half + 1, r, n)
        const c = ws.getCell(r, half + 1)
        c.value = spec.infoRight[i]
        c.alignment = { horizontal: 'left' }
      }
    }
  }

  // 表头
  r++
  const headerRowIdx = r
  spec.columns.forEach((col, i) => {
    const c = ws.getCell(r, i + 1)
    c.value = col.header
    c.font = { bold: true }
    c.fill = HEADER_FILL
    c.border = BORDER
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    ws.getColumn(i + 1).width = col.width || Math.max(10, String(col.header).length * 2 + 4)
  })

  // 数据行
  for (const row of spec.rows) {
    r++
    for (let i = 0; i < n; i++) {
      const c = ws.getCell(r, i + 1)
      c.value = (row[i] ?? '') as ExcelJS.CellValue
      c.border = BORDER
      c.alignment = { vertical: 'middle', wrapText: true }
    }
  }

  // 合计行
  if (spec.totalsRow && spec.totalsRow.length) {
    r++
    for (let i = 0; i < n; i++) {
      const c = ws.getCell(r, i + 1)
      c.value = (spec.totalsRow[i] ?? '') as ExcelJS.CellValue
      c.font = { bold: true }
      c.border = BORDER
    }
  }

  // 备注
  if (spec.note) {
    r++
    ws.mergeCells(r, 1, r, n)
    const c = ws.getCell(r, 1)
    c.value = spec.note
    c.alignment = { horizontal: 'left', wrapText: true }
  }

  void headerRowIdx
  return wb
}

/** 生成表格文件（xlsx，必要时附带 pdf） */
export async function createSpreadsheet(spec: SpreadsheetSpec): Promise<GeneratedFile[]> {
  if (!spec.columns || spec.columns.length === 0) throw new Error('缺少表头列(columns)')
  const wb = buildWorkbook(spec)
  const xbuf = Buffer.from(await wb.xlsx.writeBuffer())
  const safeName = (spec.filename || '表格').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || '表格'
  const outputs = spec.outputs && spec.outputs.length ? spec.outputs : ['xlsx']
  const files: GeneratedFile[] = []

  if (outputs.includes('xlsx')) {
    files.push({ name: `${safeName}.xlsx`, base64: xbuf.toString('base64') })
  }
  if (outputs.includes('pdf')) {
    if (!findSoffice()) {
      // 没有 LibreOffice 时降级：只给 xlsx，但确保至少有一个文件
      if (!files.length) files.push({ name: `${safeName}.xlsx`, base64: xbuf.toString('base64') })
    } else {
      const inDir = await mkdtemp(join(tmpdir(), 'wenshu-ss-'))
      const xlsxPath = join(inDir, `${safeName}.xlsx`)
      await writeFile(xlsxPath, xbuf)
      const profileDir = await mkdtemp(join(tmpdir(), 'wenshu-lo-'))
      const pdfPath = await sofficeConvert(xlsxPath, 'pdf', profileDir)
      const pdfBuf = await readFile(pdfPath)
      files.push({ name: `${safeName}.pdf`, base64: pdfBuf.toString('base64') })
    }
  }
  return files
}
