import { expect, test } from '@playwright/test'

// Placeholder: delete this file once the app you build has real screens to test.
// It exists only to prove the Playwright harness (a real Chromium browser) runs.
test('the page renders its heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Cybersteps Training Starter' })).toBeVisible()
})
