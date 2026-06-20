// 跨轮文件保持 + 生成文件可消费 的防复发测试（#9 / M1 / M2 客户端部分）。
// 不接真模型：直接验证「会话文件缓存」数据结构，以及 loop 里把缓存文件注册进 ctx.files 的关键流程，
// 并验证 agent 产出的文件落到 AgentOutput.files 后形态正确、可被 file:save 消费。
import * as XLSX from 'xlsx'
import {
  getConvFiles,
  addUploads,
  addGenerated,
  dropConv
} from '../src/main/agent/filecache'
import { dispatchTool, type AgentCtx, type AgentFile } from '../src/main/agent/tools'

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

function b64(buf: Buffer): string {
  return buf.toString('base64')
}

function freshCtx(): AgentCtx {
  return {
    files: new Map<string, AgentFile>(),
    infoEntries: [],
    generated: [],
    progress: () => {},
    _seq: 0
  }
}

// 复刻 loop.ts 里把「会话缓存文件 + 本轮上传」注册进 ctx.files 的核心流程（不接模型）。
function registerConvFilesIntoCtx(
  ctx: AgentCtx,
  convId: string,
  freshFiles: { name: string; base64: string }[]
): void {
  const fresh = addUploads(convId, freshFiles)
  const cached = getConvFiles(convId)
  const all = cached.length ? cached : fresh
  for (const f of all) ctx.files.set(f.id, { id: f.id, name: f.name, buf: Buffer.from(f.base64, 'base64') })
}

async function main(): Promise<void> {
  const CONV = 'conv-test-1'
  dropConv(CONV) // 干净起点

  // ───────────────────────────────────────────────────────────
  // [1] 会话文件缓存：上传 → 稳定 id、跨「轮」可见、同名覆盖
  // ───────────────────────────────────────────────────────────
  console.log('[1] filecache 上传缓存')
  const xlsx = sampleXlsx()
  const a1 = addUploads(CONV, [{ name: '总表.xlsx', base64: b64(xlsx) }])
  check('首轮上传分配稳定 id u1', a1.length === 1 && a1[0].id === 'u1', a1[0]?.id)
  check('缓存里能取到该文件', getConvFiles(CONV).some((f) => f.name === '总表.xlsx'))

  // 第二轮不带任何新文件 → 缓存里仍有上一轮文件（M1 核心）
  const a2 = addUploads(CONV, [])
  check('第二轮无新文件时上传结果为空', a2.length === 0)
  check('第二轮缓存仍含上一轮文件', getConvFiles(CONV).some((f) => f.name === '总表.xlsx'))

  // 同名再次上传 → 复用同一 id、刷新内容
  const a3 = addUploads(CONV, [{ name: '总表.xlsx', base64: b64(Buffer.from('NEW')) }])
  check('同名重传复用 id u1', a3[0]?.id === 'u1', a3[0]?.id)
  check(
    '同名重传刷新内容',
    getConvFiles(CONV).find((f) => f.name === '总表.xlsx')?.base64 === b64(Buffer.from('NEW'))
  )

  // ───────────────────────────────────────────────────────────
  // [2] 跨轮注册：第二轮不带新文件，ctx.files 仍能拿到上一轮文件（注册逻辑集成测）
  // ───────────────────────────────────────────────────────────
  console.log('\n[2] 跨轮把缓存文件注册进 ctx.files')
  const CONV2 = 'conv-test-2'
  dropConv(CONV2)

  // 第一轮：带文件
  const ctxR1 = freshCtx()
  registerConvFilesIntoCtx(ctxR1, CONV2, [{ name: '象盛总表.xlsx', base64: b64(xlsx) }])
  check('第一轮 ctx.files 含上传文件', ctxR1.files.has('u1') && ctxR1.files.get('u1')?.name === '象盛总表.xlsx')

  // 第二轮：不带文件（模拟用户「把刚才那个文件改成…」）
  const ctxR2 = freshCtx()
  registerConvFilesIntoCtx(ctxR2, CONV2, [])
  check('第二轮无新文件时 ctx.files 仍含上一轮文件', ctxR2.files.has('u1'), '← M1 关键')
  // 且该文件内容可被工具读取
  const rRead = await dispatchTool('read_file', { file_id: 'u1' }, ctxR2)
  check('第二轮可用 read_file 读到上一轮文件内容', rRead.includes('不锈钢法兰'), '← 模型可继续处理')

  // ───────────────────────────────────────────────────────────
  // [3] 生成文件回写缓存 → 下一轮可继续引用（如「再改一下刚才那个表」）
  // ───────────────────────────────────────────────────────────
  console.log('\n[3] 生成文件回写缓存，跨轮可引用')
  const CONV3 = 'conv-test-3'
  dropConv(CONV3)
  const ctxGen = freshCtx()
  registerConvFilesIntoCtx(ctxGen, CONV3, [{ name: '底稿.xlsx', base64: b64(xlsx) }])
  // 本轮生成一个表格
  await dispatchTool(
    'create_spreadsheet',
    { filename: '送货单', title: '送货单', columns: [{ header: '品名' }], rows: [['法兰']] },
    ctxGen
  )
  check('本轮生成了文件', ctxGen.generated.length >= 1, ctxGen.generated.map((g) => g.id).join(','))
  // 回写缓存（loop.ts filesOut 会做的事）
  addGenerated(
    CONV3,
    ctxGen.generated.map((g) => ({ id: g.id, name: g.name, base64: b64(g.buf) }))
  )
  check('生成文件已进会话缓存', getConvFiles(CONV3).some((f) => f.origin === 'generated'))

  // 下一轮：不带新文件，生成的文件仍可在 ctx 里按 id 引用
  const ctxNext = freshCtx()
  registerConvFilesIntoCtx(ctxNext, CONV3, [])
  const genId = ctxGen.generated[0].id
  check('下一轮 ctx.files 仍含上一轮生成的文件', ctxNext.files.has(genId), genId)

  // ───────────────────────────────────────────────────────────
  // [4] agent 产文件 → AgentOutput.files 形态正确、可被 file:save 消费（M2）
  // ───────────────────────────────────────────────────────────
  console.log('\n[4] 生成文件可被 file:save 消费')
  const ctxOut = freshCtx()
  await dispatchTool(
    'create_spreadsheet',
    { filename: '报价单', title: '报价单', columns: [{ header: '品名' }], rows: [['弯头']] },
    ctxOut
  )
  // loop.ts filesOut() 的等价转换
  const filesOut = ctxOut.generated.map((g) => ({ name: g.name, base64: b64(g.buf) }))
  check('AgentOutput.files 非空', filesOut.length >= 1, String(filesOut.length))
  check('每个文件有 name 和非空 base64', filesOut.every((f) => !!f.name && f.base64.length > 0))
  // file:save 的核心是 Buffer.from(base64,'base64') 写盘 —— 验证可还原成有效 xlsx
  const back = Buffer.from(filesOut[0].base64, 'base64')
  let validXlsx = false
  try {
    const wb = XLSX.read(back, { type: 'buffer' })
    validXlsx = wb.SheetNames.length > 0
  } catch {
    validXlsx = false
  }
  check('base64 可还原为有效 xlsx（可写盘下载）', validXlsx)

  // ───────────────────────────────────────────────────────────
  // [5] dropConv 释放缓存
  // ───────────────────────────────────────────────────────────
  console.log('\n[5] dropConv 释放会话缓存')
  dropConv(CONV)
  check('dropConv 后缓存清空', getConvFiles(CONV).length === 0)

  console.log(`\n========== 跨轮文件/产文件：${pass} 通过 / ${fail} 失败 ==========`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('崩溃：', e)
  process.exit(1)
})
