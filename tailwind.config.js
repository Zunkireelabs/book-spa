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
          'success': '#059669', // natural green
          'success-foreground': '#FFFFFF', // white
          
          'warning': '#D97706', // warm amber
          'warning-foreground': '#FFFFFF', // white
          
          'error': '#DC2626', // clear red
          'error-foreground': '#FFFFFF', // white
          
          // Border Colors
          'border': '#E5E7EB', // light gray
          'border-muted': 'rgba(229, 231, 235, 0.5)', // light gray with opacity
        },
        fontFamily: {
          'heading': ['Inter', 'sans-serif'],
          'body': ['Source Sans Pro', 'sans-serif'],
          'caption': ['Nunito Sans', 'sans-serif'],
          'data': ['JetBrains Mono', 'monospace'],
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
        spacing: {
          'touch': '44px',
        },
        zIndex: {
          'customer-header': '100',
          'staff-sidebar': '200',
          'modal': '1000',
        },
        animation: {
          'pulse-gentle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          'fade-in': 'fadeIn 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          'slide-in': 'slideIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
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
        },
      },
    },
    plugins: [
      require('@tailwindcss/forms'),
      require('tailwindcss-animate'),
    ],
  }