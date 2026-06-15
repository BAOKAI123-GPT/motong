// 真密钥端到端实测：用真实总表 + 客户需求截图跑完整智能体循环，看模型能否看懂并交付。
// 用法: MODEL=claude-sonnet-4-6 node verify/live-agent.test.cjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { TOOL_SPECS, dispatchTool, type AgentCtx, type AgentFile } from '../src/main/agent/tools'
import { summarizeFile } from '../src/main/engine/filecontent'

const BASE = 'https://api.qingyuntop.top'
const KEY = process.env.QKEY || ''
const MODEL = process.env.MODEL || 'claude-sonnet-4-6'

const SYSTEM = `你是「翰文」，服务中小企业（尤其传统制造业）的文书文员智能体。用户会给你聊天记录截图、订单、需求描述或表格，你要：看懂客户到底要什么 → 用用户已录入的信息库和上传的文件 → 直接产出可交付的成品文件交回用户。

工作要点：
- 先看懂需求：客户的聊天记录/图片里往往就是要求（例如"这个发Excel版的""按某港区模板""做成送货单"）。仔细读图和文字，判断要交付什么、用哪个文件。
- 善用上传的"总表/底稿"：里面常已包含全部数据（多个工作表，如 箱件汇总、装箱明细、唛头、申报要素）。用 read_file 看清有哪些工作表及其内容。
- 优先"抽取/套用"而不是"重建"：
  · 客户要把总表里的某个单据单独发出来 → 用 extract_sheet 抽那张工作表（保留原格式），不要用 create_spreadsheet 重画。
  · 客户给了空模板要填 → 用 fill_template。
  · 确实要从零造表 → 才用 create_spreadsheet。
- 关键数据（数量/重量/尺寸/合同号/单号）只用文件或用户给的，绝不编造；缺了就问。
- 文件名要专业、含合同号/单号（如 送货单-箱件汇总-合同XMXS-20260319-MTJX-ZW）。
- 产出文件会自动附在回复里给用户下载，不要粘贴文件内容或 base64。回复用中文，简要说明做了什么。没把握先问。`

async function callModel(messages: any[]): Promise<any> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOL_SPECS, tool_choice: 'auto', max_tokens: 4096 })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j: any = await res.json()
  return j?.choices?.[0]?.message
}

async function main(): Promise<void> {
  if (!KEY) throw new Error('需要 QKEY 环境变量')
  console.log(`\n======== 模型: ${MODEL} ========`)

  const masterBuf = readFileSync('/root/my/象盛镍业-台州铭通机械.xlsx')
  const imgBuf = readFileSync('/root/my/16443928d4364fe6002dc376456127bd.jpg')

  const ctx: AgentCtx = {
    files: new Map<string, AgentFile>(),
    infoEntries: [],
    generated: [],
    progress: (m) => console.log('  · ' + m),
    _seq: 0
  }
  ctx.files.set('f1', { id: 'f1', name: '象盛镍业-台州铭通机械.xlsx', buf: masterBuf })
  ctx.files.set('f2', { id: 'f2', name: '客户需求.jpg', buf: imgBuf })

  const s1 = await summarizeFile('象盛镍业-台州铭通机械.xlsx', masterBuf)
  const fileList = `- f1：象盛镍业-台州铭通机械.xlsx（${s1.meta}）\n  内容预览：\n${s1.text}\n- f2：客户需求.jpg（聊天记录截图）`

  const messages: any[] = [
    { role: 'system', content: `${SYSTEM}\n\n【本轮已上传文件】\n${fileList}` },
    {
      role: 'user',
      content: [
        { type: 'text', text: '客户的要求在这张聊天记录截图里，总表(f1)也一起发你了。请按客户要求把成品文件做好发我。' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imgBuf.toString('base64')}` } }
      ]
    }
  ]

  for (let step = 0; step < 8; step++) {
    const msg = await callModel(messages)
    messages.push(msg)
    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      console.log('\n【AI 最终回复】\n' + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)))
      break
    }
    for (const c of calls) {
      const args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}
      console.log(`\n[工具调用] ${c.function.name}(${JSON.stringify(args).slice(0, 160)})`)
      let result: string
      try {
        result = await dispatchTool(c.function.name, args, ctx)
      } catch (e: any) {
        result = `工具执行出错：${e?.message ?? e}`
      }
      console.log('  → ' + result.slice(0, 200))
      messages.push({ role: 'tool', tool_call_id: c.id, content: result })
    }
  }

  // 保存产出文件以便检查
  mkdirSync('/tmp/live-out', { recursive: true })
  console.log(`\n【产出文件 ${ctx.generated.length} 个】`)
  for (const g of ctx.generated) {
    const p = `/tmp/live-out/${g.name}`
    writeFileSync(p, g.buf)
    console.log(`  ✓ ${g.name} (${g.buf.length} 字节) → ${p}`)
  }
}

main().catch((e) => {
  console.error('崩溃：', e.message)
  process.exit(1)
})
