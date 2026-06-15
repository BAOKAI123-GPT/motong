import { useEffect, useState } from 'react'
import { Loader2, FolderOpen, Scissors, Table2 } from 'lucide-react'
import type { DroppedFile, TablePreview } from '@shared/types'
import DropZone from '../components/DropZone'
import { isSpreadsheet } from '../lib/files'
import { toast } from '../store/ui'

interface Props {
  handoff: DroppedFile | null
  clearHandoff: () => void
}

export default function SplitView({ handoff, clearHandoff }: Props): JSX.Element {
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [headerRow, setHeaderRow] = useState(1)
  const [rowsPerFile, setRowsPerFile] = useState(1)
  const [outFormat, setOutFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx')
  const [nameColumn, setNameColumn] = useState<number | -1>(-1)
  const [preview, setPreview] = useState<TablePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [doneDir, setDoneDir] = useState<string | null>(null)

  useEffect(() => {
    if (handoff) {
      void pick(handoff)
      clearHandoff()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  // 表头行变化时重新预览
  useEffect(() => {
    if (file) void refreshPreview(file, headerRow)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerRow])

  async function pick(f: DroppedFile): Promise<void> {
    if (!isSpreadsheet(f.name)) {
      toast.err('表格拆分只支持 Excel / CSV 文件')
      return
    }
    setFile(f)
    setDoneDir(null)
    await refreshPreview(f, headerRow)
  }

  async function refreshPreview(f: DroppedFile, hr: number): Promise<void> {
    const p = await window.api.table.preview({ file: f, headerRow: hr })
    setPreview(p)
    if (!p.ok) toast.err(p.error || '读取表格失败')
  }

  async function run(): Promise<void> {
    if (!file) return
    setBusy(true)
    setDoneDir(null)
    try {
      const r = await window.api.table.split({
        file,
        headerRow,
        rowsPerFile,
        outFormat,
        nameColumn: nameColumn >= 0 ? nameColumn : undefined
      })
      if (r.canceled) return
      if (r.ok && r.dir) {
        setDoneDir(r.dir)
        toast.ok(`拆分完成，共生成 ${r.count} 个文件`)
      } else {
        toast.err(r.error || '拆分失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const header = preview?.header ?? []

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-xl font-semibold">表格拆分</h1>
      <p className="mt-1 text-sm text-muted">
        把产品明细表按条目拆成一个个独立文件，每个文件自动带上表头，方便单条打印。
      </p>

      <div className="mt-6">
        <DropZone onFile={pick} compact accept=".xlsx,.xls,.csv" hint="Excel (.xlsx/.xls) 或 CSV" />
      </div>

      {preview?.ok && (
        <>
          {/* 预览 */}
          <div className="mt-5 rounded-xl border border-edge bg-panel/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <Table2 size={16} className="text-brand" />
              <span className="font-medium">{file?.name}</span>
              <span className="text-muted">
                · 共 {preview.totalRows} 条数据{preview.sheetName ? ` · 工作表 ${preview.sheetName}` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                {header.length > 0 && (
                  <thead>
                    <tr>
                      {header.map((h, i) => (
                        <th
                          key={i}
                          className="border border-edge bg-black/5 px-2 py-1 text-left font-medium"
                        >
                          {h || `列${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {preview.rows.map((r, ri) => (
                    <tr key={ri}>
                      {(header.length > 0 ? header : r).map((_, ci) => (
                        <td key={ci} className="border border-edge px-2 py-1 text-slate-600">
                          {r[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.totalRows > preview.rows.length && (
              <div className="mt-2 text-[11px] text-muted">仅预览前 {preview.rows.length} 条…</div>
            )}
          </div>

          {/* 参数 */}
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-edge bg-panel/60 p-5 md:grid-cols-4">
            <Field label="表头在第几行">
              <input
                type="number"
                min={0}
                value={headerRow}
                onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) || 0))}
                className="input"
              />
              <p className="hint">0 表示没有表头</p>
            </Field>
            <Field label="每个文件几条">
              <input
                type="number"
                min={1}
                value={rowsPerFile}
                onChange={(e) => setRowsPerFile(Math.max(1, Number(e.target.value) || 1))}
                className="input"
              />
              <p className="hint">默认 1：单条单文件</p>
            </Field>
            <Field label="文件命名">
              <select
                value={nameColumn}
                onChange={(e) => setNameColumn(Number(e.target.value))}
                className="input"
              >
                <option value={-1}>用序号</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    按「{h || `列${i + 1}`}」
                  </option>
                ))}
              </select>
              <p className="hint">用某列的值做文件名</p>
            </Field>
            <Field label="输出格式">
              <select
                value={outFormat}
                onChange={(e) => setOutFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')}
                className="input"
              >
                <option value="xlsx">Excel (xlsx)</option>
                <option value="csv">CSV</option>
                <option value="pdf">PDF（需 LibreOffice）</option>
              </select>
              <p className="hint">PDF 便于直接打印</p>
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={run}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
              开始拆分（约 {Math.ceil(preview.totalRows / rowsPerFile)} 个文件）
            </button>
            {doneDir && (
              <button
                onClick={() => window.api.system.openPath(doneDir)}
                className="flex items-center gap-1 text-sm text-emerald-600 hover:text-slate-900"
              >
                <FolderOpen size={15} /> 打开结果文件夹
              </button>
            )}
          </div>
        </>
      )}

      {/* 局部样式 */}
      <style>{`
        .input { width: 100%; border-radius: 8px; border: 1px solid #262a34; background: #0f1115; padding: 6px 10px; font-size: 13px; color: #e7e9ee; }
        .input:focus { outline: none; border-color: #2f6df6; }
        .hint { margin-top: 4px; font-size: 11px; color: #8b90a0; }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}
