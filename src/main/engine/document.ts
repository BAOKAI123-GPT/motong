import { BrowserWindow } from 'electron'
import JSZip from 'jszip'

// 「文本 → 正式文档」引擎：把结构化内容(标题/小标题/段落/要点/表格/引用)生成可下载的
// PDF（Chromium printToPDF 渲染，中文走系统字体、无需 LibreOffice、无需嵌字体）与 Word(.docx，直接拼 OOXML，纯离线)。
// 用于产品介绍/公司资料/通知公告/工作总结/方案说明等"以文字段落为主"的文档（表格单据仍用 create_spreadsheet）。

export type DocBlock =
  | { type: 'heading'; level?: number; text?: string }
  | { type: 'paragraph'; text?: string }
  | { type: 'bullets'; items?: string[] }
  | { type: 'ordered'; items?: string[] }
  | { type: 'table'; headers?: string[]; rows?: string[][] }
  | { type: 'quote'; text?: string }

export interface DocSpec {
  title?: string
  blocks?: DocBlock[]
}

const FONT = 'Microsoft YaHei'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// 1) HTML（供 printToPDF 渲染；中文用系统 CJK 字体，Chromium 原生支持）
// ---------------------------------------------------------------------------
export function buildDocHtml(doc: DocSpec): string {
  const parts: string[] = []
  if (doc.title) parts.push(`<h1 class="doc-title">${esc(doc.title)}</h1>`)
  for (const b of doc.blocks || []) {
    if (!b || typeof b !== 'object') continue
    switch (b.type) {
      case 'heading': {
        const lv = Math.min(3, Math.max(1, b.level || 2)) + 1 // → h2/h3/h4
        parts.push(`<h${lv}>${esc(b.text)}</h${lv}>`)
        break
      }
      case 'paragraph':
        parts.push(`<p>${esc(b.text).replace(/\n/g, '<br/>')}</p>`)
        break
      case 'bullets':
        parts.push(`<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)
        break
      case 'ordered':
        parts.push(`<ol>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`)
        break
      case 'quote':
        parts.push(`<blockquote>${esc(b.text).replace(/\n/g, '<br/>')}</blockquote>`)
        break
      case 'table': {
        const head = b.headers?.length
          ? `<thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
          : ''
        const body = `<tbody>${(b.rows || [])
          .map((r) => `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody>`
        parts.push(`<table>${head}${body}</table>`)
        break
      }
    }
  }
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Hiragino Sans GB",sans-serif; color:#1a1a1a; font-size:11pt; line-height:1.75; }
    .doc-title { font-size:20pt; text-align:center; margin:0 0 18pt; font-weight:700; }
    h2 { font-size:14pt; margin:16pt 0 6pt; font-weight:700; border-left:4px solid #2b2b2b; padding-left:9px; }
    h3 { font-size:12.5pt; margin:12pt 0 5pt; font-weight:700; }
    h4 { font-size:11.5pt; margin:10pt 0 4pt; font-weight:700; }
    p { margin:0 0 8pt; text-align:justify; }
    ul,ol { margin:0 0 8pt; padding-left:22pt; }
    li { margin:3pt 0; }
    blockquote { margin:0 0 8pt; padding:7pt 12pt; background:#f4f4f6; border-left:3px solid #999; color:#444; }
    table { width:100%; border-collapse:collapse; margin:0 0 10pt; }
    th,td { border:1px solid #9a9a9a; padding:5pt 8pt; font-size:10.5pt; text-align:left; vertical-align:top; }
    th { background:#eef0f4; font-weight:700; }
  </style></head><body>${parts.join('\n')}</body></html>`
}

/** 用隐藏的 Chromium 窗口把 HTML 渲染成 PDF（中文/排版原生支持，无需 LibreOffice）。 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1300,
    webPreferences: { sandbox: true, javascript: false }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    })
    return Buffer.from(data)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

// ---------------------------------------------------------------------------
// 2) DOCX（直接拼最小合法 OOXML：[Content_Types].xml + _rels/.rels + word/document.xml）
// ---------------------------------------------------------------------------
function run(text: string, opts: { b?: boolean; sz?: number; color?: string } = {}): string {
  const rpr =
    `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>` +
    `${opts.b ? '<w:b/>' : ''}` +
    `${opts.sz ? `<w:sz w:val="${opts.sz}"/><w:szCs w:val="${opts.sz}"/>` : ''}` +
    `${opts.color ? `<w:color w:val="${opts.color}"/>` : ''}</w:rPr>`
  // 段内换行 \n → <w:br/>
  const tnodes = String(text)
    .split('\n')
    .map((s, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(s)}</w:t>`)
    .join('')
  return `<w:r>${rpr}${tnodes}</w:r>`
}

function para(
  runsXml: string,
  opts: { align?: string; after?: number; ind?: number } = {}
): string {
  return (
    `<w:p><w:pPr>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ''}` +
    `<w:spacing w:after="${opts.after ?? 120}" w:line="288" w:lineRule="auto"/>` +
    `${opts.ind ? `<w:ind w:left="${opts.ind}"/>` : ''}</w:pPr>${runsXml}</w:p>`
  )
}

function docxTable(b: { headers?: string[]; rows?: string[][] }): string {
  const border =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="9A9A9A"/>`)
      .join('') +
    '</w:tblBorders>'
  const cell = (text: string, o: { b?: boolean; shade?: boolean } = {}): string =>
    `<w:tc><w:tcPr>${o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF0F4"/>' : ''}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${run(text, { b: o.b, sz: 20 })}</w:p></w:tc>`
  const rows: string[] = []
  if (b.headers?.length)
    rows.push(`<w:tr>${b.headers.map((h) => cell(h, { b: true, shade: true })).join('')}</w:tr>`)
  for (const r of b.rows || []) rows.push(`<w:tr>${(r || []).map((c) => cell(c)).join('')}</w:tr>`)
  // 表格后补一个空段落（OOXML 要求表格与表格/正文之间有段落分隔）
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/>${border}</w:tblPr>${rows.join('')}</w:tbl>` +
    '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>'
  )
}

export async function buildDocx(doc: DocSpec): Promise<Buffer> {
  const body: string[] = []
  if (doc.title) body.push(para(run(doc.title, { b: true, sz: 40 }), { align: 'center', after: 220 }))
  for (const b of doc.blocks || []) {
    if (!b || typeof b !== 'object') continue
    switch (b.type) {
      case 'heading': {
        const lv = Math.min(3, Math.max(1, b.level || 2))
        const sz = lv === 1 ? 32 : lv === 2 ? 28 : 24
        body.push(para(run(b.text || '', { b: true, sz }), { after: 120 }))
        break
      }
      case 'paragraph':
        body.push(para(run(b.text || '', { sz: 22 }), { after: 140 }))
        break
      case 'bullets':
        for (const it of b.items || []) body.push(para(run('• ' + it, { sz: 22 }), { after: 60, ind: 420 }))
        break
      case 'ordered':
        ;(b.items || []).forEach((it, i) =>
          body.push(para(run(`${i + 1}. ${it}`, { sz: 22 }), { after: 60, ind: 420 }))
        )
        break
      case 'quote':
        body.push(para(run(b.text || '', { sz: 22, color: '555555' }), { after: 140, ind: 420 }))
        break
      case 'table':
        body.push(docxTable(b))
        break
    }
  }
  body.push(
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1134" w:bottom="1440" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
  )

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body.join('')}</w:body></w:document>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', rels)
  zip.file('word/document.xml', documentXml)
  return zip.generateAsync({ type: 'nodebuffer' })
}
