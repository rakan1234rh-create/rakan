---
name: mirsad-design
description: Use this skill to generate well-branded interfaces and assets for Mirsad (مرصاد) — a monitoring and compliance platform — either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, and a UI kit of components for prototyping. The brand is Arabic-first (RTL) with Latin/English numerals.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files (`colors_and_type.css`, `ui_kits/mirsad/`, `preview/`, `_source/mirsad_index.html`).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions about audience and scope, and act as an expert designer who outputs HTML artifacts *or* production code, depending on the need.

Key conventions to remember:
- **Direction is RTL**; numbers, dates, IDs, and timestamps stay in **Latin/English** glyphs.
- **Primary is black `#0f1224`** (not purple — the brand has been refreshed).
- **Primary font: IBM Plex Sans Arabic**; mono numerals: **JetBrains Mono**.
- **Corners**: 34 (pill) / 20 (card) / 14 (input) / 10 (icon tile).
- **Cards**: white surface, 1px `#e4e6ef` border, two-stop soft shadow, 22px padding.
- **Ticket-state palette** (don't break this): emp→amber · sup→blue · aud→purple · mgt→red · closed→green · warning→amber.
- **Icons**: Font Awesome 6 Solid via CDN.
- **No emoji** beyond the welcome 👋. **No gradient cards.** **No invented illustrations.**
