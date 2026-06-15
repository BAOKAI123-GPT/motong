import * as XLSX from 'xlsx'

const TEXT_EXTS = new Set(['csv', 'tsv', 'txt'])

function stripBom(buf: Buffer): Buffer {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3)
  }
  return buf
}

/**
 * 读取工作簿。CSV/TSV/TXT 按 UTF-8 字符串读，避免 SheetJS 走代码页猜测
 * 把中文读成乱码；二进制表格（xlsx/xls/ods）按 buffer 读。
 */
export function readWorkbook(buf: Buffer, ext: string): XLSX.WorkBook {
  if (TEXT_EXTS.has(ext.toLowerCase())) {
    return XLSX.read(stripBom(buf).toString('utf8'), { type: 'string' })
  }
  return XLSX.read(buf, { type: 'buffer' })
}
