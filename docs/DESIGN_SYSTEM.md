# SoCrates Design System

> Binding design principles and patterns for all SoCrates app pages.
> Marketing/landing pages (landing.css, tools.css) follow their own visual language and are out of scope.

---

## 1. Design Principles

| Principle | Description |
|-----------|-------------|
| **Dark-first, theme-aware** | Design for dark mode first; use CSS variables so light mode inherits automatically. Never hardcode `rgba()` or hex colors — use design tokens. |
| **Glassmorphism depth** | Cards use gradient backgrounds with subtle transparency. Overlays use `backdrop-filter: blur()`. Surfaces feel layered, not flat. |
| **Micro-interactions** | Every interactive element has a transition (`0.15s–0.3s ease`). Buttons lift on hover (`translateY(-1px)`). Cards glow on hover. |
| **Information density with clarity** | Data-heavy pages should still feel premium. Use spacing, subtle borders, and color-coding to create hierarchy without clutter. |
| **System-native feel** | Use the system font stack. Avoid decorative fonts. Keep UI functional and snappy — not flashy. |
| **No hardcoded colors** | Always use CSS variables or `color-mix()` with CSS variables. This ensures light/dark theme compatibility and maintainability. |
| **Consistent component patterns** | Every card, button, input, badge, and table should follow the same structural pattern across all pages. Copy from the reference patterns below — do not reinvent. |

---

## 2. Design Tokens (CSS Variables)

All tokens are defined in `frontend/css/shared-styles.css` and automatically switch between dark and light themes.

### 2.1 Colors

```
Background:
  --bg-primary        Main page background
  --bg-secondary      Raised surface / secondary panels
  --bg-tertiary       Elevated surfaces / button defaults
  --bg-card           Card fill (flat variant)
  --bg-overlay        Semi-transparent panel/header tint
  --bg-input          Input field background
  --bg-terminal       Code/output console background

Border:
  --border-primary    Default borders
  --border-secondary  Subtle card/panel borders (preferred for cards)
  --border-accent     Focused/highlighted borders (blue tint)

Text:
  --text-primary      Main body text
  --text-secondary    Labels, meta, secondary copy
  --text-muted        Hints, disabled text, captions
  --text-placeholder  Input placeholders

Accent:
  --accent-blue       Primary interactive color
  --accent-blue-hover Hover state for blue accent
  --accent-blue-bg    Translucent blue background (badges, highlights)

Status:
  --color-success / --color-success-dark / --color-success-bg
  --color-warning / --color-warning-bg
  --color-danger  / --color-danger-bg
  --color-info    / --color-info-bg

Additional:
  --color-purple, --color-orange, --color-yellow
```

### 2.2 Gradients

```
--gradient-card      Card backgrounds (preferred over flat --bg-card)
--gradient-success   Primary action buttons
--gradient-accent    Blue accent buttons
--gradient-primary   Page-level background (rarely used)
```

### 2.3 Shadows

```
--shadow-sm    Subtle elevation (badges, small cards)
--shadow-md    Medium elevation (hover states)
--shadow-lg    High elevation (card hover, modals)
--shadow-xl    Maximum elevation (overlays, featured elements)
```

### 2.4 Border Radius

```
--radius-sm    4px   Small elements (badges, chips)
--radius-md    6px   Medium elements (inputs in some contexts)
--radius-lg    8px   Standard elements (inputs, buttons, stat boxes)
--radius-xl    12px  Cards, panels
--radius-2xl   16px  Large feature cards, modals
```

### 2.5 Spacing

```
--space-xs     4px
--space-sm     8px
--space-md     12px
--space-lg     16px
--space-xl     20px
--space-2xl    24px
--space-3xl    32px
```

### 2.6 Typography

```
--font-family  System font stack (-apple-system, BlinkMacSystemFont, 'Segoe UI', ...)
--font-mono    Monospace stack ('SF Mono', 'Consolas', 'Monaco', ...)

--font-size-xs    11px    Eyebrow labels, badge text
--font-size-sm    12px    Meta text, small labels
--font-size-md    13px    Body text, input text, button text
--font-size-base  14px    Standard body
--font-size-lg    16px    Card titles, section headers
--font-size-xl    18px    Page subtitles
--font-size-2xl   22px    Large metric values
```

### 2.7 Transitions

```
--transition-fast    0.15s ease    Hover states, toggles
--transition-normal  0.2s ease     Standard interactions
--transition-slow    0.3s ease     Panel slides, complex animations
```

---

## 3. Component Patterns

### 3.1 Cards

Cards are the primary content container. **Always use gradient backgrounds.**

```css
.card {
    background: var(--gradient-card);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-xl);       /* 12px */
    overflow: hidden;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
    border-color: color-mix(in srgb, var(--accent-blue) 30%, transparent);
    box-shadow: var(--shadow-lg);
}
```

**Card header:**
```css
.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: var(--bg-overlay);
    border-bottom: 1px solid color-mix(in srgb, var(--border-primary) 40%, transparent);
}
```

**Card body:**
```css
.card-body {
    padding: 16px 18px;
}
```

#### Do / Don't

| ✅ Do | ❌ Don't |
|-------|---------|
| `background: var(--gradient-card)` | `background: var(--bg-card)` (flat) |
| `border: 1px solid var(--border-secondary)` | `border: 1px solid var(--border)` |
| Add hover state with glow + shadow | No hover state |
| Use `color-mix()` for header border | Use `var(--border)` directly |

---

### 3.2 Buttons

```css
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 14px;
    background: color-mix(in srgb, var(--bg-card) 80%, transparent);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);       /* 8px */
    color: var(--text-primary);
    font-size: var(--font-size-md);        /* 13px */
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
}
.btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--border-accent);
    transform: translateY(-1px);
}
.btn:active {
    transform: translateY(0);
}
.btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}
```

**Primary (green/action):**
```css
.btn-primary {
    background: var(--gradient-success);
    border-color: var(--color-success-dark);
    color: #fff;
    font-weight: 500;
}
.btn-primary:hover {
    filter: brightness(1.1);
}
```

#### Key rules
- Border radius is always **8px** (not 6px)
- Always include `transform: translateY(-1px)` on hover
- Always include `font-family: inherit`
- Include disabled + disabled:hover states

---

### 3.3 Inputs

```css
input, select, .input {
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);       /* 8px */
    color: var(--text-primary);
    padding: 8px 12px;
    font-size: var(--font-size-md);        /* 13px */
    font-family: inherit;
    outline: none;
    transition: all 0.2s ease;
}
input:focus, select:focus, .input:focus {
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 3px var(--accent-blue-bg);
}
```

#### Key rules
- Border radius is **8px** (not 6px)
- Always include the **focus ring** (`box-shadow: 0 0 0 3px var(--accent-blue-bg)`)
- Transition should be `all 0.2s ease` (not just `border-color`)
- Use `var(--bg-input)` (not `var(--bg-secondary)`)

---

### 3.4 Badges & Chips

```css
.badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: var(--font-size-xs);        /* 11px */
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    border: 1px solid transparent;
}
```

**Status variants use `color-mix()`:**
```css
.badge.success {
    background: color-mix(in srgb, var(--color-success) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
    color: var(--color-success);
}
.badge.warning {
    background: color-mix(in srgb, var(--color-warning) 16%, transparent);
    border-color: color-mix(in srgb, var(--color-warning) 32%, transparent);
    color: var(--color-warning);
}
.badge.danger {
    background: color-mix(in srgb, var(--color-danger) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
    color: var(--color-danger);
}
```

---

### 3.5 Tables

```css
.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-md);
}
.data-table th, .data-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border-secondary);
}
.data-table th {
    background: var(--bg-overlay);
    color: var(--text-secondary);
    font-weight: 600;
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.data-table tr:hover {
    background: color-mix(in srgb, var(--accent-blue) 5%, transparent);
}
```

#### Key rules
- Table borders use `var(--border-secondary)`, never `var(--border)`
- Header hover uses `color-mix()` with CSS variables, never hardcoded colors
- Sortable headers should show indicator and blue highlight on hover

---

### 3.6 Stat / Metric Cards

```css
.stat-box {
    background: var(--bg-overlay);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 14px;
    text-align: center;
    transition: border-color 0.2s ease;
}
.stat-box:hover {
    border-color: color-mix(in srgb, var(--accent-blue) 24%, transparent);
}
```

---

### 3.7 Empty States

```css
.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
}
.empty-state .icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
}
```

---

### 3.8 Custom Scrollbars

Use CSS variables for scrollbar styling — never hardcode colors.

```css
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track {
    background: var(--bg-overlay);
    border-radius: 4px;
}
::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--accent-blue) 30%, transparent);
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--accent-blue) 50%, transparent);
}
```

---

### 3.9 Status Messages

```css
.status {
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-md);
    margin-bottom: 16px;
}
.status.loading {
    background: var(--color-info-bg);
    border: 1px solid color-mix(in srgb, var(--accent-blue) 30%, transparent);
    color: var(--accent-blue);
}
.status.error {
    background: var(--color-danger-bg);
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
    color: var(--color-danger);
}
.status.success {
    background: var(--color-success-bg);
    border: 1px solid color-mix(in srgb, var(--color-success-dark) 30%, transparent);
    color: var(--color-success);
}
```

---

### 3.10 Iconography

SoCrates app surfaces should use the shared SVG icon language for **primary navigation, page titles, and section headers**.

#### Primary rules

- Navigation links: let `app-shell.js` decorate `.nav-link` items using the shared `data-nav-icon` mapping.
- Page titles: use a plain `<h1>` inside `.page-header`; `app-shell.js` will upgrade it to `.page-title--with-icon` automatically.
- Section headers: use a structured icon container, not raw emoji text.

```html
<div class="section-title">
    <span class="section-icon section-icon--reports" aria-hidden="true">
        <!-- inline SVG -->
    </span>
    <div>
        <div class="card-title">Energy reports</div>
        <div class="section-subtitle">Normalized daily and monthly totals.</div>
    </div>
</div>
```

```css
.section-icon {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border-primary) 68%, transparent);
        background:
                radial-gradient(circle at 24% 18%, color-mix(in srgb, white 24%, transparent), transparent 42%),
                linear-gradient(165deg, #173661 0%, #10284a 56%, #0d203d 100%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
}
.section-icon svg {
        width: 18px;
        height: 18px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.9;
}
```

#### Emoji policy

- **Allowed:** empty states, transient helper text, or non-critical diagnostic affordances.
- **Avoid:** page titles, nav labels, major card headers, or primary CTA buttons.
- If an icon is important to information hierarchy, use SVG.

---

### 3.11 Hero / Masthead Pattern

Important app pages should open with a **hero-style masthead**, not just a heading and one paragraph.

Use this pattern for analytical or operational pages such as ROI, Reports, Control, Admin, and future advanced tools.

```css
.page-header {
        padding: 28px;
        border-radius: 24px;
        border: 1px solid color-mix(in srgb, var(--border-primary) 70%, transparent);
        background:
                radial-gradient(circle at top left, color-mix(in srgb, var(--accent-blue) 18%, transparent), transparent 34%),
                linear-gradient(145deg, color-mix(in srgb, var(--bg-secondary) 96%, transparent), color-mix(in srgb, var(--bg-primary) 92%, transparent));
        box-shadow: var(--shadow-lg);
}
```

Recommended masthead contents:

- Eyebrow label (`.page-eyebrow`)
- Decorated page title (`.page-title`)
- One concise explanatory subtitle (`.page-subtitle`)
- 2–3 chips or 2–3 signal cards explaining what the page is for
- One contextual note or coverage banner when the page depends on provider capabilities

---

## 4. Layout Patterns

### 4.1 Page Container

```css
.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
}
```

- Standard max-width is **1400px**
- Never exceed 1400px unless the page is specifically for wide data tables

### 4.2 Page Header

```css
.page-header h1 {
    font-size: 1.8rem;
    font-weight: 600;
    color: var(--text-primary);    /* NOT var(--accent) */
    display: flex;
    align-items: center;
    gap: 12px;
}
.page-header p {
    color: var(--text-muted);
    margin-top: 8px;
    font-size: 14px;
}
```

### 4.3 Grid Layouts

```css
/* Standard card grid */
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
}

/* Responsive collapse */
@media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
}
```

### 4.4 Analytical Page Composition

For pages with multiple data surfaces, avoid long single-column stacks on desktop.

Preferred compositions:

- Two-column split: primary analysis left, timeline/secondary context right
- Two-row report grid: pricing + live history on top, reports + generation below
- Full-width diagnostics or raw payload viewer at the bottom

Examples:

```css
.roi-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.95fr);
    gap: 20px;
}

.reports-grid--top {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    gap: 20px;
}
```

On mobile, all of these must collapse back to a single column.

---

## 5. Color Usage Guidelines

### Translucent backgrounds with `color-mix()`

When you need a tinted background, always use `color-mix()` with CSS variables:

```css
/* ✅ Correct */
background: color-mix(in srgb, var(--accent-blue) 12%, transparent);
border-color: color-mix(in srgb, var(--accent-blue) 30%, transparent);

/* ❌ Wrong */
background: rgba(88, 166, 255, 0.12);
border-color: rgba(88, 166, 255, 0.3);
```

This ensures the colors adapt when switching between dark and light themes.

### Status color tints

| Context | Background opacity | Border opacity |
|---------|-------------------|----------------|
| Success | 8–14% | 26–30% |
| Warning | 8–16% | 28–32% |
| Danger | 8–14% | 26–30% |
| Info/Blue | 8–14% | 26–30% |

---

## 6. Responsive Design

### Breakpoints

| Breakpoint | Usage |
|------------|-------|
| **900px** | Grid collapses to single column; mobile nav patterns |
| **768px** | Control rows stack vertically |
| **640px** | Reduced padding; stacked layouts; touch-friendly targets |

### Mobile-first rules
- Touch targets minimum **44px** height
- Scrollbar-width: thin or hidden on mobile
- Use horizontal scroll for overflowing content (tables, preset buttons)
- Page sections must not create horizontal page overflow on 390px-wide viewports
- Hero signal cards and chips must stack cleanly instead of forcing sideways scroll
- Fixed-height analytical panes on desktop must switch to `height: auto` / `max-height: none` on mobile unless scroll containment is essential

### PWA rules

- Every app page must keep:
    - `<link rel="manifest" href="/manifest.webmanifest">`
    - `<meta name="mobile-web-app-capable" content="yes">`
    - `<meta name="apple-mobile-web-app-capable" content="yes">`
    - `<meta name="theme-color" content="#0d1117">`
- Use safe-area aware bottom spacing where a page has long scrolling content:

```css
.page-shell {
        padding-bottom: calc(var(--space-3xl) + env(safe-area-inset-bottom, 0px));
}
```

- Installed-PWA quality should be validated with viewport tests, not assumed from desktop behavior.

---

## 7. Anti-Patterns (Avoid)

| Anti-Pattern | Correct Approach |
|-------------|-----------------|
| `var(--border)` in new code | Use `var(--border-primary)` or `var(--border-secondary)` |
| `var(--accent)` for page titles | Use `var(--text-primary)` |
| `rgba(88, 166, 255, ...)` | Use `color-mix(in srgb, var(--accent-blue) N%, transparent)` |
| `rgba(126, 231, 135, ...)` | Use `color-mix(in srgb, var(--color-success) N%, transparent)` |
| `rgba(248, 81, 73, ...)` | Use `color-mix(in srgb, var(--color-danger) N%, transparent)` |
| `rgba(0, 0, 0, 0.2)` for overlays | Use `var(--bg-overlay)` |
| `border-radius: 6px` on inputs/buttons | Use `8px` / `var(--radius-lg)` |
| Missing focus ring on inputs | Always include `box-shadow: 0 0 0 3px var(--accent-blue-bg)` |
| Missing hover state on cards | Always add border-color + box-shadow transition |
| Missing `translateY(-1px)` on button hover | Always include for tactile feel |
| Flat `var(--bg-card)` on cards | Use `var(--gradient-card)` for depth |
| Hardcoded light theme colors (#f6f8fa, #e2e6ea) | Use CSS variables that auto-switch |
| Duplicate `<script>` tags | One deferred import per SDK module |
| Emoji-only headers for major sections | Use SVG section icons with a structured title block |
| Desktop-only stacked analytics pages | Compose analytical surfaces into responsive grids |
| “Responsive” meaning only `body` is visible | Assert no horizontal overflow on phone-sized viewports |
| Assuming installed PWA is fine because mobile Safari/Chrome is fine | Preserve manifest/meta tags and test viewport-safe layout explicitly |

---

## 8. File Organization

```
frontend/
├── css/
│   ├── shared-styles.css      ← Design tokens + shared component styles
│   ├── tour.css               ← Onboarding tour styles
│   ├── landing.css            ← Marketing page styles (out of scope)
│   ├── tools.css              ← Public tool page styles (out of scope)
│   └── market-insights.css    ← Market insights page-specific
├── js/
│   ├── theme-init.js          ← Theme initialization (must load sync)
│   └── app-shell.js           ← Nav, user menu, shared shell logic
└── [page].html                ← Each page imports shared-styles.css
```

### Adding a new page

1. Import `shared-styles.css` in `<head>`
2. Import `theme-init.js` synchronously (before other scripts)
3. Use the nav structure from any existing page (copy from `app.html`)
4. Place page-specific styles in a `<style>` tag — keep them minimal
5. Follow ALL component patterns from this document
6. Test in **both** dark and light themes

---

## 9. Reference Pages

These pages are considered the gold standard for design quality:

- **Overview** (`app.html`) — Premium dashboard with radial gradient cards, proper hover states, grid layouts
- **Rules Library** (`rules-library.html`) — Card-based grid with search, badges, and selection states
- **Market Insights** (`market-insights.html`) — Data visualization with proper stat boxes and grids
- **Settings** (`settings.html`) — Form-heavy page with proper input styling and sections

When in doubt, reference these pages for patterns and styling decisions.
