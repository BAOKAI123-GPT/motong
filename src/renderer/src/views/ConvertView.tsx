import { useEffect, useState } from 'react'
import { FileText, Loader2, FolderOpen, AlertTriangle } from 'lucide-react'
import type { ConvertOptions, DroppedFile, TargetFormat } from '@shared/types'
import DropZone from '../components/DropZone'
import { extOf, TARGET_LABEL } from '../lib/files'
import { toast } from '../store/ui'

interface Props {
  handoff: DroppedFile | null
  clearHandoff: () => void
}

export default function ConvertView({ handoff, clearHandoff }: Props): JSX.Element {
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [opts, setOpts] = useState<ConvertOptions | null>(null)
  const [busy, setBusy] = useState<TargetFormat | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  // 接收首页交接的文件
  useEffect(() => {
    if (handoff) {
      void pick(handoff)
      clearHandoff()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  async function pick(f: DroppedFile): Promise<void> {
    setFile(f)
    setSavedPath(null)
    setOpts(null)
    const o = await window.api.convert.targets(extOf(f.name))
    setOpts(o)
    if (o.targets.length === 0) {
      toast.err(`暂不支持 .${extOf(f.name)} 的转换`)
    }
  }

  async function run(target: TargetFormat): Promise<void> {
    if (!file) return
    setBusy(target)
    setSavedPath(null)
    try {
      const r = await window.api.convert.run({ file, target })
      if (r.canceled) return
      if (r.ok && r.path) {
        setSavedPath(r.path)
        toast.ok(`已转换为 ${TARGET_LABEL[target] ?? target}`)
      } else {
        toast.err(r.error || '转换失败')
      }
    } finally {
      setBusy(null)
    }
  }

  const needLO = !!opts && !opts.libreofficeAvailable
  const docTargets: TargetFormat[] = ['pdf', 'docx', 'odt', 'pptx']

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold">格式转换</h1>
      <p className="mt-1 text-sm text-muted">选好要转成的格式，成品会让你选位置保存。</p>

      <div className="mt-6">
        <DropZone onFile={pick} compact hint="Word / Excel / PDF / CSV / WPS 等" />
      </div>

      {file && (
        <div className="mt-5 rounded-xl border border-edge bg-panel/60 p-5">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-brand" />
            <span className="text-sm font-medium">{file.name}</span>
          </div>

          {opts && opts.targets.length > 0 && (
            <>
              <div className="mt-4 text-xs text-muted">转换为：</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {opts.targets.map((t) => {
                  const disabled =
                    busy !== null || (needLO && docTargets.includes(t))
                  return (
                    <button
                      key={t}
                      disabled={disabled}
                      onClick={() => run(t)}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${
                        disabled
                          ? 'cursor-not-allowed border-edge text-muted'
                          : 'border-brand/50 bg-brand/10 text-white hover:bg-brand/20'
                      }`}
                    >
                      {busy === t && <Loader2 size={15} className="animate-spin" />}
                      {TARGET_LABEL[t] ?? t}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {needLO && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                该功能需要文档转换引擎（LibreOffice），Word / PDF / PPT 等文档类转换暂不可用（Excel/CSV
                互转不受影响）。请到「资源库」下载安装后即可解锁。
              </span>
            </div>
          )}

          {savedPath && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-brand2/40 bg-brand2/10 px-3 py-2 text-sm text-emerald-700">
              <span className="truncate">已保存：{savedPath}</span>
              <button
                onClick={() => window.api.system.revealPath(savedPath)}
                className="ml-3 flex shrink-0 items-center gap-1 text-emerald-600 hover:text-slate-900"
              >
                <FolderOpen size={15} /> 打开所在文件夹
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
