import { useEffect, useState } from 'react'
import { Plus, Trash2, Library } from 'lucide-react'
import type { InfoEntry } from '@shared/types'
import { toast } from '../store/ui'

const PRESET_CATEGORIES = ['公司信息', '联系人', '产品信息', '银行/财务', '其他']

export default function InfoLibraryView(): JSX.Element {
  const [entries, setEntries] = useState<InfoEntry[]>([])
  const [category, setCategory] = useState(PRESET_CATEGORIES[0])
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')

  async function load(): Promise<void> {
    setEntries(await window.api.info.list())
  }
  useEffect(() => {
    void load()
  }, [])

  async function add(): Promise<void> {
    if (!label.trim()) {
      toast.err('请填写字段名，例如「公司名称」')
      return
    }
    await window.api.info.save({ category, label: label.trim(), value })
    setLabel('')
    setValue('')
    await load()
    toast.ok('已保存')
  }

  async function del(id: string): Promise<void> {
    await window.api.info.delete(id)
    await load()
  }

  const grouped = entries.reduce<Record<string, InfoEntry[]>>((acc, e) => {
    ;(acc[e.category] ||= []).push(e)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-2">
        <Library size={20} className="text-brand" />
        <h1 className="text-xl font-semibold">信息库</h1>
      </div>
      <p className="mt-1 text-sm text-muted">
        把公司名称、地址、联系人、产品基础信息等固定内容录在这里，做模板填充时可直接调用，不用每次重打。全部存在本机。
      </p>

      {/* 录入 */}
      <div className="mt-6 rounded-xl border border-edge bg-panel/60 p-4">
        <div className="grid grid-cols-12 gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="col-span-3 il-input"
          >
            {PRESET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="字段名，如 公司名称"
            className="col-span-4 il-input"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="内容"
            className="col-span-4 il-input"
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button
            onClick={add}
            className="col-span-1 grid place-items-center rounded-lg bg-brand text-white hover:bg-brand/90"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-6 space-y-5">
        {entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-edge px-4 py-10 text-center text-sm text-muted">
            还没有任何信息，先在上面添加几条吧
          </div>
        )}
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <div className="mb-2 text-xs font-medium text-muted">{cat}</div>
            <div className="overflow-hidden rounded-xl border border-edge">
              {list.map((e, i) => (
                <div
                  key={e.id}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                    i % 2 ? 'bg-panel/40' : 'bg-panel/70'
                  }`}
                >
                  <span className="w-40 shrink-0 text-slate-600">{e.label}</span>
                  <span className="flex-1 truncate text-slate-800">{e.value || '—'}</span>
                  <button
                    onClick={() => del(e.id)}
                    className="text-muted hover:text-red-600"
                    title="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .il-input { border-radius: 8px; border: 1px solid #262a34; background: #0f1115; padding: 7px 10px; font-size: 13px; color: #e7e9ee; }
        .il-input:focus { outline: none; border-color: #2f6df6; }
      `}</style>
    </div>
  )
}
