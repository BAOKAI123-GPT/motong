/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#fbf8f1', // 主背景：暖白
        panel: '#ffffff', // 卡片/面板：白
        edge: '#ece1c8', // 边框：浅金
        muted: '#8a7f66', // 次要文字：暖灰
        brand: '#b8860b', // 主色：金（白底可读）
        brand2: '#caa84a', // 点缀：浅金
        // slate 恢复深色（白底下正文/标题用，深号更深）
        slate: {
          400: '#9b9079',
          500: '#8a7f66',
          600: '#6b6450',
          700: '#3a3327',
          800: '#2a2620',
          900: '#1f1c16'
        }
      }
    }
  },
  plugins: []
}
