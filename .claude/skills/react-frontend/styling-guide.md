# BookSpa Styling Guide

> Tailwind CSS conventions and custom theme tokens for the BookSpa project.

## Color Tokens

### Primary Palette
| Token | Value | Usage |
|-------|-------|-------|
| `primary` | #2D5A27 (deep forest green) | Buttons, links, active states |
| `primary-foreground` | #FFFFFF | Text on primary backgrounds |
| `secondary` | #8B4513 (warm earth brown) | Secondary buttons, accents |
| `secondary-foreground` | #FFFFFF | Text on secondary backgrounds |
| `accent` | #DAA520 (refined gold) | Highlights, badges, premium elements |
| `accent-foreground` | #1A1A1A | Text on accent backgrounds |

### Backgrounds
| Token | Value | Usage |
|-------|-------|-------|
| `background` | #FAFAF9 (soft off-white) | Page background |
| `surface` | #FFFFFF | Cards, panels, modals |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | #1A1A1A | Headings, primary content |
| `text-secondary` | #6B7280 | Descriptions, helper text |

### Status
| Token | Value | Usage |
|-------|-------|-------|
| `success` | #10B981 (emerald) | Confirmed, completed, positive |
| `warning` | #D97706 | Pending, attention needed |
| `error` | #DC2626 | Cancelled, errors, destructive |

### Borders
| Token | Value | Usage |
|-------|-------|-------|
| `border` | #E1E3E5 | Card borders, dividers |
| `border-muted` | rgba(225,227,229,0.5) | Subtle separators |

## Typography

### Font Families
```
font-heading    → Inter, sans-serif               (headings, titles — weight 500/600/700)
font-body       → Inter, sans-serif               (body text, descriptions — weight 400/500)
font-caption    → Inter, sans-serif               (small labels, captions — weight 400)
font-accent     → Playfair Display, serif         (display headlines, premium labels)
font-data       → JetBrains Mono, monospace       (numbers, codes, IDs)
```

Self-hosted fonts in `/public/fonts/` (no external Google Fonts dependency).

### Minimum Font Size
- **13px minimum** (Shopify standard) — `text-xs` is overridden to 13px (0.8125rem)
- Never use raw `font-size` below 13px in custom CSS

### Font Weights
```
font-heading-normal    → 400
font-heading-medium    → 500
font-heading-semibold  → 600
font-body-normal       → 400
font-body-medium       → 500
font-caption-normal    → 400
font-data-normal       → 400
```

### Usage Pattern
```html
<!-- Page title -->
<h1 class="font-heading font-heading-semibold text-3xl text-text-primary">Title</h1>

<!-- Section heading -->
<h2 class="font-heading font-heading-medium text-lg text-text-primary">Section</h2>

<!-- Body text -->
<p class="font-body font-body-normal text-text-secondary">Description</p>

<!-- Small caption -->
<span class="font-caption font-caption-normal text-xs text-text-secondary">Helper</span>

<!-- Data/numbers -->
<span class="font-data font-data-normal text-sm">BK-20260212-0001</span>
```

## Spacing & Layout

### Custom Spacing
- `touch` → 44px (minimum touch target size)

### Common Layout Patterns
```html
<!-- Page wrapper -->
<div class="min-h-screen bg-background">

<!-- Centered content container -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

<!-- Card -->
<div class="bg-surface rounded-spa-lg border border-border shadow-spa-resting p-6">

<!-- 12-column grid -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
  <div class="lg:col-span-3"><!-- sidebar --></div>
  <div class="lg:col-span-6"><!-- main --></div>
  <div class="lg:col-span-3"><!-- sidebar --></div>
</div>
```

## Shadows

```
shadow-spa-resting   → cards at rest
shadow-spa-elevated  → hovered cards, dropdowns
shadow-spa-modal     → modals, overlays
```

## Border Radius

```
rounded-spa     → 8px  (cards, buttons)
rounded-spa-lg  → 12px (large panels, modals)
```

## Transitions

```
duration-fast    → 150ms
duration-normal  → 200ms
duration-slow    → 300ms

ease-spa-smooth  → cubic-bezier(0.4, 0, 0.2, 1)
ease-spa-out     → ease-out
```

## Animations

```
animate-pulse-gentle  → subtle pulse (2s)
animate-fade-in       → fade in (200ms)
animate-slide-in      → slide down + fade (300ms)
```

## Z-Index Layers

```
z-customer-header → 100
z-staff-sidebar   → 200
z-modal           → 1000
```

## Responsive Breakpoints

Follow Tailwind defaults:
- Mobile first (default)
- `sm:` → 640px
- `md:` → 768px
- `lg:` → 1024px (primary breakpoint for layout shifts)
- `xl:` → 1280px

## Status Badge Pattern

```html
<!-- Confirmed -->
<span class="px-2 py-1 rounded-full text-xs font-body font-body-medium bg-success/10 text-success">Confirmed</span>

<!-- Pending -->
<span class="px-2 py-1 rounded-full text-xs font-body font-body-medium bg-warning/10 text-warning">Pending</span>

<!-- Cancelled -->
<span class="px-2 py-1 rounded-full text-xs font-body font-body-medium bg-error/10 text-error">Cancelled</span>

<!-- In Progress -->
<span class="px-2 py-1 rounded-full text-xs font-body font-body-medium bg-primary/10 text-primary">In Progress</span>

<!-- Completed -->
<span class="px-2 py-1 rounded-full text-xs font-body font-body-medium bg-accent/10 text-accent-foreground">Completed</span>
```

## Button Usage Quick Reference

```jsx
<Button variant="primary" iconName="Plus" iconSize={16}>Create Booking</Button>
<Button variant="outline" iconName="ChevronLeft" iconSize={16}>Back</Button>
<Button variant="danger" iconName="Trash2" iconSize={16}>Cancel</Button>
<Button variant="success" iconName="Check" iconSize={16}>Confirm</Button>
<Button variant="text" iconName="Search" iconSize={16}>Search</Button>
```
