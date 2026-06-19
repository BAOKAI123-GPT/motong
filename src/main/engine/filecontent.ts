import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { PDFDocument } from 'pdf-lib'
import { writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorkbook } from './read'
import { sofficeConvert } from './soffice'

export type FileKind = 'spreadsheet' | 'document' | 'pdf' | 'image' | 'other'

export interface FileSummary {
  name: string
  ext: string
  kind: FileKind
  /** 模型可读的文字内容（表格转 markdown / 文档正文） */
  text?: string
  /** 若像模板（含 {{}}）则列出占位符 */
  placeholders?: string[]
  /** 简短规模信息，如 “3 个工作表 / 120 行” */
  meta?: string
}

const SHEET = new Set(['xlsx', 'xls', 'csv', 'tsv', 'ods', 'et'])
const IMG = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

function extOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

const PH = /\{\{\s*([^{}]+?)\s*\}\}/g
function findPlaceholders(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  PH.lastIndex = 0
  while ((m = PH.exec(text))) {
    const k = m[1].trim()
    if (k && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

function aoaToMarkdown(aoa: unknown[][], maxRows: number): string {
  if (!aoa.length) return ''
  const width = Math.max(...aoa.map((r) => r.length))
  const cell = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const pad = (r: unknown[]): string =>
    '| ' + Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ') + ' |'
  const lines = [pad(aoa[0]), '| ' + Array(width).fill('---').join(' | ') + ' |']
  for (const row of aoa.slice(1, maxRows + 1)) lines.push(pad(row))
  return lines.join('\n')
}

async function docxText(buf: Buffer): Promise<{ text: string; placeholders: string[] }> {
  const zip = await JSZip.loadAsync(buf)
  const parts = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)
  )
  const paras: string[] = []
  for (const n of parts) {
    const xml = await zip.file(n)!.async('string')
    const doc = new DOMParser({ errorHandler: {} as never }).parseFromString(xml, 'text/xml')
    const ps = doc.getElementsByTagName('w:p')
    for (let i = 0; i < ps.length; i++) {
      const t = ps[i].textContent || ''
      if (t.trim()) paras.push(t)
    }
  }
  const text = paras.join('\n')
  return { text, placeholders: findPlaceholders(text) }
}

const LEGACY_DOC = new Set(['doc', 'wps', 'rtf', 'odt'])
/** 旧版/其它文档(.doc/.wps/.rtf/.odt)：先用 LibreOffice 转成 .docx，再按 docx 解析（避免编码乱码） */
async function legacyDocText(name: string, buf: Buffer): Promise<{ text: string; placeholders: string[] }> {
  const ext = extOf(name) || 'doc'
  const inDir = await mkdtemp(join(tmpdir(), 'wenshu-doc-'))
  const inputPath = join(inDir, `input.${ext}`)
  await writeFile(inputPath, buf)
  const profileDir = await mkdtemp(join(tmpdir(), 'wenshu-lo-'))
  const docxPath = await sofficeConvert(inputPath, 'docx', profileDir)
  const docxBuf = await readFile(docxPath)
  return docxText(docxBuf)
}

/** 把上传文件解析成模型可读内容 */
export async function summarizeFile(name: string, buf: Buffer): Promise<FileSummary> {
  const ext = extOf(name)
  if (IMG.has(ext)) {
    return { name, ext, kind: 'image', meta: '图片（将交给识图模型读取）' }
  }
  if (ext === 'docx') {
    try {
      const { text, placeholders } = await docxText(buf)
      const isTpl = placeholders.length > 0
      return {
        name,
        ext,
        kind: 'document',
        text: text.slice(0, 6000),
        placeholders: isTpl ? placeholders : undefined,
        meta: isTpl ? `Word 模板，含 ${placeholders.length} 个占位符` : 'Word 文档'
      }
    } catch (e: any) {
      return { name, ext, kind: 'document', meta: `无法读取：${e?.message ?? e}` }
    }
  }
  if (LEGACY_DOC.has(ext)) {
    try {
      const { text, placeholders } = await legacyDocText(name, buf)
      if (!text.trim()) throw new Error('未提取到文字')
      const isTpl = placeholders.length > 0
      return {
        name,
        ext,
        kind: 'document',
        text: text.slice(0, 6000),
        placeholders: isTpl ? placeholders : undefined,
        meta: isTpl ? `文档模板，含 ${placeholders.length} 个占位符` : '文档（经 LibreOffice 解析）'
      }
    } catch (e: any) {
      return {
        name,
        ext,
        kind: 'document',
        meta: `无法读取旧版 .${ext}：${e?.message ?? e}（需 LibreOffice；Windows 版已内置，若仍失败可把文件另存为 .docx 再上传）`
      }
    }
  }
  if (ext === 'pdf') {
    try {
      const pages = (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount()
      return {
        name,
        ext,
        kind: 'pdf',
        meta: `PDF，共 ${pages} 页（如需读取/编辑内容，可先用工具转成 Excel/Word 再处理）`
      }
    } catch (e: any) {
      return { name, ext, kind: 'pdf', meta: `无法读取：${e?.message ?? e}` }
    }
  }
  if (SHEET.has(ext)) {
    try {
      const wb = readWorkbook(buf, ext)
      const sheetSummaries: string[] = []
      let firstMd = ''
      let totalRows = 0
      let placeholders: string[] = []
      wb.SheetNames.forEach((sn, idx) => {
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], {
          header: 1,
          defval: '',
          blankrows: false
        })
        totalRows += Math.max(0, aoa.length - 1)
        if (idx === 0) {
          firstMd = aoaToMarkdown(aoa, 40)
          placeholders = findPlaceholders(aoa.flat().map(String).join('\n'))
        }
        sheetSummaries.push(`${sn}(${aoa.length}行)`)
      })
      const isTpl = placeholders.length > 0
      const text =
        `工作表：${sheetSummaries.join('、')}\n第一个工作表预览（最多 40 行）：\n${firstMd}` +
        (totalRows > 40 ? `\n…（共约 ${totalRows} 行数据）` : '')
      return {
        name,
        ext,
        kind: 'spreadsheet',
        text,
        placeholders: isTpl ? placeholders : undefined,
        meta: isTpl
          ? `Excel 模板，含 ${placeholders.length} 个占位符`
          : `表格，${wb.SheetNames.length} 个工作表`
      }
    } catch (e: any) {
      return { name, ext, kind: 'spreadsheet', meta: `无法读取：${e?.message ?? e}` }
    }
  }
  return { name, ext, kind: 'other', meta: `${ext || '未知'} 文件` }
}
