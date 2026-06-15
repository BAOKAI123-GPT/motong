// PDF 引擎验证：用 pdf-lib 造多页 PDF，跑合并/拆分/提取/范围解析并断言页数。
import { PDFDocument } from 'pdf-lib'
import {
  mergePdfs,
  pdfPageCount,
  splitEachPage,
  parsePageRanges,
  extractPages
} from '../src/main/engine/pdf'

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

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([300, 400])
    p.drawText(`Page ${i + 1}`, { x: 40, y: 350, size: 24 })
  }
  return Buffer.from(await doc.save())
}

async function main(): Promise<void> {
  const a = await makePdf(3)
  const b = await makePdf(2)

  console.log('[1] 页数读取')
  check('A=3 页', (await pdfPageCount(a)) === 3)
  check('B=2 页', (await pdfPageCount(b)) === 2)

  console.log('\n[2] 合并')
  const merged = await mergePdfs([a, b])
  check('合并后 5 页', (await pdfPageCount(merged)) === 5, `${merged.slice(0, 4).toString()}`)
  check('合并产物是 PDF', merged.slice(0, 4).toString() === '%PDF')

  console.log('\n[3] 按页拆分')
  const parts = await splitEachPage(a)
  check('拆出 3 份', parts.length === 3)
  check('每份 1 页', (await Promise.all(parts.map((p) => pdfPageCount(p.buffer)))).every((n) => n === 1))
  check('页码标注正确', parts[0].page === 1 && parts[2].page === 3)

  console.log('\n[4] 页码范围解析')
  check('1-2,3 -> [0,1,2]', JSON.stringify(parsePageRanges('1-2,3', 5)) === '[0,1,2]')
  check('去重保序 3,1,3,2 -> [2,0,1]', JSON.stringify(parsePageRanges('3,1,3,2', 5)) === '[2,0,1]')
  check('中文逗号兼容 4，5 -> [3,4]', JSON.stringify(parsePageRanges('4，5', 5)) === '[3,4]')
  let threw = false
  try {
    parsePageRanges('99', 5)
  } catch {
    threw = true
  }
  check('越界页码抛错', threw)

  console.log('\n[5] 提取页')
  const ex = await extractPages(merged, parsePageRanges('1,5', 5))
  check('提取 2 页', (await pdfPageCount(ex)) === 2)

  console.log(`\n========== PDF 引擎：${pass} 通过 / ${fail} 失败 ==========`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('崩溃：', e)
  process.exit(1)
})
