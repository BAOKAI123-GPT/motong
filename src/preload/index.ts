import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  InfoEntry,
  MemoryEntry,
  RelayProfile,
  RelayProfileInput,
  ScanModelsResult,
  ConvertRequest,
  ConvertResult,
  TablePreview,
  TableSplitRequest,
  TableSplitResult,
  DroppedFile,
  TargetFormat,
  ConvertOptions,
  PdfInfo,
  SavedFileResult,
  SavedDirResult,
  TemplateExtractResult,
  AiFillResponse,
  AgentSendInput,
  AgentSendResult,
  GeneratedFilePayload,
  AuthState,
  WsQuota,
  WsTier
} from '../shared/types'

interface ApiResult<T = any> {
  ok: boolean
  status: number
  data: T
}

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LoStatus {
  installed: boolean
  path: string | null
}

interface LoProgress {
  phase: 'download' | 'extract' | 'done'
  percent?: number
}

interface LoInstallResult {
  ok: boolean
  error?: string
}

const api = {
  config: {
    getProfiles: (): Promise<RelayProfile[]> => ipcRenderer.invoke('config:getProfiles'),
    saveProfile: (input: RelayProfileInput): Promise<RelayProfile> =>
      ipcRenderer.invoke('config:saveProfile', input),
    deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke('config:deleteProfile', id),
    getActiveProfileId: (): Promise<string | undefined> =>
      ipcRenderer.invoke('config:getActiveProfileId'),
    setActiveProfileId: (id: string): Promise<void> =>
      ipcRenderer.invoke('config:setActiveProfileId', id),
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('config:getSettings'),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('config:setSettings', patch),
    encryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke('config:encryptionAvailable')
  },
  relay: {
    scanModels: (args: { baseUrl: string; apiKey: string }): Promise<ScanModelsResult> =>
      ipcRenderer.invoke('relay:scanModels', args),
    scanByProfile: (id: string): Promise<ScanModelsResult> =>
      ipcRenderer.invoke('relay:scanByProfile', id),
    chat: (args: { profileId: string; messages: ChatMsg[] }): Promise<{
      ok: boolean
      text?: string
      error?: string
    }> => ipcRenderer.invoke('relay:chat', args)
  },
  info: {
    list: (): Promise<InfoEntry[]> => ipcRenderer.invoke('info:list'),
    save: (entry: Omit<InfoEntry, 'id'> & { id?: string }): Promise<InfoEntry> =>
      ipcRenderer.invoke('info:save', entry),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('info:delete', id)
  },
  env: {
    capabilities: (): Promise<{ libreoffice: boolean }> =>
      ipcRenderer.invoke('env:capabilities')
  },
  convert: {
    targets: (ext: string): Promise<ConvertOptions> => ipcRenderer.invoke('convert:targets', ext),
    run: (req: ConvertRequest): Promise<ConvertResult> => ipcRenderer.invoke('convert:run', req)
  },
  table: {
    preview: (args: { file: DroppedFile; headerRow: number }): Promise<TablePreview> =>
      ipcRenderer.invoke('table:preview', args),
    split: (req: TableSplitRequest): Promise<TableSplitResult> =>
      ipcRenderer.invoke('table:split', req)
  },
  pdf: {
    info: (file: DroppedFile): Promise<PdfInfo> => ipcRenderer.invoke('pdf:info', file),
    merge: (files: DroppedFile[]): Promise<SavedFileResult> =>
      ipcRenderer.invoke('pdf:merge', files),
    splitEach: (file: DroppedFile): Promise<SavedDirResult> =>
      ipcRenderer.invoke('pdf:splitEach', file),
    extract: (args: { file: DroppedFile; ranges: string }): Promise<SavedFileResult> =>
      ipcRenderer.invoke('pdf:extract', args)
  },
  template: {
    extract: (file: DroppedFile): Promise<TemplateExtractResult> =>
      ipcRenderer.invoke('template:extract', file),
    aiFill: (args: {
      profileId: string
      placeholders: string[]
      description: string
    }): Promise<AiFillResponse> => ipcRenderer.invoke('template:aiFill', args),
    render: (args: { file: DroppedFile; mapping: Record<string, string> }): Promise<SavedFileResult> =>
      ipcRenderer.invoke('template:render', args)
  },
  agent: {
    send: (input: AgentSendInput): Promise<AgentSendResult> =>
      ipcRenderer.invoke('agent:send', input),
    /** 删除对话时通知主进程释放该会话的文件缓存 */
    dropConv: (convId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:dropConv', convId),
    /** 订阅 AI 处理进度，返回取消订阅函数 */
    onProgress: (cb: (msg: string) => void): (() => void) => {
      const listener = (_e: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('agent:progress', listener)
      return () => ipcRenderer.removeListener('agent:progress', listener)
    }
  },
  file: {
    save: (args: GeneratedFilePayload): Promise<SavedFileResult> =>
      ipcRenderer.invoke('file:save', args)
  },
  plugin: {
    /** 查询文档转换引擎（LibreOffice）是否已安装 */
    loStatus: (): Promise<LoStatus> => ipcRenderer.invoke('plugin:loStatus'),
    /** 按需下载并安装文档转换引擎，返回最终结果 */
    loInstall: (): Promise<LoInstallResult> => ipcRenderer.invoke('plugin:loInstall'),
    /** 订阅安装进度，返回取消订阅函数 */
    onLoProgress: (cb: (p: LoProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: LoProgress): void => cb(p)
      ipcRenderer.on('plugin:loProgress', listener)
      return () => ipcRenderer.removeListener('plugin:loProgress', listener)
    }
  },
  memory: {
    list: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:list'),
    add: (args: { text: string; source?: 'message' | 'note' }): Promise<MemoryEntry[]> =>
      ipcRenderer.invoke('memory:add', args),
    addFile: (file: DroppedFile): Promise<MemoryEntry[]> =>
      ipcRenderer.invoke('memory:addFile', file),
    delete: (id: string): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:delete', id),
    clear: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:clear')
  },
  auth: {
    status: (): Promise<AuthState> => ipcRenderer.invoke('auth:status'),
    sendCode: (phone: string): Promise<ApiResult> => ipcRenderer.invoke('auth:sendCode', phone),
    login: (phone: string, code: string): Promise<ApiResult<{ ok?: boolean; token?: string; error?: string }>> =>
      ipcRenderer.invoke('auth:login', { phone, code }),
    logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:logout')
  },
  ws: {
    me: (): Promise<ApiResult<WsQuota & { error?: string }>> => ipcRenderer.invoke('ws:me'),
    tiers: (): Promise<ApiResult<{ tiers: WsTier[] }>> => ipcRenderer.invoke('ws:tiers'),
    payCreate: (tier: string): Promise<ApiResult<{ qrImg?: string; payUrl?: string; outTradeNo?: string; amount?: string; error?: string }>> =>
      ipcRenderer.invoke('ws:payCreate', tier),
    payStatus: (outTradeNo: string): Promise<ApiResult<{ paid?: boolean; status?: string }>> =>
      ipcRenderer.invoke('ws:payStatus', outTradeNo)
  },
  system: {
    copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('system:copyText', text),
    revealPath: (p: string): Promise<void> => ipcRenderer.invoke('system:revealPath', p),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('system:openPath', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url)
  },
  app: {
    checkUpdate: (): Promise<{
      current: string
      latest: string
      needUpdate: boolean
      notes: string
      forceUpdate: boolean
      url: string
    }> => ipcRenderer.invoke('app:checkUpdate')
  }
}

export type WenshuApi = typeof api

// 让类型工具知道 TargetFormat 被引用（供渲染层从 d.ts 复用）
export type { TargetFormat }

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore fallback
  window.api = api
}
