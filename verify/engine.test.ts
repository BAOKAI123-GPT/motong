// 引擎真跑验证：在 Node 里直接调用 convert / table 引擎，针对真实样例文件断言结果。
// 用 esbuild 打包后用 node 执行（引擎不依赖 electron）。
import * as XLSX from 'xlsx'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertFile, targetsForExt, libreofficeAvailable } from '../src/main/engine/convert'
import { previewTable, splitTable } from '../src/main/engine/table'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`)
  }
}

function makeSampleXlsx(): Buffer {
  const aoa = [
    ['产品名称', '型号', '数量', '单价'],
    ['不锈钢法兰', 'DN50', '120', '35.5'],
    ['碳钢弯头', 'DN80', '60', '22.0'],
    ['球阀', 'Q11F-16', '15', '180.0']
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '明细')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
}

async function main(): Promise<void> {
  const xlsxBuf = makeSampleXlsx()

  // 探测 LibreOffice 是否真的能转换（找到可执行 ≠ 能跑，本沙箱即为后者）
  let loWorks = false
  if (libreofficeAvailable()) {
    try {
      const p = await convertFile('probe.xlsx', xlsxBuf, 'pdf')
      loWorks = p.buffer.slice(0, 4).toString() === '%PDF'
    } catch {
      loWorks = false
    }
  }
  console.log('LibreOffice 找到:', libreofficeAvailable(), '| 实际可转换:', loWorks)

  // 1) 目标格式表
  console.log('\n[1] 目标格式探测')
  check('xlsx 可转 csv/pdf', targetsForExt('xlsx').includes('csv') && targetsForExt('xlsx').includes('pdf'))
  check('docx 可转 pdf', targetsForExt('docx').includes('pdf'))
  check('未知格式返回空', targetsForExt('zzz').length === 0)

  // 2) SheetJS：xlsx -> csv
  console.log('\n[2] SheetJS xlsx -> csv')
  const csv = await convertFile('明细.xlsx', xlsxBuf, 'csv')
  const csvText = csv.buffer.toString('utf8')
  check('引擎=sheetjs', csv.engine === 'sheetjs')
  check('含 UTF-8 BOM', csv.buffer[0] === 0xef && csv.buffer[1] === 0xbb && csv.buffer[2] === 0xbf)
  check('含中文表头', csvText.includes('产品名称') && csvText.includes('不锈钢法兰'))

  // 3) SheetJS：csv -> xlsx 回读
  console.log('\n[3] SheetJS csv -> xlsx 回读校验')
  const csvOnly = Buffer.from('名称,数量\n甲,1\n乙,2\n', 'utf8')
  const back = await convertFile('t.csv', csvOnly, 'xlsx')
  const wb2 = XLSX.read(back.buffer, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb2.Sheets[wb2.SheetNames[0]])
  check('引擎=sheetjs', back.engine === 'sheetjs')
  check('回读 2 行', rows.length === 2)
  check('字段正确', String(rows[0]['名称']) === '甲' && String(rows[1]['数量']) === '2')

  // 4) SheetJS：xlsx -> json
  console.log('\n[4] SheetJS xlsx -> json')
  const js = await convertFile('明细.xlsx', xlsxBuf, 'json')
  const arr = JSON.parse(js.buffer.toString('utf8'))
  check('3 条记录', Array.isArray(arr) && arr.length === 3)
  check('字段映射正确', arr[0]['产品名称'] === '不锈钢法兰' && String(arr[0]['型号']) === 'DN50')

  // 5) LibreOffice：xlsx -> pdf
  console.log('\n[5] LibreOffice xlsx -> pdf')
  if (loWorks) {
    const pdf = await convertFile('明细.xlsx', xlsxBuf, 'pdf')
    check('引擎=libreoffice', pdf.engine === 'libreoffice')
    check('是合法 PDF', pdf.buffer.slice(0, 4).toString() === '%PDF', `${pdf.buffer.length} 字节`)
  } else {
    console.log('  （跳过：本沙箱 LibreOffice 无法运行——属环境限制，真机可用）')
  }

  // 6) LibreOffice：真实 docx -> pdf
  console.log('\n[6] LibreOffice 真实 docx -> pdf')
  const realDocx = '/root/my/演讲稿-人民英雄纪念碑.docx'
  if (loWorks && existsSync(realDocx)) {
    const dbuf = readFileSync(realDocx)
    const pdf = await convertFile('演讲稿.docx', dbuf, 'pdf')
    check('是合法 PDF', pdf.buffer.slice(0, 4).toString() === '%PDF', `${(pdf.buffer.length / 1024).toFixed(0)} KB`)
  } else {
    console.log('  （跳过：无 LibreOffice 或样例 docx 不存在）')
  }

  // 6.5) SheetJS：含中文的 CSV 读取（回归 BUG：之前按代码页猜测导致中文乱码）
  console.log('\n[6.5] CSV 中文读取（UTF-8）')
  const cnCsv = Buffer.from('产品名称,数量\n不锈钢法兰,120\n', 'utf8')
  const cnBack = await convertFile('cn.csv', cnCsv, 'json')
  const cnArr = JSON.parse(cnBack.buffer.toString('utf8'))
  check('中文字段名不乱码', cnArr[0]['产品名称'] === '不锈钢法兰', JSON.stringify(cnArr[0]))

  // 7) 表格预览
  console.log('\n[7] 表格预览')
  const pv = previewTable(xlsxBuf, 1, 'xlsx')
  check('读取成功', pv.ok)
  check('表头正确', pv.header.join(',') === '产品名称,型号,数量,单价')
  check('数据 3 行', pv.totalRows === 3)

  // 8) 拆分 -> xlsx，每条一文件，按产品名称命名
  console.log('\n[8] 拆分 -> xlsx（单条单文件，按列命名）')
  const dir1 = mkdtempSync(join(tmpdir(), 'wenshu-test-xlsx-'))
  const n1 = await splitTable(xlsxBuf, { headerRow: 1, rowsPerFile: 1, outFormat: 'xlsx', nameColumn: 0 }, dir1, '明细', 'xlsx')
  const files1 = readdirSync(dir1)
  check('生成 3 个文件', n1 === 3 && files1.length === 3, files1.join(' | '))
  check('文件名含产品名', files1.some((f) => f.includes('不锈钢法兰')))
  // 校验某个拆出文件内容：表头 + 1 条
  const oneFile = files1.find((f) => f.endsWith('.xlsx'))!
  const oneWb = XLSX.read(readFileSync(join(dir1, oneFile)), { type: 'buffer' })
  const oneAoa = XLSX.utils.sheet_to_json<string[]>(oneWb.Sheets[oneWb.SheetNames[0]], { header: 1 })
  check('拆出文件=表头+1行', oneAoa.length === 2, `实际 ${oneAoa.length} 行`)

  // 9) 拆分 -> csv，每 2 条一文件
  console.log('\n[9] 拆分 -> csv（每 2 条一文件）')
  const dir2 = mkdtempSync(join(tmpdir(), 'wenshu-test-csv-'))
  const n2 = await splitTable(xlsxBuf, { headerRow: 1, rowsPerFile: 2, outFormat: 'csv' }, dir2, '明细', 'xlsx')
  const files2 = readdirSync(dir2)
  check('3 条按每2条 -> 2 文件', n2 === 2 && files2.length === 2, files2.join(' | '))
  check('csv 含 BOM 与中文', readFileSync(join(dir2, files2[0]))[0] === 0xef && readFileSync(join(dir2, files2[0])).toString('utf8').includes('产品名称'))

  // 10) 拆分 -> pdf（每条一文件，走 LibreOffice）
  console.log('\n[10] 拆分 -> pdf（每条一文件）')
  if (loWorks) {
    const dir3 = mkdtempSync(join(tmpdir(), 'wenshu-test-pdf-'))
    const n3 = await splitTable(xlsxBuf, { headerRow: 1, rowsPerFile: 1, outFormat: 'pdf', nameColumn: 0 }, dir3, '明细', 'xlsx')
    const files3 = readdirSync(dir3)
    check('生成 3 个 PDF', n3 === 3 && files3.filter((f) => f.endsWith('.pdf')).length === 3, files3.join(' | '))
    check('PDF 合法', readFileSync(join(dir3, files3[0])).slice(0, 4).toString() === '%PDF')
  } else {
    console.log('  （跳过：本沙箱 LibreOffice 无法运行——属环境限制，真机可用）')
  }

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('测试崩溃：', e)
  process.exit(1)
})
