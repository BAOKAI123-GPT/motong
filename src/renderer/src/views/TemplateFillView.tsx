import { useMemo, useState } from 'react'
import { FileText, Loader2, Sparkles, FolderOpen, Wand2, Database, AlertCircle } from 'lucide-react'
import type { DroppedFile } from '@shared/types'
import type { ViewId } from '../App'
import DropZone from '../components/DropZone'
import { toast } from '../store/ui'

export default function TemplateFillView({
  onOpen
}: {
  onOpen: (v: ViewId) => void
}): JSX.Element {
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [type, setType] = useState<'docx' | 'xlsx' | null>(null)
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [description, setDescription] = useState('')

  const [busyAI, setBusyAI] = useState(false)
  const [busyGen, setBusyGen] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const filledCount = useMemo(
    () => placeholders.filter((p) => (values[p] ?? '').trim() !== '').length,
    [placeholders, values]
  )

  async function pick(f: DroppedFile): Promise<void> {
    setSavedPath(null)
    const r = await window.api.template.extract(f)
    if (!r.ok || !r.placeholders) {
      toast.err(r.error || '无法解析模板')
      return
    }
    setFile(f)
    setType(r.type!)
    setPlaceholders(r.placeholders)
    setValues({ ...(r.prefill || {}) })
    setPrefilled(new Set(Object.keys(r.prefill || {})))
    setMissing(new Set())
    toast.ok(`识别到 ${r.placeholders.length} 个占位符`)
  }

  async function aiFill(): Promise<void> {
    setBusyAI(true)
    try {
      const r = await window.api.template.aiFill({ profileId: '', placeholders, description })
      if (!r.ok) {
        toast.err(r.error || 'AI 填充失败')
        return
      }
      setValues((prev) => ({ ...prev, ...(r.values || {}) }))
      setMissing(new Set(r.missing || []))
      const got = Object.keys(r.values || {}).length
      toast.ok(
        `AI 填了 ${got} 项` + ((r.missing?.length || 0) > 0 ? `，还有 ${r.missing!.length} 项需你补充` : '')
      )
    } finally {
      setBusyAI(false)
    }
  }

  async function generate(): Promise<void> {
    if (!file) return
    const empties = placeholders.filter((p) => (values[p] ?? '').trim() === '')
    if (empties.length > 0) {
      toast.info(`还有 ${empties.length} 项空着，将以空白生成`)
    }
    setBusyGen(true)
    setSavedPath(null)
    try {
      const r = await window.api.template.render({ file, mapping: values })
      if (r.canceled) return
      if (r.ok && r.path) {
        setSavedPath(r.path)
        toast.ok('已生成填好的文件')
      } else toast.err(r.error || '生成失败')
    } finally {
      setBusyGen(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold">模板自动填充</h1>
      <p className="mt-1 text-sm text-muted">
        在模板里用 <code className="rounded bg-black/[0.06] px-1">{'{{字段名}}'}</code>{' '}
        标出要填的位置，拖进来后信息库会自动预填，AI 再结合你的描述补齐，缺的会高亮提醒你。
      </p>

      <div className="mt-6">
        <DropZone onFile={pick} accept=".docx,.xlsx" compact hint="Word(.docx) 或 Excel(.xlsx) 模板" />
      </div>

      {file && placeholders.length > 0 && (
        <>
          <div className="mt-5 flex items-center gap-2 text-sm">
            <FileText size={16} className="text-brand" />
            <span className="font-medium">{file.name}</span>
            <span className="text-muted">
              · {type?.toUpperCase()} · 已填 {filledCount}/{placeholders.length}
            </span>
          </div>

          {/* 需求描述 + AI */}
          <div className="mt-4 rounded-xl border border-edge bg-panel/60 p-4">
            <label className="mb-1 block text-xs text-muted">需求描述（给 AI 看，越具体越好）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="例：给XX集团的供货报价单，产品不锈钢法兰 DN50，数量120，单价35.5元，交货期7天…"
              className="w-full resize-y rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={aiFill}
                disabled={busyAI}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {busyAI ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                用 AI 填充
              </button>
              <span className="text-xs text-muted">不接 AI 也行，可在下方手动填</span>
            </div>
          </div>

          {/* 占位符表 */}
          <div className="mt-4 overflow-hidden rounded-xl border border-edge">
            {placeholders.map((p, i) => {
              const empty = (values[p] ?? '').trim() === ''
              const isMissing = missing.has(p) || empty
              return (
                <div
                  key={p}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 ? 'bg-panel/40' : 'bg-panel/70'}`}
                >
                  <div className="flex w-44 shrink-0 items-center gap-1.5">
                    <span className="truncate text-sm text-slate-700" title={p}>
                      {p}
                    </span>
                    {prefilled.has(p) && (
                      <span title="来自信息库" className="text-brand">
                        <Database size={12} />
                      </span>
                    )}
                  </div>
                  <input
                    value={values[p] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
                    placeholder="（待填）"
                    className={`flex-1 rounded-lg border bg-ink px-3 py-1.5 text-sm text-slate-800 focus:outline-none ${
                      isMissing ? 'border-amber-500/50' : 'border-edge focus:border-brand'
                    }`}
                  />
                  {isMissing && <AlertCircle size={15} className="shrink-0 text-amber-400" />}
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={generate}
              disabled={busyGen}
              className="flex items-center gap-2 rounded-lg bg-brand2 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand2/90 disabled:opacity-50"
            >
              {busyGen ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              生成填好的{type === 'xlsx' ? ' Excel' : ' Word'}
            </button>
            {savedPath && (
              <button
                onClick={() => window.api.system.revealPath(savedPath)}
                className="flex items-center gap-1 text-sm text-emerald-600 hover:text-slate-900"
              >
                <FolderOpen size={15} /> 打开所在文件夹
              </button>
            )}
          </div>
          {savedPath && (
            <div className="mt-3 truncate rounded-lg border border-brand2/40 bg-brand2/10 px-3 py-2 text-sm text-emerald-700">
              已保存：{savedPath}
            </div>
          )}
        </>
      )}
    </div>
  )
}
