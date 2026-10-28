import { test, expect } from '@playwright/test';

test.describe('تقارير — واجهة محسّنة', () => {
  test('رأس الصفحة والمؤشرات والتصدير ظاهرة ويمكن التركيز عليها', async ({ page }) => {
    await page.goto('/reports-ui-harness.html');
    await expect(page.getByRole('heading', { name: 'التقارير' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'ملخص المؤشرات' })).toBeVisible();
    const exportBtn = page.getByTestId('rp-export');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toHaveAttribute('aria-label', /Excel/);
    await exportBtn.focus();
    await expect(exportBtn).toBeFocused();
    await expect(page.getByRole('heading', { name: 'اتجاه الالتزام الشهري' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'تقارير سريعة' })).toBeVisible();
    await expect(page.getByTestId('rp-link-mc')).toBeVisible();
    await expect(page.getByTestId('rp-link-emc')).toBeVisible();
    await page.screenshot({
      path: '../artifacts/reports-ui-desktop.png',
      fullPage: true,
    });
  });

  test('تسمية العمود عند الصفر تبقى فوق العمود لا في منتصف المخطط', async ({ page }) => {
    await page.goto('/reports-ui-harness.html');
    const zeroBar = page.getByTestId('rp-bar-zero');
    await expect(zeroBar).toBeVisible();
    const pos = await zeroBar.evaluate((el) => {
      const pct = el.querySelector('.rd-rp-bar__pct');
      const fill = el.querySelector('.rd-rp-bar__fill');
      const track = el.querySelector('.rd-rp-bar__track');
      const pr = pct.getBoundingClientRect();
      const fr = fill.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      return {
        pctBottom: pr.bottom,
        fillTop: fr.top,
        trackMidY: tr.top + tr.height / 2,
        pctCenterY: pr.top + pr.height / 2,
      };
    });
    expect(pos.pctBottom).toBeLessThanOrEqual(pos.fillTop + 1);
    expect(pos.pctCenterY).toBeGreaterThan(pos.trackMidY);
  });

  test('أزرار التقارير تتبع ثيم الوضع الداكن', async ({ page }) => {
    await page.goto('/reports-ui-harness.html');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const exportBtn = page.getByTestId('rp-export');
    const link = page.getByTestId('rp-link-emc');
    await expect(exportBtn).toBeVisible();
    const colors = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="rp-export"]');
      const linkEl = document.querySelector('[data-testid="rp-link-emc"]');
      const bs = getComputedStyle(btn);
      const ls = getComputedStyle(linkEl);
      const parse = (c) => {
        const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const lum = (rgb) => (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      const btnBg = parse(bs.backgroundColor);
      const btnFg = parse(bs.color);
      const linkBg = parse(ls.backgroundColor);
      return {
        btnBgLum: btnBg ? lum(btnBg) : -1,
        btnFgLum: btnFg ? lum(btnFg) : -1,
        linkBgLum: linkBg ? lum(linkBg) : -1,
        btnColor: bs.color,
        linkBg: ls.backgroundColor,
      };
    });
    // Primary in ATHAR dark is light; text must be dark (readable).
    expect(colors.btnBgLum).toBeGreaterThan(180);
    expect(colors.btnFgLum).toBeLessThan(80);
    // Quick-report links use surface (dark), not leftover pure white.
    expect(colors.linkBgLum).toBeLessThan(80);
    await page.screenshot({
      path: '../artifacts/reports-ui-dark.png',
      fullPage: true,
    });
  });
});
