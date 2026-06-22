import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCog,
  Library,
  Loader2,
  Sparkles
} from 'lucide-react'
import type { ViewId } from '../App'

type Status = 'builtin' | 'integrated' | 'planned' | 'external'

interface Tool {
  name: string
  desc: string
  license: string
  status: Status
  /** 内置工具：点击跳转的视图 */
  open?: ViewId
  /** 外部项目主页 */
  url?: string
}

interface Group {
  title: string
  note?: string
  tools: Tool[]
}

const CATALOG: Group[] = [
  {
    title: '开箱即用（已内置本软件）',
    tools: [
      {
        name: '格式转换',
        desc: 'Word / Excel / PDF / CSV / WPS 等互转；表格族纯本地，文档族走 LibreOffice。',
        license: 'SheetJS · LibreOffice',
        status: 'builtin',
        open: 'convert'
      },
      {
        name: '表格拆分',
        desc: '产品明细按条目拆成独立表格，自动带表头，支持单条单文件打印。',
        license: 'SheetJS',
        status: 'builtin',
        open: 'split'
      },
      {
        name: 'PDF 工具',
        desc: '多个 PDF 合并、按页拆分、按页码提取，全部本地处理。',
        license: 'pdf-lib (MIT)',
        status: 'builtin',
        open: 'pdftools'
      },
      {
        name: '模板自动填充',
        desc: '模板用 {{字段}} 占位，信息库预填 + 中转站 AI 结合需求描述补齐，缺项高亮。',
        license: 'jszip · 中转站 AI',
        status: 'builtin',
        open: 'template'
      },
      {
        name: '信息库',
        desc: '企业固定信息（公司/联系人/产品）本地存储、分类调用，模板填充直接取用。',
        license: '本地存储',
        status: 'builtin',
        open: 'info'
      }
    ]
  },
  {
    title: 'AI 智能能力 · 聊天里直接说就行',
    note: '在文员对话里直接描述需求，墨童会自动判断并使用对应能力，无需在此点开。',
    tools: [
      {
        name: '多语种翻译 / 多语对照',
        desc: '中文⇄英文 / 阿拉伯语等多语种翻译；可把整张表格的产品名等批量翻成「中 / 英 / 阿」三语对照表并导出（含 PDF，阿语自动右对齐）。',
        license: 'gpt-4o · 内置',
        status: 'builtin'
      },
      {
        name: '合同 / 法务审查',
        desc: '上传外贸购销 / 采购 / 服务 / 租赁 / 劳动 / 保密(NDA) 等合同，按审查要点逐条找缺失项、风险(高/中/低)与修改建议。',
        license: '内置审查要点',
        status: 'builtin'
      },
      {
        name: '办公文书写作',
        desc: '通知 / 公告 / 会议纪要 / 规章制度 / 商务函件 / 工作总结等，按公文规范撰写，可导出 Word / PDF。',
        license: 'gpt-4o · 内置',
        status: 'builtin'
      },
      {
        name: '聊天记录 / 截图识别',
        desc: '上传聊天记录截图或单据照片，逐字转录金额 / 数量 / 规格 / 单号后据此处理，不臆造数字。',
        license: '视觉模型 · 内置',
        status: 'builtin'
      },
      {
        name: 'PPT 一键制作',
        desc: '说清主题与要求，自动生成可编辑 .pptx（封面 / 要点 / 参考文献页）；参考文献联网查证真实来源、配图自动联网并标注出处。',
        license: 'gpt-4o + 联网 · 内置',
        status: 'builtin'
      },
      {
        name: '办公文档格式标准化',
        desc: '上传 Word / Excel + 一套格式规范（或模板文件），一键统一字体 / 字号 / 行距 / 页边距 / 标题 / 表头边框；会回报已应用与需复核项。',
        license: '内置 · 样式层标准化',
        status: 'builtin'
      }
    ]
  },
  {
    title: 'PDF 增强 · 开源社区精选',
    note: '想要更强的 PDF 能力（OCR、压缩、签章、可视化重排）可引入这些口碑项目。',
    tools: [
      {
        name: 'Stirling-PDF',
        desc: '自托管的 PDF 全能工具箱，50+ 操作：转换、压缩、OCR、加水印、签章、拆分合并。',
        license: 'MIT · 需 Docker 自托管',
        status: 'external',
        url: 'https://github.com/Stirling-Tools/Stirling-PDF'
      },
      {
        name: 'PDF Arranger',
        desc: '可视化拖拽：合并、重排、删页、旋转、裁剪，适合手动整理扫描件。',
        license: 'GPLv3 · 桌面安装',
        status: 'external',
        url: 'https://github.com/pdfarranger/pdfarranger'
      },
      {
        name: 'PDFsam Basic',
        desc: '专注合并 / 拆分 / 混合 / 提取页，老牌稳定。',
        license: 'AGPL · 桌面安装',
        status: 'external',
        url: 'https://github.com/torakiki/pdfsam'
      },
      {
        name: 'qpdf',
        desc: '命令行：PDF 压缩瘦身、线性化、解密、结构修复，可作为后端能力接入。',
        license: 'Apache-2.0 · CLI',
        status: 'external',
        url: 'https://github.com/qpdf/qpdf'
      }
    ]
  },
  {
    title: '文档转换 · 开源社区精选',
    tools: [
      {
        name: 'Pandoc',
        desc: '通用文档转换神器：Markdown ↔ Word ↔ PDF ↔ HTML ↔ LaTeX，结构不丢。',
        license: 'GPLv2 · 可启用',
        status: 'planned',
        url: 'https://github.com/jgm/pandoc'
      },
      {
        name: 'MarkItDown（微软）',
        desc: '把任意文件转成 Markdown，特别适合把文档喂给大模型做理解/摘要。',
        license: 'MIT · 需 Python',
        status: 'external',
        url: 'https://github.com/microsoft/markitdown'
      }
    ]
  },
  {
    title: 'OCR 文字识别 · 开源社区精选',
    note: '用于把聊天记录截图、扫描件、纸质单据转成可编辑文字——正好配合「聊天记录解析」。',
    tools: [
      {
        name: 'Umi-OCR',
        desc: '离线免费、可批量；支持表格还原、二维码、公式，Windows 友好（36k★，基于 PaddleOCR）。',
        license: 'MIT · 桌面安装',
        status: 'external',
        url: 'https://github.com/hiroi-sora/Umi-OCR'
      },
      {
        name: 'PaddleOCR',
        desc: '工业级 OCR 引擎，中文识别强，可作为后端服务集成。',
        license: 'Apache-2.0 · 后端集成',
        status: 'planned',
        url: 'https://github.com/PaddlePaddle/PaddleOCR'
      },
      {
        name: 'Tesseract OCR',
        desc: '经典开源 OCR，支持上百种语言，社区生态成熟。',
        license: 'Apache-2.0 · CLI/库',
        status: 'external',
        url: 'https://github.com/tesseract-ocr/tesseract'
      }
    ]
  }
]

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  builtin: { label: '已内置', cls: 'bg-brand2/15 text-emerald-600 border-brand2/40' },
  integrated: { label: '已集成·需本机', cls: 'bg-brand/15 text-blue-700 border-brand/40' },
  planned: { label: '规划中', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/40' },
  external: { label: '外部开源', cls: 'bg-black/[0.05] text-slate-600 border-edge' }
}

const isWindows = (): boolean =>
  typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '')

/** 文档转换引擎（LibreOffice）按需下载卡：进入时查状态，可下载安装并显示进度。 */
function LibreOfficePluginCard(): JSX.Element {
  const win = isWindows()
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [phase, setPhase] = useState<'download' | 'extract' | 'done' | null>(null)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    window.api.plugin
      .loStatus()
      .then((s) => alive && setInstalled(s.installed))
      .catch(() => alive && setInstalled(false))
    return () => {
      alive = false
    }
  }, [])

  async function handleInstall(): Promise<void> {
    setError('')
    setInstalling(true)
    setPhase('download')
    setPercent(0)
    const off = window.api.plugin.onLoProgress((p) => {
      setPhase(p.phase)
      if (typeof p.percent === 'number') setPercent(p.percent)
    })
    try {
      const r = await window.api.plugin.loInstall()
      if (r.ok) {
        setInstalled(true)
        setPhase('done')
        setPercent(100)
      } else {
        setError(r.error || '安装失败')
        setPhase(null)
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setPhase(null)
    } finally {
      off()
      setInstalling(false)
    }
  }

  const phaseLabel =
    phase === 'download'
      ? `下载中 ${percent}%`
      : phase === 'extract'
        ? '解压安装中…'
        : phase === 'done'
          ? '已完成'
          : ''

  return (
    <div className="rounded-xl border border-brand/40 bg-brand/[0.06] p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <FileCog size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">文档转换引擎（LibreOffice）</h3>
            {installed === true && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand2/40 bg-brand2/15 px-2 py-0.5 text-[10px] text-emerald-600">
                <CheckCircle2 size={11} /> 已安装
              </span>
            )}
            {installed === false && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700">
                未安装
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            用于 Word/PDF/PPT 等文档转换与导出，约 350MB，按需下载一次即可，不再随安装包附带。
          </p>

          {!win ? (
            <p className="mt-3 text-xs text-slate-600">
              当前系统请到{' '}
              <a
                href="https://www.libreoffice.org/"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                libreoffice.org
              </a>{' '}
              手动安装 LibreOffice。
            </p>
          ) : (
            <div className="mt-3">
              {!installing && installed !== true && (
                <button
                  onClick={handleInstall}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand/90"
                >
                  <Download size={14} /> 下载安装
                </button>
              )}

              {installed === true && !installing && (
                <button
                  onClick={handleInstall}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                >
                  <Download size={14} /> 重新安装
                </button>
              )}

              {installing && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-brand">
                    <Loader2 size={14} className="animate-spin" /> {phaseLabel}
                  </div>
                  {phase === 'download' && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08]">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResourceLibraryView({
  onOpen
}: {
  onOpen: (v: ViewId) => void
}): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center gap-2">
        <Library size={20} className="text-brand" />
        <h1 className="text-xl font-semibold">资源库</h1>
      </div>
      <p className="mt-1 text-sm text-muted">
        内置工具开箱即用；下面精选了一批开源社区口碑项目，可按需引入增强文书处理能力。点项目名进主页。
      </p>

      <div className="mt-6">
        <LibreOfficePluginCard />
      </div>

      <div className="mt-8 space-y-8">
        {CATALOG.map((group) => (
          <section key={group.title}>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles size={15} className="text-brand" />
              <h2 className="text-sm font-semibold text-slate-700">{group.title}</h2>
            </div>
            {group.note && <p className="mb-3 text-xs text-muted">{group.note}</p>}
            <div className="grid grid-cols-2 gap-3">
              {group.tools.map((t) => {
                const meta = STATUS_META[t.status]
                const clickable = !!t.open || !!t.url
                return (
                  <div
                    key={t.name}
                    className="flex flex-col rounded-xl border border-edge bg-panel/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{t.name}</div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted">{t.desc}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">{t.license}</span>
                      {t.open ? (
                        <button
                          onClick={() => onOpen(t.open!)}
                          className="flex items-center gap-1 text-xs text-brand hover:underline"
                        >
                          打开 <ArrowRight size={13} />
                        </button>
                      ) : t.url ? (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
                        >
                          项目主页 <ExternalLink size={12} />
                        </a>
                      ) : null}
                      {!clickable && <span />}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-muted">
        说明：标「已内置」的工具直接可用；「已集成·需本机」指本软件已对接、但要在电脑上装好对应程序（如
        LibreOffice）；「规划中」是下一步会接入的；「外部开源」是推荐你了解/单独部署的优秀项目。
      </p>
    </div>
  )
}
