# Mirsad — مرصاد — Design System

A documented design system for **Mirsad** (Arabic: **مرصاد**), a monitoring and compliance platform for organizations. Mirsad records workplace violations, attaches evidence, and routes each case through a structured ticket workflow — **Employee → Supervisor → Auditor → Management → Closed**. The interface is **Arabic-first with RTL layout**; numerals and dates are kept in **Latin/English glyphs** for readability inside Arabic copy.

This project distills the brand and UI patterns out of the single-file SPA at:

- **GitHub:** [rakan1234rh-create/rakan](https://github.com/rakan1234rh-create/rakan) — `index.html` (~17k lines, all HTML + CSS + JS) is the canonical source of truth. Explore it further to ground designs in real product detail (workflow states, role gating, panel structures, modal patterns).

Everything here is reverse-engineered from that single file; if you have access, open it in GitHub and search for the `--mr-*` CSS variables and class prefixes referenced below (`mr-topbar-`, `md-`, `wf-`, `fp-`, `rb-`, `rp-`, `cmp-`, `figma-`).

---

## 1. Product context

Mirsad is a **role-aware compliance platform**. Different surfaces appear for different roles:

| Role (key)   | Arabic label   | Surfaces they see                       |
|--------------|---------------|-----------------------------------------|
| `admin`      | مدير النظام    | Everything                              |
| `manager`    | المدير         | Dashboard, workflow, reports, compliance |
| `auditor`    | المدقق         | Reports, compliance, workflow            |
| `supervisor` | المشرف         | New violation, workflow                  |
| `employee`   | الموظف         | Workflow (their tickets)                 |
| `observer`   | الراصد         | New violation, locations                 |

### Core surfaces
1. **Login screen** — Centered card with shield mascot, animated brand blob backdrop, pill inputs.
2. **App shell** — Sticky top bar (76px) + hover-expand sidebar rail (68px → 236px) + scrollable main.
3. **Dashboard** — Hero greeting, 4 KPI cards, recent activity list, quick-action stack, state distribution bars.
4. **Workflow (ticket queue)** — Filter panel, status-pill column, batch actions, modal ticket detail.
5. **New violation** — Form panel with employee autocomplete, type catalog, date/time, evidence upload.
6. **Reports / Compliance** — Charts, region/branch breakdowns, trend badges (up/down/flat), filter chips.
7. **Settings** — Regions & Branches, Users, Violation Types catalog.

### Ticket states (the "status pill" vocabulary)
- `emp` — بانتظار الموظف — **amber** pill
- `sup` — بانتظار المشرف — **blue** pill
- `aud` — بانتظار التدقيق — **purple** pill
- `mgt` — بانتظار الإدارة — **red** pill
- `closed` — مغلقة — **green** pill
- `Warning_Issued` — تنبيه إداري صادر — **amber** pill (no financial impact)
- `uploading` — *intermediate* — gray (loading)

These five colors are the entire ticket-pill palette and must be used consistently.

---

## 2. Content fundamentals

**Language.** Arabic-first throughout (`<html lang="ar" dir="rtl">`). Latin/English is reserved for: numbers, dates, times, IDs, file sizes, code, and the occasional mono kicker (e.g. the brand subtitle `MONITORING.SYSTEM`).

**Voice and casing.**
- Arabic copy is **professional, slightly formal, neutral**. Not chatty, not bureaucratic.
- Direct and instructional, addressing the user without pronouns — verbs and labels do the work (e.g. `"رصد مخالفة جديدة"` — "Record a new violation"; `"سجّل مخالفة بأكبر قدر من التفاصيل"` — "Log a violation with as much detail as possible").
- Welcomes are warm but restrained: `"مرحباً بك، فلان 👋"` paired with `"إليك نظرة عامة على أداء منصتك اليوم"`.
- Numbers integrate inline: `"3 تنبيهات إداري"`, `"245 مخالفة كلياً"` — Latin numeral, Arabic noun.
- English placeholder phrases are short and lowercase (e.g. `monitoring.system`, `Mirsad UI`).

**Examples** (verbatim from source):

| Where                 | Arabic copy                                              | Translation                                |
|-----------------------|---------------------------------------------------------|--------------------------------------------|
| Dashboard hero        | `مرحباً بك، {name} 👋`                                  | Welcome, {name}                            |
| Dashboard sub         | `إليك نظرة عامة على أداء منصتك اليوم`                   | Here's an overview of your platform today  |
| KPI labels            | `إجمالي المخالفات` / `معتمدة نهائياً` / `قيد المعالجة`   | Total violations / Final-approved / In-progress |
| Empty state          | `لا توجد تنبيهات`                                       | No notifications                           |
| Filter button         | `فرز بواسطة`                                            | Sort by                                    |
| Search placeholder    | `ابحث في التذاكر، المخالفات، الموظفين، والفروع...`      | Search tickets, violations, employees, branches… |
| Indicator badge       | `لا مخالفات مؤثرة`                                      | No impacting violations                    |

**Emoji.** Used very sparingly — only one is recurring: 👋 in the welcome line (`md-wave`, gently animated). Everything else is icons. **Do not invent new emoji usage.**

**Punctuation and numerals.** Latin digits inside Arabic sentences: `"3 تنبيه إداري (بدون أثر مالي)"`. Decimal/percentage formatting is the standard `12.4%`. Times are `HH:MM:SS AM/PM` in English. Use Arabic punctuation (`،`، `؛`) only inside paragraphs of Arabic prose, not in UI labels.

**Vibe.** Refined, slightly glossy, government-adjacent without feeling bureaucratic. Closer to a modern banking dashboard than a workplace HR tool. Confident, not playful.

---

## 3. Visual foundations

### Color
The palette is **black primary on soft white**, with a calm neutral ladder and four semantic accents. No gradients on cards — the only gradient in the system is the **login background wash** (`linear-gradient(135deg, #f8fafc 0%, #fff 45%, #f1f5f9 100%)`) and two **animated blur blobs** behind the login card. Everything else is solid fills.

- **Primary black** `#0f1224` — used for: primary buttons, active sidebar icon tile, focus ring, table-header tint, brand wordmark, link accents. Its 2 light tints (`primary-soft` `#e9e9ef`, `primary-softer` `#f3f3f6`) handle hover, focus glow, and washes.
- **Neutrals** start at `#ffffff` (surface), step to `#f9fafb` (app bg), then to `#e4e6ef` (border) and `#acb1c6` (stronger divider). Text is `#0f1224 → #4a4d63 → #8b90a6 → #9aa2b8` — note that the primary and the deepest text token are intentionally the same value, giving the brand a refined, monochrome grounding.
- **Semantic** colors are tuned for badges, not buttons: green `#16a34a`, amber `#f59e0b`, red `#ef4444`. Each has a 10%-alpha fill plus a 25%-alpha border on light backgrounds.
- **Dark theme** swaps surfaces to deep navy (`#080c14`, `#131826`); the source app also shifts the action color to iOS-blue (`#0A84FF`) in dark mode for OS-native feel, but the **brand mark stays black** for consistency in both modes.

### Type
- **Family.** `IBM Plex Sans Arabic` for everything (300/400/500/600/700). `JetBrains Mono` (400/600) for numerals, IDs, timestamps, and the eyebrow kicker `MONITORING.SYSTEM`. Roboto + Poppins are loaded in the source for two Figma-borrowed widgets and are *not* part of the main type system.
- **Scale.** Hero `32px / 700` → Page title `21px / 700` → Card title `16px / 700` → Body `13px / 400-600` → Meta `11px / 500-600` → Kicker `10px / 600 uppercase`. Numerals always tabular.
- **Weights in use.** 800 only on brand mark + page-shell titles; 700 on hero / card titles; 600 on labels, button text, badges; 500 on body; 400 on long paragraphs (rare in app).
- **Casing.** Arabic doesn't use case; uppercase is reserved for **Latin kickers/eyebrows** (`MONITORING.SYSTEM`) and **mono code-ish snippets**.
- **Tracking.** Slightly negative on big titles (`-0.02em`); generous (`0.12em`) on uppercase Latin kickers.

### Spacing
- Page gutter: `24px`. Card interior: `22px`. Tight controls: `10px–14px`.
- Stat-card grid: `clamp(12px, 2vw, 22px)` gap. Sidebar nav-items: `6px` vertical rhythm.
- The system is informal — values are mostly from a 2/4/8 base, with the dashboard cards using `clamp()` for breathable scaling. No rigid 8pt grid is enforced.

### Backgrounds & layers
- App background is **flat soft white** (`#f9fafb`). No texture, no patterns, no illustrations.
- Cards are **pure white** with a 1px `#e4e6ef` border and a **two-stop soft shadow** (`0 2px 6px / 0 8px 24px`, both very low opacity). They feel glossy by virtue of edge contrast, not glare.
- The login screen is the only place with motion in the background: two large blur-radius `48px` circles tinted with primary, animated on an 8-second loop (`lpBlobA` / `lpBlobB`). No imagery, no photography in the system.

### Animation
- **Easings.** `cubic-bezier(0.22, 1, 0.36, 1)` (smooth ease-out) for entry animations; `cubic-bezier(0.34, 1.56, 0.64, 1)` (gentle spring) for icon pops and tab hovers; default ease `0.15s–0.22s` for hover state changes.
- **Patterns.**
  - Cards/rows: fade-up `translateY(20px → 0)` over 0.5–0.6s.
  - Stat cards: slight lift on hover `translateY(-4px)`.
  - Sidebar items: `translateX(-3px / -2px)` slide on hover (RTL — so they slide *toward* their icon).
  - The hero 👋 emoji wiggles (`mdWave` 0/14/-10/0deg).
  - Honors `prefers-reduced-motion: reduce` and disables all entry animations.

### Hover / press states
- **Default UI.** Hover lifts background to `--mr-primary-softer` (`#f5f3ff`) and shifts text/icon to primary purple. No translucency tricks; just a solid tint swap.
- **Primary buttons.** Hover deepens fill to `--mr-primary-hover` `#5a4eef`. Keep the `0 6px 16px rgba(104,91,255,0.28)` purple glow shadow.
- **Pill chips and quick-actions.** Hover swaps border to primary + bg to softer wash + text to primary.
- **Press** isn't strongly differentiated visually; the source relies on the hover state pulling double duty. Active tab gets a colored icon tile (primary-fill square) instead of a fully recolored row.
- **Disabled.** `opacity: 0.55`, `cursor: not-allowed`, `pointer-events: none`.

### Borders & shadows
- Default border: **1px `#e4e6ef`**. Stronger divider: **`#acb1c6`** (used inside the top-bar divider).
- Shadows form **three tiers**: `--mr-shadow-soft` (1-line lift), `--mr-shadow-card` (resting card), `--mr-shadow-lg` (modal). The primary button gets its own colored glow `--mr-shadow-primary`.
- The sidebar uses a **side shadow** (`-8px 0 24px`) only when expanded on hover — a tactile "drawer is out" affordance.

### Transparency & blur
- The unified top bar uses `backdrop-filter: blur(12px)` on a solid surface — it stays visually solid on a flat bg but ready for content scrolled underneath.
- The login background blobs use `filter: blur(48px)` with the primary at 18% mix for a glow effect.
- Modal overlay: full-screen black at low opacity; cards float above with `--mr-shadow-lg`.

### Layout rules
- **Fixed elements:** sticky top bar, sticky sidebar. Both stay on screen during scroll. Sidebar is 68px collapsed (icons only) and expands on hover to 236px on desktop. On mobile (<992px), it becomes a slide-in drawer from the right (RTL) with an overlay.
- **Cards** never stretch full width on desktop — content is capped at `max-width: 1600px` and centered.
- **Tables** sit inside `.panel` cards. Table headers tint to `#f3f0ff` (lighter purple); rows hover to `#faf9ff`.

### Corner radii
- **Pill** (`34px` / `999px`): all buttons, search bars, dropdowns, badges that aren't square chips, quick-action rows, top-bar circular icon buttons.
- **Card** (`20px`): panels, cards, modal containers, KPI cards, the sidebar (when free-floating).
- **Medium** (`14px`): nav-item rows, form inputs (non-pill), small popovers, brand icon tile.
- **Small** (`10px`): the rounded square the active sidebar icon sits in; quick-action button mini-icons.

### Card recipe (canonical)
```css
background: var(--mr-surface);
border:     1px solid var(--mr-border);
border-radius: var(--mr-radius-card);   /* 20px */
padding:    22px;
box-shadow: var(--mr-shadow-card);
```

---

## 4. Iconography

**System:** **Font Awesome 6** (Solid) via CDN — referenced as `<i class="fas fa-...">`. The source app loads:

```html
<link rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
```

This design system continues to use Font Awesome 6 Solid from CDN. We did not find a custom in-repo icon font, SVG sprite, or PNG icon folder — Mirsad delegates entirely to Font Awesome. No substitution was needed.

**Used glyphs (representative).** `fa-shield-halved` (brand), `fa-table-cells-large` (dashboard), `fa-circle-plus` (new), `fa-ticket` (workflow), `fa-chart-bar` (reports), `fa-gauge-high` (compliance), `fa-map-location-dot`, `fa-users-gear`, `fa-triangle-exclamation` (violations), `fa-magnifying-glass` (search), `fa-bell` (notifications), `fa-moon` (theme toggle), `fa-bars` (mobile menu), `fa-clock`, `fa-arrow-right-from-bracket` (logout), `fa-circle-check`, `fa-hourglass-half`, `fa-arrow-trend-up`, `fa-bolt`, `fa-chart-pie`, `fa-user-tie`, `fa-location-dot`.

**Sizing.** Inside nav-items: 14px glyph inside a 34×34px tile with 10px corner radius. Top-bar circular buttons: 13–15px glyph inside a 40×40 circle. Inline meta: 10–12px.

**Color rules.** Icons inherit text color unless they sit on a colored tile (active sidebar item, primary CTA, KPI ico-square). KPI ico-squares use the four brand-tinted backgrounds: blue (primary), green, amber, red.

**No SVG illustrations.** The brand has no custom SVG illustrations or hand-drawn glyphs. The favicon uses a 🛡️ emoji inside an inline SVG `<text>` — that's the *only* place emoji acts as an icon.

**Emoji.** Limited to the wave 👋 in the dashboard greeting (gently animated). Treat as part of the welcome microcopy, not as a general icon system.

---

## 5. Index — files in this design system

```
.
├── README.md                  ← you are here
├── SKILL.md                   ← Agent-Skill manifest (works in Claude Code)
├── colors_and_type.css        ← all tokens (CSS vars), webfont @imports
├── _source/                   ← original imported source HTML (read-only ref)
│   └── mirsad_index.html
├── assets/
│   └── (icons via Font Awesome CDN — see ICONOGRAPHY)
├── preview/                   ← Design System tab cards
│   ├── logo.html
│   ├── colors-primary.html
│   ├── colors-neutrals.html
│   ├── colors-semantic.html
│   ├── type-scale.html
│   ├── type-mono.html
│   ├── radii.html
│   ├── shadows.html
│   ├── spacing.html
│   ├── buttons.html
│   ├── pill-search.html
│   ├── form-inputs.html
│   ├── nav-item-states.html
│   ├── status-pills.html
│   ├── kpi-card.html
│   ├── card-recipe.html
│   ├── topbar.html
│   └── sidebar.html
└── ui_kits/
    └── mirsad/
        ├── README.md
        ├── index.html         ← interactive click-through prototype
        ├── Sidebar.jsx
        ├── TopBar.jsx
        ├── Dashboard.jsx
        ├── WorkflowTable.jsx
        ├── LoginScreen.jsx
        └── shared.jsx
```

---

## 6. Caveats / open questions

- **Brand primary diverges from source.** The original Mirsad app uses purple `#685bff`. Per design direction in this iteration, the primary has been swapped to **black `#0f1224`** — a deliberate move toward a more refined, monochrome system. All `--mr-primary*` tokens and shadow tints have been updated to match. The brand mark is now a **Mirsad wordmark** (and a `م` monogram on small surfaces), not the shield icon.
- **Fonts ship from Google Fonts CDN**, not bundled — IBM Plex Sans Arabic and JetBrains Mono are loaded over the network. If offline-first is required, please attach the `.woff2` files and we'll bundle them under `fonts/`.
- **Dark theme** behavior in the source app shifts the action color from the brand primary to iOS-blue. We kept the brand primary (now black) in both themes here for consistency; flag this if the original behavior is preferred.
- **No icons or illustrations** live in the repo — all are from Font Awesome 6 CDN. If you'd like a custom mark or illustration set, that's a separate brief.
- **Single product** detected — Mirsad is one web app, no marketing site, mobile app, or docs site in the source. The UI kit therefore covers app surfaces only.
