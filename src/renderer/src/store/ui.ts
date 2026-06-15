import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface UiState {
  toasts: Toast[]
  push: (kind: ToastKind, text: string) => void
  remove: (id: number) => void
}

let seq = 0
export const useUi = create<UiState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    seq += 1
    const id = seq
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = {
  info: (t: string) => useUi.getState().push('info', t),
  ok: (t: string) => useUi.getState().push('success', t),
  err: (t: string) => useUi.getState().push('error', t)
}
