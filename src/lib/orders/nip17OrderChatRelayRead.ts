import { getNostrIo, type FetchOptions, type NostrFilter, type NostrIo } from '../nostr/io'
import { ORDER_GENERAL_KIND } from '../schemas/order'
import { readNip17OrderChatInbox, type ReadNip17OrderChatInboxParams, type ReadNip17OrderChatInboxResult } from './nip17OrderChatInbox'
import {
	readOrderChatMessages,
	type OrderChatReadResult,
	type ReadEncryptedOrderChat,
	type ReadOrderChatParams,
} from './nip17OrderChatReadOrchestration'
import type { Nip17OrderTransportSigner } from './nip17OrderTransport'

const DEFAULT_LEGACY_LIMIT_PER_DIRECTION = 500
const MAX_LEGACY_LIMIT_PER_DIRECTION = 500

export type OrderChatRelayReadIo = Pick<NostrIo, 'fetchEvents'>

export type ReadOrderChatRelayParams = {
	activeUserPubkey: string
	counterpartyPubkey: string
	orderContext?: {
		orderId: string
		buyerPubkey: string
		sellerPubkey: string
	}
	signer: Nip17OrderTransportSigner | null | undefined
	legacyRelayUrls?: string[]
	discoveryRelayUrls?: string[]
	legacyLimitPerDirection?: number
	giftWrapLimit?: number
	timeoutMs?: number
}

type PropertySnapshot = { status: 'ready'; value: unknown } | { status: 'unreadable' }

type InputSnapshot = {
	activeUserPubkey: unknown
	counterpartyPubkey: unknown
	orderContext: unknown
	signer: PropertySnapshot
	legacyRelayUrls: PropertySnapshot
	discoveryRelayUrls: PropertySnapshot
	legacyLimitPerDirection: PropertySnapshot
	giftWrapLimit: PropertySnapshot
	timeoutMs: PropertySnapshot
}

type DenseStringArraySnapshot = { status: 'ready'; value: string[] | undefined } | { status: 'failed' }

type FetchEventsSnapshot = { status: 'ready'; fetchEvents: NostrIo['fetchEvents'] } | { status: 'failed' }

type LegacySourceSnapshot =
	| {
			status: 'ready'
			fetchEvents: NostrIo['fetchEvents']
			relayUrls: string[] | undefined
			limitPerDirection: number
			timeoutMs: number | undefined
	  }
	| { status: 'failed' }

type EncryptedSourceSnapshot =
	| {
			status: 'ready'
			fetchEvents: NostrIo['fetchEvents']
			discoveryRelayUrls: string[] | undefined
			giftWrapLimit: unknown
			timeoutMs: unknown
	  }
	| { status: 'failed' }

/**
 * Binds relay infrastructure to the pairwise Layer 2 read boundary. Each
 * source retains independent health. A completed bounded request is not proof
 * of complete historical coverage because neither source exposes pagination
 * or a completeness signal here.
 */
export async function readOrderChatFromRelays(params: ReadOrderChatRelayParams, io?: OrderChatRelayReadIo): Promise<OrderChatReadResult> {
	const input = snapshotInput(params)
	const selectedIo = io === undefined ? getNostrIo() : io
	const fetchEvents = snapshotFetchEvents(selectedIo)
	const legacySource = snapshotLegacySource(input, fetchEvents)
	const encryptedSource = snapshotEncryptedSource(input, fetchEvents)

	const fetchLegacyMessages: ReadOrderChatParams['fetchLegacyMessages'] = async (readParams) => {
		if (legacySource.status === 'failed') throw new Error('Legacy relay read unavailable')

		const filters: NostrFilter[] = [
			{
				kinds: [ORDER_GENERAL_KIND],
				authors: [readParams.activeUserPubkey],
				'#p': [readParams.counterpartyPubkey],
				limit: legacySource.limitPerDirection,
			},
			{
				kinds: [ORDER_GENERAL_KIND],
				authors: [readParams.counterpartyPubkey],
				'#p': [readParams.activeUserPubkey],
				limit: legacySource.limitPerDirection,
			},
		]

		return legacySource.fetchEvents(filters, fetchOptions(legacySource.relayUrls, legacySource.timeoutMs))
	}

	const readEncryptedMessages: ReadEncryptedOrderChat = async (readParams): Promise<ReadNip17OrderChatInboxResult> => {
		if (encryptedSource.status === 'failed') throw new Error('Encrypted relay read unavailable')

		const inboxParams = {
			activeUserPubkey: readParams.activeUserPubkey,
			counterpartyPubkey: readParams.counterpartyPubkey,
			signer: readParams.signer,
			fetchEvents: encryptedSource.fetchEvents,
			discoveryRelayUrls: encryptedSource.discoveryRelayUrls,
			giftWrapLimit: encryptedSource.giftWrapLimit,
			timeoutMs: encryptedSource.timeoutMs,
		} as ReadNip17OrderChatInboxParams

		return readNip17OrderChatInbox(inboxParams)
	}

	const layerTwoInput = {
		activeUserPubkey: input.activeUserPubkey,
		counterpartyPubkey: input.counterpartyPubkey,
		orderContext: input.orderContext,
		signer: input.signer.status === 'ready' ? input.signer.value : undefined,
		fetchLegacyMessages,
		readEncryptedMessages,
	} as ReadOrderChatParams

	return readOrderChatMessages(layerTwoInput)
}

function snapshotInput(value: unknown): InputSnapshot {
	const input = snapshotRecord(value)
	const activeUserPubkey = snapshotProperty(input, 'activeUserPubkey')
	const counterpartyPubkey = snapshotProperty(input, 'counterpartyPubkey')
	const rawOrderContext = snapshotProperty(input, 'orderContext')

	return {
		activeUserPubkey: readyValue(activeUserPubkey),
		counterpartyPubkey: readyValue(counterpartyPubkey),
		orderContext: snapshotOrderContext(rawOrderContext),
		signer: snapshotProperty(input, 'signer'),
		legacyRelayUrls: snapshotProperty(input, 'legacyRelayUrls'),
		discoveryRelayUrls: snapshotProperty(input, 'discoveryRelayUrls'),
		legacyLimitPerDirection: snapshotProperty(input, 'legacyLimitPerDirection'),
		giftWrapLimit: snapshotProperty(input, 'giftWrapLimit'),
		timeoutMs: snapshotProperty(input, 'timeoutMs'),
	}
}

function snapshotRecord(value: unknown): Record<string, unknown> | undefined {
	try {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
		return value as Record<string, unknown>
	} catch {
		return undefined
	}
}

function snapshotProperty(input: Record<string, unknown> | undefined, key: string): PropertySnapshot {
	if (!input) return { status: 'unreadable' }

	try {
		return { status: 'ready', value: input[key] }
	} catch {
		return { status: 'unreadable' }
	}
}

function readyValue(snapshot: PropertySnapshot): unknown {
	return snapshot.status === 'ready' ? snapshot.value : undefined
}

function snapshotOrderContext(snapshot: PropertySnapshot): unknown {
	if (snapshot.status === 'unreadable') return null
	if (snapshot.value === undefined) return undefined

	const context = snapshotRecord(snapshot.value)
	if (!context) return null

	const orderId = snapshotProperty(context, 'orderId')
	const buyerPubkey = snapshotProperty(context, 'buyerPubkey')
	const sellerPubkey = snapshotProperty(context, 'sellerPubkey')
	if (orderId.status === 'unreadable' || buyerPubkey.status === 'unreadable' || sellerPubkey.status === 'unreadable') {
		return null
	}

	return {
		orderId: orderId.value,
		buyerPubkey: buyerPubkey.value,
		sellerPubkey: sellerPubkey.value,
	}
}

function snapshotFetchEvents(value: unknown): FetchEventsSnapshot {
	const io = snapshotRecord(value)
	if (!io) return { status: 'failed' }

	const fetchEvents = snapshotProperty(io, 'fetchEvents')
	if (fetchEvents.status === 'unreadable' || typeof fetchEvents.value !== 'function') {
		return { status: 'failed' }
	}

	const selectedFetchEvents = fetchEvents.value as NostrIo['fetchEvents']
	return {
		status: 'ready',
		fetchEvents: (filter, options) => selectedFetchEvents.call(value, filter, options),
	}
}

function snapshotLegacySource(input: InputSnapshot, fetchEvents: FetchEventsSnapshot): LegacySourceSnapshot {
	if (fetchEvents.status === 'failed') return { status: 'failed' }

	const relayUrls = snapshotOptionalDenseStringArray(input.legacyRelayUrls)
	if (relayUrls.status === 'failed') return { status: 'failed' }

	if (input.legacyLimitPerDirection.status === 'unreadable') return { status: 'failed' }
	const rawLimit = input.legacyLimitPerDirection.value
	const limit = rawLimit === undefined ? DEFAULT_LEGACY_LIMIT_PER_DIRECTION : rawLimit
	if (!isPositiveSafeInteger(limit) || limit > MAX_LEGACY_LIMIT_PER_DIRECTION) return { status: 'failed' }

	if (input.timeoutMs.status === 'unreadable') return { status: 'failed' }
	const timeoutMs = input.timeoutMs.value
	if (timeoutMs !== undefined && !isPositiveSafeInteger(timeoutMs)) return { status: 'failed' }

	return {
		status: 'ready',
		fetchEvents: fetchEvents.fetchEvents,
		relayUrls: relayUrls.value,
		limitPerDirection: limit,
		timeoutMs,
	}
}

function snapshotEncryptedSource(input: InputSnapshot, fetchEvents: FetchEventsSnapshot): EncryptedSourceSnapshot {
	if (fetchEvents.status === 'failed') return { status: 'failed' }
	if (input.signer.status === 'unreadable') return { status: 'failed' }
	if (input.giftWrapLimit.status === 'unreadable') return { status: 'failed' }
	if (input.timeoutMs.status === 'unreadable') return { status: 'failed' }

	const discoveryRelayUrls = snapshotOptionalDenseStringArray(input.discoveryRelayUrls)
	if (discoveryRelayUrls.status === 'failed') return { status: 'failed' }

	return {
		status: 'ready',
		fetchEvents: fetchEvents.fetchEvents,
		discoveryRelayUrls: discoveryRelayUrls.value,
		giftWrapLimit: input.giftWrapLimit.value,
		timeoutMs: input.timeoutMs.value,
	}
}

function snapshotOptionalDenseStringArray(snapshot: PropertySnapshot): DenseStringArraySnapshot {
	if (snapshot.status === 'unreadable') return { status: 'failed' }
	if (snapshot.value === undefined) return { status: 'ready', value: undefined }

	try {
		if (!Array.isArray(snapshot.value)) return { status: 'failed' }

		const length = snapshot.value.length
		if (!Number.isSafeInteger(length) || length < 0) return { status: 'failed' }

		const values: string[] = []
		for (let index = 0; index < length; index += 1) {
			if (!Object.prototype.hasOwnProperty.call(snapshot.value, index)) return { status: 'failed' }

			const entry = snapshot.value[index]
			if (typeof entry !== 'string') return { status: 'failed' }
			values.push(entry)
		}

		return { status: 'ready', value: values }
	} catch {
		return { status: 'failed' }
	}
}

function fetchOptions(relayUrls: string[] | undefined, timeoutMs: number | undefined): FetchOptions | undefined {
	if (relayUrls === undefined && timeoutMs === undefined) return undefined

	const options: FetchOptions = {}
	if (relayUrls !== undefined) options.relayUrls = relayUrls
	if (timeoutMs !== undefined) options.timeoutMs = timeoutMs
	return options
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
