import { useEffect, useRef, useState } from 'react'
import { Crown, Loader2, LogOut, RefreshCw, X } from 'lucide-react'
import type { WsQuota, WsTier } from '@shared/types'
import { toast } from '../store/ui'

const TIER_CN: Record<string, string> = {
  none: '未开通',
  basic: '基础版',
  plus: '升级版',
  ultra: '至尊版'
}

function wan(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 万` : String(n)
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('zh-CN')
  } catch {
    return '—'
  }
}

export default function AccountView({ onLoggedOut }: { onLoggedOut: () => void }): JSX.Element {
  const [q, setQ] = useState<WsQuota | null>(null)
  const [tiers, setTiers] = useState<WsTier[]>([])
  const [pay, setPay] = useState<{ qrImg: string; outTradeNo: string; amount: string } | null>(null)
  const [busy, setBusy] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadMe(): Promise<void> {
    const r = await window.api.ws.me()
    if (r.ok) setQ(r.data)
  }
  useEffect(() => {
    void loadMe()
    void window.api.ws.tiers().then((r) => r.ok && setTiers(r.data.tiers || []))
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function recharge(tierId: string): Promise<void> {
    setBusy(tierId)
    const r = await window.api.ws.payCreate(tierId)
    setBusy('')
    if (!r.ok || !r.data?.qrImg) {
      toast.err(r.data?.error || '下单失败')
      return
    }
    const { qrImg, outTradeNo, amount } = r.data
    setPay({ qrImg, outTradeNo: outTradeNo!, amount: amount! })
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await window.api.ws.payStatus(outTradeNo!)
      if (s.ok && s.data?.paid) {
        clearInterval(pollRef.current!)
        setPay(null)
        toast.ok('支付成功，已到账')
        void loadMe()
      }
    }, 3000)
  }

  async function logout(): Promise<void> {
    await window.api.auth.logout()
    onLoggedOut()
  }

  const active = q?.active

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-2">
        <Crown size={20} className="text-brand" />
        <h1 className="text-xl font-semibold">我的账户</h1>
        <div className="flex-1" />
        <button onClick={loadMe} className="flex items-center gap-1 text-xs text-muted hover:text-slate-700">
          <RefreshCw size={13} /> 刷新
        </button>
        <button onClick={logout} className="flex items-center gap-1 text-xs text-muted hover:text-red-600">
          <LogOut size={13} /> 退出登录
        </button>
      </div>

      {/* 当前状态 */}
      <div className="mt-5 rounded-2xl border border-edge bg-panel/60 p-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-muted">当前套餐</div>
            <div className="text-lg font-semibold">
              {active ? TIER_CN[q!.tier] || q!.tier : '未开通'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">本周剩余额度</div>
            <div className="text-lg font-semibold">{active ? `${wan(q!.weekTokens)} token` : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">额度刷新</div>
            <div className="text-sm">{active ? fmtDate(q!.weekResetAt) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">到期</div>
            <div className="text-sm">{active ? fmtDate(q!.expiresAt) : '—'}</div>
          </div>
        </div>
        {!active && (
          <p className="mt-3 text-sm text-muted">还没开通会员。选择下面的套餐开通后即可使用对话办公。</p>
        )}
        {active && q!.weekTokens <= 0 && (
          <p className="mt-3 text-sm text-amber-700">本周额度已用完，下周自动恢复；急用可升级更高套餐。</p>
        )}
      </div>

      {/* 套餐 */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        {tiers.map((t) => {
          const cur = active && q!.tier === t.id
          return (
            <div
              key={t.id}
              className={`flex flex-col rounded-2xl border p-5 ${
                t.id === 'plus' ? 'border-brand/60 bg-brand/5' : 'border-edge bg-panel/50'
              }`}
            >
              <div className="text-base font-semibold">{t.name}</div>
              <div className="mt-2 text-2xl font-bold">
                ¥{(t.priceCents / 100).toFixed(0)}
                <span className="text-xs font-normal text-muted"> /月</span>
              </div>
              <div className="mt-1 text-xs text-muted">每周 {wan(t.weekTokens)} token（不结转）</div>
              <div className="flex-1" />
              <button
                onClick={() => recharge(t.id)}
                disabled={busy === t.id}
                className={`mt-4 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium ${
                  t.id === 'plus'
                    ? 'bg-brand text-white hover:bg-brand/90'
                    : 'border border-edge text-slate-700 hover:bg-black/5'
                } disabled:opacity-50`}
              >
                {busy === t.id && <Loader2 size={14} className="animate-spin" />}
                {cur ? '续费' : '开通'}
              </button>
            </div>
          )
        })}
      </div>

      {/* 支付二维码 */}
      {pay && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setPay(null)}>
          <div
            className="w-72 rounded-2xl border border-edge bg-panel p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">支付宝扫码支付 ¥{pay.amount}</span>
              <button onClick={() => setPay(null)} className="text-muted hover:text-slate-900">
                <X size={16} />
              </button>
            </div>
            <img src={pay.qrImg} alt="支付二维码" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> 支付完成后自动到账…
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
