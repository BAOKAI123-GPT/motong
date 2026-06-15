import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

export type TemplateType = 'docx' | 'xlsx'

export interface ExtractResult {
  type: TemplateType
  placeholders: string[]
}

/** 占位符语法：{{字段名}}，允许内部空格 */
const PH = /\{\{\s*([^{}]+?)\s*\}\}/g

const silentParser = (): DOMParser =>
  new DOMParser({
    // 办公 XML 偶有非致命告警，静默处理，致命错误才抛
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e: unknown) => {
      throw e
    } }
  })

function partNames(zip: JSZip, re: RegExp): string[] {
  return Object.keys(zip.files).filter((n) => re.test(n))
}

const DOCX_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/
const XLSX_SHARED = 'xl/sharedStrings.xml'
const XLSX_SHEETS = /^xl\/worksheets\/sheet\d+\.xml$/

/** 收集某段 XML 中所有占位符（按容器合并文字，兼容被拆成多段的占位符） */
function collectFromXml(
  xml: string,
  containerTag: string,
  textTag: string,
  out: Set<string>,
  order: string[]
): void {
  const doc = silentParser().parseFromString(xml, 'text/xml')
  const containers = doc.getElementsByTagName(containerTag)
  for (let i = 0; i < containers.length; i++) {
    const tNodes = containers[i].getElementsByTagName(textTag)
    let joined = ''
    for (let j = 0; j < tNodes.length; j++) joined += tNodes[j].textContent || ''
    if (!joined.includes('{{')) continue
    let m: RegExpExecArray | null
    PH.lastIndex = 0
    while ((m = PH.exec(joined))) {
      const k = m[1].trim()
      if (k && !out.has(k)) {
        out.add(k)
        order.push(k)
      }
    }
  }
}

function setText(node: Element, text: string): void {
  while (node.firstChild) node.removeChild(node.firstChild)
  node.appendChild(node.ownerDocument!.createTextNode(text))
  // 保留首尾空格
  node.setAttribute('xml:space', 'preserve')
}

/** 在一段 XML 中按 mapping 替换占位符；保留 XML 声明 */
function replaceInXml(
  xml: string,
  containerTag: string,
  textTag: string,
  mapping: Record<string, string>
): string {
  const doc = silentParser().parseFromString(xml, 'text/xml')
  const containers = doc.getElementsByTagName(containerTag)
  let changed = false
  for (let i = 0; i < containers.length; i++) {
    const tNodes = containers[i].getElementsByTagName(textTag)
    if (tNodes.length === 0) continue
    let joined = ''
    for (let j = 0; j < tNodes.length; j++) joined += tNodes[j].textContent || ''
    if (!joined.includes('{{')) continue
    PH.lastIndex = 0
    const replaced = joined.replace(PH, (m, key) => {
      const k = String(key).trim()
      return Object.prototype.hasOwnProperty.call(mapping, k) ? String(mapping[k] ?? '') : m
    })
    if (replaced === joined) continue
    changed = true
    // 整段文字写入第一个文字节点，其余清空（保留第一段的格式）
    setText(tNodes[0], replaced)
    for (let j = 1; j < tNodes.length; j++) setText(tNodes[j], '')
  }
  if (!changed) return xml
  let out = new XMLSerializer().serializeToString(doc)
  const decl = xml.match(/^<\?xml[^>]*\?>/)
  if (decl && !out.startsWith('<?xml')) out = decl[0] + out
  return out
}

/** 提取模板里的全部占位符 */
export async function extractPlaceholders(ext: string, buf: Buffer): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(buf)
  const out = new Set<string>()
  const order: string[] = []
  if (ext === 'docx') {
    for (const n of partNames(zip, DOCX_PARTS)) {
      collectFromXml(await zip.file(n)!.async('string'), 'w:p', 'w:t', out, order)
    }
    return { type: 'docx', placeholders: order }
  }
  // xlsx
  const ss = zip.file(XLSX_SHARED)
  if (ss) collectFromXml(await ss.async('string'), 'si', 't', out, order)
  for (const n of partNames(zip, XLSX_SHEETS)) {
    collectFromXml(await zip.file(n)!.async('string'), 'is', 't', out, order)
  }
  return { type: 'xlsx', placeholders: order }
}

/** 按 mapping 渲染模板，返回成品文件 buffer（保留原格式） */
export async function renderTemplate(
  ext: string,
  buf: Buffer,
  mapping: Record<string, string>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf)
  if (ext === 'docx') {
    for (const n of partNames(zip, DOCX_PARTS)) {
      const xml = await zip.file(n)!.async('string')
      const next = replaceInXml(xml, 'w:p', 'w:t', mapping)
      if (next !== xml) zip.file(n, next)
    }
  } else {
    const ss = zip.file(XLSX_SHARED)
    if (ss) {
      const xml = await ss.async('string')
      const next = replaceInXml(xml, 'si', 't', mapping)
      if (next !== xml) zip.file(XLSX_SHARED, next)
    }
    for (const n of partNames(zip, XLSX_SHEETS)) {
      const xml = await zip.file(n)!.async('string')
      const next = replaceInXml(xml, 'is', 't', mapping)
      if (next !== xml) zip.file(n, next)
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}
