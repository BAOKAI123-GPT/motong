// 办公文档格式标准化：把上传的 Word/Excel 按「企业统一格式规范」一键调整。
// - Word(.docx)：改 word/styles.xml 的 docDefaults(全局字体/字号/行距) + Normal 首行缩进 + 各级标题样式，
//   并改 document.xml 的 sectPr 页边距；或直接套用「模板 docx」的 styles.xml（最省心、最一致）。
//   走样式层（而非逐段改）以最大化覆盖、降低破坏风险。
// - Excel(.xlsx)：用 exceljs 套字体/字号/列宽/表头加粗/边框/数字格式。
// 说明：复杂或异常文档无法保证 100% 零误差，返回时会一并列出「已应用规则」与「未能处理项」供复核。
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import ExcelJS from 'exceljs'

export interface FormatSpec {
  cnFont?: string // 中文字体，如 仿宋_GB2312 / 宋体 / 微软雅黑
  enFont?: string // 西文/数字字体，如 Times New Roman
  bodySize?: number // 正文字号(pt)，如 14(三号)
  lineSpacing?: number // 行距倍数，如 1.5
  firstLineIndent?: boolean // 正文首行缩进 2 字符
  margins?: { top?: number; bottom?: number; left?: number; right?: number } // 页边距(厘米)
  headings?: { level: number; font?: string; size?: number; bold?: boolean }[] // 各级标题
  // Excel 专项
  headerBold?: boolean
  borders?: boolean
  colWidth?: number
}

export interface FormatResult {
  base64: string
  ext: string
  applied: string[]
  skipped: string[]
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const cm2tw = (cm: number): number => Math.round(cm * 567) // 厘米→twips
const pt2hp = (pt: number): number => Math.round(pt * 2) // pt→半点
const mul2line = (m: number): number => Math.round(m * 240) // 行距倍数→240ths

// ---------- 通用 XML 小工具（命名空间用 w: 前缀） ----------
function child(parent: any, tag: string): any {
  const ns = parent.getElementsByTagNameNS ? parent.childNodes : parent.childNodes
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i]
    if (n.nodeType === 1 && (n.tagName === tag || n.nodeName === tag)) return n
  }
  return null
}
function ensureChild(doc: any, parent: any, tag: string, first = false): any {
  let e = child(parent, tag)
  if (!e) {
    e = doc.createElementNS(W, tag)
    if (first && parent.firstChild) parent.insertBefore(e, parent.firstChild)
    else parent.appendChild(e)
  }
  return e
}
function setAttr(el: any, name: string, val: string): void {
  el.setAttribute(name, val)
}

// 设置一个 rPr 节点的字体/字号/加粗
function applyRPr(doc: any, rPr: any, spec: { cnFont?: string; enFont?: string; size?: number; bold?: boolean }): void {
  if (spec.cnFont || spec.enFont) {
    const rf = ensureChild(doc, rPr, 'w:rFonts', true)
    if (spec.enFont) {
      setAttr(rf, 'w:ascii', spec.enFont)
      setAttr(rf, 'w:hAnsi', spec.enFont)
    }
    if (spec.cnFont) setAttr(rf, 'w:eastAsia', spec.cnFont)
  }
  if (spec.size) {
    const sz = ensureChild(doc, rPr, 'w:sz')
    setAttr(sz, 'w:val', String(pt2hp(spec.size)))
    const szCs = ensureChild(doc, rPr, 'w:szCs')
    setAttr(szCs, 'w:val', String(pt2hp(spec.size)))
  }
  if (spec.bold) ensureChild(doc, rPr, 'w:b')
}

async function standardizeDocx(buf: Buffer, spec: FormatSpec, templateStyles?: string): Promise<FormatResult> {
  const applied: string[] = []
  const skipped: string[] = []
  const zip = await JSZip.loadAsync(buf)

  // 模板套用：直接用模板的 styles.xml 覆盖（最一致）
  if (templateStyles) {
    zip.file('word/styles.xml', templateStyles)
    applied.push('已套用模板样式(styles.xml)')
  } else {
    const stylesXml = await zip.file('word/styles.xml')?.async('string')
    if (!stylesXml) {
      skipped.push('未找到 word/styles.xml，跳过字体/标题设置')
    } else {
      const doc = new DOMParser().parseFromString(stylesXml, 'text/xml')
      const root = doc.documentElement // w:styles
      // docDefaults → 全局正文字体/字号/行距/首行缩进
      const docDefaults = ensureChild(doc, root, 'w:docDefaults', true)
      const rPrDefault = ensureChild(doc, docDefaults, 'w:rPrDefault')
      const rPr = ensureChild(doc, rPrDefault, 'w:rPr')
      applyRPr(doc, rPr, { cnFont: spec.cnFont, enFont: spec.enFont, size: spec.bodySize })
      if (spec.cnFont || spec.enFont) applied.push(`正文字体：中文 ${spec.cnFont || '不变'} / 西文 ${spec.enFont || '不变'}`)
      if (spec.bodySize) applied.push(`正文字号：${spec.bodySize}pt`)
      if (spec.lineSpacing || spec.firstLineIndent) {
        const pPrDefault = ensureChild(doc, docDefaults, 'w:pPrDefault')
        const pPr = ensureChild(doc, pPrDefault, 'w:pPr')
        if (spec.lineSpacing) {
          const sp = ensureChild(doc, pPr, 'w:spacing')
          setAttr(sp, 'w:line', String(mul2line(spec.lineSpacing)))
          setAttr(sp, 'w:lineRule', 'auto')
          applied.push(`行距：${spec.lineSpacing} 倍`)
        }
        if (spec.firstLineIndent) {
          const ind = ensureChild(doc, pPr, 'w:ind')
          setAttr(ind, 'w:firstLineChars', '200')
          setAttr(ind, 'w:firstLine', String(pt2hp((spec.bodySize || 14)) * 10)) // 兜底像素，主要靠 firstLineChars
          applied.push('正文首行缩进 2 字符')
        }
      }
      // 各级标题样式
      if (spec.headings?.length) {
        const styles = root.getElementsByTagName('w:style')
        for (const h of spec.headings) {
          let target: any = null
          for (let i = 0; i < styles.length; i++) {
            const st = styles[i]
            if (st.getAttribute('w:styleId') === `Heading${h.level}` || st.getAttribute('w:styleId') === `${h.level}`) {
              target = st
              break
            }
          }
          if (!target) {
            skipped.push(`未找到 ${h.level} 级标题样式(Heading${h.level})，跳过`)
            continue
          }
          const hr = ensureChild(doc, target, 'w:rPr')
          applyRPr(doc, hr, { cnFont: h.font || spec.cnFont, enFont: h.font || spec.enFont, size: h.size, bold: h.bold !== false })
          applied.push(`${h.level} 级标题：${h.font || ''}${h.size ? ` ${h.size}pt` : ''}${h.bold === false ? '' : ' 加粗'}`)
        }
      }
      zip.file('word/styles.xml', new XMLSerializer().serializeToString(doc))
    }
  }

  // 页边距（document.xml 的 sectPr/pgMar）
  if (spec.margins) {
    const docXml = await zip.file('word/document.xml')?.async('string')
    if (docXml) {
      const doc = new DOMParser().parseFromString(docXml, 'text/xml')
      const sectPrs = doc.getElementsByTagName('w:sectPr')
      if (sectPrs.length) {
        const m = spec.margins
        for (let i = 0; i < sectPrs.length; i++) {
          const pgMar = ensureChild(doc, sectPrs[i], 'w:pgMar')
          if (m.top != null) setAttr(pgMar, 'w:top', String(cm2tw(m.top)))
          if (m.bottom != null) setAttr(pgMar, 'w:bottom', String(cm2tw(m.bottom)))
          if (m.left != null) setAttr(pgMar, 'w:left', String(cm2tw(m.left)))
          if (m.right != null) setAttr(pgMar, 'w:right', String(cm2tw(m.right)))
        }
        zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
        applied.push(`页边距(cm)：上${m.top ?? '-'} 下${m.bottom ?? '-'} 左${m.left ?? '-'} 右${m.right ?? '-'}`)
      } else {
        skipped.push('文档无 sectPr，跳过页边距')
      }
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer' })
  return { base64: out.toString('base64'), ext: 'docx', applied, skipped }
}

async function standardizeXlsx(buf: Buffer, spec: FormatSpec): Promise<FormatResult> {
  const applied: string[] = []
  const skipped: string[] = []
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  const fontName = spec.cnFont || spec.enFont
  const thin = { style: 'thin' as const, color: { argb: 'FF888888' } }
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const font: Partial<ExcelJS.Font> = { ...(cell.font || {}) }
        if (fontName) font.name = fontName
        if (spec.bodySize) font.size = spec.bodySize
        if (rowNum === 1 && spec.headerBold) font.bold = true
        cell.font = font
        if (spec.borders) cell.border = { top: thin, left: thin, bottom: thin, right: thin }
      })
    })
    if (spec.colWidth) ws.columns.forEach((c) => { if (c) c.width = spec.colWidth })
  }
  if (fontName) applied.push(`字体：${fontName}`)
  if (spec.bodySize) applied.push(`字号：${spec.bodySize}pt`)
  if (spec.headerBold) applied.push('表头加粗')
  if (spec.borders) applied.push('全表格线')
  if (spec.colWidth) applied.push(`列宽：${spec.colWidth}`)
  const out = Buffer.from(await wb.xlsx.writeBuffer())
  return { base64: out.toString('base64'), ext: 'xlsx', applied, skipped }
}

/** 标准化入口。ext 来自源文件后缀；templateStyles 可选(模板 docx 的 styles.xml 字符串)。 */
export async function standardizeFormat(
  buf: Buffer,
  ext: string,
  spec: FormatSpec,
  templateStyles?: string
): Promise<FormatResult> {
  const e = ext.toLowerCase()
  if (e === 'docx') return standardizeDocx(buf, spec, templateStyles)
  if (e === 'xlsx') return standardizeXlsx(buf, spec)
  throw new Error(`暂不支持的格式：.${ext}（目前支持 Word .docx 与 Excel .xlsx）`)
}

/** 从一个模板 docx 取出 word/styles.xml（供「套用模板格式」用）。 */
export async function extractDocxStyles(buf: Buffer): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(buf)
  return zip.file('word/styles.xml')?.async('string')
}
