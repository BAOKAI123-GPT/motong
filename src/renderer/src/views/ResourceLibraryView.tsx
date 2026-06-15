import { ArrowRight, ExternalLink, Library, Sparkles } from 'lucide-react'
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
        name: 'LibreOffice',
        desc: '本软件文档/PDF 转换的底层引擎；装上即可解锁 Word/PPT/WPS↔PDF 等全部文档族转换。',
        license: 'MPL-2.0 · 需本机安装',
        status: 'integrated',
        url: 'https://www.libreoffice.org/'
      },
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
