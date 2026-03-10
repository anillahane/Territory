const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Branches' }).click();
  await page.waitForTimeout(2500);

  const urlAfter = page.url();
  const hasGrid = await page.locator('[role="grid"]').count();
  const branchHeading = await page.getByText('Branch Management', { exact: false }).count();
  const rootTextLen = await page.evaluate(() => (document.getElementById('root')?.innerText || '').trim().length);

  await page.screenshot({ path: 'c:/MIS/Territory Redesign/Territory/tmp_nav_branches_after_click.png', fullPage: true });

  console.log(`URL_AFTER=${urlAfter}`);
  console.log(`GRID_COUNT=${hasGrid}`);
  console.log(`BRANCH_HEADING_COUNT=${branchHeading}`);
  console.log(`ROOT_TEXT_LEN=${rootTextLen}`);
  console.log('ERRORS_START');
  if (errors.length === 0) {
    console.log('none');
  } else {
    for (const e of errors) console.log(e);
  }
  console.log('ERRORS_END');

  await browser.close();
})();
