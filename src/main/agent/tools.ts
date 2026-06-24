import JSZip from 'jszip'
import type { InfoEntry, TargetFormat } from '../../shared/types'
import { convertFile } from '../engine/convert'
import { createSpreadsheet, type SpreadsheetSpec } from '../engine/spreadsheet'
import { renderTemplate, extractPlaceholders } from '../engine/template'
import { splitTableToBuffers } from '../engine/table'
import { mergePdfs, splitEachPage, extractPages, parsePageRanges, pdfPageCount } from '../engine/pdf'
import { summarizeFile } from '../engine/filecontent'
import { extractSheet, previewSheet } from '../engine/sheet'
import { webSearch, fetchPageText } from '../engine/websearch'
import { CONTRACT_CHECKLIST } from '../engine/legal'
import { createPptx, type PptxSpec } from '../engine/pptx'
import { standardizeFormat, extractDocxStyles, type FormatSpec } from '../engine/format'
import { buildDocHtml, htmlToPdf, buildDocx, type DocSpec } from '../engine/document'

export interface AgentFile {
  id: string
  name: string
  buf: Buffer
}

export interface AgentCtx {
  files: Map<string, AgentFile>
  infoEntries: InfoEntry[]
  generated: AgentFile[]
  progress: (msg: string) => void
  _seq: number
}

function extOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}
function newId(ctx: AgentCtx): string {
  ctx._seq += 1
  return `g${ctx._seq}`
}
function register(ctx: AgentCtx, name: string, buf: Buffer): AgentFile {
  const f = { id: newId(ctx), name, buf }
  ctx.files.set(f.id, f)
  ctx.generated.push(f)
  return f
}
// 容错取文件：模型常把上传文件 id(u1) 误写成 f1/file1/1 或直接给文件名。
// 依次尝试：精确 → 大小写/空白 → 末尾数字同号(唯一) → 文件名(全等/包含) → 全场仅一个文件。
// 都不中才抛错，并把"当前可用文件清单"带回，引导模型用正确 id 重试（绝不让用户重新上传）。
function getFile(ctx: AgentCtx, id: string): AgentFile {
  const raw = String(id ?? '').trim()
  const exact = ctx.files.get(raw)
  if (exact) return exact
  const all = [...ctx.files.values()]
  const norm = raw.toLowerCase()
  for (const v of all) if (v.id.toLowerCase() === norm) return v
  const num = /(\d+)\s*$/.exec(raw)?.[1]
  if (num) {
    const cands = all.filter((v) => new RegExp(`${num}$`).test(v.id))
    if (cands.length === 1) return cands[0]
  }
  for (const v of all) if (v.name === raw || v.name.toLowerCase() === norm) return v
  if (norm.length >= 2) for (const v of all) if (v.name.toLowerCase().includes(norm)) return v
  if (all.length === 1) return all[0]
  const avail = all.map((v) => `${v.id}(${v.name})`).join('、') || '（当前没有任何文件）'
  throw new Error(`找不到文件 "${raw}"。当前可用文件：${avail}。请用清单里的确切 id 重试，不要让用户重新上传。`)
}
async function zipBuffers(files: { name: string; buffer: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.buffer)
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ---------------------------------------------------------------------------
// 工具定义（OpenAI function 格式）
// ---------------------------------------------------------------------------
export const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        '读取已上传或已生成文件的文字/表格内容。Excel 多工作表时，先看返回的工作表清单，再用 sheet_name 查看具体某张表的内容。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '文件 id：上传的文件以 u 开头(如 u1)、生成的文件以 g 开头(如 g1)；确切 id 见系统提示【对话中的文件】清单' },
          sheet_name: { type: 'string', description: '可选：要查看的工作表名（支持模糊匹配）' }
        },
        required: ['file_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_sheet',
      description:
        '把 Excel 里的某一张工作表抽取成独立的 xlsx 文件，并完整保留原表的合并单元格、边框、列宽等排版。常用于「把总表里的某个单据（如 送货单-箱件汇总）单独做成一个 Excel 发给客户」。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '源 Excel 文件 id' },
          sheet_name: { type: 'string', description: '要抽取的工作表名（支持模糊匹配，如 箱件汇总）' },
          out_name: { type: 'string', description: '输出文件名（不含扩展名），如 送货单-箱件汇总-合同XMXS-20260319-MTJX-ZW' }
        },
        required: ['file_id', 'sheet_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_company_info',
      description: '获取本企业信息库里录入的固定信息（公司名称、地址、联系人、银行、产品等），用于填写发货方/我方信息。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_spreadsheet',
      description:
        '按结构化数据生成专业表格（送货单/出货单/装箱单/对账单/报价单等），带标题、信息块、表头边框与合计行。需要 PDF 就在 outputs 里加 pdf。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '文件名（不含扩展名）' },
          title: { type: 'string', description: '顶部大标题，如 送货单' },
          infoLeft: { type: 'array', items: { type: 'string' }, description: '左栏信息行，如 发货方/单号' },
          infoRight: { type: 'array', items: { type: 'string' }, description: '右栏信息行，如 收货方/日期' },
          columns: {
            type: 'array',
            description: '表头列',
            items: {
              type: 'object',
              properties: { header: { type: 'string' }, width: { type: 'number' }, rtl: { type: 'boolean', description: '该列文字从右到左(阿拉伯语等)，设 true 则右对齐、RTL 阅读顺序；用于多语对照表的阿语列' } },
              required: ['header']
            }
          },
          rows: {
            type: 'array',
            description: '数据行，每行是按列顺序的值数组',
            items: { type: 'array', items: {} }
          },
          totalsRow: { type: 'array', items: {}, description: '合计行（可选）' },
          note: { type: 'string', description: '底部备注/签字行' },
          outputs: { type: 'array', items: { type: 'string', enum: ['xlsx', 'pdf'] } }
        },
        required: ['filename', 'columns', 'rows']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_document',
      description:
        '把你整理好的文字内容生成为可下载的正式文档（Word .docx 和/或 PDF）。用于"以文字段落为主"的文档：产品介绍/亮点、公司资料、通知公告、会议纪要、规章制度、商务函件、工作总结、方案说明等。PDF 由内置引擎直接渲染（中文正常、无需安装 LibreOffice）。注意：这是写"文章/文档"，不是表格单据——送货单/报价单/对账单等表格请用 create_spreadsheet。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '文件名（不含扩展名），如 产品亮点介绍' },
          title: { type: 'string', description: '文档大标题（居中显示在首行）' },
          formats: {
            type: 'array',
            items: { type: 'string', enum: ['pdf', 'docx'] },
            description: '要产出的格式，默认两种都给 ["pdf","docx"]'
          },
          blocks: {
            type: 'array',
            description: '文档内容块，按显示顺序排列',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['heading', 'paragraph', 'bullets', 'ordered', 'table', 'quote'],
                  description: 'heading=小标题 / paragraph=正文段落 / bullets=无序要点 / ordered=有序步骤 / table=表格 / quote=引用强调'
                },
                level: { type: 'number', description: 'heading 级别 1-3' },
                text: { type: 'string', description: 'heading/paragraph/quote 的文字（段内换行用 \\n）' },
                items: { type: 'array', items: { type: 'string' }, description: 'bullets/ordered 的条目数组' },
                headers: { type: 'array', items: { type: 'string' }, description: 'table 的表头' },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table 的数据行（每行一个字符串数组）' }
              },
              required: ['type']
            }
          }
        },
        required: ['filename', 'blocks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'convert_format',
      description:
        '把某个【已存在的文件】转换成另一种格式：Excel↔CSV/JSON/HTML、以及 Word/PDF/PPT/WPS 等互转（文档/PDF 类需要 LibreOffice）。注意：只能转换已上传/已生成的文件(需 file_id)；若是把你写的文字做成 Word/PDF，请用 create_document，不要用本工具。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          target: {
            type: 'string',
            enum: ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'html', 'json', 'odt', 'pptx']
          }
        },
        required: ['file_id', 'target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill_template',
      description:
        '把一个含 {{占位符}} 的 Word/Excel 模板按字段映射填好。常用于「把数据套进大厂要求的模板」。先用 read_file 看模板占位符，再给出 mapping。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '模板文件 id' },
          mapping: { type: 'object', description: '占位符到值的映射，如 {"公司名称":"XX公司"}' }
        },
        required: ['file_id', 'mapping']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'split_table',
      description: '把一个表格按条目拆成多个文件，打包成 zip 返回（用于单条单独打印）。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          header_row: { type: 'number', description: '表头在第几行（1 基），无表头填 0，默认 1' },
          rows_per_file: { type: 'number', description: '每个文件几条，默认 1' },
          out_format: { type: 'string', enum: ['xlsx', 'csv'] },
          name_column: { type: 'number', description: '用第几列(0 基)的值做文件名，可省略' }
        },
        required: ['file_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索（免费、无需配置）。用于查公司、查资料、核实信息。返回若干条标题/网址/摘要。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_company',
      description:
        '联网搜集某公司的公开信息并汇总：公司全称、地址、联系方式、主营产品、外贸/资质等。返回搜集到的资料，由你整理成一份公司资料文档，提示用户可修改后存入信息库/记忆。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '公司名称' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'contract_review',
      description:
        '审查各类合同/协议（外贸购销、采购、服务、租赁、劳动、保密 NDA 等；Word/Excel/文本）。会读取合同内容并附上审查要点，请据此逐条指出缺失项、风险点(高/中/低)与修改建议。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '合同文件 id' },
          focus: { type: 'string', description: '可选：用户特别关注的方面，如 付款条款/交期' }
        },
        required: ['file_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_pptx',
      description:
        '一键生成可编辑的 PPT(.pptx)。用户给主题/要求后，先用 web_search 查证真实资料与参考文献(只放真实URL,不编造)，再调用本工具。每页可给 image_query 自动联网配图并标注来源。生成的 PPT 文本/图片均可在 PowerPoint/WPS 继续编辑。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '文件名(不含扩展名)' },
          title: { type: 'string', description: '封面主标题' },
          subtitle: { type: 'string', description: '封面副标题(主题/单位/日期等，可选)' },
          slides: {
            type: 'array',
            description: '内容页，每页一个对象',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '本页小标题' },
                bullets: { type: 'array', items: { type: 'string' }, description: '本页要点(3~6 条，精炼)' },
                body: { type: 'string', description: '若不用要点可给整段正文(可选)' },
                image_query: { type: 'string', description: '配图关键词(可选)，工具自动联网搜图并嵌入+标来源' },
                notes: { type: 'string', description: '讲者备注(可选)' }
              }
            }
          },
          references: { type: 'array', items: { type: 'string' }, description: '真实参考文献(带URL)，须经联网查证，勿编造' }
        },
        required: ['filename', 'title', 'slides']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'standardize_format',
      description:
        '把上传的 Word(.docx)/Excel(.xlsx) 按企业统一格式规范一键标准化(字体/字号/行距/首行缩进/页边距/各级标题/表头/边框/列宽)。也可提供格式模板文件直接套用其样式。复杂文档不保证零误差，会回报已应用与未处理项。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '要标准化的文件 id' },
          template_file_id: { type: 'string', description: '可选：作为格式模板的 docx 文件 id，套用其样式' },
          spec: {
            type: 'object',
            description: '格式规范(把用户描述解析进来)',
            properties: {
              cnFont: { type: 'string', description: '中文字体，如 仿宋_GB2312 / 宋体 / 微软雅黑' },
              enFont: { type: 'string', description: '西文/数字字体，如 Times New Roman' },
              bodySize: { type: 'number', description: '正文字号(pt)，如 14(三号)、16(小三)' },
              lineSpacing: { type: 'number', description: '行距倍数，如 1.5 / 2' },
              firstLineIndent: { type: 'boolean', description: '正文首行缩进 2 字符' },
              margins: {
                type: 'object',
                description: '页边距(厘米)',
                properties: { top: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } }
              },
              headings: {
                type: 'array',
                description: '各级标题样式',
                items: {
                  type: 'object',
                  properties: { level: { type: 'number' }, font: { type: 'string' }, size: { type: 'number' }, bold: { type: 'boolean' } },
                  required: ['level']
                }
              },
              headerBold: { type: 'boolean', description: 'Excel：首行表头加粗' },
              borders: { type: 'boolean', description: 'Excel：全表加表格线' },
              colWidth: { type: 'number', description: 'Excel：统一列宽' }
            }
          }
        },
        required: ['file_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pdf_merge',
      description: '把多个 PDF 按给定顺序合并成一个。',
      parameters: {
        type: 'object',
        properties: { file_ids: { type: 'array', items: { type: 'string' } } },
        required: ['file_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pdf_split',
      description: '把一个 PDF 按页拆成多个单页 PDF，打包成 zip 返回。',
      parameters: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pdf_extract',
      description: '从一个 PDF 里提取指定页码（如 1-3,5）合成新 PDF。',
      parameters: {
        type: 'object',
        properties: { file_id: { type: 'string' }, ranges: { type: 'string' } },
        required: ['file_id', 'ranges']
      }
    }
  }
]

// ---------------------------------------------------------------------------
// 工具分发
// ---------------------------------------------------------------------------
export async function dispatchTool(name: string, args: any, ctx: AgentCtx): Promise<string> {
  switch (name) {
    case 'read_file': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`读取 ${f.name}`)
      if (args.sheet_name) {
        return previewSheet(f.buf, extOf(f.name), String(args.sheet_name), 60)
      }
      const s = await summarizeFile(f.name, f.buf)
      return JSON.stringify({
        name: f.name,
        kind: s.kind,
        meta: s.meta,
        placeholders: s.placeholders,
        content: s.text || '(无文字内容)'
      })
    }
    case 'extract_sheet': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`抽取工作表 ${args.sheet_name}`)
      const { buffer, matched } = await extractSheet(f.buf, String(args.sheet_name))
      const base = String(args.out_name || matched).replace(/[\\/:*?"<>|]/g, '').slice(0, 90) || matched
      const g = register(ctx, `${base}.xlsx`, buffer)
      return `已把工作表「${matched}」抽取为 ${g.name}(${g.id})，原表格式（合并单元格/边框/列宽）已保留`
    }
    case 'get_company_info': {
      ctx.progress('读取信息库')
      if (!ctx.infoEntries.length) return '信息库为空，请提醒用户先到「信息库」录入公司固定信息。'
      return ctx.infoEntries.map((e) => `${e.category} / ${e.label}: ${e.value}`).join('\n')
    }
    case 'create_spreadsheet': {
      ctx.progress(`生成表格：${args.title || args.filename || ''}`)
      const spec = args as SpreadsheetSpec
      const files = await createSpreadsheet(spec)
      const out = files.map((f) => register(ctx, f.name, Buffer.from(f.base64, 'base64')))
      return `已生成：${out.map((f) => `${f.name}(${f.id})`).join('、')}`
    }
    case 'create_document': {
      const spec = args as DocSpec & { filename?: string; formats?: string[] }
      const base =
        String(spec.filename || spec.title || '文档').replace(/[\\/:*?"<>|]/g, '').slice(0, 90) || '文档'
      ctx.progress(`生成文档：${spec.title || base}`)
      const fmts = Array.isArray(spec.formats) && spec.formats.length ? spec.formats : ['pdf', 'docx']
      const out: AgentFile[] = []
      let pdfErr = ''
      if (fmts.includes('docx')) {
        const buf = await buildDocx(spec)
        out.push(register(ctx, `${base}.docx`, buf))
      }
      if (fmts.includes('pdf')) {
        try {
          const buf = await htmlToPdf(buildDocHtml(spec))
          out.push(register(ctx, `${base}.pdf`, buf))
        } catch (e: unknown) {
          pdfErr = e instanceof Error ? e.message : String(e)
        }
      }
      if (!out.length) return `生成文档失败：${pdfErr || '未指定有效格式(pdf/docx)'}`
      return (
        `已生成：${out.map((f) => `${f.name}(${f.id})`).join('、')}` +
        (pdfErr ? `（PDF 生成失败：${pdfErr}；已提供 Word 版，可在 Word/WPS 里另存为 PDF）` : '')
      )
    }
    case 'convert_format': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`转换 ${f.name} → ${args.target}`)
      const res = await convertFile(f.name, f.buf, args.target as TargetFormat)
      const base = f.name.replace(/\.[^.]+$/, '')
      const g = register(ctx, `${base}.${res.outExt}`, res.buffer)
      return `已转换为 ${g.name}(${g.id})，引擎：${res.engine}`
    }
    case 'fill_template': {
      const f = getFile(ctx, args.file_id)
      const ext = extOf(f.name)
      ctx.progress(`填充模板 ${f.name}`)
      const { placeholders } = await extractPlaceholders(ext, f.buf)
      const buf = await renderTemplate(ext, f.buf, args.mapping || {})
      const base = f.name.replace(/\.[^.]+$/, '')
      const g = register(ctx, `${base}-已填写.${ext}`, buf)
      const filled = Object.keys(args.mapping || {})
      const missing = placeholders.filter((p) => !filled.includes(p))
      return `已生成 ${g.name}(${g.id})。模板占位符共 ${placeholders.length} 个${
        missing.length ? `，未提供值：${missing.join('、')}` : '，全部已填'
      }`
    }
    case 'split_table': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`拆分 ${f.name}`)
      const parts = splitTableToBuffers(
        f.buf,
        extOf(f.name),
        {
          headerRow: args.header_row ?? 1,
          rowsPerFile: args.rows_per_file ?? 1,
          outFormat: args.out_format === 'csv' ? 'csv' : 'xlsx',
          nameColumn: args.name_column
        },
        f.name.replace(/\.[^.]+$/, '')
      )
      const zip = await zipBuffers(parts)
      const g = register(ctx, `${f.name.replace(/\.[^.]+$/, '')}-拆分(${parts.length}个).zip`, zip)
      return `已拆成 ${parts.length} 个文件，打包为 ${g.name}(${g.id})`
    }
    case 'web_search': {
      ctx.progress(`联网搜索：${args.query}`)
      const hits = await webSearch(String(args.query || ''), 8)
      if (!hits.length) return '没搜到结果，可换个关键词再试。'
      return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n')
    }
    case 'summarize_company': {
      const name = String(args.name || '')
      ctx.progress(`搜集「${name}」公司资料`)
      const hits = await webSearch(`${name} 公司 主营产品 地址 联系方式`, 8)
      const list = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n')
      const pages = await Promise.all(
        hits.slice(0, 2).map((h) => fetchPageText(h.url, 2500).catch(() => ''))
      )
      const pageText = pages.filter(Boolean).join('\n---\n').slice(0, 5000)
      return (
        `【「${name}」公开资料 · 搜索结果】\n${list || '（无）'}\n\n【网页正文摘录】\n${pageText}\n\n` +
        '请据此整理成一份结构化「公司资料」文档（公司全称、地址、联系方式、主营产品/型号、外贸出口、资质等），只用搜到的事实、不要编造；并提示用户可修改后点「存记忆」存入。'
      )
    }
    case 'contract_review': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`审查合同 ${f.name}`)
      const ext = extOf(f.name)
      let content = ''
      if (['xlsx', 'xls', 'csv'].includes(ext)) content = previewSheet(f.buf, ext, '', 120)
      else {
        const s = await summarizeFile(f.name, f.buf)
        content = s.text || s.meta || '(无法读取文本)'
      }
      const focus = args.focus ? `\n用户特别关注：${args.focus}` : ''
      return `【合同文件：${f.name}】\n${content.slice(0, 8000)}${focus}\n\n${CONTRACT_CHECKLIST}`
    }
    case 'create_pptx': {
      ctx.progress(`制作 PPT：${args.title || args.filename || ''}`)
      const { files, report } = await createPptx(args as PptxSpec)
      const out = files.map((f) => register(ctx, f.name, Buffer.from(f.base64, 'base64')))
      return `${report} 文件：${out.map((f) => `${f.name}(${f.id})`).join('、')}`
    }
    case 'standardize_format': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`标准化格式 ${f.name}`)
      const ext = extOf(f.name)
      let templateStyles: string | undefined
      if (args.template_file_id) {
        const tf = getFile(ctx, args.template_file_id)
        if (extOf(tf.name) === 'docx') templateStyles = await extractDocxStyles(tf.buf)
      }
      const res = await standardizeFormat(f.buf, ext, (args.spec || {}) as FormatSpec, templateStyles)
      const base = f.name.replace(/\.[^.]+$/, '')
      const g = register(ctx, `${base}-标准化.${res.ext}`, Buffer.from(res.base64, 'base64'))
      return (
        `已生成 ${g.name}(${g.id})。已应用：${res.applied.join('；') || '(无)'}` +
        (res.skipped.length ? `。未能处理(请复核)：${res.skipped.join('；')}` : '')
      )
    }
    case 'pdf_merge': {
      const ids: string[] = args.file_ids || []
      ctx.progress(`合并 ${ids.length} 个 PDF`)
      const merged = await mergePdfs(ids.map((id) => getFile(ctx, id).buf))
      const g = register(ctx, '合并结果.pdf', merged)
      return `已合并为 ${g.name}(${g.id})`
    }
    case 'pdf_split': {
      const f = getFile(ctx, args.file_id)
      ctx.progress(`拆分 PDF ${f.name}`)
      const pages = await splitEachPage(f.buf)
      const base = f.name.replace(/\.[^.]+$/, '')
      const zip = await zipBuffers(
        pages.map((p) => ({ name: `${base}-第${String(p.page).padStart(3, '0')}页.pdf`, buffer: p.buffer }))
      )
      const g = register(ctx, `${base}-分页(${pages.length}页).zip`, zip)
      return `已拆成 ${pages.length} 个单页 PDF，打包为 ${g.name}(${g.id})`
    }
    case 'pdf_extract': {
      const f = getFile(ctx, args.file_id)
      const total = await pdfPageCount(f.buf)
      const idx = parsePageRanges(args.ranges, total)
      ctx.progress(`提取 PDF 页 ${args.ranges}`)
      const out = await extractPages(f.buf, idx)
      const g = register(ctx, `${f.name.replace(/\.[^.]+$/, '')}-提取页.pdf`, out)
      return `已提取 ${idx.length} 页为 ${g.name}(${g.id})`
    }
    default:
      return `未知工具：${name}`
  }
}
