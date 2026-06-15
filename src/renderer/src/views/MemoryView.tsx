import { useEffect, useState } from 'react'
import { BrainCircuit, Plus, Trash2, Eraser } from 'lucide-react'
import type { MemoryEntry } from '@shared/types'
import { toast } from '../store/ui'

const SOURCE_META: Record<MemoryEntry['source'], { label: string; cls: string }> = {
  message: { label: '对话', cls: 'bg-brand/15 text-blue-700' },
  file: { label: '文件', cls: 'bg-brand2/15 text-emerald-600' },
  summary: { label: '提纲', cls: 'bg-amber-500/15 text-amber-700' },
  note: { label: '笔记', cls: 'bg-black/[0.06] text-slate-600' }
}

function fmt(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

export default function MemoryView(): JSX.Element {
  const [list, setList] = useState<MemoryEntry[]>([])
  const [note, setNote] = useState('')

  async function load(): Promise<void> {
    setList(await window.api.memory.list())
  }
  useEffect(() => {
    void load()
  }, [])

  async function add(): Promise<void> {
    if (!note.trim()) return
    setList(await window.api.memory.add({ text: note.trim(), source: 'note' }))
    setNote('')
    toast.ok('已记住')
  }
  async function del(id: string): Promise<void> {
    setList(await window.api.memory.delete(id))
  }
  async function clearAll(): Promise<void> {
    setList(await window.api.memory.clear())
    toast.ok('已清空记忆')
  }

  const totalChars = list.reduce((s, m) => s + m.text.length, 0)

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-2">
        <BrainCircuit size={20} className="text-brand" />
        <h1 className="text-xl font-semibold">记忆</h1>
      </div>
      <p className="mt-1 text-sm text-muted">
        这里是智能体的长期记忆——你在对话里"存记忆"的内容、文件要点都会进来，之后对话时会自动参考。
        <br />
        记忆写满后会自动把<strong>最早的内容总结成提纲</strong>保留要点；万一总结不了，则从最早的开始删。
      </p>

      {/* 手动记一条 */}
      <div className="mt-6 flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="手动记一条，例如：本溪精工的对账单都用模板B"
          className="flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none"
        />
        <button
          onClick={add}
          className="flex items-center gap-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          <Plus size={15} /> 记住
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          共 {list.length} 条 · 约 {totalChars} 字
        </span>
        {list.length > 0 && (
          <button onClick={clearAll} className="flex items-center gap-1 hover:text-red-600">
            <Eraser size={13} /> 清空全部
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {list.length === 0 && (
          <div className="rounded-xl border border-dashed border-edge px-4 py-10 text-center text-sm text-muted">
            还没有记忆。在对话里点消息或文件下的「存记忆」，或在上面手动记一条。
          </div>
        )}
        {list
          .slice()
          .reverse()
          .map((m) => {
            const meta = SOURCE_META[m.source]
            return (
              <div key={m.id} className="rounded-xl border border-edge bg-panel/60 p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-slate-500">{fmt(m.createdAt)}</span>
                  <div className="flex-1" />
                  <button onClick={() => del(m.id)} className="text-muted hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {m.text.length > 600 ? m.text.slice(0, 600) + '…' : m.text}
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
