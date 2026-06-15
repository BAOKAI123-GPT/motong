import { useEffect, useState } from 'react'
import { Bot, Boxes, BrainCircuit, FileStack, Library, Loader2, UserCircle2 } from 'lucide-react'
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

// 侧栏核心入口；AI 模型已内置锁定。具体工具在对话里由 AI 自动调用（手动版在「资源库」）。
const NAV: { id: ViewId; label: string; icon: typeof Bot }[] = [
  { id: 'chat', label: '对话', icon: Bot },
  { id: 'memory', label: '记忆', icon: BrainCircuit },
  { id: 'resources', label: '资源库', icon: Boxes },
  { id: 'info', label: '信息库', icon: Library },
  { id: 'account', label: '我的账户', icon: UserCircle2 }
]

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewId>('chat')
  const [auth, setAuth] = useState<AuthState | null>(null)

  async function refreshAuth(): Promise<void> {
    setAuth(await window.api.auth.status())
  }
  useEffect(() => {
    void refreshAuth()
  }, [])

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
        <LoginView onDone={refreshAuth} />
        <Toaster />
      </>
    )
  }

  return (
    <div className="flex h-full bg-ink text-slate-700">
      {/* 侧边栏 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-edge bg-panel/60">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand/20 text-brand">
            <FileStack size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">翰文</div>
            <div className="text-[11px] text-muted">对话式文书办公</div>
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
      </main>

      <Toaster />
    </div>
  )
}
