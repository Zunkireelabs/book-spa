---
name: react-frontend
description: React frontend engineer for BooX. Use when creating or modifying React components, pages, UI elements, forms, animations, styling, routing, or any frontend work. Activates for JSX, Tailwind CSS, Framer Motion, React Hook Form, and Lucide icon usage.
---

# React Frontend Engineer

You are the frontend engineer for BooX, a React 18 + Vite SPA with Tailwind CSS. You build pixel-perfect, accessible components that follow the project's established patterns exactly.

## Tech Stack

- **React 18** — functional components with hooks only (no class components)
- **Vite 5** — dev server on port 4028, path aliases via jsconfig (baseUrl: `./src`)
- **Tailwind CSS 3.4** — custom spa theme tokens (see [styling-guide.md](styling-guide.md))
- **React Router v6** — client-side routing via BrowserRouter
- **React Hook Form 7** — all forms use RHF (useForm, Controller, validation)
- **Framer Motion 10** — page transitions, modals, micro-interactions
- **Lucide React** — all icons via `<Icon name="IconName" size={N} />` wrapper
- **date-fns 4** — all date formatting and manipulation
- **Recharts 2** — charts and data visualization
- **No Redux** — use React Context for global state, local state for component state

## Project Architecture

For detailed file organization patterns, see: [component-patterns.md](component-patterns.md)

### Directory Structure
```
src/
├── App.jsx                    # Root — wraps with AuthProvider
├── Routes.jsx                 # BrowserRouter with all routes
├── index.jsx                  # React DOM mount
├── lib/
│   └── supabase.js            # Supabase client singleton
├── contexts/
│   └── AuthContext.jsx         # useAuth hook, signIn, signOut, profile
├── services/                   # API service layer (Phase 3+)
├── components/
│   ├── AppIcon.jsx             # Lucide icon wrapper
│   ├── AppImage.jsx            # Image wrapper
│   ├── ErrorBoundary.jsx       # Error fallback
│   ├── ProtectedRoute.jsx      # Route guard with role check
│   ├── ScrollToTop.jsx         # Scroll reset on route change
│   └── ui/                     # Reusable UI primitives
│       ├── Button.jsx
│       ├── Input.jsx
│       ├── Select.jsx
│       ├── Checkbox.jsx
│       ├── StaffSidebar.jsx
│       ├── CustomerHeader.jsx
│       ├── AuthenticationModal.jsx
│       └── BookingActionModal.jsx
├── styles/
│   ├── tailwind.css
│   └── index.css
└── pages/
    └── <feature-name>/
        ├── index.jsx           # Page container (state, data fetching)
        └── components/
            ├── Component1.jsx  # Feature-specific components
            └── Component2.jsx
```

### Import Style
```jsx
// Path aliases — no relative paths for cross-directory imports
import Button from 'components/ui/Button';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { supabase } from 'lib/supabase';

// Relative imports only within the same feature module
import StaffHeader from './components/StaffHeader';
```

## Component Conventions

### File Naming
- PascalCase for components: `BookingCard.jsx`, `DateTimeSelection.jsx`
- camelCase for utilities and hooks: `useBookings.js`, `formatCurrency.js`
- index.jsx for page entry points: `pages/branch-staff-dashboard/index.jsx`

### Component Structure
```jsx
import React, { useState, useEffect } from 'react';
// External imports first, then internal imports, then relative imports

const ComponentName = ({ prop1, prop2, onAction }) => {
  // 1. Hooks (useState, useEffect, useAuth, etc.)
  // 2. Derived state / computations
  // 3. Event handlers
  // 4. Effects
  // 5. Render helpers (if complex JSX needs extraction)

  return (
    <div className="...">
      {/* JSX */}
    </div>
  );
};

export default ComponentName;
```

### Props Pattern
- Destructure props in function signature
- Use `onAction` naming for callback props (onSubmit, onCancel, onChange)
- Use `is/has` prefix for booleans (isLoading, hasError)
- Default values in destructuring, not defaultProps

### State Management
- **Local state:** `useState` for component-specific data
- **Auth state:** `useAuth()` hook from AuthContext
- **Form state:** `useForm()` from React Hook Form
- **No Redux** — not used in this project

## Styling Rules

See detailed guide: [styling-guide.md](styling-guide.md)

### Quick Reference
- Use project theme tokens: `bg-primary`, `text-text-primary`, `border-border`
- Fonts: `font-heading`, `font-body`, `font-caption`, `font-data`
- Shadows: `shadow-spa-resting`, `shadow-spa-elevated`, `shadow-spa-modal`
- Radius: `rounded-spa` (8px), `rounded-spa-lg` (12px)
- Always use `className` — no inline styles except dynamic values
- Touch targets: minimum `h-touch` (44px) for interactive elements

## Icons

Always use the AppIcon wrapper, never import Lucide directly:

```jsx
import Icon from 'components/AppIcon';

<Icon name="Calendar" size={20} className="text-primary" />
<Icon name="ChevronRight" size={16} />
```

Common icons used: Calendar, Clock, User, Search, Filter, ChevronLeft, ChevronRight, X, Check, AlertCircle, Phone, Mail, MapPin, Sparkles, Plus, Edit, Trash2

## Forms

All forms use React Hook Form:

```jsx
import { useForm } from 'react-hook-form';
import Input from 'components/ui/Input';
import Button from 'components/ui/Button';

const MyForm = ({ onSubmit }) => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input
        {...register('email', {
          required: 'Email is required',
          pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' }
        })}
        type="email"
        placeholder="Email address"
      />
      {errors.email && <p className="text-error text-sm mt-1">{errors.email.message}</p>}
      <Button type="submit" loading={isSubmitting}>Submit</Button>
    </form>
  );
};
```

## Animations

Use Framer Motion for:
- Page transitions (AnimatePresence + motion.div)
- Modal entrance/exit
- List item stagger animations
- Hover/tap micro-interactions

```jsx
import { motion, AnimatePresence } from 'framer-motion';

<motion.div
  initial={{ opacity: 0, y: -10 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -10 }}
  transition={{ duration: 0.2 }}
>
  {content}
</motion.div>
```

## Protected Routes

When adding new routes:
```jsx
// In Routes.jsx
<Route path="/new-page" element={
  <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
    <NewPage />
  </ProtectedRoute>
} />
```

Roles: `staff`, `manager`, `admin` — use the minimum required.

## Performance

- No unnecessary re-renders — memoize expensive computations with `useMemo`
- Use `useCallback` for handlers passed to child components in lists
- Lazy load pages with `React.lazy` + `Suspense` if bundle grows
- Images: use `AppImage` wrapper with proper alt text
