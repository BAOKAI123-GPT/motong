import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from '../store/ui'
import motongLogo from '../assets/motong.png'

export default function LoginView({ onDone }: { onDone: () => void }): JSX.Element {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [cd, setCd] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cd <= 0) return
    const t = setTimeout(() => setCd((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cd])

  const validPhone = /^1[3-9]\d{9}$/.test(phone)

  async function send(): Promise<void> {
    if (!validPhone) {
      toast.err('请输入正确的手机号')
      return
    }
    setBusy(true)
    const r = await window.api.auth.sendCode(phone)
    setBusy(false)
    if (r.ok) {
      setSent(true)
      setCd(60)
      toast.ok('验证码已发送')
    } else {
      toast.err((r.data as any)?.error || '发送失败，请稍后再试')
    }
  }

  async function login(): Promise<void> {
    if (!validPhone || !code) {
      toast.err('请填写手机号和验证码')
      return
    }
    setBusy(true)
    const r = await window.api.auth.login(phone, code)
    setBusy(false)
    if (r.ok && r.data?.token) onDone()
    else toast.err((r.data as any)?.error || '登录失败')
  }

  return (
    <div className="grid h-full place-items-center bg-ink px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src={motongLogo} alt="墨童" className="h-14 w-14 rounded-2xl object-cover ring-1 ring-brand/40" />
          <div className="text-xl font-semibold">墨童</div>
          <div className="text-sm text-muted">AI 文员 · 承子夏文脉 · 手机号登录</div>
        </div>
        <div className="space-y-3 rounded-2xl border border-edge bg-panel/60 p-5">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="手机号"
            inputMode="numeric"
            className="w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-slate-800 focus:border-brand focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="验证码"
              inputMode="numeric"
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-slate-800 focus:border-brand focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || cd > 0 || !validPhone}
              className="shrink-0 rounded-lg border border-edge px-3 py-2.5 text-sm text-slate-700 hover:bg-black/5 disabled:opacity-50"
            >
              {cd > 0 ? `${cd}s` : '获取验证码'}
            </button>
          </div>
          <button
            onClick={login}
            disabled={busy || !sent}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            登录 / 注册
          </button>
          <p className="text-center text-[11px] leading-relaxed text-muted">
            未注册的手机号将自动创建账号。登录即代表同意服务条款。
          </p>
        </div>
      </div>
    </div>
  )
}
