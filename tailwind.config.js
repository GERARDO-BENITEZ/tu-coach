/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./athlete-dashboard.html', './athlete-analytics.html'],
  theme: {
    extend: {
      colors: {
        base: '#121212',
        surface: '#1a1a1a',
        surface2: '#202020',
        line: '#2e2e2e',
        line2: '#3a3a3a',
        ink: '#eaeaea',
        ink2: '#9a9a9a',
        ink3: '#6b6b6b',
        brand: {
          DEFAULT: '#d97706',
          light: '#f59e0b',
          dark: '#b45309',
        },
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-468px 0' },
          '100%': { backgroundPosition: '468px 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.25s linear infinite',
      },
    },
  },
  plugins: [],
}
