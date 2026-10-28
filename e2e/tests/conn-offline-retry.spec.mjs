import { test, expect } from '@playwright/test';

test.describe('انقطاع الاتصال — واجهة إعادة المحاولة', () => {
  test('تظهر رسالة انقطاع واضحة مع زر إعادة المحاولة', async ({ page }) => {
    await page.goto('/conn-offline-harness.html');
    const overlay = page.getByTestId('athar-conn-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByRole('heading', { name: 'لا يوجد اتصال بالإنترنت' })).toBeVisible();
    await expect(page.getByTestId('athar-conn-retry')).toBeVisible();
    await page.getByTestId('athar-conn-retry').click();
    await expect(overlay).toBeHidden();
    await expect(page.getByText('تمت إعادة المحاولة')).toBeVisible();
  });
});
