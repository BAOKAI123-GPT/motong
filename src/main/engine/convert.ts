import * as XLSX from 'xlsx'
import { writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import type { TargetFormat } from '../../shared/types'
import { sofficeConvert, libreofficeAvailable } from './soffice'
import { readWorkbook } from './read'

/** SheetJS 能直接读的源格式 */
const SHEET_SRC = new Set(['xlsx', 'xls', 'csv', 'tsv', 'ods'])
/** SheetJS 能直接产出的目标格式 */
const SHEET_TARGET = new Set<TargetFormat>(['xlsx', 'csv', 'html', 'json', 'txt'])

/** 各源格式可选的目标格式（供 UI 动态展示），文档族需要 LibreOffice */
const TARGETS_BY_EXT: Record<string, TargetFormat[]> = {
  xlsx: ['csv', 'pdf', 'html', 'json'],
  xls: ['xlsx', 'csv', 'pdf', 'html', 'json'],
  csv: ['xlsx', 'pdf', 'html', 'json'],
  ods: ['xlsx', 'csv', 'pdf'],
  et: ['xlsx', 'csv', 'pdf'],
  docx: ['pdf', 'txt', 'html', 'odt'],
  doc: ['docx', 'pdf', 'txt'],
  wps: ['docx', 'pdf', 'txt'],
  odt: ['docx', 'pdf', 'txt'],
  rtf: ['docx', 'pdf', 'txt'],
  pptx: ['pdf'],
  ppt: ['pptx', 'pdf'],
  dps: ['pptx', 'pdf'],
  pdf: ['docx', 'txt'],
  txt: ['pdf', 'docx', 'html'],
  html: ['pdf', 'docx', 'txt']
}

export function targetsForExt(ext: string): TargetFormat[] {
  return TARGETS_BY_EXT[ext.toLowerCase()] ?? []
}

export { libreofficeAvailable }

export interface ConvertOutput {
  buffer: Buffer
  engine: 'sheetjs' | 'libreoffice'
  outExt: string
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

function viaSheetJs(buf: Buffer, srcExt: string, target: TargetFormat): Buffer {
  const wb = readWorkbook(buf, srcExt)
  const firstName = wb.SheetNames[0]
  const ws = wb.Sheets[firstName]
  switch (target) {
    case 'xlsx':
      return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
    case 'csv': {
      const csv = XLSX.utils.sheet_to_csv(ws)
      // 加 UTF-8 BOM，避免 Excel 打开中文乱码
      return Buffer.concat([BOM, Buffer.from(csv, 'utf8')])
    }
    case 'html': {
      const html = XLSX.write(wb, { bookType: 'html', type: 'string' }) as string
      return Buffer.from(html, 'utf8')
    }
    case 'txt': {
      const txt = XLSX.utils.sheet_to_txt(ws) // 制表符分隔
      return Buffer.concat([BOM, Buffer.from(txt, 'utf8')])
    }
    case 'json': {
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      return Buffer.from(JSON.stringify(rows, null, 2), 'utf8')
    }
    default:
      throw new Error(`SheetJS 不支持输出 ${target}`)
  }
}

async function viaLibreOffice(
  srcName: string,
  buf: Buffer,
  target: TargetFormat
): Promise<Buffer> {
  const inDir = await mkdtemp(join(tmpdir(), 'wenshu-in-'))
  const inputPath = join(inDir, srcName)
  await writeFile(inputPath, buf)
  const profileDir = await mkdtemp(join(tmpdir(), 'wenshu-lo-'))
  const outPath = await sofficeConvert(inputPath, target, profileDir)
  return readFile(outPath)
}

/**
 * 转换主入口：能用 SheetJS 就用（纯本地、快、无外部依赖），
 * 否则交给 LibreOffice（文档/PDF 族）。
 */
export async function convertFile(
  srcName: string,
  buf: Buffer,
  target: TargetFormat
): Promise<ConvertOutput> {
  const srcExt = extname(srcName).slice(1).toLowerCase()
  const sheetSrc = SHEET_SRC.has(srcExt)
  const sheetTarget = SHEET_TARGET.has(target)

  if (sheetSrc && sheetTarget) {
    return { buffer: viaSheetJs(buf, srcExt, target), engine: 'sheetjs', outExt: target }
  }
  const buffer = await viaLibreOffice(srcName, buf, target)
  return { buffer, engine: 'libreoffice', outExt: target }
}
