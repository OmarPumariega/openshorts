/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Daylight (answerthepublic-inspired) — values mirror tokens.css
        // (kept literal so Tailwind alpha modifiers like bg-brass/10 compile)
        paper: "oklch(100% 0 0 / <alpha-value>)",
        paper2: "oklch(98.5% 0.002 264 / <alpha-value>)",
        paper3: "oklch(96% 0.003 264 / <alpha-value>)",
        ink: "oklch(20% 0.008 264 / <alpha-value>)",
        ink2: "oklch(38% 0.01 264 / <alpha-value>)",
        muted: "oklch(58% 0.012 264 / <alpha-value>)",
        brass: "oklch(64% 0.19 35 / <alpha-value>)",
        brassink: "oklch(99% 0 0 / <alpha-value>)",
        coral: "oklch(58% 0.18 20 / <alpha-value>)",
        ok: "oklch(58% 0.13 150 / <alpha-value>)",
        warn: "oklch(65% 0.15 75 / <alpha-value>)",
        danger: "oklch(58% 0.19 25 / <alpha-value>)",
        // Fixed light text for content sitting on the black video-preview
        // surfaces — see tokens.css's --color-onblack* for why these don't
        // flip with the rest of the (now light) theme.
        onblack: "oklch(96% 0.006 262 / <alpha-value>)",
        onblackmuted: "oklch(72% 0.01 262 / <alpha-value>)",
        // legacy aliases so untouched files degrade gracefully
        background: "oklch(100% 0 0 / <alpha-value>)",
        surface: "oklch(98.5% 0.002 264 / <alpha-value>)",
        primary: "oklch(64% 0.19 35 / <alpha-value>)",
        accent: "oklch(58% 0.18 20 / <alpha-value>)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        sans: "var(--font-body)",
        serif: "var(--font-display)",
        mono: "var(--font-mono)",
      },
      borderColor: {
        rule: "var(--color-rule)",
        rule2: "var(--color-rule-2)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        input: "var(--radius-input)",
      },
      fontSize: {
        micro: ["10.5px", { letterSpacing: "0.10em" }],
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade': 'fadeIn 0.4s var(--ease-out)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
