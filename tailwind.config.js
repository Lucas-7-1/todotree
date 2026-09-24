/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        q1: {
          bg: '#fef2f2',
          text: '#ef4444',
          border: '#fecaca',
          dot: '#ef4444',
        },
        q2: {
          bg: '#eff6ff',
          text: '#3b82f6',
          border: '#bfdbfe',
          dot: '#3b82f6',
        },
        q3: {
          bg: '#fffbeb',
          text: '#f59e0b',
          border: '#fde68a',
          dot: '#f59e0b',
        },
        q4: {
          bg: '#f8fafc',
          text: '#64748b',
          border: '#e2e8f0',
          dot: '#94a3b8',
        }
      }
    },
  },
  plugins: [],
}
