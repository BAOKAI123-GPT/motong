import { ipcMain, dialog, shell, app, clipboard, BrowserWindow } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { configStore } from './store'
import { scanModels, chatComplete } from './relay'
import type { ChatMsg } from './relay'
import { convertFile, targetsForExt, libreofficeAvailable } from './engine/convert'
import { previewTable, splitTable } from './engine/table'
import { mergePdfs, pdfPageCount, splitEachPage, parsePageRanges, extractPages } from './engine/pdf'
import { extractPlaceholders, renderTemplate } from './engine/template'
import { aiFillTemplate } from './engine/aifill'
import { runAgent } from './agent/loop'
import { dropConv } from './agent/filecache'
import { addMemory, addFileMemory } from './memory'
import { syncPull, pushMemories, pushInfo } from './sync'
import { libreOfficeStatus, installLibreOffice } from './plugins'
import * as account from './account'
import type {
  RelayProfileInput,
  AppSettings,
  InfoEntry,
  ConvertRequest,
  ConvertResult,
  TableSplitRequest,
  TableSplitResult,
  DroppedFile,
  TargetFormat,
  PdfInfo,
  SavedFileResult,
  SavedDirResult,
  TemplateExtractResult,
  AiFillResponse,
  AgentSendInput,
  AgentSendResult,
  GeneratedFilePayload
} from '../shared/types'

function winFrom(e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined
}

function decode(file: DroppedFile): Buffer {
  return Buffer.from(file.base64, 'base64')
}

function stem(name: string): string {
  return basename(name, extname(name)) || 'file'
}

function extLower(name: string): string {
  return extname(name).slice(1).toLowerCase()
}

export function registerIpc(): void {
  // ---- 配置 / 中转站 ----
  ipcMain.handle('config:getProfiles', () => configStore.getProfiles())
  ipcMain.handle('config:saveProfile', (_e, input: RelayProfileInput) =>
    configStore.saveProfile(input)
  )
  ipcMain.handle('config:deleteProfile', (_e, id: string) => configStore.deleteProfile(id))
  ipcMain.handle('config:getActiveProfileId', () => configStore.getActiveProfileId())
  ipcMain.handle('config:setActiveProfileId', (_e, id: string) =>
    configStore.setActiveProfileId(id)
  )
  ipcMain.handle('config:getSettings', () => configStore.getSettings())
  ipcMain.handle('config:setSettings', (_e, patch: Partial<AppSettings>) =>
    configStore.setSettings(patch)
  )
  ipcMain.handle('config:encryptionAvailable', () => {
    try {
      return require('electron').safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  })

  ipcMain.handle('relay:scanModels', (_e, args: { baseUrl: string; apiKey: string }) =>
    scanModels(args.baseUrl, args.apiKey)
  )
  ipcMain.handle('relay:scanByProfile', (_e, id: string) => {
    const p = configStore.getRawProfile(id)
    if (!p) return { ok: false, models: [], error: '找不到该中转站配置' }
    return scanModels(p.baseUrl, p.apiKey)
  })
  ipcMain.handle('relay:chat', (_e, args: { profileId: string; messages: ChatMsg[] }) =>
    chatComplete(args.profileId, args.messages)
  )

  // ---- 信息库 ----
  ipcMain.handle('info:list', () => configStore.getInfoEntries())
  ipcMain.handle('info:save', (_e, entry: Omit<InfoEntry, 'id'> & { id?: string }) => {
    const r = configStore.saveInfoEntry(entry)
    pushInfo()
    return r
  })
  ipcMain.handle('info:delete', (_e, id: string) => {
    configStore.deleteInfoEntry(id)
    pushInfo()
  })

  // ---- 能力探测 ----
  ipcMain.handle('env:capabilities', () => ({
    libreoffice: libreofficeAvailable()
  }))
  ipcMain.handle('convert:targets', (_e, ext: string) => ({
    ext,
    targets: targetsForExt(ext),
    libreofficeAvailable: libreofficeAvailable()
  }))

  // ---- 可选插件：文档转换引擎（LibreOffice）按需下载 ----
  ipcMain.handle('plugin:loStatus', () => libreOfficeStatus())
  ipcMain.handle('plugin:loInstall', async (e) => {
    return installLibreOffice((p) => {
      if (!e.sender.isDestroyed()) e.sender.send('plugin:loProgress', p)
    })
  })

  // ---- 格式转换 ----
  ipcMain.handle('convert:run', async (e, req: ConvertRequest): Promise<ConvertResult> => {
    try {
      const buf = decode(req.file)
      const out = await convertFile(req.file.name, buf, req.target)
      const win = winFrom(e)
      const defaultPath = join(
        configStore.getSettings().lastExportDir || app.getPath('documents'),
        `${stem(req.file.name)}.${out.outExt}`
      )
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '保存转换结果',
        defaultPath,
        filters: [{ name: out.outExt.toUpperCase(), extensions: [out.outExt] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await writeFile(filePath, out.buffer)
      configStore.setSettings({ lastExportDir: join(filePath, '..') })
      return { ok: true, path: filePath, engine: out.engine }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  // ---- 表格拆分 ----
  ipcMain.handle('table:preview', (_e, args: { file: DroppedFile; headerRow: number }) =>
    previewTable(decode(args.file), args.headerRow, extLower(args.file.name))
  )

  ipcMain.handle('table:split', async (e, req: TableSplitRequest): Promise<TableSplitResult> => {
    try {
      const win = winFrom(e)
      const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
        title: '选择拆分结果的保存文件夹',
        defaultPath: configStore.getSettings().lastExportDir || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (canceled || !filePaths[0]) return { ok: false, canceled: true }
      const base = stem(req.file.name)
      const outDir = join(filePaths[0], `${base}-拆分`)
      await mkdir(outDir, { recursive: true })
      const count = await splitTable(
        decode(req.file),
        {
          headerRow: req.headerRow,
          rowsPerFile: req.rowsPerFile,
          outFormat: req.outFormat,
          nameColumn: req.nameColumn
        },
        outDir,
        base,
        extLower(req.file.name)
      )
      configStore.setSettings({ lastExportDir: filePaths[0] })
      return { ok: true, dir: outDir, count }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  // ---- PDF 工具 ----
  ipcMain.handle('pdf:info', async (_e, file: DroppedFile): Promise<PdfInfo> => {
    try {
      return { ok: true, pages: await pdfPageCount(decode(file)) }
    } catch (err: any) {
      return { ok: false, error: `不是有效的 PDF：${err?.message ?? err}` }
    }
  })

  ipcMain.handle('pdf:merge', async (e, files: DroppedFile[]): Promise<SavedFileResult> => {
    try {
      if (!files || files.length < 2) return { ok: false, error: '请至少选择 2 个 PDF' }
      const merged = await mergePdfs(files.map(decode))
      const win = winFrom(e)
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '保存合并后的 PDF',
        defaultPath: join(
          configStore.getSettings().lastExportDir || app.getPath('documents'),
          '合并结果.pdf'
        ),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await writeFile(filePath, merged)
      configStore.setSettings({ lastExportDir: join(filePath, '..') })
      return { ok: true, path: filePath }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  ipcMain.handle('pdf:splitEach', async (e, file: DroppedFile): Promise<SavedDirResult> => {
    try {
      const parts = await splitEachPage(decode(file))
      const win = winFrom(e)
      const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
        title: '选择保存文件夹',
        defaultPath: configStore.getSettings().lastExportDir || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (canceled || !filePaths[0]) return { ok: false, canceled: true }
      const base = stem(file.name)
      const outDir = join(filePaths[0], `${base}-分页`)
      await mkdir(outDir, { recursive: true })
      for (const p of parts) {
        await writeFile(join(outDir, `${base}-第${String(p.page).padStart(3, '0')}页.pdf`), p.buffer)
      }
      configStore.setSettings({ lastExportDir: filePaths[0] })
      return { ok: true, dir: outDir, count: parts.length }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  ipcMain.handle(
    'pdf:extract',
    async (e, args: { file: DroppedFile; ranges: string }): Promise<SavedFileResult> => {
      try {
        const buf = decode(args.file)
        const total = await pdfPageCount(buf)
        const indices = parsePageRanges(args.ranges, total)
        const out = await extractPages(buf, indices)
        const win = winFrom(e)
        const { canceled, filePath } = await dialog.showSaveDialog(win!, {
          title: '保存提取的页面',
          defaultPath: join(
            configStore.getSettings().lastExportDir || app.getPath('documents'),
            `${stem(args.file.name)}-提取页.pdf`
          ),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (canceled || !filePath) return { ok: false, canceled: true }
        await writeFile(filePath, out)
        configStore.setSettings({ lastExportDir: join(filePath, '..') })
        return { ok: true, path: filePath }
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) }
      }
    }
  )

  // ---- 模板自动填充 ----
  ipcMain.handle('template:extract', async (_e, file: DroppedFile): Promise<TemplateExtractResult> => {
    try {
      const ext = extLower(file.name)
      if (ext !== 'docx' && ext !== 'xlsx') {
        return { ok: false, error: '模板填充目前支持 Word(.docx) 和 Excel(.xlsx)，请用其中之一' }
      }
      const { type, placeholders } = await extractPlaceholders(ext, decode(file))
      if (placeholders.length === 0) {
        return {
          ok: false,
          error: '没找到占位符。请在模板里用 {{字段名}} 标出要填写的位置，例如 {{公司名称}}'
        }
      }
      // 信息库同名字段预填
      const info = configStore.getInfoEntries()
      const prefill: Record<string, string> = {}
      for (const p of placeholders) {
        const hit = info.find((e) => e.label === p || e.label.trim() === p.trim())
        if (hit) prefill[p] = hit.value
      }
      return { ok: true, type, placeholders, prefill }
    } catch (err: any) {
      return { ok: false, error: `读取模板失败：${err?.message ?? err}` }
    }
  })

  ipcMain.handle(
    'template:aiFill',
    async (
      _e,
      args: { profileId: string; placeholders: string[]; description: string }
    ): Promise<AiFillResponse> => {
      const info = configStore.getInfoEntries()
      return aiFillTemplate(args.profileId, args.placeholders, info, args.description)
    }
  )

  ipcMain.handle(
    'template:render',
    async (
      e,
      args: { file: DroppedFile; mapping: Record<string, string> }
    ): Promise<SavedFileResult> => {
      try {
        const ext = extLower(args.file.name)
        const out = await renderTemplate(ext, decode(args.file), args.mapping)
        const win = winFrom(e)
        const { canceled, filePath } = await dialog.showSaveDialog(win!, {
          title: '保存填好的文件',
          defaultPath: join(
            configStore.getSettings().lastExportDir || app.getPath('documents'),
            `${stem(args.file.name)}-已填写.${ext}`
          ),
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
        })
        if (canceled || !filePath) return { ok: false, canceled: true }
        await writeFile(filePath, out)
        configStore.setSettings({ lastExportDir: join(filePath, '..') })
        return { ok: true, path: filePath }
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) }
      }
    }
  )

  // ---- 账号（手机登录，对接后端）----
  ipcMain.handle('auth:status', () => ({ loggedIn: account.isLoggedIn(), phone: account.getPhone() }))
  ipcMain.handle('auth:sendCode', (_e, phone: string) => account.sendCode(phone))
  ipcMain.handle('auth:login', async (_e, args: { phone: string; code: string }) => {
    const r = await account.login(args.phone, args.code)
    if (r.ok) await syncPull()
    return r
  })
  ipcMain.handle('auth:logout', () => {
    account.logout()
    return { ok: true }
  })
  ipcMain.handle('ws:me', () => account.me())
  ipcMain.handle('ws:tiers', () => account.tiers())
  ipcMain.handle('ws:payCreate', (_e, tier: string) => account.payCreate(tier))
  ipcMain.handle('ws:payStatus', (_e, outTradeNo: string) => account.payStatus(outTradeNo))
  ipcMain.handle('app:version', () => account.appVersion())
  // 启动版本检测：后端最新版本号与本机版本比对，不是最新则提示去官网更新
  ipcMain.handle('app:checkUpdate', async () => {
    const current = app.getVersion()
    const url = `${account.API_BASE}/wenshu/download`
    const newer = (a: string, b: string): boolean => {
      const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
      const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0
        const y = pb[i] || 0
        if (x !== y) return x > y
      }
      return false
    }
    try {
      const r = await account.appVersion()
      const latest = (r.data?.version as string) || current
      return {
        current,
        latest,
        needUpdate: newer(latest, current),
        notes: (r.data?.notes as string) || '',
        forceUpdate: !!r.data?.forceUpdate,
        url
      }
    } catch {
      return { current, latest: current, needUpdate: false, notes: '', forceUpdate: false, url }
    }
  })

  // ---- 对话式智能体 ----
  ipcMain.handle('agent:send', async (e, input: AgentSendInput): Promise<AgentSendResult> => {
    if (!account.isLoggedIn()) return { ok: false, needLogin: true, error: '请先登录' }
    const onProgress = (msg: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('agent:progress', msg)
    }
    try {
      return await runAgent(input, onProgress)
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  // 删除对话时释放该会话的文件缓存（内存）
  ipcMain.handle('agent:dropConv', (_e, convId: string) => {
    dropConv(convId)
    return { ok: true }
  })

  // 保存生成的文件（base64）到用户选择的位置
  ipcMain.handle(
    'file:save',
    async (e, args: GeneratedFilePayload): Promise<SavedFileResult> => {
      const win = winFrom(e)
      const ext = extname(args.name).slice(1) || 'bin'
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '保存文件',
        defaultPath: join(
          configStore.getSettings().lastExportDir || app.getPath('documents'),
          args.name
        ),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await writeFile(filePath, Buffer.from(args.base64, 'base64'))
      configStore.setSettings({ lastExportDir: join(filePath, '..') })
      return { ok: true, path: filePath }
    }
  )

  // ---- 长期记忆 ----
  ipcMain.handle('memory:list', () => configStore.getMemories())
  ipcMain.handle('memory:add', async (_e, args: { text: string; source?: 'message' | 'note' }) => {
    await addMemory(args.text, args.source || 'message')
    pushMemories()
    return configStore.getMemories()
  })
  ipcMain.handle('memory:addFile', async (_e, file: DroppedFile) => {
    await addFileMemory(file.name, decode(file))
    pushMemories()
    return configStore.getMemories()
  })
  ipcMain.handle('memory:delete', (_e, id: string) => {
    configStore.deleteMemory(id)
    pushMemories()
    return configStore.getMemories()
  })
  ipcMain.handle('memory:clear', () => {
    configStore.clearMemories()
    pushMemories()
    return []
  })

  // ---- 剪贴板 ----
  ipcMain.handle('system:copyText', (_e, text: string) => {
    clipboard.writeText(text || '')
    return true
  })

  // ---- 打开文件夹 / 文件 ----
  ipcMain.handle('system:revealPath', (_e, p: string) => {
    shell.showItemInFolder(p)
  })
  ipcMain.handle('system:openPath', (_e, p: string) => shell.openPath(p))
  // 在系统默认浏览器打开外部网址（用于「去官网更新」）
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}
