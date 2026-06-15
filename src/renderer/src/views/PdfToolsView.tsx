import { useState } from 'react'
import {
  Combine,
  Loader2,
  Scissors,
  FileOutput,
  FolderOpen,
  Trash2,
  ChevronUp,
  ChevronDown,
  FileText
} from 'lucide-react'
import type { DroppedFile } from '@shared/types'
import DropZone from '../components/DropZone'
import { toast } from '../store/ui'

type Mode = 'merge' | 'splitEach' | 'extract'

const MODES: { id: Mode; label: string; icon: typeof Combine; desc: string }[] = [
  { id: 'merge', label: '合并 PDF', icon: Combine, desc: '把多个 PDF 按顺序合成一个' },
  { id: 'splitEach', label: '按页拆分', icon: Scissors, desc: '每一页拆成单独的 PDF' },
  { id: 'extract', label: '提取页面', icon: FileOutput, desc: '挑选指定页码合成新 PDF' }
]

export default function PdfToolsView(): JSX.Element {
  const [mode, setMode] = useState<Mode>('merge')
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold">PDF 工具</h1>
      <p className="mt-1 text-sm text-muted">合并、拆分、提取页面，全部在本机完成，不上传。</p>

      <div className="mt-5 flex gap-2">
        {MODES.map((m) => {
          const Icon = m.icon
          const active = mode === m.id
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                active ? 'border-brand bg-brand/10' : 'border-edge bg-panel/40 hover:bg-panel'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon size={16} className={active ? 'text-brand' : 'text-muted'} />
                {m.label}
              </div>
              <div className="text-[11px] text-muted">{m.desc}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        {mode === 'merge' && <MergePanel />}
        {mode === 'splitEach' && <SplitEachPanel />}
        {mode === 'extract' && <ExtractPanel />}
      </div>
    </div>
  )
}

function ResultBar({
  path,
  dir
}: {
  path?: string
  dir?: string
}): JSX.Element {
  const target = path || dir!
  const isDir = !!dir
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg border border-brand2/40 bg-brand2/10 px-3 py-2 text-sm text-emerald-700">
      <span className="truncate">已保存：{target}</span>
      <button
        onClick={() => (isDir ? window.api.system.openPath(target) : window.api.system.revealPath(target))}
        className="ml-3 flex shrink-0 items-center gap-1 text-emerald-600 hover:text-slate-900"
      >
        <FolderOpen size={15} /> {isDir ? '打开文件夹' : '打开所在文件夹'}
      </button>
    </div>
  )
}

function MergePanel(): JSX.Element {
  const [files, setFiles] = useState<DroppedFile[]>([])
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState<string | null>(null)

  function add(list: DroppedFile[]): void {
    const pdfs = list.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length < list.length) toast.info('已忽略非 PDF 文件')
    setFiles((prev) => [...prev, ...pdfs])
    setPath(null)
  }
  function move(i: number, dir: -1 | 1): void {
    setFiles((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  async function run(): Promise<void> {
    setBusy(true)
    setPath(null)
    try {
      const r = await window.api.pdf.merge(files)
      if (r.canceled) return
      if (r.ok && r.path) {
        setPath(r.path)
        toast.ok('合并完成')
      } else toast.err(r.error || '合并失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-5">
      <DropZone onFiles={add} multiple accept=".pdf" compact hint="可一次拖入多个 PDF，按下方顺序合并" />
      {files.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-edge bg-ink/40 px-3 py-2 text-sm"
            >
              <span className="w-6 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <FileText size={15} className="shrink-0 text-brand" />
              <span className="flex-1 truncate">{f.name}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-slate-900 disabled:opacity-30">
                <ChevronUp size={15} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === files.length - 1} className="text-muted hover:text-slate-900 disabled:opacity-30">
                <ChevronDown size={15} />
              </button>
              <button onClick={() => setFiles((p) => p.filter((_, k) => k !== i))} className="text-muted hover:text-red-600">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy || files.length < 2}
          className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Combine size={16} />}
          合并 {files.length} 个 PDF
        </button>
        {files.length > 0 && (
          <button onClick={() => setFiles([])} className="text-sm text-muted hover:text-slate-900">
            清空
          </button>
        )}
      </div>
      {path && <ResultBar path={path} />}
    </div>
  )
}

function SplitEachPanel(): JSX.Element {
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState<string | null>(null)

  async function pick(f: DroppedFile): Promise<void> {
    setFile(f)
    setDir(null)
    const info = await window.api.pdf.info(f)
    if (info.ok) setPages(info.pages!)
    else {
      setPages(null)
      toast.err(info.error || '读取 PDF 失败')
    }
  }
  async function run(): Promise<void> {
    if (!file) return
    setBusy(true)
    setDir(null)
    try {
      const r = await window.api.pdf.splitEach(file)
      if (r.canceled) return
      if (r.ok && r.dir) {
        setDir(r.dir)
        toast.ok(`已拆成 ${r.count} 个单页 PDF`)
      } else toast.err(r.error || '拆分失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-5">
      <DropZone onFile={pick} accept=".pdf" compact hint="拖入一个 PDF" />
      {file && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <FileText size={16} className="text-brand" /> {file.name}
            {pages != null && <span className="text-muted">· 共 {pages} 页</span>}
          </div>
          <button
            onClick={run}
            disabled={busy || !pages}
            className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
            拆成 {pages ?? ''} 个单页 PDF
          </button>
        </div>
      )}
      {dir && <ResultBar dir={dir} />}
    </div>
  )
}

function ExtractPanel(): JSX.Element {
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [ranges, setRanges] = useState('')
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState<string | null>(null)

  async function pick(f: DroppedFile): Promise<void> {
    setFile(f)
    setPath(null)
    const info = await window.api.pdf.info(f)
    if (info.ok) setPages(info.pages!)
    else {
      setPages(null)
      toast.err(info.error || '读取 PDF 失败')
    }
  }
  async function run(): Promise<void> {
    if (!file) return
    if (!ranges.trim()) {
      toast.err('请填写要提取的页码，如 1-3,5')
      return
    }
    setBusy(true)
    setPath(null)
    try {
      const r = await window.api.pdf.extract({ file, ranges })
      if (r.canceled) return
      if (r.ok && r.path) {
        setPath(r.path)
        toast.ok('提取完成')
      } else toast.err(r.error || '提取失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-5">
      <DropZone onFile={pick} accept=".pdf" compact hint="拖入一个 PDF" />
      {file && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <FileText size={16} className="text-brand" /> {file.name}
            {pages != null && <span className="text-muted">· 共 {pages} 页</span>}
          </div>
          <label className="mt-4 block text-xs text-muted">提取哪些页（示例 1-3,5,8-10）</label>
          <input
            value={ranges}
            onChange={(e) => setRanges(e.target.value)}
            placeholder="1-3,5"
            className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none"
          />
          <button
            onClick={run}
            disabled={busy}
            className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileOutput size={16} />}
            提取并保存
          </button>
        </div>
      )}
      {path && <ResultBar path={path} />}
    </div>
  )
}
