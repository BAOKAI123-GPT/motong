import { useEffect, useState } from 'react'
import { Bot, Boxes, BrainCircuit, Library, Loader2, ScrollText, UserCircle2, X } from 'lucide-react'
import type { AuthState } from '@shared/types'
import Toaster from './components/Toast'
import LoginView from './views/LoginView'
import ChatView from './views/ChatView'
import ConvertView from './views/ConvertView'
import SplitView from './views/SplitView'
import PdfToolsView from './views/PdfToolsView'
import TemplateFillView from './views/TemplateFillView'
import ResourceLibraryView from './views/ResourceLibraryView'
import InfoLibraryView from './views/InfoLibraryView'
import MemoryView from './views/MemoryView'
import AccountView from './views/AccountView'
import SettingsView from './views/SettingsView'
import AboutView from './views/AboutView'

export type ViewId =
  | 'chat'
  | 'convert'
  | 'split'
  | 'pdftools'
  | 'template'
  | 'resources'
  | 'info'
  | 'memory'
  | 'account'
  | 'settings'
  | 'about'

// 侧栏核心入口；AI 模型已内置锁定。具体工具在对话里由 AI 自动调用（手动版在「资源库」）。
const NAV: { id: ViewId; label: string; icon: typeof Bot }[] = [
  { id: 'chat', label: '对话', icon: Bot },
  { id: 'memory', label: '记忆', icon: BrainCircuit },
  { id: 'resources', label: '资源库', icon: Boxes },
  { id: 'info', label: '信息库', icon: Library },
  { id: 'account', label: '我的账户', icon: UserCircle2 },
  { id: 'about', label: '关于墨童', icon: ScrollText }
]

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewId>('chat')
  const [auth, setAuth] = useState<AuthState | null>(null)

  const [update, setUpdate] = useState<{
    latest: string
    notes: string
    url: string
    forceUpdate: boolean
  } | null>(null)

  async function refreshAuth(): Promise<void> {
    setAuth(await window.api.auth.status())
  }
  useEffect(() => {
    void refreshAuth()
    // 启动版本检测：不是最新版则提示去官网更新；后端下发 forceUpdate 时强制阻断旧版
    void window.api.app
      .checkUpdate()
      .then((u) => {
        if (u?.needUpdate)
          setUpdate({ latest: u.latest, notes: u.notes, url: u.url, forceUpdate: !!u.forceUpdate })
      })
      .catch(() => {})
  }, [])

  // 强制更新：全屏、不可关闭遮罩。优先于一切界面（含登录/加载），旧功能被完全挡住。
  if (update && update.forceUpdate) {
    return (
      <>
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-ink/95 backdrop-blur-sm p-6">
          <div className="w-full max-w-md rounded-2xl border border-edge bg-panel p-7 text-center shadow-2xl">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand text-xl font-black text-[#3a2a05]">
              墨
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-800">请更新到最新版</h2>
            <p className="mt-1 text-sm text-muted">
              当前版本已停用，新版本 <b className="text-slate-700">v{update.latest}</b> 修复了对话与文件处理核心功能：
              多轮对话不再丢失已上传的文件、可稳定生成并下载成品文件。请更新后继续使用。
            </p>
            {update.notes && (
              <div className="mt-4 whitespace-pre-wrap rounded-lg border border-edge bg-ink/40 px-4 py-3 text-left text-xs leading-relaxed text-slate-600">
                {update.notes}
              </div>
            )}
            <button
              onClick={() => void window.api.system.openExternal(update.url)}
              className="mt-5 w-full rounded-xl bg-brand py-2.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              去官网更新
            </button>
          </div>
        </div>
        <Toaster />
      </>
    )
  }

  // 建议更新：可关闭横幅（非强制）
  const updateBanner = update ? (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-brand px-4 py-2 text-xs text-white shadow-md">
      <span>
        发现新版本 <b>v{update.latest}</b>，建议更新以获得最新功能与修复
        {update.notes ? `（${update.notes}）` : ''}。
      </span>
      <button
        onClick={() => void window.api.system.openExternal(update.url)}
        className="rounded-full bg-white/20 px-3 py-0.5 font-medium hover:bg-white/30"
      >
        去官网更新
      </button>
      <button onClick={() => setUpdate(null)} className="text-white/80 hover:text-white" title="稍后">
        <X size={14} />
      </button>
    </div>
  ) : null

  if (auth === null) {
    return (
      <div className="grid h-full place-items-center bg-ink text-muted">
        <Loader2 size={22} className="animate-spin" />
      </div>
    )
  }
  if (!auth.loggedIn) {
    return (
      <>
        {updateBanner}
        <LoginView onDone={refreshAuth} />
        <Toaster />
      </>
    )
  }

  return (
    <div className="flex h-full bg-ink text-slate-700">
      {updateBanner}
      {/* 侧边栏 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-edge bg-panel/60">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-lg font-black text-[#3a2a05]">墨</div>
          <div>
            <div className="text-sm font-semibold leading-tight">墨童</div>
            <div className="text-[11px] text-muted">AI 文员 · 承子夏文脉</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = view === n.id
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-brand/10 font-medium text-brand'
                    : 'text-slate-500 hover:bg-black/5 hover:text-slate-700'
                }`}
              >
                <Icon size={17} />
                {n.label}
              </button>
            )
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] leading-relaxed text-muted">
          {auth.phone ? `${auth.phone} · ` : ''}文件本地处理
        </div>
      </aside>

      {/* 主区域：对话页常驻不卸载（切到别的页再切回来，已输入文字/正在生成的内容不丢失），其它页随内容滚动 */}
      <main className="flex-1 overflow-y-auto">
        <div className={view === 'chat' ? 'h-full' : 'hidden'}>
          <ChatView onOpen={setView} onAuthExpired={refreshAuth} />
        </div>
        {view === 'convert' && <ConvertView handoff={null} clearHandoff={() => {}} />}
        {view === 'split' && <SplitView handoff={null} clearHandoff={() => {}} />}
        {view === 'pdftools' && <PdfToolsView />}
        {view === 'template' && <TemplateFillView onOpen={setView} />}
        {view === 'resources' && <ResourceLibraryView onOpen={setView} />}
        {view === 'info' && <InfoLibraryView />}
        {view === 'memory' && <MemoryView />}
        {view === 'account' && <AccountView onLoggedOut={refreshAuth} />}
        {view === 'settings' && <SettingsView />}
        {view === 'about' && <AboutView />}
      </main>

      <Toaster />
    </div>
  )
}
