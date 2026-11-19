/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}",
      "./public/index.html"
    ],
    theme: {
      extend: {
        colors: {
          // Primary Colors
          'primary': '#2D5A27', // deep forest green
          'primary-foreground': '#FFFFFF', // white
          
          // Secondary Colors
          'secondary': '#8B4513', // warm earth brown
          'secondary-foreground': '#FFFFFF', // white
          
          // Accent Colors
          'accent': '#DAA520', // refined gold
          'accent-foreground': '#1A1A1A', // near-black
          
          // Background Colors
          'background': '#FAFAFB', // brand grey
          'surface': '#FFFFFF', // pure white
          
          // Text Colors
          'text-primary': '#0E0D0C', // brand ink
          'text-secondary': '#515152', // brand muted
          'text-tertiary': '#8A8A90', // brand soft
          
          // Status Colors
          'success': '#10B981', // emerald green (distinct from primary)
          'success-foreground': '#FFFFFF', // white
          
          'warning': '#D97706', // warm amber
          'warning-foreground': '#FFFFFF', // white
          
          'error': '#DC2626', // clear red
          'error-foreground': '#FFFFFF', // white
          
          // Border Colors
          'border': '#E9E9EC', // brand hairline
          'border-muted': 'rgba(233, 233, 236, 0.5)', // soft gray with opacity
          'surface-sidebar': '#F9F9F9',   // sidebar shell background
          'surface-dim': '#FFFFFF',       // main content area background

          // Neutral scale remapped to ClinicMD's cool greys so the hundreds of
          // gray-* utilities follow the same neutrals without per-file edits.
          'gray': {
            50: '#FAFAFB',
            100: '#F4F4F6',
            200: '#E9E9EC',
            300: '#DCDCE0',
            400: '#9A9AA0',
            500: '#6B6B6E',
            600: '#515152',
            700: '#3A3A40',
            800: '#2A2A30',
            900: '#0E0D0C',
            950: '#080914',
          },
        },
        fontFamily: {
          'heading': ['Inter', 'sans-serif'],
          'body': ['Inter', 'sans-serif'],
          'caption': ['Inter', 'sans-serif'],
          'accent': ['Inter', 'sans-serif'],
          'data': ['Inter', 'sans-serif'],
          'mono': ['Inter', 'sans-serif'],
          'sans': ['Inter', 'sans-serif'],
          'serif': ['Inter', 'sans-serif'],
        },
        fontWeight: {
          'heading-normal': '400',
          'heading-medium': '500',
          'heading-semibold': '600',
          'body-normal': '400',
          'body-medium': '500',
          'caption-normal': '400',
          'data-normal': '400',
        },
        boxShadow: {
          // Flat: hairline borders do the work, shadows only lift overlays.
          'spa-resting': '0 1px 2px rgba(14,13,12,0.04)',
          'spa-elevated': '0 12px 32px rgba(14,13,12,0.08), 0 0 0 1px #E9E9EC',
          'spa-modal': '0 20px 40px rgba(14,13,12,0.12), 0 0 0 1px #E9E9EC',
        },
        borderRadius: {
          'spa': '6px',
          'spa-lg': '8px',
        },
        transitionDuration: {
          'fast': '150ms',
          'normal': '200ms',
          'slow': '300ms',
        },
        transitionTimingFunction: {
          'spa-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
          'spa-out': 'ease-out',
        },
        fontSize: {
          'xs': ['0.8125rem', { lineHeight: '1.125rem' }], // 13px — Shopify minimum
        },
        spacing: {
          'touch': '44px',
        },
        zIndex: {
          'sticky-filter': '50',
          'header': '100',
          'customer-header': '100',
          'sidebar': '200',
          'staff-sidebar': '200',
          'dropdown': '300',
          'toast': '900',
          'modal': '1000',
          'modal-overlay': '1100',
          'notification': '1200',
          'lock': '1300',
        },
        animation: {
          'pulse-gentle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          'fade-in': 'fadeIn 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          'slide-in': 'slideIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          'slide-in-right': 'slideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1)',
          'settle-in': 'settleIn 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        },
        keyframes: {
          fadeIn: {
            '0%': { opacity: '0' },
            '100%': { opacity: '1' },
          },
          slideIn: {
            '0%': { transform: 'translateY(-10px)', opacity: '0' },
            '100%': { transform: 'translateY(0)', opacity: '1' },
          },
          slideInRight: {
            '0%': { transform: 'translateX(100%)' },
            '100%': { transform: 'translateX(0)' },
          },
          settleIn: {
            '0%': { transform: 'scale(0.9) translateX(-6px)', opacity: '0' },
            '60%': { transform: 'scale(1.015) translateX(1px)', opacity: '1' },
            '100%': { transform: 'scale(1) translateX(0)', opacity: '1' },
          },
        },
      },
    },
    plugins: [
      require('@tailwindcss/forms'),
      require('tailwindcss-animate'),
      require('@tailwindcss/container-queries'),
    ],
  }