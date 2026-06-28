import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  BrainCircuit,
  Copy,
  FileDown,
  Loader2,
  Paperclip,
  Quote,
  Send,
  Sparkles,
  Plus,
  History,
  Trash2,
  User,
  X
} from 'lucide-react'
import type { DroppedFile, GeneratedFilePayload, WsQuota } from '@shared/types'
import type { ViewId } from '../App'
import { readDropped } from '../lib/files'
import { toast } from '../store/ui'
import { convId as newConvId, convSave, convList, convLoad, convDel, type ConvMeta } from '../lib/conversations'
import motongFace from '../assets/motong-avatar.png'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: string[]
  attachFiles?: DroppedFile[]
  files?: GeneratedFilePayload[]
}

// ChatMessage[] ↔ 云端归一化消息（与网页版同形：{role, text, files:[{fileId?,name}], uploads:[{name}]}），实现桌面↔网页对话互通。
function toCloud(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => ({
    role: m.role,
    text: m.content,
    files: m.files?.map((f) => ({ fileId: f.fileId, name: f.name })),
    uploads: m.attachments?.map((n) => ({ name: n }))
  }))
}
function fromCloud(arr: unknown[]): ChatMessage[] {
  return (Array.isArray(arr) ? arr : []).map((raw) => {
    const m = raw as { role?: string; text?: string; error?: string; uploads?: { name?: string }[]; files?: { fileId?: string; name?: string }[] }
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.text === 'string' ? m.text : m.error || '',
      attachments: Array.isArray(m.uploads) ? m.uploads.map((u) => u?.name || '').filter(Boolean) : undefined,
      files: Array.isArray(m.files) ? m.files.map((f) => ({ name: f?.name || '文件', base64: '', fileId: f?.fileId })) : undefined
    }
  })
}
async function mergedConvList(): Promise<ConvMeta[]> {
  const local = await convList()
  try {
    const cloud = await window.api.wsConv.list()
    if (cloud.ok) {
      const map = new Map<string, ConvMeta>()
      for (const c of local) map.set(c.id, c)
      for (const c of cloud.conversations) {
        const ex = map.get(c.id)
        if (!ex || c.updatedAt > ex.updatedAt) map.set(c.id, c)
      }
      return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    }
  } catch {
    /* 云端不可用 → 仅本地 */
  }
  return local
}

const EXAMPLES = [
  '把这段聊天记录里的订单做成送货单（Excel）',
  '把总表里的“箱件汇总”单独抽成 Excel 发我',
  '按我上传的大厂模板，把数据填进去',
  '把这张表转成 PDF'
]

export default function ChatView({
  onOpen,
  onAuthExpired
}: {
  onOpen: (v: ViewId) => void
  onAuthExpired: () => void
}): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<DroppedFile[]>([])
  const [quoted, setQuoted] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deliver, setDeliver] = useState('')
  const [deliverCustom, setDeliverCustom] = useState('')
  const [progress, setProgress] = useState('')
  const [quota, setQuota] = useState<WsQuota | null>(null)
  const [over, setOver] = useState(false)
  const [cid, setCid] = useState<string>(() => newConvId())
  const [convs, setConvs] = useState<ConvMeta[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [userAvatar, setUserAvatar] = useState<string>('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  async function loadQuota(): Promise<void> {
    const r = await window.api.ws.me()
    if (r.ok) setQuota(r.data)
  }
  // 用户自定义头像（在「我的账户」上传，存本地）
  useEffect(() => {
    const read = (): void => setUserAvatar(localStorage.getItem('motong_avatar') || '')
    read()
    window.addEventListener('motong-avatar', read)
    return () => window.removeEventListener('motong-avatar', read)
  }, [])
  useEffect(() => {
    void loadQuota()
    const off = window.api.agent.onProgress((m) => setProgress(m))
    return off
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, progress, busy])

  // 启动：加载历史列表，并恢复最近一条对话
  useEffect(() => {
    void (async () => {
      const list = await mergedConvList()
      setConvs(list)
      if (list[0]) await openConversation(list[0].id)
    })()
  }, [])

  // 自动保存当前对话（标题取首条用户消息）。
  // 关键：剔除大 base64 —— 上传文件(attachFiles)整体不存；生成文件(files)只留 name、清掉 base64。
  // 否则把数 MB 的 base64 写进 IndexedDB 容易写失败/库损坏，恢复后只剩文字标题、文件全丢。
  // 本轮刚生成、未保存的文件仍在内存 messages 里可正常下载；历史恢复的文件靠跨轮缓存重新生成。
  useEffect(() => {
    if (messages.length === 0) return
    const firstUser = messages.find((m) => m.role === 'user')
    const title = (firstUser?.content || '新对话').replace(/\n/g, ' ').slice(0, 30) || '新对话'
    const slim = messages.map((m) => ({
      ...m,
      attachFiles: undefined,
      files: m.files?.map((f) => ({ name: f.name, base64: '', fileId: f.fileId }))
    }))
    void convSave({ id: cid, title, updatedAt: Date.now(), messages: slim }).then(refreshList)
    // 完成一轮(非处理中)才推云端，避免频繁写：与网页版同账号互通
    if (!busy) void window.api.wsConv.save({ id: cid, title, messages: toCloud(messages) })
  }, [messages])

  async function refreshList(): Promise<void> {
    setConvs(await mergedConvList())
  }
  function newConversation(): void {
    setMessages([])
    setCid(newConvId())
    setHistoryOpen(false)
  }
  async function openConversation(id: string): Promise<void> {
    const full = await convLoad(id)
    if (full) {
      setMessages((full.messages as ChatMessage[]) || [])
      setCid(id)
    } else {
      // 本地没有(网页版创建的会话) → 从云端取
      try {
        const cloud = await window.api.wsConv.get(id)
        if (cloud && Array.isArray(cloud.messages)) {
          setMessages(fromCloud(cloud.messages))
          setCid(id)
        }
      } catch {
        /* ignore */
      }
    }
    setHistoryOpen(false)
  }
  async function deleteConversation(id: string): Promise<void> {
    await convDel(id)
    void window.api.wsConv.del(id) // 同步删云端
    void window.api.agent.dropConv(id) // 释放主进程里该会话的文件缓存
    await refreshList()
    if (id === cid) newConversation()
  }

  async function addFiles(list: FileList | null): Promise<void> {
    if (!list) return
    const all = await Promise.all(Array.from(list).map(readDropped))
    setAttachments((p) => [...p, ...all])
  }

  async function send(): Promise<void> {
    let text = input.trim()
    if (quoted) text = `> 引用：${quoted.replace(/\n/g, ' ').slice(0, 200)}\n\n${text}`
    if (!text && attachments.length === 0) return
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      attachments: attachments.map((a) => a.name),
      attachFiles: attachments
    }
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    const files = attachments
    setMessages((m) => [...m, userMsg])
    setInput('')
    setAttachments([])
    setQuoted(null)
    setBusy(true)
    setProgress('正在思考…')
    try {
      const deliveryFormat = deliver === '__custom' ? deliverCustom.trim() : deliver
      const r = await window.api.agent.send({ profileId: '', convId: cid, history, userText: text, files, deliveryFormat })
      if (r.quota) setQuota(r.quota)
      if (r.needLogin) {
        toast.err('登录已过期，请重新登录')
        onAuthExpired()
        return
      }
      if (r.scopeBlocked) {
        setMessages((m) => [...m, { role: 'assistant', content: r.text || r.error || '该请求超出文书范围。' }])
        return
      }
      if (r.needRecharge) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: r.text || '本周额度已用完。', files: r.files }
        ])
        toast.info('额度已用完，去「我的账户」升级或等下周恢复')
        onOpen('account')
        return
      }
      if (r.ok) {
        setMessages((m) => [...m, { role: 'assistant', content: r.text || '已完成。', files: r.files }])
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${r.error || '处理失败'}` }])
      }
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function saveFile(f: GeneratedFilePayload): Promise<void> {
    // 网页版生成、存于 COS 的文件（有 fileId、无本地 base64）→ 经服务端下载到本地。
    if (!f.base64 && f.fileId) {
      const dr = await window.api.wsConv.download({ convId: cid, fileId: f.fileId, name: f.name })
      if (dr.ok) toast.ok(`已保存：${dr.path}`)
      else if (!dr.canceled) toast.err(dr.error || '下载失败')
      return
    }
    // 桌面历史会话恢复后，本地生成文件的 base64 已清空（避免库膨胀）；此时无法直接下载。
    if (!f.base64) {
      toast.info('这是历史对话里生成过的文件，内容未保留。让我「重新生成一下刚才那个文件」即可下载。')
      return
    }
    const r = await window.api.file.save(f)
    if (r.ok) toast.ok(`已保存：${r.path}`)
    else if (!r.canceled) toast.err(r.error || '保存失败')
  }

  async function copyText(t: string): Promise<void> {
    await window.api.system.copyText(t)
    toast.ok('已复制')
  }
  function quote(t: string): void {
    setQuoted(t)
    inputRef.current?.focus()
  }
  async function rememberText(t: string): Promise<void> {
    await window.api.memory.add({ text: t, source: 'message' })
    toast.ok('已存入记忆')
  }
  async function rememberFile(f: DroppedFile | GeneratedFilePayload): Promise<void> {
    await window.api.memory.addFile(f as DroppedFile)
    toast.ok(`已把「${f.name}」存入记忆`)
  }

  const empty = messages.length === 0
  const wan = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(0)}万` : String(n))

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <Bot size={18} className="text-brand" />
        <span className="text-sm font-medium">对话</span>
        <span className="text-xs text-muted">把需求、聊天记录或文件发给我，我直接给你做好文件</span>
        <div className="flex-1" />
        <button
          onClick={newConversation}
          title="新建对话"
          className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] text-muted hover:border-brand/50 hover:text-brand"
        >
          <Plus size={13} /> 新建
        </button>
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          title="历史对话"
          className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] text-muted hover:border-brand/50 hover:text-brand"
        >
          <History size={13} /> 历史
        </button>
        <button
          onClick={() => onOpen('account')}
          title="查看套餐与额度"
          className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-muted hover:text-slate-700"
        >
          {quota?.active ? `剩余 ${quota.memberCredits} 次` : `今日免费 ${quota?.freeRemaining ?? 0}/${quota?.freeDaily ?? 0} 次`}
        </button>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-5">
        {over && (
          <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/10 text-sm text-brand">
            松手上传文件
          </div>
        )}
        {empty ? (
          <div className="mx-auto max-w-xl pt-10 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-brand">
              <Sparkles size={26} />
            </div>
            <h2 className="mt-4 text-lg font-semibold">说一句话，或拖个文件进来</h2>
            <p className="mt-1 text-sm text-muted">
              我会自己判断该建表、抽表、套模板还是转格式，做好直接回给你。
            </p>
            <div className="mt-5 grid gap-2 text-left">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  className="rounded-lg border border-edge bg-panel/50 px-4 py-2.5 text-sm text-slate-600 hover:border-brand/50 hover:bg-panel"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <Bubble
                key={i}
                msg={m}
                onSaveFile={saveFile}
                onCopy={copyText}
                onQuote={quote}
                onRememberText={rememberText}
                onRememberFile={rememberFile}
                userAvatar={userAvatar}
              />
            ))}
            {busy && (
              <div className="flex gap-3">
                <Avatar role="assistant" />
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-edge bg-panel/60 px-4 py-3 text-sm text-muted">
                  <Loader2 size={15} className="animate-spin text-brand" />
                  {progress || '正在处理…'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-edge px-6 py-3">
        <div className="mx-auto max-w-3xl">
          {quoted && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand bg-panel/60 px-3 py-1.5 text-xs text-muted">
              <Quote size={13} className="mt-0.5 shrink-0 text-brand" />
              <span className="flex-1 truncate">引用：{quoted}</span>
              <button onClick={() => setQuoted(null)} className="hover:text-slate-900">
                <X size={13} />
              </button>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1 text-xs"
                >
                  <Paperclip size={12} className="text-muted" />
                  {a.name}
                  <button
                    onClick={() => setAttachments((p) => p.filter((_, k) => k !== i))}
                    className="text-muted hover:text-slate-900"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">交付为</span>
            {[{ v: '', l: '自动' }, { v: 'docx', l: 'Word' }, { v: 'pdf', l: 'PDF' }, { v: 'xlsx', l: 'Excel' }, { v: 'pptx', l: 'PPT' }, { v: 'text', l: '纯文本' }, { v: '__custom', l: '其他' }].map((d) => (
              <button key={d.v} onClick={() => setDeliver(d.v)} className={`rounded-full border px-2.5 py-0.5 text-xs ${deliver === d.v ? 'border-brand bg-brand/15 text-brand' : 'border-edge text-muted hover:text-slate-900'}`}>{d.l}</button>
            ))}
            {deliver === '__custom' && (
              <input value={deliverCustom} onChange={(e) => setDeliverCustom(e.target.value)} placeholder="想要的格式，如 长图/网页/Markdown" className="min-w-[120px] flex-1 rounded-lg border border-edge bg-panel px-2 py-1 text-xs text-slate-800 focus:outline-none" />
            )}
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-edge bg-panel/60 px-3 py-2 focus-within:border-brand/60">
            <button
              onClick={() => fileRef.current?.click()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-black/5 hover:text-slate-900"
              title="添加文件"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder="描述需求，或粘贴聊天记录…（Enter 发送，Shift+Enter 换行）"
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-muted focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || (!input.trim() && attachments.length === 0)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
        </div>
      </div>

      {historyOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-black/20" onClick={() => setHistoryOpen(false)} />
          <div className="absolute left-0 top-0 z-30 flex h-full w-72 flex-col border-r border-edge bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <span className="text-sm font-medium">历史对话</span>
              <button onClick={() => setHistoryOpen(false)} className="text-muted hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <button
              onClick={newConversation}
              className="mx-3 mt-3 flex items-center justify-center gap-1 rounded-lg bg-brand py-2 text-sm text-white hover:bg-brand/90"
            >
              <Plus size={15} /> 新建对话
            </button>
            <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
              {convs.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-muted">还没有历史对话</p>
              ) : (
                convs.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => void openConversation(c.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      c.id === cid ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-black/5'
                    }`}
                  >
                    <History size={13} className="shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{c.title || '新对话'}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteConversation(c.id)
                      }}
                      className="shrink-0 text-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Avatar({ role, userAvatar }: { role: 'user' | 'assistant'; userAvatar?: string }): JSX.Element {
  if (role === 'assistant')
    return <img src={motongFace} alt="墨童" className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-brand/30" />
  if (userAvatar)
    return <img src={userAvatar} alt="我" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/[0.06] text-slate-600">
      <User size={17} />
    </div>
  )
}

interface BubbleProps {
  msg: ChatMessage
  onSaveFile: (f: GeneratedFilePayload) => void
  onCopy: (t: string) => void
  onQuote: (t: string) => void
  onRememberText: (t: string) => void
  onRememberFile: (f: DroppedFile | GeneratedFilePayload) => void
  userAvatar?: string
}

function ActionBtn({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Copy
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-black/[0.06] hover:text-slate-700"
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

function Bubble({
  msg,
  onSaveFile,
  onCopy,
  onQuote,
  onRememberText,
  onRememberFile,
  userAvatar
}: BubbleProps): JSX.Element {
  const isUser = msg.role === 'user'
  return (
    <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar role={msg.role} userAvatar={userAvatar} />
      <div className={`max-w-[80%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        {msg.content && (
          <div
            className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'rounded-tr-sm bg-brand text-white'
                : 'rounded-tl-sm border border-edge bg-panel/60 text-slate-700'
            }`}
          >
            {msg.content}
          </div>
        )}

        {/* 消息操作：复制 / 引用 / 存记忆 —— 悬停显示 */}
        {msg.content && (
          <div
            className={`mt-1 flex gap-1 opacity-0 transition group-hover:opacity-100 ${
              isUser ? 'justify-end' : ''
            }`}
          >
            <ActionBtn icon={Copy} label="复制" onClick={() => onCopy(msg.content)} />
            <ActionBtn icon={Quote} label="引用" onClick={() => onQuote(msg.content)} />
            <ActionBtn icon={BrainCircuit} label="存记忆" onClick={() => onRememberText(msg.content)} />
          </div>
        )}

        {/* 上传的附件：可单独存入记忆 */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1.5 ${isUser ? 'justify-end' : ''}`}>
            {msg.attachments.map((a, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-md bg-black/[0.06] px-2 py-0.5 text-[11px] text-slate-600"
              >
                📎 {a}
                {msg.attachFiles?.[i] && (
                  <button
                    onClick={() => onRememberFile(msg.attachFiles![i])}
                    title="存入记忆"
                    className="text-muted hover:text-brand"
                  >
                    <BrainCircuit size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* 生成的文件：保存 / 存记忆。base64 为空者为历史恢复文件，标注「历史」并禁存记忆 */}
        {msg.files && msg.files.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {msg.files.map((f, i) => {
              const expired = !f.base64 && !f.fileId
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    expired
                      ? 'border-edge bg-black/[0.03] text-muted'
                      : 'border-brand2/40 bg-brand2/10 text-emerald-700'
                  }`}
                >
                  <FileDown size={16} className={`shrink-0 ${expired ? 'text-muted' : 'text-emerald-600'}`} />
                  <span className="flex-1 truncate">{f.name}</span>
                  {expired && <span className="shrink-0 text-[11px] text-muted">历史 · 需重新生成</span>}
                  <button
                    onClick={() => onSaveFile(f)}
                    className={`shrink-0 text-xs ${
                      expired ? 'text-muted hover:text-slate-700' : 'text-emerald-600 hover:text-slate-900'
                    }`}
                  >
                    保存
                  </button>
                  {!!f.base64 && (
                    <button
                      onClick={() => onRememberFile(f)}
                      title="存入记忆"
                      className="shrink-0 text-muted hover:text-brand"
                    >
                      <BrainCircuit size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
