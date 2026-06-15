// 内置（锁定）的中转站与模型 —— 让软件开箱即用，终端用户无需填写网址/密钥/模型。
//
// ⚠️ 安全提示：此处的 API Key 会被打进安装包，任何拿到安装包的人理论上都能提取并消耗其额度。
// 仅在“发给可信同事/自用”的前提下使用；对外公开分发前请改用各自的 Key 或加访问控制。
export const BUILTIN_RELAY = {
  /** 内置中转站标识，固定 id 便于幂等种入 */
  id: 'builtin',
  name: '内置 · 青云中转站',
  baseUrl: 'https://api.qingyuntop.top',
  // 商业化后：中转站密钥不再放客户端，统一由后端(cogpt-server)持有并计费。此处留空。
  apiKey: '',
  /** 锁定的对话模型（实测理解力+工具调用+视觉俱佳、性价比最优） */
  chatModel: 'claude-sonnet-4-6',
  /** 识图模型（读聊天记录截图），同上 */
  visionModel: 'claude-sonnet-4-6'
}
