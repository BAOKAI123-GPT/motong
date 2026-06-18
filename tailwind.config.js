/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0a07', // 主背景：黑
        panel: '#15110a', // 卡片/面板：暖黑
        edge: '#3a3320', // 边框：金棕
        muted: '#a99a78', // 次要文字：暖金灰
        brand: '#e3c06a', // 主色：金
        brand2: '#caa84a', // 点缀：深金
        // 重映射 slate 为浅色，使原 text-slate-* 在黑底自动可读（深号→更亮）
        slate: {
          400: '#8a7f66',
          500: '#9b8e74',
          600: '#bdb195',
          700: '#ddd0b5',
          800: '#ece0c6',
          900: '#f4ecd9'
        }
      }
    }
  },
  plugins: []
}
