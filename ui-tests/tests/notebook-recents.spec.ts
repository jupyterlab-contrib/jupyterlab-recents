import { expect, test } from '@jupyterlab/galata';

const DEFAULT_NAME = 'untitled.txt';

test.use({
  waitForApplication: async ({ baseURL }, use, testInfo) => {
    const waitIsReady = async (page): Promise<void> => {
      await page.waitForSelector('#main-panel');
    };
    await use(waitIsReady);
  }
});

test('should list opened file under recents', async ({ page }) => {
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page
    .locator('#jp-mainmenu-file')
    .getByText('New', { exact: true })
    .click();

  const [filePage] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByText('Text File', { exact: true }).click()
  ]);

  await filePage.getByRole('heading', { name: DEFAULT_NAME }).waitFor();

  await filePage.close();

  await page.menu.clickMenuItem('File>Recents');

  expect(page.locator(`.lm-Menu > text=${DEFAULT_NAME}`));
  expect(page.locator('.lm-Menu > text=Clear Recents'));
});
