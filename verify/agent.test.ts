// Agent 工具层验证：不接真模型，直接造 ctx 调 dispatchTool，验证产出文件正确。
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { createSpreadsheet } from '../src/main/engine/spreadsheet'
import { summarizeFile } from '../src/main/engine/filecontent'
import { dispatchTool, type AgentCtx } from '../src/main/agent/tools'

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

function sampleXlsx(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['品名', '规格', '数量', '单价'],
    ['不锈钢法兰', 'DN50', 120, 35.5],
    ['碳钢弯头', 'DN80', 60, 22]
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '订单')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
}

async function templateDocx(): Promise<Buffer> {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>致：{{客户名称}}　发货方：{{公司名称}}</w:t></w:r></w:p></w:body></w:document>`
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

function freshCtx(): AgentCtx {
  return {
    files: new Map(),
    infoEntries: [
      { id: '1', category: '公司信息', label: '公司名称', value: '本溪精工机械有限公司' },
      { id: '2', category: '公司信息', label: '电话', value: '024-1234567' }
    ],
    generated: [],
    progress: () => {},
    _seq: 0
  }
}

async function main(): Promise<void> {
  // 1) 生成专业表格（送货单）
  console.log('[1] create_spreadsheet 生成送货单')
  const files = await createSpreadsheet({
    filename: '送货单-测试',
    title: '送货单',
    infoLeft: ['发货方：本溪精工机械', '单号：SH20260614'],
    infoRight: ['收货方：XX集团', '日期：2026-06-14'],
    columns: [{ header: '序号' }, { header: '品名' }, { header: '数量' }, { header: '金额' }],
    rows: [
      [1, '不锈钢法兰', 120, 4260],
      [2, '碳钢弯头', 60, 1320]
    ],
    totalsRow: ['', '合计', 180, 5580],
    note: '收货人签字：__________'
  })
  check('产出 1 个 xlsx', files.length === 1 && files[0].name.endsWith('.xlsx'))
  const ssWb = XLSX.read(Buffer.from(files[0].base64, 'base64'), { type: 'buffer' })
  const ssTxt = XLSX.utils.sheet_to_csv(ssWb.Sheets[ssWb.SheetNames[0]])
  check('含标题/表头/数据/合计', ['送货单', '品名', '不锈钢法兰', '合计', '5580'].every((s) => ssTxt.includes(s)), '')

  // 2) 文件解析
  console.log('\n[2] summarizeFile 解析上传文件')
  const sx = await summarizeFile('订单.xlsx', sampleXlsx())
  check('xlsx 识别为 spreadsheet', sx.kind === 'spreadsheet')
  check('内容含表头与数据', !!sx.text && sx.text.includes('品名') && sx.text.includes('不锈钢法兰'))
  const sd = await summarizeFile('模板.docx', await templateDocx())
  check('docx 模板识别占位符', !!sd.placeholders && sd.placeholders.includes('客户名称') && sd.placeholders.includes('公司名称'))

  // 3) 工具分发
  console.log('\n[3] dispatchTool 工具分发')
  const ctx = freshCtx()
  ctx.files.set('f1', { id: 'f1', name: '订单.xlsx', buf: sampleXlsx() })
  ctx.files.set('f2', { id: 'f2', name: '模板.docx', buf: await templateDocx() })

  const rRead = await dispatchTool('read_file', { file_id: 'f1' }, ctx)
  check('read_file 返回内容', rRead.includes('不锈钢法兰'))

  const rInfo = await dispatchTool('get_company_info', {}, ctx)
  check('get_company_info 返回信息库', rInfo.includes('本溪精工机械有限公司'))

  await dispatchTool(
    'create_spreadsheet',
    { filename: '报价单', title: '报价单', columns: [{ header: '品名' }], rows: [['法兰']] },
    ctx
  )
  check('create_spreadsheet 注册了生成文件', ctx.generated.some((g) => g.name.includes('报价单')))

  await dispatchTool('convert_format', { file_id: 'f1', target: 'csv' }, ctx)
  const csvGen = ctx.generated.find((g) => g.name.endsWith('.csv'))
  check('convert_format 产出 csv', !!csvGen && csvGen.buf.toString('utf8').includes('不锈钢法兰'))

  const rFill = await dispatchTool(
    'fill_template',
    { file_id: 'f2', mapping: { 客户名称: 'XX集团', 公司名称: '本溪精工机械' } },
    ctx
  )
  const filledGen = ctx.generated.find((g) => g.name.includes('已填写'))
  check('fill_template 产出已填文件', !!filledGen, rFill.slice(0, 40))
  if (filledGen) {
    const z = await JSZip.loadAsync(filledGen.buf)
    const docXml = await z.file('word/document.xml')!.async('string')
    check('模板已填入值', docXml.includes('XX集团') && docXml.includes('本溪精工机械') && !docXml.includes('{{'))
  }

  await dispatchTool('split_table', { file_id: 'f1', header_row: 1, rows_per_file: 1 }, ctx)
  const zipGen = ctx.generated.find((g) => g.name.includes('拆分'))
  check('split_table 产出 zip', !!zipGen && zipGen.name.endsWith('.zip'))
  if (zipGen) {
    const z = await JSZip.loadAsync(zipGen.buf)
    check('zip 内含 2 个拆分文件', Object.keys(z.files).length === 2, Object.keys(z.files).join(','))
  }

  console.log(`\n========== Agent 工具：${pass} 通过 / ${fail} 失败 ==========`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('崩溃：', e)
  process.exit(1)
})
