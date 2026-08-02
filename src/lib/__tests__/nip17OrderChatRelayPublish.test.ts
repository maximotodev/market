import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import {
	getNostrIo,
	setNostrIo,
	type FetchOptions,
	type NostrEvent,
	type NostrFilter,
	type NostrIo,
	type PublishOptions,
} from '../nostr/io'
import { NIP17_DM_RELAY_LIST_KIND } from '../nostr/nip17Relays'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import {
	publishOrderChatToRelays,
	type OrderChatRelayPublishIo,
	type PublishOrderChatRelayParams,
} from '../orders/nip17OrderChatRelayPublish'
import type { Nip17OrderTransportError, Nip17OrderTransportSigner, PublishNip17OrderTransportResult } from '../orders/nip17OrderTransport'
import { createOrderChatRumor } from '../orders/orderMessageRumor'

const CREATED_AT = 1_700_000_000
const SENDER_PRIVATE_KEY = generateSecretKey()
const RECIPIENT_PRIVATE_KEY = generateSecretKey()
const OTHER_PRIVATE_KEY = generateSecretKey()
const SENDER_PUBKEY = getPublicKey(SENDER_PRIVATE_KEY)
const RECIPIENT_PUBKEY = getPublicKey(RECIPIENT_PRIVATE_KEY)
const OTHER_PUBKEY = getPublicKey(OTHER_PRIVATE_KEY)
const DISCOVERY_RELAYS = ['wss://discovery-one.example', 'wss://discovery-two.example']
const SENDER_RELAYS = ['wss://sender-one.example', 'wss://sender-two.example']
const RECIPIENT_RELAYS = ['wss://recipient.example']
const PRIVATE_CONTENT = 'private order chat invoice preimage shipping address'
const PRIVATE_SUBJECT = 'private-order-subject'
const PRIVATE_FAILURE = 'private dependency failure ciphertext invoice'

type FetchCall = {
	filter: NostrFilter | NostrFilter[]
	options?: FetchOptions
}

type PublishCall = {
	event: NostrEvent
	options?: PublishOptions
}

type HarnessOptions = {
	senderEvents?: NostrEvent[]
	recipientEvents?: NostrEvent[]
	rejectSenderFetch?: boolean
	rejectRecipientFetch?: boolean
	rejectSenderPublish?: boolean
	rejectRecipientPublish?: boolean
}

type RuntimePublish = (params: unknown, io?: unknown) => Promise<PublishNip17OrderTransportResult>

const runtimePublish = publishOrderChatToRelays as unknown as RuntimePublish

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

function relayListEvent(privateKey: Uint8Array, relays: string[], createdAt = CREATED_AT): NostrEvent {
	return finalizeEvent(
		{
			kind: NIP17_DM_RELAY_LIST_KIND,
			created_at: createdAt,
			tags: relays.map((relay) => ['relay', relay]),
			content: '',
		},
		privateKey,
	)
}

function createHarness(options: HarnessOptions = {}): {
	io: OrderChatRelayPublishIo
	fetchCalls: FetchCall[]
	publishCalls: PublishCall[]
} {
	const fetchCalls: FetchCall[] = []
	const publishCalls: PublishCall[] = []
	const io: OrderChatRelayPublishIo = {
		fetchEvents: async (filter, fetchOptions) => {
			fetchCalls.push({ filter, ...(fetchOptions === undefined ? {} : { options: fetchOptions }) })
			if (Array.isArray(filter)) throw new Error('unexpected filter array')
			const author = filter.authors?.[0]
			if (author === SENDER_PUBKEY) {
				if (options.rejectSenderFetch) throw new Error(PRIVATE_FAILURE)
				return options.senderEvents ?? [relayListEvent(SENDER_PRIVATE_KEY, SENDER_RELAYS)]
			}
			if (author === RECIPIENT_PUBKEY) {
				if (options.rejectRecipientFetch) throw new Error(PRIVATE_FAILURE)
				return options.recipientEvents ?? [relayListEvent(RECIPIENT_PRIVATE_KEY, RECIPIENT_RELAYS)]
			}
			return []
		},
		publish: async (event, publishOptions) => {
			publishCalls.push({ event, ...(publishOptions === undefined ? {} : { options: publishOptions }) })
			const recipient = event.tags.find((tag) => tag[0] === 'p')?.[1]
			if (recipient === SENDER_PUBKEY && options.rejectSenderPublish) throw new Error(PRIVATE_FAILURE)
			if (recipient === RECIPIENT_PUBKEY && options.rejectRecipientPublish) throw new Error(PRIVATE_FAILURE)
		},
	}

	return { io, fetchCalls, publishCalls }
}

function baseParams(overrides: Partial<PublishOrderChatRelayParams> = {}): PublishOrderChatRelayParams {
	return {
		activeUserPubkey: SENDER_PUBKEY,
		recipientPubkey: RECIPIENT_PUBKEY,
		content: PRIVATE_CONTENT,
		subject: PRIVATE_SUBJECT,
		signer: createSigner(SENDER_PRIVATE_KEY),
		createdAt: CREATED_AT,
		...overrides,
	}
}

function expectValidationFailure(
	result: PublishNip17OrderTransportResult,
	code: Nip17OrderTransportError['code'] = 'invalid_order_message',
): void {
	expect(result).toEqual({
		status: 'validation_failed',
		error: { code },
	})
	expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
}

function expectRelayListFailure(result: PublishNip17OrderTransportResult): void {
	expect(result).toMatchObject({
		status: 'relay_targets_failed',
		error: { code: 'relay_list_fetch_failed' },
		relayTargets: null,
	})
	expect(JSON.stringify(result)).not.toContain(PRIVATE_FAILURE)
}

describe('NIP-17 order-chat relay publish adapter', () => {
	test('constructs one canonical rumor and preserves exact relay targeting and publish-call order', async () => {
		const harness = createHarness()
		const params = baseParams({ discoveryRelayUrls: DISCOVERY_RELAYS, timeoutMs: 1_234 })
		const expectedRumor = createOrderChatRumor({
			senderPubkey: SENDER_PUBKEY,
			recipientPubkey: RECIPIENT_PUBKEY,
			content: PRIVATE_CONTENT,
			subject: PRIVATE_SUBJECT,
			createdAt: CREATED_AT,
		})

		const result = await publishOrderChatToRelays(params, harness.io)

		expect(result.status).toBe('published')
		if (result.status !== 'published') throw new Error('expected both publish calls to resolve')
		expect(result.rumorId).toBe(expectedRumor.id)
		expect(harness.fetchCalls).toEqual([
			{
				filter: { kinds: [NIP17_DM_RELAY_LIST_KIND], authors: [SENDER_PUBKEY], limit: 1 },
				options: { relayUrls: DISCOVERY_RELAYS, timeoutMs: 1_234 },
			},
			{
				filter: { kinds: [NIP17_DM_RELAY_LIST_KIND], authors: [RECIPIENT_PUBKEY], limit: 1 },
				options: { relayUrls: DISCOVERY_RELAYS, timeoutMs: 1_234 },
			},
		])
		expect(harness.publishCalls.map((call) => call.options)).toEqual([{ relayUrls: SENDER_RELAYS }, { relayUrls: RECIPIENT_RELAYS }])
		expect(harness.publishCalls.map((call) => call.event.kind)).toEqual([NIP59_GIFT_WRAP_KIND, NIP59_GIFT_WRAP_KIND])
		expect(harness.publishCalls.map((call) => call.event.tags.find((tag) => tag[0] === 'p')?.[1])).toEqual([
			SENDER_PUBKEY,
			RECIPIENT_PUBKEY,
		])
		expect(harness.fetchCalls).toHaveLength(2)
		expect(harness.publishCalls).toHaveLength(2)
	})

	test('passes no fetch options when discovery relays and timeout are absent', async () => {
		const harness = createHarness()
		const params = baseParams()
		delete params.discoveryRelayUrls
		delete params.timeoutMs

		expect((await publishOrderChatToRelays(params, harness.io)).status).toBe('published')
		expect(harness.fetchCalls.map((call) => call.options)).toEqual([undefined, undefined])
	})

	test('keeps plaintext order data and forbidden domain tags out of public gift wraps', async () => {
		const harness = createHarness()
		await publishOrderChatToRelays(baseParams(), harness.io)

		const forbiddenTags = ['subject', 'order', 'payment', 'amount', 'status', 'shipping', 'address', 'email', 'phone', 'name', 'item']
		expect(harness.publishCalls).toHaveLength(2)
		for (const call of harness.publishCalls) {
			const serialized = JSON.stringify(call.event)
			expect(serialized).not.toContain(PRIVATE_CONTENT)
			expect(serialized).not.toContain(PRIVATE_SUBJECT)
			expect(call.event.tags.some((tag) => forbiddenTags.includes(tag[0] ?? ''))).toBe(false)
			expect(call.event.tags).toContainEqual(['p', expect.any(String)])
			expect(call.event.content.length).toBeGreaterThan(0)
		}
	})

	test('preserves missing and empty sender and recipient relay-list states without a publish call', async () => {
		const testCases: Array<HarnessOptions & { expected: 'missing' | 'empty'; fetches: number }> = [
			{ senderEvents: [], expected: 'missing', fetches: 2 },
			{ senderEvents: [relayListEvent(SENDER_PRIVATE_KEY, [])], expected: 'empty', fetches: 2 },
			{ recipientEvents: [], expected: 'missing', fetches: 2 },
			{ recipientEvents: [relayListEvent(RECIPIENT_PRIVATE_KEY, [])], expected: 'empty', fetches: 2 },
		]
		for (const testCase of testCases) {
			const harness = createHarness(testCase)
			const result = await publishOrderChatToRelays(baseParams(), harness.io)
			expect(result.status).toBe('relay_targets_failed')
			if (result.status !== 'relay_targets_failed' || !result.relayTargets) throw new Error('expected relay target state')
			const target = 'senderEvents' in testCase ? result.relayTargets.sender : result.relayTargets.recipient
			expect(target.status).toBe(testCase.expected)
			expect(harness.fetchCalls).toHaveLength(testCase.fetches)
			expect(harness.publishCalls).toHaveLength(0)
		}
	})

	test('contains sequential sender and recipient relay-list fetch rejection', async () => {
		const senderHarness = createHarness({ rejectSenderFetch: true })
		expectRelayListFailure(await publishOrderChatToRelays(baseParams(), senderHarness.io))
		expect(senderHarness.fetchCalls).toHaveLength(1)

		const recipientHarness = createHarness({ rejectRecipientFetch: true })
		expectRelayListFailure(await publishOrderChatToRelays(baseParams(), recipientHarness.io))
		expect(recipientHarness.fetchCalls).toHaveLength(2)
		expect(recipientHarness.publishCalls).toHaveLength(0)
	})

	test('omits forged, wrong-kind, and wrong-author relay candidates without additional I/O', async () => {
		const wrongKind = finalizeEvent(
			{
				kind: 10002,
				created_at: CREATED_AT + 10,
				tags: [['relay', 'wss://wrong-kind.example']],
				content: '',
			},
			SENDER_PRIVATE_KEY,
		)
		const wrongAuthor = relayListEvent(OTHER_PRIVATE_KEY, ['wss://wrong-author.example'], CREATED_AT + 10)
		const signed = relayListEvent(SENDER_PRIVATE_KEY, ['wss://forged.example'], CREATED_AT + 20)
		const forged = { ...signed, sig: '0'.repeat(128) }
		const harness = createHarness({
			senderEvents: [forged, wrongKind, wrongAuthor, relayListEvent(SENDER_PRIVATE_KEY, SENDER_RELAYS)],
			recipientEvents: [wrongKind, wrongAuthor, relayListEvent(RECIPIENT_PRIVATE_KEY, RECIPIENT_RELAYS)],
		})

		const result = await publishOrderChatToRelays(baseParams(), harness.io)
		expect(result.status).toBe('published')
		if (result.status !== 'published') throw new Error('expected both publish calls to resolve')
		expect(result.relayTargets.sender.relays).toEqual(SENDER_RELAYS)
		expect(result.relayTargets.recipient.relays).toEqual(RECIPIENT_RELAYS)
		expect(harness.fetchCalls).toHaveLength(2)
		expect(harness.publishCalls).toHaveLength(2)
	})

	test('preserves signer-unavailable and signer-mismatch precedence before relay option failures', async () => {
		const unavailable = await runtimePublish({ ...baseParams(), signer: undefined, discoveryRelayUrls: 'bad' }, createHarness().io)
		expectValidationFailure(unavailable, 'signer_pubkey_unavailable')

		const mismatch = await runtimePublish(
			{ ...baseParams(), signer: createSigner(OTHER_PRIVATE_KEY), discoveryRelayUrls: 'bad' },
			createHarness().io,
		)
		expectValidationFailure(mismatch, 'signer_pubkey_mismatch')
	})

	test('maps unreadable signer selection through the real transport without I/O', async () => {
		let ioReads = 0
		const params = baseParams() as unknown as Record<string, unknown>
		Object.defineProperty(params, 'signer', {
			get: () => {
				throw new Error(PRIVATE_FAILURE)
			},
		})
		const io = new Proxy(
			{},
			{
				get: () => {
					ioReads += 1
					throw new Error(PRIVATE_FAILURE)
				},
			},
		)

		const result = await runtimePublish(params, io)
		expectValidationFailure(result, 'signer_pubkey_unavailable')
		expect(ioReads).toBe(2)
	})

	test('preserves sender and recipient publish-call rejection states and attempt counts', async () => {
		const senderHarness = createHarness({ rejectSenderPublish: true })
		const senderResult = await publishOrderChatToRelays(baseParams(), senderHarness.io)
		expect(senderResult.status).toBe('sender_publish_failed')
		expect(senderHarness.publishCalls).toHaveLength(1)

		const recipientHarness = createHarness({ rejectRecipientPublish: true })
		const recipientResult = await publishOrderChatToRelays(baseParams(), recipientHarness.io)
		expect(recipientResult.status).toBe('recipient_publish_failed')
		expect(recipientHarness.publishCalls).toHaveLength(2)
		expect(JSON.stringify(recipientResult)).not.toContain(PRIVATE_FAILURE)
	})
})

describe('NIP-17 order-chat relay publish runtime containment', () => {
	for (const [name, value] of [
		['null', null],
		['undefined', undefined],
		['string', 'input'],
		['number', 42],
		['boolean', true],
		['array', []],
	] as const) {
		test(`rejects malformed top-level ${name} input before I/O access`, async () => {
			let ioReads = 0
			const io = new Proxy(
				{},
				{
					get: () => {
						ioReads += 1
						throw new Error(PRIVATE_FAILURE)
					},
				},
			)
			expectValidationFailure(await runtimePublish(value, io))
			expect(ioReads).toBe(0)
		})
	}

	test('contains throwing and revoked top-level inputs before I/O access', async () => {
		for (const value of [
			new Proxy(
				{},
				{
					get: () => {
						throw new Error(PRIVATE_FAILURE)
					},
				},
			),
			(() => {
				const revocable = Proxy.revocable(baseParams(), {})
				revocable.revoke()
				return revocable.proxy
			})(),
		]) {
			let ioReads = 0
			const result = await runtimePublish(
				value,
				new Proxy(
					{},
					{
						get: () => {
							ioReads += 1
							return undefined
						},
					},
				),
			)
			expectValidationFailure(result)
			expect(ioReads).toBe(0)
		}
	})

	test('rejects each invalid or unreadable message field before selecting I/O', async () => {
		const cases: Array<{ field: string; value?: unknown; throwing?: boolean }> = [
			{ field: 'activeUserPubkey', value: 'bad' },
			{ field: 'activeUserPubkey', value: SENDER_PUBKEY.toUpperCase() },
			{ field: 'recipientPubkey', value: 'bad' },
			{ field: 'recipientPubkey', value: RECIPIENT_PUBKEY.toUpperCase() },
			{ field: 'recipientPubkey', value: SENDER_PUBKEY },
			{ field: 'content', value: 42 },
			{ field: 'subject', value: 42 },
			{ field: 'createdAt', value: 0 },
			{ field: 'createdAt', value: -1 },
			{ field: 'createdAt', value: 1.5 },
			{ field: 'createdAt', value: Number.POSITIVE_INFINITY },
			{ field: 'activeUserPubkey', throwing: true },
			{ field: 'recipientPubkey', throwing: true },
			{ field: 'content', throwing: true },
			{ field: 'subject', throwing: true },
			{ field: 'createdAt', throwing: true },
		]

		for (const testCase of cases) {
			let ioReads = 0
			const params = baseParams() as unknown as Record<string, unknown>
			Object.defineProperty(
				params,
				testCase.field,
				testCase.throwing
					? {
							configurable: true,
							get: () => {
								throw new Error(PRIVATE_FAILURE)
							},
						}
					: { configurable: true, value: testCase.value },
			)
			const result = await runtimePublish(
				params,
				new Proxy(
					{},
					{
						get: () => {
							ioReads += 1
							return undefined
						},
					},
				),
			)
			expectValidationFailure(result)
			expect(ioReads).toBe(0)
		}
	})

	test('contains malformed discovery relay arrays and timeout without underlying fetch calls', async () => {
		const throwingArray = ['wss://one.example']
		Object.defineProperty(throwingArray, 0, {
			get: () => {
				throw new Error(PRIVATE_FAILURE)
			},
		})
		const revoked = Proxy.revocable(['wss://one.example'], {})
		revoked.revoke()
		const cases = [
			{ discoveryRelayUrls: null },
			{ discoveryRelayUrls: 'relay' },
			{ discoveryRelayUrls: new Array(1) },
			{ discoveryRelayUrls: ['wss://one.example', 42] },
			{ discoveryRelayUrls: throwingArray },
			{ discoveryRelayUrls: revoked.proxy },
			{ timeoutMs: 0 },
			{ timeoutMs: -1 },
			{ timeoutMs: 1.5 },
			{ timeoutMs: Number.NaN },
		]

		for (const values of cases) {
			let fetchCalls = 0
			const io = {
				fetchEvents: async () => {
					fetchCalls += 1
					return []
				},
				publish: async () => {},
			}
			const result = await runtimePublish({ ...baseParams(), ...values }, io)
			expectRelayListFailure(result)
			expect(fetchCalls).toBe(0)
		}
	})

	test('contains throwing discovery and timeout getters through relay-list failure', async () => {
		for (const field of ['discoveryRelayUrls', 'timeoutMs'] as const) {
			let fetchCalls = 0
			const params = baseParams() as unknown as Record<string, unknown>
			Object.defineProperty(params, field, {
				get: () => {
					throw new Error(PRIVATE_FAILURE)
				},
			})
			const result = await runtimePublish(params, {
				fetchEvents: async () => {
					fetchCalls += 1
					return []
				},
				publish: async () => {},
			})
			expectRelayListFailure(result)
			expect(fetchCalls).toBe(0)
		}
	})

	test('contains unavailable fetch and publish dependencies with exact precedence', async () => {
		for (const fetchEvents of [null, 'fetch', {}]) {
			let publishCalls = 0
			const result = await runtimePublish(baseParams(), {
				fetchEvents,
				publish: async () => {
					publishCalls += 1
				},
			})
			expectRelayListFailure(result)
			expect(publishCalls).toBe(0)
		}

		for (const publish of [null, 'publish', {}]) {
			const harness = createHarness()
			const result = await runtimePublish(baseParams(), {
				fetchEvents: harness.io.fetchEvents,
				publish,
			})
			expect(result.status).toBe('sender_publish_failed')
			expect(harness.fetchCalls).toHaveLength(2)
		}
	})

	test('contains unreadable fetch and publish methods without exposing thrown text', async () => {
		const io = {}
		Object.defineProperties(io, {
			fetchEvents: {
				get: () => {
					throw new Error(PRIVATE_FAILURE)
				},
			},
			publish: {
				get: () => {
					throw new Error(PRIVATE_FAILURE)
				},
			},
		})
		expectRelayListFailure(await runtimePublish(baseParams(), io))

		const harness = createHarness()
		const publishFailureIo = { fetchEvents: harness.io.fetchEvents }
		Object.defineProperty(publishFailureIo, 'publish', {
			get: () => {
				throw new Error(PRIVATE_FAILURE)
			},
		})
		const publishResult = await runtimePublish(baseParams(), publishFailureIo)
		expect(publishResult.status).toBe('sender_publish_failed')
		expect(JSON.stringify(publishResult)).not.toContain(PRIVATE_FAILURE)
	})

	test('reads each caller and dependency property at most once', async () => {
		const counts = new Map<string, number>()
		const getter =
			(name: string, value: unknown): (() => unknown) =>
			() => {
				counts.set(name, (counts.get(name) ?? 0) + 1)
				return value
			}
		const params = {}
		Object.defineProperties(params, {
			activeUserPubkey: { get: getter('activeUserPubkey', SENDER_PUBKEY) },
			recipientPubkey: { get: getter('recipientPubkey', RECIPIENT_PUBKEY) },
			content: { get: getter('content', PRIVATE_CONTENT) },
			subject: { get: getter('subject', PRIVATE_SUBJECT) },
			createdAt: { get: getter('createdAt', CREATED_AT) },
			signer: { get: getter('signer', createSigner(SENDER_PRIVATE_KEY)) },
			discoveryRelayUrls: { get: getter('discoveryRelayUrls', DISCOVERY_RELAYS) },
			timeoutMs: { get: getter('timeoutMs', 500) },
		})
		const harness = createHarness()
		const io = {}
		Object.defineProperties(io, {
			fetchEvents: { get: getter('fetchEvents', harness.io.fetchEvents) },
			publish: { get: getter('publish', harness.io.publish) },
		})

		expect((await runtimePublish(params, io)).status).toBe('published')
		counts.forEach((count, name) => expect(count, name).toBe(1))
	})

	test('receiver-binds and snapshots selected I/O methods and all caller values', async () => {
		const fetchCalls: FetchCall[] = []
		const publishCalls: PublishCall[] = []
		let replacementFetchCalls = 0
		let replacementPublishCalls = 0
		const io = {
			identity: 'selected',
			fetchEvents: async function (
				this: { identity: string },
				filter: NostrFilter | NostrFilter[],
				options?: FetchOptions,
			): Promise<NostrEvent[]> {
				expect(this.identity).toBe('selected')
				fetchCalls.push({ filter, ...(options === undefined ? {} : { options }) })
				if (Array.isArray(filter)) return []
				return filter.authors?.[0] === SENDER_PUBKEY
					? [relayListEvent(SENDER_PRIVATE_KEY, SENDER_RELAYS)]
					: [relayListEvent(RECIPIENT_PRIVATE_KEY, RECIPIENT_RELAYS)]
			},
			publish: async function (this: { identity: string }, event: NostrEvent, options?: PublishOptions): Promise<void> {
				expect(this.identity).toBe('selected')
				publishCalls.push({ event, ...(options === undefined ? {} : { options }) })
			},
		}
		const discoveryRelays = ['wss://original-discovery.example']
		const selectedSigner = createSigner(SENDER_PRIVATE_KEY)
		const params = baseParams({ signer: selectedSigner, discoveryRelayUrls: discoveryRelays, timeoutMs: 700 })
		const promise = publishOrderChatToRelays(params, io)
		io.fetchEvents = async () => {
			replacementFetchCalls += 1
			return []
		}
		io.publish = async () => {
			replacementPublishCalls += 1
		}
		params.activeUserPubkey = OTHER_PUBKEY
		params.recipientPubkey = OTHER_PUBKEY
		params.content = 'replacement content'
		params.subject = 'replacement subject'
		params.createdAt = CREATED_AT + 1
		params.signer = createSigner(OTHER_PRIVATE_KEY)
		params.discoveryRelayUrls = ['wss://replacement.example']
		params.timeoutMs = 9_999
		discoveryRelays[0] = 'wss://mutated.example'

		const result = await promise
		expect(result.status).toBe('published')
		expect(fetchCalls).toHaveLength(2)
		expect(publishCalls).toHaveLength(2)
		expect(replacementFetchCalls).toBe(0)
		expect(replacementPublishCalls).toBe(0)
		expect(fetchCalls[0]?.options).toEqual({ relayUrls: ['wss://original-discovery.example'], timeoutMs: 700 })
		expect(result.status === 'published' && result.rumorId).toBe(
			createOrderChatRumor({
				senderPubkey: SENDER_PUBKEY,
				recipientPubkey: RECIPIENT_PUBKEY,
				content: PRIVATE_CONTENT,
				subject: PRIVATE_SUBJECT,
				createdAt: CREATED_AT,
			}).id,
		)
	})

	test('preserves mutation visibility for the selected signer object', async () => {
		let selectedPubkey = SENDER_PUBKEY
		let releaseUser!: () => void
		const gate = new Promise<void>((resolve) => {
			releaseUser = resolve
		})
		const signer = createSigner(SENDER_PRIVATE_KEY)
		const mutableSigner = signer as unknown as { user: () => Promise<{ pubkey: string }> }
		mutableSigner.user = async () => {
			await gate
			return { pubkey: selectedPubkey }
		}
		const params = baseParams({ signer })
		const promise = publishOrderChatToRelays(params, createHarness().io)
		selectedPubkey = OTHER_PUBKEY
		releaseUser()

		expectValidationFailure(await promise, 'signer_pubkey_mismatch')
	})

	test('uses the active adapter selected inside the function body and restores it', async () => {
		const previous = getNostrIo()
		const harness = createHarness()
		const activeIo: NostrIo = {
			fetchEvents: harness.io.fetchEvents,
			publish: harness.io.publish,
			subscribe: () => () => {},
			sign: async () => {
				throw new Error('legacy signing must not be used')
			},
			getUser: async () => null,
		}

		try {
			setNostrIo(activeIo)
			const result = await publishOrderChatToRelays(baseParams())
			expect(result.status).toBe('published')
			expect(harness.fetchCalls).toHaveLength(2)
			expect(harness.publishCalls).toHaveLength(2)
			expect(harness.publishCalls.every((call) => call.event.kind === NIP59_GIFT_WRAP_KIND)).toBe(true)
		} finally {
			setNostrIo(previous)
		}
	})
})
