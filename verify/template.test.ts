// 模板引擎验证：构造含「拆段占位符」的 docx / xlsx，跑 提取 + 渲染 并断言。
import JSZip from 'jszip'
import { extractPlaceholders, renderTemplate } from '../src/main/engine/template'

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

const DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>公司名称：</w:t></w:r><w:r><w:t>{{公司名称}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t>项目</w:t></w:r><w:r><w:t>名称}}</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数量：{{数量}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>金额：{{金额}}元</w:t></w:r></w:p>
</w:body></w:document>`

const SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>公司：{{公司名称}}</t></si>
<si><r><t>{{</t></r><r><t>报价</t></r><r><t>金额}}</t></r></si>
<si><t>固定表头</t></si>
</sst>`

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', DOCX)
  return zip.generateAsync({ type: 'nodebuffer' })
}
async function makeXlsx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('xl/sharedStrings.xml', SHARED)
  zip.file('xl/worksheets/sheet1.xml', '<worksheet/>')
  return zip.generateAsync({ type: 'nodebuffer' })
}
async function docText(buf: Buffer, part: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  return zip.file(part)!.async('string')
}

async function main(): Promise<void> {
  // ---- DOCX ----
  console.log('[1] DOCX 占位符提取（含拆成多段的 {{项目名称}}）')
  const docx = await makeDocx()
  const ex = await extractPlaceholders('docx', docx)
  check('类型=docx', ex.type === 'docx')
  check(
    '提取到全部 4 个占位符',
    JSON.stringify(ex.placeholders) === JSON.stringify(['公司名称', '项目名称', '数量', '金额']),
    ex.placeholders.join(',')
  )

  console.log('\n[2] DOCX 渲染替换')
  const outDocx = await renderTemplate('docx', docx, {
    公司名称: '测试有限公司',
    项目名称: '供水管网改造',
    数量: '120',
    金额: '8800'
  })
  const docXml = await docText(outDocx, 'word/document.xml')
  check('保留标签外文字+填入值（拆段已合并）', docXml.includes('供水管网改造'))
  check('普通占位符已填', docXml.includes('测试有限公司') && docXml.includes('120') && docXml.includes('8800'))
  check('段落静态文字保留', docXml.includes('公司名称：') && docXml.includes('金额：') && docXml.includes('元'))
  check('不再残留占位符', !docXml.includes('{{'))
  check('仍是合法 zip(docx)', outDocx.slice(0, 2).toString() === 'PK')

  // ---- XLSX ----
  console.log('\n[3] XLSX 占位符提取（sharedStrings 含拆段 {{报价金额}}）')
  const xlsx = await makeXlsx()
  const exx = await extractPlaceholders('xlsx', xlsx)
  check('类型=xlsx', exx.type === 'xlsx')
  check(
    '提取到 2 个占位符',
    JSON.stringify(exx.placeholders) === JSON.stringify(['公司名称', '报价金额']),
    exx.placeholders.join(',')
  )

  console.log('\n[4] XLSX 渲染替换')
  const outXlsx = await renderTemplate('xlsx', xlsx, { 公司名称: '测试公司', 报价金额: '8800.00' })
  const ssXml = await docText(outXlsx, 'xl/sharedStrings.xml')
  check('填入值', ssXml.includes('测试公司') && ssXml.includes('8800.00'))
  check('静态文字保留', ssXml.includes('固定表头') && ssXml.includes('公司：'))
  check('不再残留占位符', !ssXml.includes('{{'))

  console.log('\n[5] 部分映射：未提供的占位符原样保留')
  const partial = await renderTemplate('docx', docx, { 公司名称: '只填这个' })
  const pXml = await docText(partial, 'word/document.xml')
  check('已填的替换', pXml.includes('只填这个'))
  // 单段占位符未提供值 → 原样保留（连续字符串可直接断言）
  check('未提供的 {{数量}}/{{金额}} 保留', pXml.includes('{{数量}}') && pXml.includes('{{金额}}'))

  console.log(`\n========== 模板引擎：${pass} 通过 / ${fail} 失败 ==========`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('崩溃：', e)
  process.exit(1)
})
