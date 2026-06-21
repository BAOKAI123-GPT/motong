import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, statSync, createWriteStream } from 'node:fs'
import { mkdir, rm, readdir, rename, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { findSoffice, resetSofficeCache } from './engine/soffice'

/**
 * 可选插件管理：目前只有「文档转换引擎（LibreOffice）」。
 * 安装包瘦身后不再内置 LibreOffice，改成装完 App 后从这里按需下载，
 * 解压到用户数据目录的 libreoffice/，供 soffice.ts 的 findSoffice() 探测。
 */

// LibreOffice 官方 stable msi（Windows x86-64），约 350MB
const LO_VERSION = '25.8.7'
const LO_MSI_URL = `https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}/win/x86_64/LibreOffice_${LO_VERSION}_Win_x86-64.msi`

export interface LoStatus {
  installed: boolean
  path: string | null
}

export function libreOfficeStatus(): LoStatus {
  const path = findSoffice()
  return { installed: path !== null, path }
}

export interface InstallProgress {
  phase: 'download' | 'extract' | 'done'
  percent?: number
}

export interface InstallResult {
  ok: boolean
  error?: string
}

/** 在目录树里递归找第一个 soffice.exe，返回绝对路径或 null */
async function findSofficeExe(dir: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  for (const name of names) {
    const full = join(dir, name)
    if (name.toLowerCase() === 'soffice.exe') return full
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      isDir = false
    }
    if (isDir) {
      const hit = await findSofficeExe(full)
      if (hit) return hit
    }
  }
  return null
}

/** msiexec 管理员解压（/a），不真正安装、不写注册表，纯解出文件 */
function msiAdminExtract(msiPath: string, targetDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      'msiexec',
      ['/a', msiPath, '/qn', `TARGETDIR=${targetDir}`],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve()
      }
    )
  })
}

/**
 * 按需下载并安装 LibreOffice 文档转换引擎。
 * 非 Windows 直接拒绝（让用户去官网手动装）。Windows 流程：
 *   下载 msi（流式 + content-length 上报百分比）→ msiexec /a 解压 → 找 soffice.exe
 *   → 取 LibreOffice 根目录拷到 userData/libreoffice → 清理临时文件 → 重探测 → 校验。
 */
export async function installLibreOffice(
  onProgress: (p: InstallProgress) => void
): Promise<InstallResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: '当前系统请到 libreoffice.org 手动安装 LibreOffice' }
  }

  const userData = app.getPath('userData')
  const msiPath = join(userData, 'lo.msi')
  const extractDir = join(userData, 'lo_extract')
  const installDir = join(userData, 'libreoffice')

  // 失败/成功后都要清理的临时文件
  const cleanup = async (): Promise<void> => {
    await rm(msiPath, { force: true }).catch(() => {})
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    // 1) 下载 msi（流式写盘 + 百分比上报）
    await rm(msiPath, { force: true }).catch(() => {})
    const resp = await fetch(LO_MSI_URL)
    if (!resp.ok || !resp.body) {
      throw new Error(`下载失败（HTTP ${resp.status}），请检查网络后重试`)
    }
    const total = Number(resp.headers.get('content-length')) || 0
    let received = 0
    onProgress({ phase: 'download', percent: 0 })

    const webStream = resp.body as ReadableStream<Uint8Array>
    const nodeStream = Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) {
        onProgress({ phase: 'download', percent: Math.min(99, Math.round((received / total) * 100)) })
      }
    })
    await pipeline(nodeStream, createWriteStream(msiPath))
    onProgress({ phase: 'download', percent: 100 })

    // 2) 管理员解压（不写注册表的纯解包）
    onProgress({ phase: 'extract' })
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(extractDir, { recursive: true })
    await msiAdminExtract(msiPath, extractDir)

    // 3) 找 soffice.exe，取它 program 目录的上一级 = LibreOffice 根
    const sofficeExe = await findSofficeExe(extractDir)
    if (!sofficeExe) throw new Error('解压后没有找到 soffice.exe，安装包可能损坏')
    const loRoot = join(sofficeExe, '..', '..') // …/program/soffice.exe → LibreOffice 根

    // 4) 落到 userData/libreoffice（已存在先删）。同盘优先 rename，跨盘退回 cp。
    await rm(installDir, { recursive: true, force: true }).catch(() => {})
    try {
      await rename(loRoot, installDir)
    } catch {
      await cp(loRoot, installDir, { recursive: true })
    }

    // 5) 清理临时文件、重探测、校验
    await cleanup()
    resetSofficeCache()
    if (!existsSync(join(installDir, 'program', 'soffice.exe'))) {
      throw new Error('安装校验失败：未在目标目录找到 soffice.exe')
    }
    onProgress({ phase: 'done', percent: 100 })
    return { ok: true }
  } catch (err: unknown) {
    await cleanup()
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg || '安装过程中出现未知错误' }
  }
}
