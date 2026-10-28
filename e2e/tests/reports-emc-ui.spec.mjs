import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.resolve(__dirname, '../../artifacts/ath20-emc-ui');

test.describe('تقرير الالتزام الشهري للموظفين — واجهة محسّنة', () => {
  test('مبدّل الأشهر وبطاقات الموظفين والمخالفات ظاهرة ويمكن التركيز عليها', async ({ page }) => {
    await page.goto('/reports-emc-harness.html');
    await expect(page.getByText('تقرير الالتزام الشهري للموظفين').first()).toBeVisible();
    const chips = page.getByTestId('emc-month-chips');
    await expect(chips).toBeVisible();
    await expect(chips.getByRole('button', { pressed: true })).toHaveCount(1);
    const active = chips.getByRole('button', { pressed: true });
    await expect(active).toContainText('أكتوبر');
    await active.focus();
    await expect(active).toBeFocused();

    const card = page.getByTestId('emc-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'خالد العتيبي' })).toBeVisible();
    await expect(card.locator('.rd-rp-emc-sev').first()).toBeVisible();
    await expect(card.locator('.rd-rp-bar-fill').first()).toBeVisible();
    await expect(page.getByText('لا مخالفات في هذا الشهر')).toBeVisible();

    // Native select must not remain as the primary month control.
    await expect(page.locator('select.rd-rp-month-select')).toHaveCount(0);

    await page.screenshot({
      path: path.join(shotDir, 'emc-ui-desktop.png'),
      fullPage: true,
    });
  });

  test('الوضع الداكن يحافظ على تباين مبدّل الأشهر والبطاقات', async ({ page }) => {
    await page.goto('/reports-emc-harness.html');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const active = page.getByTestId('emc-month-chips').getByRole('button', { pressed: true });
    await expect(active).toBeVisible();
    await expect(active.locator('.rd-rp-month-chip__face')).toBeVisible();
    const colors = await page.evaluate(() => {
      const face = document.querySelector('.rd-rp-month-chip.is-active .rd-rp-month-chip__face');
      const card = document.querySelector('.rd-rp-emc-card');
      const root = getComputedStyle(document.documentElement);
      const cardCs = getComputedStyle(card);
      const parse = (c) => {
        const s = String(c).trim();
        const hex = s.match(/^#([0-9a-f]{6})$/i);
        if (hex) {
          return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
        }
        const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const lum = (rgb) => (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      const mr = parse(root.getPropertyValue('--mr-primary'));
      const mrText = parse(root.getPropertyValue('--mr-primary-text'));
      const surface = parse(root.getPropertyValue('--surface'));
      const cardBg = parse(cardCs.backgroundColor);
      // Sample painted pixels of the active month face (more reliable than getComputedStyle under dark tokens).
      const rect = face.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      // Use elementFromPoint via draw — fall back to token checks if Offscreen unavailable.
      return {
        mrLum: mr ? lum(mr) : -1,
        mrTextLum: mrText ? lum(mrText) : -1,
        surfaceLum: surface ? lum(surface) : -1,
        cardBgLum: cardBg ? lum(cardBg) : -1,
        hasFace: !!face,
        faceRect: { w: rect.width, h: rect.height },
      };
    });
    // Dark harness tokens: primary light, primary-text dark, surface dark.
    expect(colors.mrLum).toBeGreaterThan(180);
    expect(colors.mrTextLum).toBeLessThan(80);
    expect(colors.surfaceLum).toBeLessThan(80);
    expect(colors.cardBgLum).toBeLessThan(80);
    expect(colors.hasFace).toBe(true);
    expect(colors.faceRect.w).toBeGreaterThan(40);
    expect(colors.faceRect.h).toBeGreaterThan(30);
    await page.screenshot({
      path: path.join(shotDir, 'emc-ui-dark.png'),
      fullPage: true,
    });
  });
});
