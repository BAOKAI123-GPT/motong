# 翰文（政企文书智能处理助手）

**对话式文书办公助手**：把需求、聊天记录或文件发给它，AI 自己判断该建表、套模板、转格式还是拆分，
做好后直接把成品文件回在对话里。面向中小企业、尤其传统制造业对接发货的文员场景。

技术栈与 PixRelay 一致：Electron + electron-vite + React + TypeScript + Tailwind + electron-store；
AI 走任意 OpenAI 兼容中转站（function calling 工具调用）。

## 形态（v0.2）

- **对话为核心**：一个聊天窗口就是你的文书文员。例如：
  - “把这段聊天记录里的订单做成送货单（Excel）” → 自动建表并回传
  - “按我上传的大厂模板把数据填进去” → 读模板占位符 → 套用 → 回传
  - “把这张表转成 PDF” / “把这个明细按产品拆成单独文件”
- AI 通过**工具**完成任务，工具对用户隐形，由模型自动选择：
  `read_file / get_company_info / create_spreadsheet / convert_format / fill_template / split_table / pdf_merge / pdf_split / pdf_extract`
- 生成单据时**自动取信息库**里的公司固定信息；关键数据缺失会主动问你。
- 侧栏只留：对话 / 资源库（开源工具目录 + 手动工具入口）/ 信息库 / 中转站设置。

## 引擎与依赖

| 能力 | 引擎 | 联网 |
| --- | --- | --- |
| 生成专业表格（送货单/报价单/对账单…） | exceljs（带标题/边框/合计） | 否 |
| Excel↔CSV/JSON/HTML 互转、表格拆分 | SheetJS | 否 |
| Word/PPT/WPS↔PDF、PDF→Excel/Word | LibreOffice 无界面 | 否（需 LibreOffice） |
| 模板填充（{{占位符}}，保留格式） | jszip + xmldom | 否 |
| PDF 合并/拆分/提取 | pdf-lib | 否 |
| 对话与工具调用 | 中转站（需支持 function calling 的模型） | 是 |

> AI 需要一个**支持工具调用**的模型（如 gpt-4o / deepseek / qwen-max / claude 等）。识图（聊天截图）需识图模型。

## LibreOffice（PDF / 文档转换，开箱即用）

文档族转换依赖 LibreOffice。把便携版放进 `resources/libreoffice/`（见该目录 README），
`npm run build:win` 会自动打进安装包，安装后即可离线转换（安装包约 +450MB）。
运行时定位顺序见 `src/main/engine/soffice.ts`：先用打包版，再退回本机安装版。

## 运行

```bash
npm install
npm run dev          # 开发预览
npm run build:win    # 打 Windows 安装包（nsis + portable）
```

## 验证

引擎层用真实中文样例做了 Node 端到端断言，全部通过：

```bash
for t in engine pdf template agent; do
  ./node_modules/.bin/esbuild verify/$t.test.ts --bundle --platform=node --format=cjs --packages=external --outfile=verify/$t.test.cjs
  node verify/$t.test.cjs
done
# 转换/表格 20 · PDF 12 · 模板 14 · Agent工具 13（生成送货单/套模板/转格式/拆分打包）
```

> 注：LibreOffice 在开发沙箱里无法运行（环境限制），其转换链路为构造正确性验证；真机可用。

## 数据安全

- 文件在本机处理，不上传任何网盘 / SaaS。中转站 API Key 用系统 `safeStorage` 加密存本地。
- 对话需要大模型理解内容，**会把必要的文字/图片发给中转站（云端）**；公司固定信息走信息库直填，可少经 AI。
