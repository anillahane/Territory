const { test, expect } = require('playwright/test');

test('dashboard to branches navigation should render content', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Branches' }).click();
  await page.waitForURL('**/branches', { timeout: 15000 });
  await expect(page.getByText('Branch Management')).toBeVisible({ timeout: 15000 });

  if (pageErrors.length > 0) {
    console.log('PAGE_ERRORS_START');
    for (const e of pageErrors) console.log(e);
    console.log('PAGE_ERRORS_END');
  }
});
