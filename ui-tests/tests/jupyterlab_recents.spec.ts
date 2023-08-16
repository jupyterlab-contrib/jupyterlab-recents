import { expect, test } from '@jupyterlab/galata';

const DEFAULT_NAME = 'untitled.txt';

test('should list opened file under recents', async ({ page }) => {
  await page.menu.clickMenuItem('File>New>Text File');

  await page.waitForSelector(`[role="main"] >> text=${DEFAULT_NAME}`);

  await page.activity.closeAll();

  await page.menu.clickMenuItem('File>Recents');

  expect(page.locator(`.lm-Menu > text=${DEFAULT_NAME}`));
  expect(page.locator('.lm-Menu > text=Clear Recents'));
});
