---
name: design-system
description: Design specification guide — layout, components, color, typography, spacing, interactions, responsive, accessibility.
---

## Design Specification Guide

When creating design specs, cover each applicable section with exact values.

### Layout
- Grid system (columns, gutters, max-width)
- Visual hierarchy (primary → secondary → tertiary content)
- Semantic HTML structure (header, main, aside, footer)

### Components
- States: default, hover, focus, active, disabled, loading, error
- Variations: size (sm/md/lg), style (primary/secondary/ghost)
- Composition: how components nest and combine

### Color
- Palette with hex values: primary, secondary, neutral, semantic (success/error/warning/info)
- Contrast ratios: WCAG AA minimum (4.5:1 normal text, 3:1 large text)

### Typography
- Font family, fallback stack
- Scale: heading sizes (h1-h6), body, small, caption
- Weight, line-height, letter-spacing per level

### Spacing
- Scale: 4px base unit (4, 8, 12, 16, 24, 32, 48, 64)
- Component padding, margins, gaps — exact values

### Interactions
- Hover: color shift, scale, shadow changes
- Focus: visible outline (2px solid, offset 2px)
- Transitions: property, duration (150-300ms), easing
- Loading: skeleton, spinner, or progress indicator

### Responsive
- Breakpoints: mobile (320px+), tablet (768px+), desktop (1024px+)
- Layout changes at each breakpoint
- Touch targets: minimum 44x44px on mobile

### Accessibility
- Keyboard navigation order matches visual order
- Screen reader: semantic elements, ARIA labels where needed
- Works at 200% zoom
- No information conveyed by color alone
