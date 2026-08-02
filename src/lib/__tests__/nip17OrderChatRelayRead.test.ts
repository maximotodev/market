import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import type { FetchOptions, NostrEvent, NostrFilter } from '../nostr/io'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { NIP17_DM_RELAY_LIST_KIND } from '../nostr/nip17Relays'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import { readOrderChatFromRelays, type OrderChatRelayReadIo, type ReadOrderChatRelayParams } from '../orders/nip17OrderChatRelayRead'
import type { OrderChatReadInputErrorCode, OrderChatReadResult } from '../orders/nip17OrderChatReadOrchestration'
import type { Nip17OrderTransportSigner } from '../orders/nip17OrderTransport'
import { createOrderChatRumor, type OrderMessageRumor } from '../orders/orderMessageRumor'

const CREATED_AT = 1_700_000_000
const ACTIVE_PRIVATE_KEY = generateSecretKey()
const COUNTERPARTY_PRIVATE_KEY = generateSecretKey()
const THIRD_PARTY_PRIVATE_KEY = generateSecretKey()
const ACTIVE_USER_PUBKEY = getPublicKey(ACTIVE_PRIVATE_KEY)
const COUNTERPARTY_PUBKEY = getPublicKey(COUNTERPARTY_PRIVATE_KEY)
const LEGACY_RELAYS = ['wss://legacy-one.example', 'wss://legacy-two.example']
const DISCOVERY_RELAYS = ['wss://discovery.example']
const INBOX_RELAYS = ['wss://inbox.example']
const ORDER_ID = 'order-layer-3'
const PRIVATE_FAILURE = 'private relay invoice preimage ciphertext'

type FetchCall = {
	filter: NostrFilter | NostrFilter[]
	options?: FetchOptions
}

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
}

type HarnessOptions = {
	legacyEvents?: NostrEvent[]
	relayListEvents?: NostrEvent[]
	giftWraps?: NostrEvent[]
	rejectLegacy?: boolean
	rejectRelayList?: boolean
	rejectGiftWraps?: boolean
}

type RuntimeRead = (params: unknown, io?: unknown) => Promise<OrderChatReadResult>

const runtimeRead = readOrderChatFromRelays as unknown as RuntimeRead

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})

	return { promise, resolve }
}

function createSigner(privateKey: Uint8Array): Nip17OrderTransportSigner {
	const pubkey = getPublicKey(privateKey)

	return {
		user: async () => ({ pubkey }),
		encryptionEnabled: async () => ['nip44'],
		encrypt: async (recipient: { pubkey: string }, plaintext: string) => {
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(plaintext, conversationKey)
		},
		decrypt: async (sender: { pubkey: string }, ciphertext: string) => {
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(ciphertext, conversationKey)
		},
		sign: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) =>
			finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
				},
				privateKey,
			).sig,
	} as unknown as Nip17OrderTransportSigner
}

function relayListEvent(privateKey: Uint8Array, relayUrls = INBOX_RELAYS): NostrEvent {
	return finalizeEvent(
		{
			kind: NIP17_DM_RELAY_LIST_KIND,
			created_at: CREATED_AT,
			tags: relayUrls.map((relayUrl) => ['relay', relayUrl]),
			content: '',
		},
		privateKey,
	)
}

function signedLegacyEvent(
	params: {
		privateKey?: Uint8Array
		recipientPubkey?: string
		createdAt?: number
		content?: string
		subject?: string
	} = {},
): NostrEvent {
	const tags: string[][] = [['p', params.recipientPubkey ?? COUNTERPARTY_PUBKEY]]
	if (params.subject !== undefined) tags.push(['subject', params.subject])

	return finalizeEvent(
		{
			kind: 14,
			created_at: params.createdAt ?? CREATED_AT,
			tags,
			content: params.content ?? 'Public order chat',
		},
		params.privateKey ?? ACTIVE_PRIVATE_KEY,
	)
}

function malformedGiftWrap(): NostrEvent {
	return finalizeEvent(
		{
			kind: NIP59_GIFT_WRAP_KIND,
			created_at: CREATED_AT + 50,
			tags: [['p', ACTIVE_USER_PUBKEY]],
			content: PRIVATE_FAILURE,
		},
		THIRD_PARTY_PRIVATE_KEY,
	)
}

async function senderSelfWrapForRumor(rumor: OrderMessageRumor): Promise<Event> {
	const wraps = await createNip17GiftWrapsWithSigner({
		rumor,
		signer: createSigner(ACTIVE_PRIVATE_KEY),
		recipientPubkey: COUNTERPARTY_PUBKEY,
		createdAt: CREATED_AT + 100,
	})

	return wraps.sender.giftWrap
}

function createHarness(options: HarnessOptions = {}): {
	io: OrderChatRelayReadIo
	calls: FetchCall[]
} {
	const calls: FetchCall[] = []
	const io: OrderChatRelayReadIo = {
		fetchEvents: async (filter, fetchOptions) => {
			calls.push({
				filter,
				...(fetchOptions === undefined ? {} : { options: fetchOptions }),
			})

			if (Array.isArray(filter)) {
				if (options.rejectLegacy) throw new Error(PRIVATE_FAILURE)
				return options.legacyEvents ?? []
			}

			const kind = filter.kinds?.[0]
			if (kind === NIP17_DM_RELAY_LIST_KIND) {
				if (options.rejectRelayList) throw new Error(PRIVATE_FAILURE)
				return options.relayListEvents ?? [relayListEvent(ACTIVE_PRIVATE_KEY)]
			}
			if (kind === NIP59_GIFT_WRAP_KIND) {
				if (options.rejectGiftWraps) throw new Error(PRIVATE_FAILURE)
				return options.giftWraps ?? []
			}

			throw new Error('unexpected test filter')
		},
	}

	return { io, calls }
}

function baseParams(overrides: Partial<ReadOrderChatRelayParams> = {}): ReadOrderChatRelayParams {
	return {
		activeUserPubkey: ACTIVE_USER_PUBKEY,
		counterpartyPubkey: COUNTERPARTY_PUBKEY,
		signer: createSigner(ACTIVE_PRIVATE_KEY),
		...overrides,
	}
}

function expectInputFailure(result: OrderChatReadResult, code: OrderChatReadInputErrorCode): void {
	expect(result).toEqual({
		status: 'failed',
		error: { code },
		records: [],
	})
	expect('legacy' in result).toBe(false)
	expect('nip17' in result).toBe(false)
	expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
}

describe('NIP-17 order chat relay read adapter targeting', () => {
	test('uses exact directional kind-14 filters and forwards source-local bounded options', async () => {
		const harness = createHarness()
		const result = await readOrderChatFromRelays(
			baseParams({
				legacyRelayUrls: LEGACY_RELAYS,
				discoveryRelayUrls: DISCOVERY_RELAYS,
				legacyLimitPerDirection: 17,
				giftWrapLimit: 23,
				timeoutMs: 1_234,
			}),
			harness.io,
		)

		expect(result.status).toBe('ready')
		expect(harness.calls).toHaveLength(3)
		expect(harness.calls[0]).toEqual({
			filter: [
				{
					kinds: [14],
					authors: [ACTIVE_USER_PUBKEY],
					'#p': [COUNTERPARTY_PUBKEY],
					limit: 17,
				},
				{
					kinds: [14],
					authors: [COUNTERPARTY_PUBKEY],
					'#p': [ACTIVE_USER_PUBKEY],
					limit: 17,
				},
			],
			options: { relayUrls: LEGACY_RELAYS, timeoutMs: 1_234 },
		})
		expect(harness.calls[1]).toEqual({
			filter: {
				kinds: [NIP17_DM_RELAY_LIST_KIND],
				authors: [ACTIVE_USER_PUBKEY],
				limit: 1,
			},
			options: { relayUrls: DISCOVERY_RELAYS, timeoutMs: 1_234 },
		})
		expect(harness.calls[2]).toEqual({
			filter: {
				kinds: [NIP59_GIFT_WRAP_KIND],
				'#p': [ACTIVE_USER_PUBKEY],
				limit: 23,
			},
			options: { relayUrls: INBOX_RELAYS, timeoutMs: 1_234 },
		})
	})

	test('uses the default per-direction legacy limit of 500', async () => {
		const harness = createHarness()
		await readOrderChatFromRelays(baseParams(), harness.io)

		const legacyFilter = harness.calls[0]?.filter
		expect(Array.isArray(legacyFilter)).toBe(true)
		if (!Array.isArray(legacyFilter)) throw new Error('expected legacy filter array')
		expect(legacyFilter.map((filter) => filter.limit)).toEqual([500, 500])
	})

	test('starts both sources without waiting for the legacy source to settle', async () => {
		const legacyRead = deferred<NostrEvent[]>()
		const encryptedStarted = deferred<void>()
		let encryptedStartCount = 0
		const signer = createSigner(ACTIVE_PRIVATE_KEY)
		const originalUser = signer.user
		signer.user = async () => {
			encryptedStartCount += 1
			encryptedStarted.resolve()
			return originalUser.call(signer)
		}
		const harness = createHarness()
		harness.io.fetchEvents = async (filter, options) => {
			if (Array.isArray(filter)) return legacyRead.promise
			return createHarness().io.fetchEvents(filter, options)
		}

		const resultPromise = readOrderChatFromRelays(baseParams({ signer }), harness.io)
		await encryptedStarted.promise
		expect(encryptedStartCount).toBeGreaterThan(0)
		legacyRead.resolve([])
		expect((await resultPromise).status).toBe('ready')
	})
})

describe('NIP-17 order chat relay read adapter source health', () => {
	test('returns ready when both bounded sources complete', async () => {
		const harness = createHarness()
		expect(await readOrderChatFromRelays(baseParams(), harness.io)).toEqual({
			status: 'ready',
			records: [],
			legacy: { status: 'ready' },
			nip17: { status: 'ready', relayUrls: INBOX_RELAYS },
		})
	})

	test('returns degraded when only legacy fails', async () => {
		const harness = createHarness({ rejectLegacy: true })
		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result).toMatchObject({
			status: 'degraded',
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'ready' },
		})
		expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
	})

	test('returns degraded when only encrypted relay discovery fails', async () => {
		const harness = createHarness({ rejectRelayList: true })
		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result).toMatchObject({
			status: 'degraded',
			legacy: { status: 'ready' },
			nip17: { status: 'failed', code: 'relay_list_fetch_failed' },
		})
	})

	test('returns all-sources-failed without exposing thrown text', async () => {
		const harness = createHarness({ rejectLegacy: true, rejectRelayList: true })
		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result).toEqual({
			status: 'failed',
			error: { code: 'all_sources_failed' },
			records: [],
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'failed', code: 'relay_list_fetch_failed' },
		})
		expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
	})
})

describe('NIP-17 order chat relay read adapter runtime input containment', () => {
	for (const [name, value] of [
		['null', null],
		['undefined', undefined],
		['string', 'input'],
		['number', 42],
		['boolean', true],
		['array', []],
		['sparse array', new Array(2)],
	] as const) {
		test(`contains malformed top-level ${name} input without I/O`, async () => {
			let fetchCalls = 0
			const io: OrderChatRelayReadIo = {
				fetchEvents: async () => {
					fetchCalls += 1
					return []
				},
			}

			const result = await runtimeRead(value, io)
			expectInputFailure(result, 'invalid_active_user')
			expect(fetchCalls).toBe(0)
		})
	}

	test('contains participant and order-context getters with Layer 2 classifications and zero I/O', async () => {
		for (const testCase of [
			{ field: 'activeUserPubkey', code: 'invalid_active_user' },
			{ field: 'counterpartyPubkey', code: 'invalid_counterparty' },
			{ field: 'orderContext', code: 'invalid_order_context' },
		] as const) {
			let fetchCalls = 0
			const value: Record<string, unknown> = {
				activeUserPubkey: ACTIVE_USER_PUBKEY,
				counterpartyPubkey: COUNTERPARTY_PUBKEY,
				signer: createSigner(ACTIVE_PRIVATE_KEY),
			}
			Object.defineProperty(value, testCase.field, {
				get: () => {
					throw new Error(PRIVATE_FAILURE)
				},
			})
			const result = await runtimeRead(value, {
				fetchEvents: async () => {
					fetchCalls += 1
					return []
				},
			})

			expectInputFailure(result, testCase.code)
			expect(fetchCalls).toBe(0)
		}
	})

	test('contains proxy and revoked-proxy inputs', async () => {
		const proxy = new Proxy(baseParams(), {})
		expect((await runtimeRead(proxy, createHarness().io)).status).toBe('ready')

		const revocable = Proxy.revocable(baseParams(), {})
		revocable.revoke()
		const revokedResult = await runtimeRead(revocable.proxy, createHarness().io)
		expectInputFailure(revokedResult, 'invalid_active_user')
	})

	test('passes readable raw order-context fields to Layer 2 without reclassification', async () => {
		const harness = createHarness()
		for (const [orderContext, code] of [
			[{ orderId: 42, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY }, 'invalid_order_id'],
			[{ orderId: ORDER_ID, buyerPubkey: 'bad', sellerPubkey: COUNTERPARTY_PUBKEY }, 'invalid_buyer'],
			[{ orderId: ORDER_ID, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: 'bad' }, 'invalid_seller'],
		] as const) {
			const result = await runtimeRead(
				{
					activeUserPubkey: ACTIVE_USER_PUBKEY,
					counterpartyPubkey: COUNTERPARTY_PUBKEY,
					orderContext,
					signer: createSigner(ACTIVE_PRIVATE_KEY),
				},
				harness.io,
			)
			expectInputFailure(result, code)
		}
		expect(harness.calls).toEqual([])
	})
})

describe('NIP-17 order chat relay read adapter source-local snapshots', () => {
	test('contains throwing source option getters without exposing private text', async () => {
		for (const [field, expectedStatus] of [
			['legacyRelayUrls', 'degraded'],
			['legacyLimitPerDirection', 'degraded'],
			['discoveryRelayUrls', 'degraded'],
			['giftWrapLimit', 'degraded'],
			['signer', 'degraded'],
			['timeoutMs', 'failed'],
		] as const) {
			const params = baseParams() as unknown as Record<string, unknown>
			Object.defineProperty(params, field, {
				get: () => {
					throw new Error(PRIVATE_FAILURE)
				},
			})
			const result = await runtimeRead(params, createHarness().io)
			expect(result.status).toBe(expectedStatus)
			expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
		}
	})

	test('contains unreadable or non-function fetchers as independent callback failures', async () => {
		for (const io of [null, 'io', [], { fetchEvents: null }, { fetchEvents: 'fetch' }, { fetchEvents: {} }]) {
			const result = await runtimeRead(baseParams(), io)
			expect(result).toMatchObject({
				status: 'failed',
				error: { code: 'all_sources_failed' },
				legacy: { status: 'failed', code: 'legacy_read_failed' },
				nip17: { status: 'failed', code: 'nip17_read_failed' },
			})
		}

		const throwingIo = Object.defineProperty({}, 'fetchEvents', {
			get: () => {
				throw new Error(PRIVATE_FAILURE)
			},
		})
		const result = await runtimeRead(baseParams(), throwingIo)
		expect(result.status).toBe('failed')
		expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
	})

	test('keeps malformed legacy options local to legacy health', async () => {
		for (const overrides of [
			{ legacyRelayUrls: 'relay' },
			{ legacyRelayUrls: new Array(1) },
			{ legacyRelayUrls: ['wss://ok.example', 42] },
			{ legacyLimitPerDirection: 0 },
			{ legacyLimitPerDirection: 501 },
			{ legacyLimitPerDirection: 1.5 },
		] as const) {
			const result = await runtimeRead(
				{
					...baseParams(),
					...overrides,
				},
				createHarness().io,
			)
			expect(result).toMatchObject({
				status: 'degraded',
				legacy: { status: 'failed', code: 'legacy_read_failed' },
				nip17: { status: 'ready' },
			})
		}
	})

	test('keeps malformed encrypted relay and gift-wrap options local to encrypted health', async () => {
		for (const overrides of [
			{ discoveryRelayUrls: 'relay' },
			{ discoveryRelayUrls: new Array(1) },
			{ discoveryRelayUrls: ['wss://ok.example', 42] },
			{ giftWrapLimit: 0 },
			{ giftWrapLimit: 501 },
			{ giftWrapLimit: 1.5 },
		] as const) {
			const result = await runtimeRead(
				{
					...baseParams(),
					...overrides,
				},
				createHarness().io,
			)
			expect(result.status).toBe('degraded')
			expect(result).toMatchObject({ legacy: { status: 'ready' }, nip17: { status: 'failed' } })
		}
	})

	test('applies an invalid shared timeout independently to both sources', async () => {
		const result = await runtimeRead({ ...baseParams(), timeoutMs: 0 }, createHarness().io)
		expect(result).toEqual({
			status: 'failed',
			error: { code: 'all_sources_failed' },
			records: [],
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'failed', code: 'invalid_timeout' },
		})
	})

	test('reads every caller-controlled property at most once', async () => {
		const counts = new Map<string, number>()
		const count =
			(name: string, value: unknown): (() => unknown) =>
			() => {
				counts.set(name, (counts.get(name) ?? 0) + 1)
				return value
			}
		const orderContext = {}
		Object.defineProperties(orderContext, {
			orderId: { get: count('orderId', ORDER_ID) },
			buyerPubkey: { get: count('buyerPubkey', ACTIVE_USER_PUBKEY) },
			sellerPubkey: { get: count('sellerPubkey', COUNTERPARTY_PUBKEY) },
		})
		const params = {}
		Object.defineProperties(params, {
			activeUserPubkey: { get: count('activeUserPubkey', ACTIVE_USER_PUBKEY) },
			counterpartyPubkey: { get: count('counterpartyPubkey', COUNTERPARTY_PUBKEY) },
			orderContext: { get: count('orderContext', orderContext) },
			signer: { get: count('signer', createSigner(ACTIVE_PRIVATE_KEY)) },
			legacyRelayUrls: { get: count('legacyRelayUrls', LEGACY_RELAYS) },
			discoveryRelayUrls: { get: count('discoveryRelayUrls', DISCOVERY_RELAYS) },
			legacyLimitPerDirection: { get: count('legacyLimitPerDirection', 5) },
			giftWrapLimit: { get: count('giftWrapLimit', 7) },
			timeoutMs: { get: count('timeoutMs', 500) },
		})
		const harness = createHarness()
		const io = {}
		Object.defineProperty(io, 'fetchEvents', { get: count('fetchEvents', harness.io.fetchEvents) })

		expect((await runtimeRead(params, io)).status).toBe('ready')
		counts.forEach((reads, name) => {
			expect(reads, name).toBe(1)
		})
	})

	test('binds the selected fetcher and snapshots replacements before either source runs', async () => {
		const selectedCalls: FetchCall[] = []
		let replacementCalls = 0
		const selectedIo = {
			identity: 'selected',
			fetchEvents: async function (
				this: { identity: string },
				filter: NostrFilter | NostrFilter[],
				options?: FetchOptions,
			): Promise<NostrEvent[]> {
				expect(this.identity).toBe('selected')
				selectedCalls.push({ filter, ...(options === undefined ? {} : { options }) })
				if (Array.isArray(filter)) return []
				if (filter.kinds?.[0] === NIP17_DM_RELAY_LIST_KIND) return [relayListEvent(ACTIVE_PRIVATE_KEY)]
				return []
			},
		}
		const params = baseParams()
		const selectedSigner = params.signer
		const promise = runtimeRead(params, selectedIo)
		selectedIo.fetchEvents = async () => {
			replacementCalls += 1
			return []
		}
		params.signer = createSigner(COUNTERPARTY_PRIVATE_KEY)

		expect((await promise).status).toBe('ready')
		expect(selectedCalls).toHaveLength(3)
		expect(replacementCalls).toBe(0)
		expect(selectedSigner).not.toBe(params.signer)
	})

	test('snapshots relay arrays, limits, timeout, and order context after invocation', async () => {
		const legacyRelays = ['wss://legacy-original.example']
		const discoveryRelays = ['wss://discovery-original.example']
		const context = {
			orderId: ORDER_ID,
			buyerPubkey: ACTIVE_USER_PUBKEY,
			sellerPubkey: COUNTERPARTY_PUBKEY,
		}
		const event = signedLegacyEvent({ subject: ORDER_ID })
		const harness = createHarness({ legacyEvents: [event] })
		const params = baseParams({
			orderContext: context,
			legacyRelayUrls: legacyRelays,
			discoveryRelayUrls: discoveryRelays,
			legacyLimitPerDirection: 5,
			giftWrapLimit: 6,
			timeoutMs: 700,
		})
		const promise = readOrderChatFromRelays(params, harness.io)
		legacyRelays[0] = 'wss://legacy-replaced.example'
		discoveryRelays[0] = 'wss://discovery-replaced.example'
		params.legacyLimitPerDirection = 99
		params.giftWrapLimit = 99
		params.timeoutMs = 999
		context.orderId = 'replacement-order'

		const result = await promise
		expect(result.records[0]?.correlation).toEqual({ status: 'subject_matches_order' })
		expect(harness.calls[0]?.options).toEqual({ relayUrls: ['wss://legacy-original.example'], timeoutMs: 700 })
		expect(harness.calls[1]?.options).toEqual({ relayUrls: ['wss://discovery-original.example'], timeoutMs: 700 })
		expect(harness.calls[2]?.filter).toMatchObject({ limit: 6 })
	})

	test('preserves mutation visibility for the selected signer object', async () => {
		const gate = deferred<void>()
		const mutableSigner = {
			selectedPubkey: ACTIVE_USER_PUBKEY,
			user: async () => {
				await gate.promise
				return { pubkey: mutableSigner.selectedPubkey }
			},
			encryptionEnabled: async () => ['nip44'],
			decrypt: async () => '',
		}
		const signer = mutableSigner as unknown as Nip17OrderTransportSigner
		const promise = readOrderChatFromRelays(baseParams({ signer }), createHarness().io)
		mutableSigner.selectedPubkey = COUNTERPARTY_PUBKEY
		gate.resolve()

		const result = await promise
		expect(result).toMatchObject({
			status: 'degraded',
			legacy: { status: 'ready' },
			nip17: { status: 'failed', code: 'signer_pubkey_mismatch' },
		})
	})
})

describe('NIP-17 order chat relay read adapter domain preservation', () => {
	test('omits malformed and unauthorized relay candidates without changing source health', async () => {
		const malformed = { private: PRIVATE_FAILURE } as unknown as NostrEvent
		const unauthorized = signedLegacyEvent({
			privateKey: THIRD_PARTY_PRIVATE_KEY,
			recipientPubkey: ACTIVE_USER_PUBKEY,
		})
		const authorized = signedLegacyEvent()
		const harness = createHarness({
			legacyEvents: [malformed, unauthorized, authorized],
			giftWraps: [malformedGiftWrap()],
		})

		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result.status).toBe('ready')
		expect(result.records.map(({ record }) => record.id)).toEqual([authorized.id])
		expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
	})

	test('overlays authorized NIP-17 over legacy for the same canonical inner id', async () => {
		const legacy = signedLegacyEvent({ content: 'same canonical message' })
		const rumor: OrderMessageRumor = {
			id: legacy.id,
			pubkey: legacy.pubkey,
			created_at: legacy.created_at,
			kind: legacy.kind,
			tags: legacy.tags,
			content: legacy.content,
		}
		const harness = createHarness({
			legacyEvents: [legacy],
			giftWraps: [await senderSelfWrapForRumor(rumor)],
		})

		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.record.id).toBe(legacy.id)
		expect(result.records[0]?.record.source).toBe('nip17')
	})

	test('preserves deterministic inner timestamp and id ordering', async () => {
		const later = signedLegacyEvent({ createdAt: CREATED_AT + 10, content: 'later' })
		const tieA = signedLegacyEvent({ createdAt: CREATED_AT, content: 'tie-a' })
		const tieB = signedLegacyEvent({ createdAt: CREATED_AT, content: 'tie-b' })
		const expectedTieIds = [tieA.id, tieB.id].sort()
		const harness = createHarness({ legacyEvents: [later, tieB, tieA] })

		const result = await readOrderChatFromRelays(baseParams(), harness.io)
		expect(result.records.map(({ record }) => record.id)).toEqual([...expectedTieIds, later.id])
	})
})
