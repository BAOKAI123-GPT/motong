/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#f4ecdb', // 主背景：宣纸米
        panel: '#fffdf7', // 卡片/面板：暖白
        edge: '#e0d4ba', // 边框：暖浅
        muted: '#7a6e58', // 次要文字：暖灰
        brand: '#b1342a', // 主色：朱砂红
        brand2: '#3a6b5e' // 成功/下载：竹青（点缀）
      }
    }
  },
  plugins: []
}
