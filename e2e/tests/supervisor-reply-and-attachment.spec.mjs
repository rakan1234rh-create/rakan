import { test, expect } from '@playwright/test';

/**
 * Smoke paths (mock harness — no production / Supabase):
 * (أ) ظهور تفاعل المشرف/الرد
 * (ب) فتح مرفق
 */
test.describe('ATHAR smoke: supervisor reply + attachment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/smoke-harness.html');
  });

  test('(أ) نموذج رد المشرف يظهر ويمكن إرسال رد محاكى', async ({ page }) => {
    const compose = page.getByTestId('supervisor-reply-compose');
    await expect(compose).toBeVisible();
    await expect(page.getByLabel('إضافة رد')).toBeVisible();

    const reply = page.locator('#respText');
    await reply.fill('موافقة المشرف — اختبار دخان');
    await page.getByTestId('send-reply-btn').click();

    await expect(page.getByTestId('reply-status')).toBeVisible();
    await expect(page.getByTestId('reply-status')).toContainText('تم إرسال رد المشرف');
  });

  test('(ب) فتح المرفق يظهر العارض ويمكن إغلاقه', async ({ page }) => {
    await page.getByTestId('open-attachment-btn').click();

    const viewer = page.getByTestId('att-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('aria-hidden', 'false');
    await expect(viewer.getByRole('img', { name: 'مرفق تجريبي' })).toBeVisible();

    await page.getByRole('button', { name: 'إغلاق عارض المرفقات' }).click();
    await expect(viewer).toHaveAttribute('aria-hidden', 'true');
  });
});
