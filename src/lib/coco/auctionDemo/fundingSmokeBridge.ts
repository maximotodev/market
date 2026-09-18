import { FrozenCocoAuctionWallet } from './cocoPort'
import { getLegacyAuctionMonetaryAudit, resetLegacyAuctionMonetaryAuditForTests } from './legacyAudit'
import { isCocoAuctionDemoMode } from './mode'
import { inspectCocoRuntime } from './runtimeProbe'

interface FundingSmokeReport {
	runtime: ReturnType<typeof inspectCocoRuntime>
	quotePaymentState: string
	finalQuoteState: string
	operationState: string
	balance: number
	realIndexedDb: boolean
	legacyFallbackCalls: number
}

const runFundingSmoke = async (input?: { mintUrl?: string; amount?: number }): Promise<FundingSmokeReport> => {
	if (!isCocoAuctionDemoMode()) throw new Error('Coco Auction demo mode is not enabled')
	const runtime = inspectCocoRuntime()
	if (!runtime.sameAmountConstructor || !runtime.coreAcceptsIndexedDbAmount || !runtime.indexedDbAcceptsCoreAmount) {
		throw new Error('Coco runtime package graph is incoherent')
	}

	resetLegacyAuctionMonetaryAuditForTests()
	const mintUrl = input?.mintUrl ?? process.env.APP_DEV_TEST_MINT_URL ?? 'http://localhost:3338'
	const amount = input?.amount ?? 32
	const accountId = `funding-smoke:${crypto.randomUUID()}`
	const wallet = new FrozenCocoAuctionWallet(accountId)
	await wallet.boot()
	try {
		const funding = await wallet.fundDemoWallet(mintUrl, amount)
		const balance = await wallet.getBalance(mintUrl)
		const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
		const realIndexedDb = databases.some((database) => database.name?.includes(accountId))
		const legacyCalls = Object.values(getLegacyAuctionMonetaryAudit()).reduce((sum, count) => sum + count, 0)
		return Object.freeze({
			runtime,
			quotePaymentState: funding.quotePaymentState,
			finalQuoteState: funding.finalQuoteState,
			operationState: funding.state,
			balance: balance.spendable,
			realIndexedDb,
			legacyFallbackCalls: legacyCalls,
		})
	} finally {
		await wallet.dispose()
	}
}

export const installCocoFundingSmokeBridge = (): void => {
	if (!isCocoAuctionDemoMode() || typeof window === 'undefined') return
	Object.defineProperty(window, '__cocoFundingSmoke', {
		configurable: true,
		value: Object.freeze({ inspectRuntime: inspectCocoRuntime, run: runFundingSmoke }),
	})
}

declare global {
	interface Window {
		__cocoFundingSmoke?: {
			inspectRuntime(): ReturnType<typeof inspectCocoRuntime>
			run(input?: { mintUrl?: string; amount?: number }): Promise<FundingSmokeReport>
		}
	}
}
