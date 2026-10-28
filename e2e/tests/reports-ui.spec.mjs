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
    await page.screenshot({
      path: '../artifacts/reports-ui-desktop.png',
      fullPage: true,
    });
  });
});
