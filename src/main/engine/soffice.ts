import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, extname } from 'node:path'

/**
 * 定位 LibreOffice 可执行文件。
 * Windows 安装路径固定；Linux/Mac 走 PATH 里的 soffice。
 * 打包后也可把便携版放进 resources，再在这里补一条候选路径。
 */
let cachedPath: string | null | undefined
export function findSoffice(): string | null {
  if (cachedPath !== undefined) return cachedPath
  const isWin = process.platform === 'win32'
  const exe = isWin ? 'soffice.exe' : 'soffice'

  // 1) 优先用打包进安装包的便携版（resources/libreoffice/program/soffice）
  const bundled: string[] = []
  if (process.resourcesPath) {
    bundled.push(join(process.resourcesPath, 'libreoffice', 'program', exe))
  }

  // 2) 退回本机安装的 LibreOffice
  const system =
    isWin
      ? [
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
        ]
      : process.platform === 'darwin'
        ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice']
        : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice']

  cachedPath = [...bundled, ...system].find((p) => existsSync(p)) ?? null
  return cachedPath
}

export function libreofficeAvailable(): boolean {
  // win32 下即使没装也允许调用前再判断；这里只看本机是否能找到
  return process.platform === 'win32' ? findSoffice() !== null : findSoffice() !== null
}

/**
 * 用 LibreOffice 无界面把 inputPath 转换成 target 格式，返回生成文件路径。
 * 用独立的 UserInstallation 目录，避免与用户已打开的 LibreOffice 抢进程锁。
 */
export async function sofficeConvert(
  inputPath: string,
  target: string,
  profileDir: string
): Promise<string> {
  const soffice = findSoffice()
  if (!soffice) {
    throw new Error(
      '没有找到 LibreOffice。文档/PDF 类转换需要它，请先安装 LibreOffice（免费）后重试。'
    )
  }
  const outDir = await mkdtemp(join(tmpdir(), 'wenshu-out-'))
  const filter = LO_FILTERS[target] ?? target
  const args = [
    '--headless',
    '--norestore',
    '--invisible',
    `-env:UserInstallation=file://${profileDir}`,
    '--convert-to',
    filter,
    '--outdir',
    outDir,
    inputPath
  ]
  await new Promise<void>((resolve, reject) => {
    execFile(soffice, args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`LibreOffice 转换失败：${stderr || err.message}`))
      else resolve()
    })
  })
  const produced = await readdir(outDir)
  const want = basename(inputPath, extname(inputPath)) + '.' + target.split(':')[0]
  const hit = produced.includes(want) ? want : produced[0]
  if (!hit) throw new Error('LibreOffice 没有产出文件（可能源文件格式不被支持）')
  return join(outDir, hit)
}

/** 部分目标格式需要显式 filter 名，否则 LibreOffice 可能选错过滤器 */
const LO_FILTERS: Record<string, string> = {
  docx: 'docx:MS Word 2007 XML',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  csv: 'csv:Text - txt - csv (StarCalc)',
  txt: 'txt:Text',
  html: 'html'
}
