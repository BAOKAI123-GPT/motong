// PPT 一键生成（真·可编辑 .pptx，pptxgenjs）。
// - 文本/标题/项目符号/图片都是原生可编辑对象，用户拿到后可继续在 PowerPoint/WPS 里改。
// - 每页可给 image_query：引擎自动经后端图搜取首图 → 后端代下载字节 → 嵌入，并在图下标注「来源」URL。
//   取图失败则跳过该图（不影响其余内容），并在返回报告里说明。
// - 参考文献单独成页：必须是模型经联网搜到的真实来源（带 URL），不编造。
import PptxGenJS from 'pptxgenjs'
import { imageSearch, fetchImageBytes } from './imagesearch'

export interface PptxSlideSpec {
  title?: string
  bullets?: string[]
  body?: string
  /** 该页配图关键词；留空则该页不配图 */
  image_query?: string
  /** 讲者备注 */
  notes?: string
}

export interface PptxSpec {
  filename: string
  /** 封面主标题 */
  title: string
  /** 封面副标题（可放主题/单位/日期） */
  subtitle?: string
  slides: PptxSlideSpec[]
  /** 真实参考文献（带 URL），单独成页；务必是联网搜到的真实来源 */
  references?: string[]
}

export interface GeneratedFile {
  name: string
  base64: string
}

const FONT = '微软雅黑'
const C = { brand: '2E5BFF', brand2: '6C8BFF', dark: '1F2937', muted: '7A8190', light: 'EEF3FF', white: 'FFFFFF' }
const W = 13.333
const H = 7.5

/** 生成可编辑 PPT。返回文件 + 一段处理报告（配图成功/失败、来源数）。 */
export async function createPptx(spec: PptxSpec): Promise<{ files: GeneratedFile[]; report: string }> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 16:9, 13.33 x 7.5 英寸
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT }

  const imgSources: { title: string; source: string }[] = []
  let imgOk = 0
  let imgFail = 0

  // ---------- 封面 ----------
  {
    const s = pptx.addSlide()
    s.background = { color: C.brand }
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 1.5, w: W, h: 1.5, fill: { color: C.brand2 } })
    s.addText(spec.title || '演示文稿', {
      x: 0.8, y: 2.4, w: W - 1.6, h: 1.8, fontSize: 40, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle'
    })
    if (spec.subtitle) {
      s.addText(spec.subtitle, {
        x: 0.8, y: 4.3, w: W - 1.6, h: 1, fontSize: 20, color: C.light, fontFace: FONT, align: 'center'
      })
    }
  }

  // ---------- 内容页 ----------
  for (const slide of spec.slides) {
    const s = pptx.addSlide()
    s.background = { color: C.white }
    // 顶部标题条
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.brand } })
    if (slide.title) {
      s.addText(slide.title, {
        x: 0.6, y: 0.4, w: W - 1.2, h: 0.9, fontSize: 26, bold: true, color: C.dark, fontFace: FONT, valign: 'middle'
      })
      s.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.35, w: W - 1.2, h: 0, line: { color: C.light, width: 1.5 } })
    }

    // 取配图（可选）
    let placed = false
    if (slide.image_query) {
      try {
        const hits = await imageSearch(slide.image_query, 4)
        for (const hit of hits) {
          const got = await fetchImageBytes(hit.url)
          if (!got) continue
          const iw = 4.6
          const ih = 3.8
          const ix = W - iw - 0.6
          const iy = 1.7
          s.addImage({ data: `data:${got.mime};base64,${got.buf.toString('base64')}`, x: ix, y: iy, w: iw, h: ih, sizing: { type: 'contain', w: iw, h: ih } })
          if (hit.source) {
            s.addText(`来源：${hit.source}`.slice(0, 120), {
              x: ix, y: iy + ih + 0.06, w: iw, h: 0.3, fontSize: 9, italic: true, color: C.muted, fontFace: FONT, align: 'center'
            })
            imgSources.push({ title: hit.title || slide.title || slide.image_query, source: hit.source })
          }
          placed = true
          imgOk++
          break
        }
        if (!placed) imgFail++
      } catch {
        imgFail++
      }
    }

    // 正文（项目符号优先；有图则文字占左半，无图则整页）
    const textW = placed ? W - 6.4 : W - 1.2
    const items = (slide.bullets && slide.bullets.length ? slide.bullets : (slide.body ? [slide.body] : [])).filter(Boolean)
    if (items.length) {
      s.addText(
        items.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, breakLine: true } })),
        { x: 0.6, y: 1.7, w: textW, h: H - 2.3, fontSize: 18, color: C.dark, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.25 }
      )
    }
    if (slide.notes) s.addNotes(String(slide.notes))
  }

  // ---------- 参考文献 / 来源页 ----------
  const refs = (spec.references || []).filter(Boolean)
  if (refs.length || imgSources.length) {
    const s = pptx.addSlide()
    s.background = { color: C.white }
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.brand } })
    s.addText('参考文献与素材来源', {
      x: 0.6, y: 0.4, w: W - 1.2, h: 0.9, fontSize: 26, bold: true, color: C.dark, fontFace: FONT, valign: 'middle'
    })
    const lines: { text: string; options: any }[] = []
    refs.forEach((r, i) => lines.push({ text: `${i + 1}. ${r}`, options: { breakLine: true, fontSize: 14, color: C.dark } }))
    if (imgSources.length) {
      lines.push({ text: '图片来源：', options: { breakLine: true, fontSize: 14, bold: true, color: C.dark, paraSpaceBefore: 8 } })
      imgSources.forEach((g, i) =>
        lines.push({ text: `图${i + 1}. ${g.title} — ${g.source}`, options: { breakLine: true, fontSize: 12, color: C.muted } })
      )
    }
    s.addText(lines, { x: 0.6, y: 1.5, w: W - 1.2, h: H - 2, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.2 })
  }

  const safe = (spec.filename || '演示文稿').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || '演示文稿'
  const b64 = (await pptx.write({ outputType: 'base64' })) as string
  const report =
    `已生成可编辑 PPT「${safe}.pptx」，共 ${spec.slides.length + 1 + (refs.length || imgSources.length ? 1 : 0)} 页。` +
    (imgOk || imgFail ? `配图：成功 ${imgOk} 张${imgFail ? `、${imgFail} 处未取到图(已跳过)` : ''}。` : '') +
    (refs.length ? `参考文献 ${refs.length} 条。` : '')
  return { files: [{ name: `${safe}.pptx`, base64: b64 }], report }
}
