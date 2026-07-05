import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0b0e14',
          raised: '#12161f',
          card: '#161b26',
          border: '#232a38',
          hover: '#1b2130',
        },
        accent: {
          DEFAULT: '#4f7cff',
          hover: '#6b91ff',
          soft: 'rgba(79, 124, 255, 0.12)',
        },
        positive: '#34d399',
        negative: '#f87171',
        warn: '#fbbf24',
        muted: '#8b93a7',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
