import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { readWorkbook } from './read'

/** 列出工作簿里的所有工作表名 */
export async function listSheets(buf: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  return wb.worksheets.map((w) => w.name)
}

/** 工作表名模糊匹配：精确 → 去空白 → 互相包含 */
function matchSheet(names: string[], want: string): string | undefined {
  const w = want.trim()
  let hit = names.find((n) => n === w)
  if (hit) return hit
  hit = names.find((n) => n.trim() === w)
  if (hit) return hit
  hit = names.find((n) => n.includes(w) || w.includes(n))
  return hit
}

/**
 * 抽取单个工作表为独立 xlsx：复制整个工作簿、删除其它表，
 * 完整保留目标表的合并单元格 / 边框 / 列宽 / 字体等格式。
 */
export async function extractSheet(
  buf: Buffer,
  sheetName: string
): Promise<{ buffer: Buffer; matched: string }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  const names = wb.worksheets.map((w) => w.name)
  const matched = matchSheet(names, sheetName)
  if (!matched) {
    throw new Error(`找不到工作表「${sheetName}」。可选：${names.join('、')}`)
  }
  for (const ws of wb.worksheets.slice()) {
    if (ws.name !== matched) wb.removeWorksheet(ws.id)
  }
  const out = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer: out, matched }
}

/** 预览指定工作表内容（转 markdown，给模型读） */
export function previewSheet(buf: Buffer, ext: string, sheetName: string, maxRows = 40): string {
  const wb = readWorkbook(buf, ext)
  const name = matchSheet(wb.SheetNames, sheetName) || wb.SheetNames[0]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1,
    defval: '',
    blankrows: false
  })
  if (!aoa.length) return `工作表「${name}」为空`
  const width = Math.max(...aoa.map((r) => r.length))
  const cell = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const row = (r: unknown[]): string =>
    '| ' + Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ') + ' |'
  const lines = [`工作表「${name}」（共 ${aoa.length} 行）：`, row(aoa[0]), '| ' + Array(width).fill('---').join(' | ') + ' |']
  for (const r of aoa.slice(1, maxRows + 1)) lines.push(row(r))
  if (aoa.length > maxRows + 1) lines.push(`…（余 ${aoa.length - maxRows - 1} 行）`)
  return lines.join('\n')
}
