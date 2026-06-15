/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#ffffff', // 主背景：白
        panel: '#f6f6f8', // 卡片/面板：极浅灰
        edge: '#e7e7ea', // 边框：浅灰
        muted: '#6b7280', // 次要文字：中灰
        brand: '#e11d2a', // 主色：红
        brand2: '#0e9f6e' // 成功/下载：绿（点缀）
      }
    }
  },
  plugins: []
}
