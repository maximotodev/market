import { describe, expect, test } from 'bun:test'
import type { SendOperation } from '@cashu/coco-core'
import { assertNonBearerAuctionLeg } from '@/lib/coco/auctionDemo/bindingStore'
import { buildAuctionConditionFingerprint, FrozenCocoAuctionWallet, selectUniquePreparedOperation } from '@/lib/coco/auctionDemo/cocoPort'
import { FROZEN_COCO_REFUND_COMMIT, type CocoAuctionLegRecord } from '@/lib/coco/auctionDemo/types'

const recipientPublicKey = `02${'1'.repeat(64)}`
const secondRecipientPublicKey = `03${'3'.repeat(64)}`
const refundPublicKey = `03${'2'.repeat(64)}`
const otherRefundPublicKey = `02${'4'.repeat(64)}`

const leg = (overrides: Partial<CocoAuctionLegRecord> = {}): CocoAuctionLegRecord => {
	const condition = {
		mintUrl: 'http://localhost:3338',
		unit: 'sat',
		amount: 16,
		recipientPublicKey,
		refundPublicKey,
		locktime: 205,
	} as const
	return {
		version: 2,
		runId: 'run-1',
		state: 'INTENT',
		role: 'bidder-a',
		accountId: 'run-1:bidder-a',
		bidderPubkey: 'b'.repeat(64),
		auctionId: 'a'.repeat(64),
		auctionCoordinate: `30408:${'c'.repeat(64)}:run-1`,
		bidderLegId: 'run-1:bidder-a',
		...condition,
		derivationPath: 'm/1/2/3/4/5',
		conditionFingerprint: buildAuctionConditionFingerprint(condition),
		revision: 0,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

const preparedOperation = (id: string, options: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): SendOperation =>
	({
		id,
		state: 'prepared',
		mintUrl: 'http://localhost:3338',
		amount: { toNumber: () => 16 },
		unit: 'sat',
		method: 'p2pk',
		methodData: {
			options: {
				pubkey: recipientPublicKey,
				locktime: 205,
				refundKeys: [refundPublicKey],
				requiredSignatures: 1,
				requiredRefundSignatures: 1,
				sigFlag: 'SIG_INPUTS',
				...options,
			},
		},
		createdAt: 1,
		updatedAt: 1,
		needsSwap: true,
		fee: { toNumber: () => 0 },
		inputAmount: { toNumber: () => 16 },
		inputProofSecrets: [],
		...overrides,
	}) as unknown as SendOperation

describe('Coco Auction adversarial integration boundary', () => {
	test('pins the exact frozen Coco refund candidate', () => {
		expect(FROZEN_COCO_REFUND_COMMIT).toBe('190b25b0c16eb6ebbb42e1d67a0d28399c641ae1')
	})

	test('P1/P4 binds exactly one full-condition candidate', () => {
		const exact = preparedOperation('exact')
		const wrongAmount = preparedOperation('wrong-amount', {}, { amount: { toNumber: () => 17 } })
		const wrongMint = preparedOperation('wrong-mint', {}, { mintUrl: 'http://localhost:9999' })
		const wrongUnit = preparedOperation('wrong-unit', {}, { unit: 'usd' })
		expect(selectUniquePreparedOperation([wrongAmount, wrongMint, exact, wrongUnit], leg())?.id).toBe('exact')
	})

	test('P2 rejects a sibling with a second or extra recipient', () => {
		const exact = preparedOperation('exact')
		const secondRecipient = preparedOperation('second-recipient', { pubkey: [recipientPublicKey, secondRecipientPublicKey] })
		const extraRecipientTag = preparedOperation('extra-recipient-tag', { additionalTags: [['pubkeys', secondRecipientPublicKey]] })
		expect(selectUniquePreparedOperation([secondRecipient, extraRecipientTag, exact], leg())?.id).toBe('exact')
	})

	test('P3 rejects refund, locktime, sigflag, threshold, and additional-tag siblings', () => {
		const siblings = [
			preparedOperation('refund', { refundKeys: [otherRefundPublicKey] }),
			preparedOperation('locktime', { locktime: 206 }),
			preparedOperation('sigflag', { sigFlag: 'SIG_ALL' }),
			preparedOperation('threshold', { requiredSignatures: 2 }),
			preparedOperation('refund-threshold', { requiredRefundSignatures: 2 }),
			preparedOperation('tag', { additionalTags: [['custom', 'condition']] }),
		]
		expect(selectUniquePreparedOperation([...siblings, preparedOperation('exact')], leg())?.id).toBe('exact')
	})

	test('fails closed when more than one full-condition candidate exists', () => {
		expect(() => selectUniquePreparedOperation([preparedOperation('one'), preparedOperation('two')], leg())).toThrow('More than one exact')
	})

	test('T1 rejects bearer and private fields from workflow records', () => {
		expect(() => assertNonBearerAuctionLeg({ ...leg(), token: 'cashuBearer' })).toThrow('forbidden bearer')
		expect(() => assertNonBearerAuctionLeg({ ...leg(), privateKey: 'secret' })).toThrow('forbidden bearer')
	})

	test('T2 keeps the demo seed private to the sealed wallet adapter', async () => {
		const exports = await import('@/lib/coco/auctionDemo/cocoPort')
		expect(Object.keys(exports).some((name) => /seed/i.test(name))).toBe(false)
		const wallet = new FrozenCocoAuctionWallet('seed-boundary-test')
		expect(Object.keys(wallet).some((name) => /seed/i.test(name))).toBe(false)
		expect('seed' in (wallet as unknown as Record<string, unknown>)).toBe(false)
	})
})
