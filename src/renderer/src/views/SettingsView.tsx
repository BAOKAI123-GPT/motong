import { useEffect, useState } from 'react'
import { Loader2, Plus, Radar, Save, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { ModelInfo, RelayProfile } from '@shared/types'
import { toast } from '../store/ui'

interface FormState {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  chatModel: string
  visionModel: string
}

const EMPTY: FormState = { name: '', baseUrl: '', apiKey: '', chatModel: '', visionModel: '' }

export default function SettingsView(): JSX.Element {
  const [profiles, setProfiles] = useState<RelayProfile[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [scanning, setScanning] = useState(false)
  const [encOk, setEncOk] = useState(true)

  async function load(): Promise<void> {
    setProfiles(await window.api.config.getProfiles())
    setEncOk(await window.api.config.encryptionAvailable())
  }
  useEffect(() => {
    void load()
  }, [])

  function editProfile(p: RelayProfile): void {
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: '',
      chatModel: p.chatModel || '',
      visionModel: p.visionModel || ''
    })
    setModels([])
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]): void {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function scan(): Promise<void> {
    setScanning(true)
    setModels([])
    try {
      const res =
        form.apiKey.trim().length > 0
          ? await window.api.relay.scanModels({ baseUrl: form.baseUrl, apiKey: form.apiKey })
          : form.id
            ? await window.api.relay.scanByProfile(form.id)
            : { ok: false, models: [], error: '请先填写 API Key' }
      if (!res.ok) {
        toast.err(res.error || '扫描失败')
        return
      }
      setModels(res.models)
      if (!form.chatModel && res.suggestedChatModel) set('chatModel', res.suggestedChatModel)
      if (!form.visionModel && res.suggestedVisionModel)
        set('visionModel', res.suggestedVisionModel)
      toast.ok(`扫描到 ${res.models.length} 个模型`)
    } finally {
      setScanning(false)
    }
  }

  async function save(): Promise<void> {
    if (!form.name.trim() || !form.baseUrl.trim()) {
      toast.err('请填写名称和中转站地址')
      return
    }
    await window.api.config.saveProfile({
      id: form.id,
      name: form.name,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey || undefined,
      chatModel: form.chatModel || undefined,
      visionModel: form.visionModel || undefined
    })
    setForm(EMPTY)
    setModels([])
    await load()
    toast.ok('已保存中转站配置')
  }

  async function del(id: string): Promise<void> {
    await window.api.config.deleteProfile(id)
    if (form.id === id) setForm(EMPTY)
    await load()
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold">中转站设置</h1>
      <p className="mt-1 text-sm text-muted">
        模板填充、聊天记录解析这些 AI 功能需要一个中转站（OpenAI 兼容接口）。API Key
        只保存在本机
        {encOk ? '并加密存储' : '（当前系统不支持加密，将以本地编码方式保存）'}。
      </p>
      <div
        className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
          encOk ? 'bg-brand2/15 text-emerald-600' : 'bg-amber-500/15 text-amber-700'
        }`}
      >
        {encOk ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
        {encOk ? 'API Key 加密存储' : '未启用加密'}
      </div>

      {/* 已有配置 */}
      {profiles.length > 0 && (
        <div className="mt-6 space-y-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-edge bg-panel/60 px-4 py-3"
            >
              <div className="flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted">
                  {p.baseUrl} · {p.hasKey ? p.apiKeyMasked : '未填 Key'} ·{' '}
                  {p.chatModel || '未选模型'}
                </div>
              </div>
              <button onClick={() => editProfile(p)} className="text-xs text-brand hover:underline">
                编辑
              </button>
              <button onClick={() => del(p.id)} className="text-muted hover:text-red-600">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 表单 */}
      <div className="mt-6 rounded-xl border border-edge bg-panel/60 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          {form.id ? '编辑中转站' : <><Plus size={15} /> 新增中转站</>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <L label="名称">
            <input
              className="sv-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="如 青云中转站"
            />
          </L>
          <L label="中转站地址 (Base URL)">
            <input
              className="sv-input"
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="https://api.xxx.com"
            />
          </L>
          <L label="API Key">
            <input
              className="sv-input"
              type="password"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder={form.id ? '留空则沿用已保存的 Key' : 'sk-...'}
            />
          </L>
          <L label="　">
            <button
              onClick={scan}
              disabled={scanning}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand/50 bg-brand/10 py-2 text-sm text-white hover:bg-brand/20 disabled:opacity-60"
            >
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
              扫描可用模型
            </button>
          </L>
          <L label="对话模型（文书处理）">
            {models.length > 0 ? (
              <select
                className="sv-input"
                value={form.chatModel}
                onChange={(e) => set('chatModel', e.target.value)}
              >
                <option value="">（不指定）</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.chatScore > 0 ? ' ⭐' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="sv-input"
                value={form.chatModel}
                onChange={(e) => set('chatModel', e.target.value)}
                placeholder="如 gpt-4o，可先扫描"
              />
            )}
          </L>
          <L label="识图模型（解析聊天截图，可选）">
            {models.length > 0 ? (
              <select
                className="sv-input"
                value={form.visionModel}
                onChange={(e) => set('visionModel', e.target.value)}
              >
                <option value="">（同对话模型）</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.vision ? ' 👁' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="sv-input"
                value={form.visionModel}
                onChange={(e) => set('visionModel', e.target.value)}
                placeholder="如 gpt-4o"
              />
            )}
          </L>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={save}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
          >
            <Save size={15} /> 保存
          </button>
          {form.id && (
            <button
              onClick={() => {
                setForm(EMPTY)
                setModels([])
              }}
              className="rounded-lg border border-edge px-4 py-2 text-sm hover:bg-black/5"
            >
              取消编辑
            </button>
          )}
        </div>
      </div>

      <style>{`
        .sv-input { width: 100%; border-radius: 8px; border: 1px solid #262a34; background: #0f1115; padding: 8px 10px; font-size: 13px; color: #e7e9ee; }
        .sv-input:focus { outline: none; border-color: #2f6df6; }
      `}</style>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}
