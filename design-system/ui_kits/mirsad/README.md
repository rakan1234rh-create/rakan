# Mirsad UI Kit

A click-through prototype of the Mirsad (مرصاد) monitoring & compliance app, built as a single-page React mock. The kit is **not production code** — it's a high-fidelity visual recreation suitable for prototyping, validation, and as a reference for the design system.

## Run

Open `index.html` in a browser. No build step. React + Babel are loaded from CDN, and `colors_and_type.css` (one level up) supplies all design tokens.

## Files

| File | Role |
|---|---|
| `index.html`           | Entry point. Loads React, Babel, all JSX modules, and styles. |
| `styles.css`           | All component styles, prefixed `mk-*` to avoid collisions. |
| `App.jsx`              | Root component — owns tab routing, sign-in state, theme. |
| `shared.jsx`           | Atoms: `Icon`, `Badge`, `Button`, `Card`, `SearchPill`, `Num`. Also sample ticket data and the `STATE_LABELS` ticket-state map. |
| `TopBar.jsx`           | Sticky top bar — brand wordmark, search pill, live clock, notifications, theme toggle, user chip. |
| `Sidebar.jsx`          | Hover-expand rail (68 → 236px) with two sections of nav items, badge support, logout. |
| `Dashboard.jsx`        | Hero, four KPI cards, recent activity, quick-action stack, state-distribution bars. |
| `WorkflowTable.jsx`    | Ticket queue with filter chips, search, table, and a workflow modal with stepper. |
| `NewTicketForm.jsx`    | New-violation form with employee picker, type select, segmented severity, drop zone. |
| `ComplianceView.jsx`   | Region cards with SVG score ring and trend badges. |
| `LoginScreen.jsx`      | Centered card with blob backdrop, password show/hide, remember-me. |

## What's interactive

- Sign in → app.
- Sidebar tabs switch the main panel.
- Theme toggle (top-right moon/sun) flips `data-theme="dark"` on `<html>`.
- Search box on the workflow tab filters the ticket list live.
- Filter chips on the workflow tab narrow by state.
- Clicking any row in the workflow table opens the ticket detail modal with a workflow stepper.

## What's NOT here

- No real backend. No persistence. No auth.
- Reports, Locations, Users, and Violation-Types tabs are placeholder cards — see `_source/mirsad_index.html` for the canonical screens.
- Animations are limited to what shipped in the source (hero wave, modal entry, card lift, blob loop on login). No new effects invented.

## Design notes

- All `--mr-*` tokens come from `../../colors_and_type.css`.
- Component class names live entirely in the `mk-*` namespace so this kit can be dropped next to the source app without leaking styles.
- Primary is **black `#0f1224`** (refreshed brand — was purple in the source).
- The brand mark in the top bar uses the **م monogram** so it stays legible at 44×44; the full `Mirsad` wordmark is reserved for surfaces with more breathing room (see `preview/logo.html`).
