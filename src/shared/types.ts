// 主进程与渲染进程之间共享的类型定义

// ---------------------------------------------------------------------------
// 中转站配置（apiKey 原文只存主进程，返回渲染进程时掩码）
// ---------------------------------------------------------------------------
export interface RelayProfile {
  id: string
  name: string
  baseUrl: string
  /** 掩码后的 key，仅用于显示，如 sk-Gi••••cd49 */
  apiKeyMasked: string
  hasKey: boolean
  /** 文书处理走对话模型 */
  chatModel?: string
  /** 识图模型（解析聊天记录截图用），不填则复用 chatModel */
  visionModel?: string
  createdAt: number
}

export interface RelayProfileInput {
  id?: string
  name: string
  baseUrl: string
  /** 明文 key；为空表示沿用已有 key（编辑场景） */
  apiKey?: string
  chatModel?: string
  visionModel?: string
}

export interface ModelInfo {
  id: string
  /** 越高越像“能力强的对话模型”，用于排序高亮 */
  chatScore: number
  /** 是否疑似识图模型 */
  vision: boolean
}

export interface ScanModelsResult {
  ok: boolean
  models: ModelInfo[]
  suggestedChatModel?: string
  suggestedVisionModel?: string
  error?: string
}

// ---------------------------------------------------------------------------
// 应用设置
// ---------------------------------------------------------------------------
export interface AppSettings {
  /** 上次使用的导出目录，便于默认定位 */
  lastExportDir?: string
}

// ---------------------------------------------------------------------------
// 信息库（企业固定信息，本地存储，分类管理）
// ---------------------------------------------------------------------------
export interface InfoEntry {
  id: string
  /** 分类，如 公司信息 / 联系人 / 产品 */
  category: string
  /** 字段名，如 公司名称 / 统一社会信用代码 */
  label: string
  /** 字段值 */
  value: string
}

// ---------------------------------------------------------------------------
// 拖入的文件（渲染进程读出后传给主进程）
// ---------------------------------------------------------------------------
export interface DroppedFile {
  name: string
  /** 文件二进制的 base64（不含 data: 前缀） */
  base64: string
}

// ---------------------------------------------------------------------------
// 格式转换
// ---------------------------------------------------------------------------
/** 支持的目标格式 */
export type TargetFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'txt'
  | 'html'
  | 'json'
  | 'odt'
  | 'pptx'

export interface ConvertRequest {
  file: DroppedFile
  target: TargetFormat
}

export interface ConvertResult {
  ok: boolean
  /** 成品文件保存路径（已写盘） */
  path?: string
  /** 转换走的引擎，便于 UI 解释 */
  engine?: 'sheetjs' | 'libreoffice'
  /** 取消（用户在保存对话框点了取消） */
  canceled?: boolean
  error?: string
}

/** 某个来源格式可转到的目标列表，用于 UI 动态展示按钮 */
export interface ConvertOptions {
  ext: string
  targets: TargetFormat[]
  /** libreoffice 是否可用（影响文档族转换） */
  libreofficeAvailable: boolean
}

// ---------------------------------------------------------------------------
// 表格拆分
// ---------------------------------------------------------------------------
export interface TablePreview {
  ok: boolean
  /** 表头（第一行） */
  header: string[]
  /** 预览的前若干行数据 */
  rows: string[][]
  /** 数据总行数（不含表头） */
  totalRows: number
  /** 工作表名 */
  sheetName?: string
  error?: string
}

export interface TableSplitRequest {
  file: DroppedFile
  /** 第几行是表头（1 基），0 表示无表头 */
  headerRow: number
  /** 每个拆出文件包含多少条数据行，默认 1（单条单文件） */
  rowsPerFile: number
  /** 拆出文件的格式 */
  outFormat: 'xlsx' | 'csv' | 'pdf'
  /** 用某一列的值作为文件名前缀（列索引，0 基），不填用序号 */
  nameColumn?: number
}

export interface TableSplitResult {
  ok: boolean
  /** 输出目录 */
  dir?: string
  /** 生成的文件数 */
  count?: number
  canceled?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// PDF 工具（合并 / 拆分 / 提取页）
// ---------------------------------------------------------------------------
export interface PdfInfo {
  ok: boolean
  pages?: number
  error?: string
}

export interface SavedFileResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

export interface SavedDirResult {
  ok: boolean
  dir?: string
  count?: number
  canceled?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// 模板自动填充
// ---------------------------------------------------------------------------
export interface TemplateExtractResult {
  ok: boolean
  type?: 'docx' | 'xlsx'
  /** 模板里出现的占位符（保序去重） */
  placeholders?: string[]
  /** 信息库同名字段的预填值 */
  prefill?: Record<string, string>
  error?: string
}

export interface AiFillResponse {
  ok: boolean
  values?: Record<string, string>
  /** AI 判断信息不足、需要用户补充的占位符 */
  missing?: string[]
  error?: string
}

// ---------------------------------------------------------------------------
// 长期记忆
// ---------------------------------------------------------------------------
export interface MemoryEntry {
  id: string
  text: string
  /** message=对话内容 file=文件要点 summary=自动总结的提纲 note=手动记的 */
  source: 'message' | 'file' | 'summary' | 'note'
  createdAt: number
}

// ---------------------------------------------------------------------------
// 对话式智能体
// ---------------------------------------------------------------------------
export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentSendInput {
  profileId: string
  /** 当前对话 id，用于主进程按会话缓存上传/生成的文件，实现跨轮引用（无需重传） */
  convId?: string
  /** 之前的对话（仅文字） */
  history: AgentChatMessage[]
  userText: string
  /** 本轮上传的文件 */
  files: DroppedFile[]
}

export interface GeneratedFilePayload {
  name: string
  /** base64（不含 data: 前缀） */
  base64: string
}

export interface AgentSendResult {
  ok: boolean
  text?: string
  files?: GeneratedFilePayload[]
  error?: string
  needLogin?: boolean
  needRecharge?: boolean
  scopeBlocked?: boolean
  quota?: WsQuota
}

// ---------------------------------------------------------------------------
// 翰文账号 / 套餐（对接 cogpt 后端）
// ---------------------------------------------------------------------------
export interface WsQuota {
  phone?: string
  active: boolean
  tier: string
  weekTokens: number
  weekResetAt: string | null
  expiresAt: string | null
  canUse: boolean
}

export interface WsTier {
  id: string
  name: string
  priceCents: number
  weekTokens: number
}

export interface AuthState {
  loggedIn: boolean
  phone?: string
}
