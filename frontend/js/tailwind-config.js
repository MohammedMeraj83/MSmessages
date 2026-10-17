tailwind.config = {
  darkMode: 'class',
  // Registers the `light:` variant used all over the markup; without it the light theme never applied.
  plugins: [function ({ addVariant }) { addVariant('light', '.light &'); }],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        aether: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#06b6d4',
          600: '#0891b2',
          900: '#082f49',
          dark: '#070b14',
          surface: '#0d1322',
          card: '#131b2e',
          border: '#1e293b',
          accent: '#38bdf8',
          purple: '#8b5cf6',
          emerald: '#10b981'
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      }
    }
  }
};