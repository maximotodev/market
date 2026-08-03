import { describe, expect, spyOn, test } from 'bun:test'
import * as orderChatRelayRead from '@/lib/orders/nip17OrderChatRelayRead'
import type { OrderChatReadResult } from '@/lib/orders/nip17OrderChatReadOrchestration'
import type { ReadOrderChatRelayParams } from '@/lib/orders/nip17OrderChatRelayRead'
import { createOrderChatQueryOptions } from '../orderChat'
import { orderChatKeys, type OrderChatReadKeySnapshot } from '../queryKeyFactory'

const ACTIVE_USER_PUBKEY = 'a'.repeat(64)
const COUNTERPARTY_PUBKEY = 'b'.repeat(64)
const THIRD_PUBKEY = 'c'.repeat(64)
const FOURTH_PUBKEY = 'd'.repeat(64)

function baseParams(overrides: Partial<ReadOrderChatRelayParams> = {}): ReadOrderChatRelayParams {
	return {
		activeUserPubkey: ACTIVE_USER_PUBKEY,
		counterpartyPubkey: COUNTERPARTY_PUBKEY,
		signer: undefined,
		...overrides,
	}
}

function keySnapshot(params: ReadOrderChatRelayParams): OrderChatReadKeySnapshot {
	return createOrderChatQueryOptions(params).queryKey[2] as OrderChatReadKeySnapshot
}

async function executeQuery(params: ReadOrderChatRelayParams): Promise<OrderChatReadResult> {
	const queryFn = createOrderChatQueryOptions(params).queryFn
	if (typeof queryFn !== 'function') throw new Error('expected query function')
	return (queryFn as () => Promise<OrderChatReadResult>)()
}

async function captureAdapterParams(params: ReadOrderChatRelayParams): Promise<ReadOrderChatRelayParams> {
	let captured: ReadOrderChatRelayParams | undefined
	const result = {
		status: 'failed',
		error: { code: 'invalid_active_user' },
		records: [],
	} as OrderChatReadResult
	const readSpy = spyOn(orderChatRelayRead, 'readOrderChatFromRelays').mockImplementation(async (adapterParams) => {
		captured = adapterParams
		return result
	})

	try {
		await executeQuery(params)
	} finally {
		readSpy.mockRestore()
	}

	if (!captured) throw new Error('expected adapter parameters')
	return captured
}

function withUnreadableProperty(property: keyof ReadOrderChatRelayParams): ReadOrderChatRelayParams {
	const params = baseParams()
	Object.defineProperty(params, property, {
		enumerable: true,
		get() {
			throw new Error('private hostile getter failure')
		},
	})
	return params
}

function emptyIo() {
	return { fetchEvents: async () => [] }
}

describe('order-chat query detached snapshot', () => {
	test('reads every hostile top-level getter at most once per construction', () => {
		const counts = new Map<string, number>()
		const values: Record<string, unknown> = {
			activeUserPubkey: ACTIVE_USER_PUBKEY,
			counterpartyPubkey: COUNTERPARTY_PUBKEY,
			orderContext: undefined,
			signer: undefined,
			legacyRelayUrls: ['wss://legacy.example'],
			discoveryRelayUrls: ['wss://discovery.example'],
			legacyLimitPerDirection: 25,
			giftWrapLimit: 30,
			timeoutMs: 1_000,
		}
		const params: Record<string, unknown> = {}
		for (const [property, value] of Object.entries(values)) {
			Object.defineProperty(params, property, {
				enumerable: true,
				get() {
					counts.set(property, (counts.get(property) ?? 0) + 1)
					return value
				},
			})
		}

		createOrderChatQueryOptions(params as ReadOrderChatRelayParams)

		expect(Object.fromEntries(counts)).toEqual(Object.fromEntries(Object.keys(values).map((property) => [property, 1])))
	})

	test('reads every supplied order-context getter at most once per construction', () => {
		const counts = { orderId: 0, buyerPubkey: 0, sellerPubkey: 0 }
		const context = {
			get orderId() {
				counts.orderId += 1
				return 'order-one'
			},
			get buyerPubkey() {
				counts.buyerPubkey += 1
				return ACTIVE_USER_PUBKEY
			},
			get sellerPubkey() {
				counts.sellerPubkey += 1
				return COUNTERPARTY_PUBKEY
			},
		}

		createOrderChatQueryOptions(baseParams({ orderContext: context }))

		expect(counts).toEqual({ orderId: 1, buyerPubkey: 1, sellerPubkey: 1 })
	})

	test('passes only the detached key snapshot to the key factory', () => {
		const raw = baseParams({ legacyRelayUrls: ['wss://legacy.example'] })
		const keySpy = spyOn(orderChatKeys, 'read')

		try {
			const options = createOrderChatQueryOptions(raw)
			expect(keySpy).toHaveBeenCalledTimes(1)
			expect(keySpy.mock.calls[0]?.[0]).not.toBe(raw)
			expect(keySpy.mock.calls[0]?.[0]).toBe(options.queryKey[2])
		} finally {
			keySpy.mockRestore()
		}
	})

	test('caller array mutation cannot alter the key or reconstructed adapter parameters', async () => {
		const legacyRelayUrls = ['wss://legacy-one.example', 'wss://legacy-two.example']
		const discoveryRelayUrls = ['wss://discovery.example']
		const params = baseParams({ legacyRelayUrls, discoveryRelayUrls })
		const options = createOrderChatQueryOptions(params)

		legacyRelayUrls.reverse()
		discoveryRelayUrls.push('wss://later.example')

		const key = options.queryKey[2] as OrderChatReadKeySnapshot
		expect(key.legacyRelayUrls).toEqual({
			state: 'values',
			value: ['wss://legacy-one.example', 'wss://legacy-two.example'],
		})
		expect(key.discoveryRelayUrls).toEqual({ state: 'values', value: ['wss://discovery.example'] })

		let captured: ReadOrderChatRelayParams | undefined
		const readSpy = spyOn(orderChatRelayRead, 'readOrderChatFromRelays').mockImplementation(async (adapterParams) => {
			captured = adapterParams
			return { status: 'failed', error: { code: 'invalid_active_user' }, records: [] }
		})
		try {
			await (options.queryFn as () => Promise<OrderChatReadResult>)()
		} finally {
			readSpy.mockRestore()
		}

		expect(captured?.legacyRelayUrls).toEqual(['wss://legacy-one.example', 'wss://legacy-two.example'])
		expect(captured?.discoveryRelayUrls).toEqual(['wss://discovery.example'])
		expect(captured?.legacyRelayUrls).not.toBe(legacyRelayUrls)
		expect(captured?.discoveryRelayUrls).not.toBe(discoveryRelayUrls)
	})
})

describe('order-chat query key states and enablement', () => {
	test('distinguishes absent, empty, ordered, reordered, malformed, and unreadable relay arrays', () => {
		const absent = keySnapshot(baseParams()).legacyRelayUrls
		const empty = keySnapshot(baseParams({ legacyRelayUrls: [] })).legacyRelayUrls
		const ordered = keySnapshot(baseParams({ legacyRelayUrls: ['wss://one.example', 'wss://two.example'] })).legacyRelayUrls
		const reordered = keySnapshot(baseParams({ legacyRelayUrls: ['wss://two.example', 'wss://one.example'] })).legacyRelayUrls
		const malformed = keySnapshot(baseParams({ legacyRelayUrls: null as unknown as string[] })).legacyRelayUrls
		const unreadable = keySnapshot(withUnreadableProperty('legacyRelayUrls')).legacyRelayUrls

		expect(absent).toEqual({ state: 'absent' })
		expect(empty).toEqual({ state: 'empty' })
		expect(ordered).toEqual({ state: 'values', value: ['wss://one.example', 'wss://two.example'] })
		expect(new Set([absent, empty, ordered, reordered, malformed, unreadable].map((value) => JSON.stringify(value))).size).toBe(6)
	})

	test('distinguishes absent, readable-invalid, valid, and unreadable numeric values', () => {
		const states = [
			keySnapshot(baseParams()).giftWrapLimit,
			keySnapshot(baseParams({ giftWrapLimit: 0 })).giftWrapLimit,
			keySnapshot(baseParams({ giftWrapLimit: 50 })).giftWrapLimit,
			keySnapshot(withUnreadableProperty('giftWrapLimit')).giftWrapLimit,
		]
		expect(states).toEqual([{ state: 'absent' }, { state: 'invalid' }, { state: 'valid', value: 50 }, { state: 'unreadable' }])
	})

	test('distinguishes signer absent, present, and unreadable without inspecting or exposing the signer', () => {
		let signerPropertyReads = 0
		const signer = new Proxy(
			{ privateMarker: 'private-signer-marker', user: () => ({ pubkey: THIRD_PUBKEY }) },
			{
				get(target, property, receiver) {
					signerPropertyReads += 1
					return Reflect.get(target, property, receiver)
				},
			},
		)
		const absent = createOrderChatQueryOptions(baseParams())
		const present = createOrderChatQueryOptions(baseParams({ signer: signer as never }))
		const replacement = createOrderChatQueryOptions(baseParams({ signer: { privateMarker: 'replacement' } as never }))
		const unreadable = createOrderChatQueryOptions(withUnreadableProperty('signer'))

		expect((absent.queryKey[2] as OrderChatReadKeySnapshot).signer).toEqual({ state: 'absent' })
		expect((present.queryKey[2] as OrderChatReadKeySnapshot).signer).toEqual({ state: 'present' })
		expect(replacement.queryKey).toEqual(present.queryKey)
		expect((unreadable.queryKey[2] as OrderChatReadKeySnapshot).signer).toEqual({ state: 'unreadable' })
		expect(signerPropertyReads).toBe(0)
		expect(JSON.stringify(present.queryKey)).not.toContain('private-signer-marker')
		expect(JSON.stringify(present.queryKey)).not.toContain(THIRD_PUBKEY)
	})

	test('enables canonical participants without requiring a signer or order context', () => {
		const options = createOrderChatQueryOptions(baseParams())
		expect(options.enabled).toBe(true)
		expect((options.queryKey[2] as OrderChatReadKeySnapshot).signer).toEqual({ state: 'absent' })
		expect((options.queryKey[2] as OrderChatReadKeySnapshot).orderContext).toEqual({ state: 'absent' })
	})

	test('disables malformed and unreadable participant keys', () => {
		expect(createOrderChatQueryOptions(baseParams({ activeUserPubkey: 'A'.repeat(64) })).enabled).toBe(false)
		expect(createOrderChatQueryOptions(baseParams({ counterpartyPubkey: 'short' })).enabled).toBe(false)
		expect(createOrderChatQueryOptions(withUnreadableProperty('activeUserPubkey')).enabled).toBe(false)
	})

	test('keeps malformed supplied order context distinct from absence and preserves field-level failure states', async () => {
		const cases = [
			baseParams(),
			baseParams({ orderContext: null as never }),
			baseParams({ orderContext: { orderId: '', buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: 'bad', sellerPubkey: COUNTERPARTY_PUBKEY } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: 'bad' } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: ACTIVE_USER_PUBKEY } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: THIRD_PUBKEY, sellerPubkey: FOURTH_PUBKEY } }),
		]
		const serializedKeys = cases.map((params) => JSON.stringify(keySnapshot(params).orderContext))

		expect(new Set(serializedKeys).size).toBe(cases.length)
		expect(await executeQuery(cases[1]!)).toMatchObject({ status: 'failed', error: { code: 'invalid_order_context' } })
		expect(await executeQuery(cases[2]!)).toMatchObject({ status: 'failed', error: { code: 'invalid_order_id' } })
		expect(await executeQuery(cases[3]!)).toMatchObject({ status: 'failed', error: { code: 'invalid_buyer' } })
		expect(await executeQuery(cases[4]!)).toMatchObject({ status: 'failed', error: { code: 'invalid_seller' } })
		expect(await executeQuery(cases[5]!)).toMatchObject({ status: 'failed', error: { code: 'same_order_participant' } })
		expect(await executeQuery(cases[6]!)).toMatchObject({ status: 'failed', error: { code: 'order_participant_mismatch' } })
	})

	test('represents valid order-context values in the key', () => {
		const context = {
			orderId: 'order-visible-identifier',
			buyerPubkey: ACTIVE_USER_PUBKEY,
			sellerPubkey: COUNTERPARTY_PUBKEY,
		}
		expect(keySnapshot(baseParams({ orderContext: context })).orderContext).toEqual({
			state: 'supplied',
			orderId: { state: 'valid', value: context.orderId },
			buyerPubkey: { state: 'canonical', value: context.buyerPubkey },
			sellerPubkey: { state: 'canonical', value: context.sellerPubkey },
		})
	})
})

describe('order-chat query hostile-input reconstruction', () => {
	for (const property of ['signer', 'giftWrapLimit', 'timeoutMs'] as const) {
		test(`preserves Layer 3 behavior for unreadable ${property}`, async () => {
			const direct = await orderChatRelayRead.readOrderChatFromRelays(withUnreadableProperty(property), emptyIo())
			const reconstructed = await captureAdapterParams(withUnreadableProperty(property))
			const throughSnapshot = await orderChatRelayRead.readOrderChatFromRelays(reconstructed, emptyIo())
			expect(throughSnapshot).toEqual(direct)
		})
	}

	test('uses controlled unreadable reconstruction for every unreadable result-affecting property', async () => {
		for (const property of [
			'activeUserPubkey',
			'counterpartyPubkey',
			'orderContext',
			'legacyRelayUrls',
			'discoveryRelayUrls',
			'legacyLimitPerDirection',
		] as const) {
			const direct = await orderChatRelayRead.readOrderChatFromRelays(withUnreadableProperty(property), emptyIo())
			const reconstructed = await captureAdapterParams(withUnreadableProperty(property))
			const throughSnapshot = await orderChatRelayRead.readOrderChatFromRelays(reconstructed, emptyIo())
			expect(throughSnapshot).toEqual(direct)
		}
	})

	test('keeps fixed inert sentinels behaviorally equivalent to readable hostile inputs', async () => {
		const hostileInputs: ReadOrderChatRelayParams[] = [
			baseParams({ activeUserPubkey: 1 as never }),
			baseParams({ counterpartyPubkey: 1 as never }),
			baseParams({ orderContext: 'bad' as never }),
			baseParams({ orderContext: { orderId: 1 as never, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: 1 as never, sellerPubkey: COUNTERPARTY_PUBKEY } }),
			baseParams({ orderContext: { orderId: 'order', buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: 1 as never } }),
			baseParams({ legacyRelayUrls: 'bad' as never }),
			baseParams({ discoveryRelayUrls: 'bad' as never }),
			baseParams({ legacyLimitPerDirection: 'bad' as never }),
			baseParams({ giftWrapLimit: 'bad' as never }),
			baseParams({ timeoutMs: 'bad' as never }),
		]

		for (const hostile of hostileInputs) {
			const direct = await orderChatRelayRead.readOrderChatFromRelays(hostile, emptyIo())
			const reconstructed = await captureAdapterParams(hostile)
			const throughSnapshot = await orderChatRelayRead.readOrderChatFromRelays(reconstructed, emptyIo())
			expect(throughSnapshot).toEqual(direct)
		}
	})
})

describe('order-chat query options contract', () => {
	test('invokes the adapter exactly once and returns ready, degraded, and encoded failed results by identity', async () => {
		const results = [
			{ status: 'ready', records: [], legacy: { status: 'ready' }, nip17: { status: 'ready', relayUrls: [] } },
			{
				status: 'degraded',
				records: [],
				legacy: { status: 'ready' },
				nip17: { status: 'failed', code: 'signer_unavailable' },
			},
			{ status: 'failed', error: { code: 'invalid_active_user' }, records: [] },
		] as OrderChatReadResult[]
		let index = 0
		const readSpy = spyOn(orderChatRelayRead, 'readOrderChatFromRelays').mockImplementation(async () => results[index++]!)

		try {
			for (const expected of results) {
				const actual = await executeQuery(baseParams())
				expect(actual).toBe(expected)
			}
			expect(readSpy).toHaveBeenCalledTimes(results.length)
		} finally {
			readSpy.mockRestore()
		}
	})

	test('sets retry false and introduces no query callbacks or result transforms', () => {
		const options = createOrderChatQueryOptions(baseParams())
		expect(options.retry).toBe(false)
		expect(Object.keys(options).sort()).toEqual(['enabled', 'queryFn', 'queryKey', 'retry'])
		expect('select' in options).toBe(false)
		expect('onSuccess' in options).toBe(false)
		expect('onError' in options).toBe(false)
	})
})
