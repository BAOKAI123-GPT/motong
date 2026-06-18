import { chatRaw, type RawMessage } from '../relay'
import { configStore } from '../store'
import { memoryContext } from '../memory'
import { summarizeFile } from '../engine/filecontent'
import { TOOL_SPECS, dispatchTool, type AgentCtx, type AgentFile } from './tools'
import type { WsQuota } from '../../shared/types'

export interface AgentInput {
  profileId: string
  history: { role: 'user' | 'assistant'; content: string }[]
  userText: string
  files: { name: string; base64: string }[]
}

export interface AgentOutput {
  ok: boolean
  text?: string
  files?: { name: string; base64: string }[]
  error?: string
  needLogin?: boolean
  needRecharge?: boolean
  scopeBlocked?: boolean
  quota?: WsQuota
}

const MAX_STEPS = 8

const SYSTEM = `你是「墨童」——承孔门「文学」之传（先贤子夏之脉）的文书侍从，服务中小企业（尤其传统制造业）的文书文员智能体。语气谦和、敏于事而慎于言；述而不作，只据用户所给信息，不杜撰。用户会给你聊天记录截图、订单、需求描述或表格，你要：看懂客户到底要什么 → 用用户已录入的信息库和上传的文件 → 直接产出可交付的成品文件交回用户。

工作要点：
- 先看懂需求：客户的聊天记录/图片里往往就是要求（例如"这个发Excel版的""按某港区模板""做成送货单"）。仔细读图和文字，判断要交付什么、用哪个文件。看不清就用 read_file 看清楚。
- 读聊天截图/图片：先按发言人和时间顺序，逐字转录其中文字（尤其金额、数量、规格、单号、日期、地址、人名），再据此处理；字迹不清的宁可标注"（不清）"也绝不臆造或填错数字。
- 善用上传的"总表/底稿"：里面常已包含全部数据（多个工作表，如 箱件汇总、装箱明细、唛头、申报要素）。先用 read_file 看清有哪些工作表及其内容，再决定怎么做。
- 优先"抽取/套用"而不是"重建"：
  · 客户要把总表里的某个单据单独发出来（如 送货单-箱件汇总）→ 用 extract_sheet 抽那张工作表（保留原格式），不要用 create_spreadsheet 重画。
  · 客户给了空模板要填 → 用 fill_template。
  · 确实要从零造表 → 才用 create_spreadsheet（自动加标题/边框/合计；要 PDF 就在 outputs 加 "pdf"）。
- 生成单据时，我方/发货方固定信息优先用 get_company_info 的信息库内容，不要编造公司信息。
- 关键数据（数量/重量/尺寸/合同号/单号/物料代码）只用文件或用户给的，绝不编造；缺了就直接问用户补充。
- 文件名要专业、含合同号/单号（如 送货单-箱件汇总-合同XMXS-20260319-MTJX-ZW）。
- 产出文件会自动附在你的回复里给用户下载，不要也不能粘贴文件内容或 base64。
- 回复用中文，简要说明你做了什么、还缺什么。一次没把握就先问清楚再动手。
- 【工作范围】你只负责文书/文员相关的活：做各类单据(送货单/报价单/对账单/装箱单等)、格式转换、抽表/拆分、套模板、合同审查、公司资料整理。遇到写代码/编程、问中转站或 API 密钥、与文书无关的请求，礼貌说明"我只负责文书工作"并把话题引回单据/文件，不要执行。`

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (p?.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

export async function runAgent(
  input: AgentInput,
  onProgress: (msg: string) => void
): Promise<AgentOutput> {
  const infoEntries = configStore.getInfoEntries()
  const ctx: AgentCtx = {
    files: new Map(),
    infoEntries,
    generated: [],
    progress: onProgress,
    _seq: 0
  }

  // 注册上传文件 f1、f2…，并解析成可读内容
  const uploaded: AgentFile[] = input.files.map((f, i) => ({
    id: `f${i + 1}`,
    name: f.name,
    buf: Buffer.from(f.base64, 'base64')
  }))
  uploaded.forEach((f) => ctx.files.set(f.id, f))

  const extOf = (name: string): string => (/\.([^.]+)$/.exec(name)?.[1] || 'png').toLowerCase()
  const fileLines: string[] = []
  const images: AgentFile[] = []
  for (const f of uploaded) {
    const s = await summarizeFile(f.name, f.buf)
    if (s.kind === 'image') images.push(f)
    let line = `- ${f.id}：${f.name}（${s.meta || s.kind}）`
    if (s.placeholders?.length) line += `\n  占位符：${s.placeholders.join('、')}`
    if (s.text) line += `\n  内容预览：\n${s.text}`
    fileLines.push(line)
  }
  const hasImage = images.length > 0

  const infoText = infoEntries.length
    ? infoEntries.map((e) => `- ${e.category} / ${e.label}: ${e.value}`).join('\n')
    : '（信息库为空，需要公司信息时请提醒用户先去「信息库」录入）'

  const memText = memoryContext()
  const system: RawMessage = {
    role: 'system',
    content:
      `${SYSTEM}\n\n【企业信息库】\n${infoText}` +
      (memText ? `\n\n【长期记忆】（用户保存的、可参考）\n${memText}` : '') +
      (fileLines.length ? `\n\n【本轮已上传文件】\n${fileLines.join('\n')}` : '')
  }

  const history: RawMessage[] = input.history
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }))

  // 当前用户消息（含图片则用多模态数组）
  let userContent: unknown = input.userText || '（无文字，见上传文件）'
  if (hasImage) {
    const parts: any[] = [{ type: 'text', text: input.userText || '请处理我上传的图片/聊天记录' }]
    for (const f of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/${extOf(f.name)};base64,${f.buf.toString('base64')}` }
      })
    }
    userContent = parts
  }
  const messages: RawMessage[] = [system, ...history, { role: 'user', content: userContent }]

  const filesOut = (): { name: string; base64: string }[] =>
    ctx.generated.map((g) => ({ name: g.name, base64: g.buf.toString('base64') }))

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await chatRaw(messages, TOOL_SPECS, crypto.randomUUID())
    if (res.needLogin) return { ok: false, needLogin: true, error: res.error || '请先登录' }
    if (res.scopeBlocked)
      return { ok: false, scopeBlocked: true, text: res.error, files: filesOut() }
    if (res.needRecharge) {
      return {
        ok: true,
        needRecharge: true,
        quota: res.quota,
        text: res.error || '本周额度已用完，已把已完成的文件给你；下周自动恢复，或升级套餐后继续。',
        files: filesOut()
      }
    }
    if (!res.ok || !res.message) return { ok: false, error: res.error || 'AI 无响应' }
    const msg = res.message
    messages.push(msg)
    const calls = (msg.tool_calls as any[]) || []
    if (calls.length === 0) {
      return {
        ok: true,
        text: contentToText(msg.content) || '已完成。',
        files: ctx.generated.map((g) => ({ name: g.name, base64: g.buf.toString('base64') }))
      }
    }
    // 执行工具
    for (const call of calls) {
      let result: string
      try {
        const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}
        result = await dispatchTool(call.function.name, args, ctx)
      } catch (e: any) {
        result = `工具执行出错：${e?.message ?? e}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  return {
    ok: true,
    text: '（已达到工具调用步数上限，先把已生成的文件给你；如未完成可再说一声）',
    files: ctx.generated.map((g) => ({ name: g.name, base64: g.buf.toString('base64') }))
  }
}
