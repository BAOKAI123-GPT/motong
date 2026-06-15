import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { useUi } from '../store/ui'

const ICON = {
  info: Info,
  success: CheckCircle2,
  error: XCircle
}
const COLOR = {
  info: 'border-edge text-slate-700',
  success: 'border-brand2/60 text-emerald-700',
  error: 'border-red-500/60 text-red-600'
}

export default function Toaster(): JSX.Element {
  const { toasts, remove } = useUi()
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-panel/95 px-4 py-3 text-sm shadow-xl backdrop-blur ${COLOR[t.kind]}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 whitespace-pre-wrap leading-relaxed">{t.text}</span>
            <button onClick={() => remove(t.id)} className="text-muted hover:text-slate-900">
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
