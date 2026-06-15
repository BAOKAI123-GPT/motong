import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import type { DroppedFile } from '@shared/types'
import { readDropped } from '../lib/files'
import { toast } from '../store/ui'

interface Props {
  onFile?: (file: DroppedFile) => void
  /** 多选模式：一次返回所有文件 */
  onFiles?: (files: DroppedFile[]) => void
  multiple?: boolean
  accept?: string
  hint?: string
  compact?: boolean
}

export default function DropZone({
  onFile,
  onFiles,
  multiple,
  accept,
  hint,
  compact
}: Props): JSX.Element {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    try {
      if (multiple || onFiles) {
        const all = await Promise.all(Array.from(files).map((f) => readDropped(f)))
        onFiles?.(all)
        if (!onFiles) all.forEach((f) => onFile?.(f))
      } else {
        onFile?.(await readDropped(files[0]))
      }
    } catch (e: any) {
      toast.err(`读取文件失败：${e?.message ?? e}`)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
        over ? 'border-brand bg-brand/10' : 'border-edge bg-panel/40 hover:border-brand/60'
      } ${compact ? 'gap-1 px-6 py-6' : 'gap-2 px-8 py-12'}`}
    >
      <UploadCloud size={compact ? 24 : 40} className={over ? 'text-brand' : 'text-muted'} />
      <div className={`font-medium ${compact ? 'text-sm' : 'text-base'}`}>
        把文件拖到这里，或点击选择
      </div>
      {hint && <div className="text-center text-xs text-muted">{hint}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  )
}
