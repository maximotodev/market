import { expect, test, type Page } from '@playwright/test'

const runCleanFundingSmoke = async (page: Page) => {
	await page.goto('/')
	await page.waitForFunction(() => Boolean(window.__cocoFundingSmoke))
	const runtime = await page.evaluate(() => window.__cocoFundingSmoke!.inspectRuntime())
	expect(runtime.commit).toBe('190b25b0c16eb6ebbb42e1d67a0d28399c641ae1')
	expect(runtime.cashuTsVersion).toBe('5.0.0-rc.4')
	expect(runtime.sameAmountConstructor).toBe(true)
	expect(runtime.coreAcceptsIndexedDbAmount).toBe(true)
	expect(runtime.indexedDbAcceptsCoreAmount).toBe(true)

	const report = await page.evaluate(() => window.__cocoFundingSmoke!.run({ amount: 32 }))
	expect(report.quotePaymentState).toBe('PAID')
	expect(report.finalQuoteState).toBe('ISSUED')
	expect(report.operationState).toBe('finalized')
	expect(report.balance).toBe(32)
	expect(report.realIndexedDb).toBe(true)
	expect(report.legacyFallbackCalls).toBe(0)
}

test.describe('clean-browser frozen Coco funding foundation', () => {
	test('funds a fresh IndexedDB wallet — run 1', async ({ page }) => runCleanFundingSmoke(page))
	test('funds a separate fresh IndexedDB wallet — run 2', async ({ page }) => runCleanFundingSmoke(page))
})
