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
          'background': '#FAFAF9', // soft off-white
          'surface': '#FFFFFF', // pure white
          
          // Text Colors
          'text-primary': '#1A1A1A', // near-black
          'text-secondary': '#6B7280', // medium gray
          
          // Status Colors
          'success': '#10B981', // emerald green (distinct from primary)
          'success-foreground': '#FFFFFF', // white
          
          'warning': '#D97706', // warm amber
          'warning-foreground': '#FFFFFF', // white
          
          'error': '#DC2626', // clear red
          'error-foreground': '#FFFFFF', // white
          
          // Border Colors
          'border': '#E1E3E5', // soft gray (Shopify-style)
          'border-muted': 'rgba(225, 227, 229, 0.5)', // soft gray with opacity
          'surface-sidebar': '#EBEBEB',   // sidebar shell background
          'surface-dim': '#F1F1F1',       // main content area background
        },
        fontFamily: {
          'heading': ['Inter', 'sans-serif'],
          'body': ['Inter', 'sans-serif'],
          'caption': ['Inter', 'sans-serif'],
          'accent': ['Playfair Display', 'serif'],
          'data': ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
          'spa-resting': '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
          'spa-elevated': '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
          'spa-modal': '0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)',
        },
        borderRadius: {
          'spa': '8px',
          'spa-lg': '12px',
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
        },
        animation: {
          'pulse-gentle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          'fade-in': 'fadeIn 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          'slide-in': 'slideIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          'slide-in-right': 'slideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1)',
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
        },
      },
    },
    plugins: [
      require('@tailwindcss/forms'),
      require('tailwindcss-animate'),
      require('@tailwindcss/container-queries'),
    ],
  }