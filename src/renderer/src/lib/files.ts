import type { DroppedFile } from '@shared/types'

/** 把浏览器 File 读成 { name, base64 } 传给主进程 */
export function readDropped(file: File): Promise<DroppedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result as string // data:...;base64,XXXX
      const comma = res.indexOf(',')
      resolve({ name: file.name, base64: comma >= 0 ? res.slice(comma + 1) : '' })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function extOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

const SHEET_EXTS = new Set(['xlsx', 'xls', 'csv', 'ods', 'et', 'tsv'])
export function isSpreadsheet(name: string): boolean {
  return SHEET_EXTS.has(extOf(name))
}

export const TARGET_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word (docx)',
  xlsx: 'Excel (xlsx)',
  csv: 'CSV',
  txt: '纯文本 (txt)',
  html: '网页 (html)',
  json: 'JSON',
  odt: 'OpenDocument (odt)',
  pptx: 'PPT (pptx)'
}
