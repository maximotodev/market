import { verifyEvent } from 'nostr-tools'
import { getNostrIo, type FetchOptions, type NostrIo } from '../nostr/io'
import { NIP17_DM_RELAY_LIST_KIND } from '../nostr/nip17Relays'
import {
	publishNip17OrderTransportMessage,
	type FetchNip17RelayListEventsParams,
	type Nip17OrderTransportSigner,
	type PublishNip17OrderTransportMessageParams,
	type PublishNip17OrderTransportGiftWrapParams,
	type PublishNip17OrderTransportResult,
} from './nip17OrderTransport'
import { createOrderChatRumor, type CreateOrderChatRumorParams, type OrderMessageRumor } from './orderMessageRumor'

const LOWERCASE_PUBKEY_RE = /^[0-9a-f]{64}$/

export type OrderChatRelayPublishIo = Pick<NostrIo, 'fetchEvents' | 'publish'>

export type PublishOrderChatRelayParams = {
	activeUserPubkey: string
	recipientPubkey: string
	content: string
	subject?: string
	signer: Nip17OrderTransportSigner | null | undefined
	discoveryRelayUrls?: string[]
	timeoutMs?: number
	createdAt?: number
}

type PropertySnapshot = { status: 'ready'; value: unknown } | { status: 'unreadable' }

type MessageSnapshot = {
	input: Record<string, unknown> | undefined
	readable: boolean
	activeUserPubkey: unknown
	recipientPubkey: unknown
	content: unknown
	subject: unknown
	createdAt: unknown
}

type DenseStringArraySnapshot = { status: 'ready'; value: string[] | undefined } | { status: 'failed' }

type FetchOptionsSnapshot =
	| {
			status: 'ready'
			discoveryRelayUrls: string[] | undefined
			timeoutMs: number | undefined
	  }
	| { status: 'failed' }

type IoSnapshot = {
	fetchEvents: { status: 'ready'; value: NostrIo['fetchEvents'] } | { status: 'failed' }
	publish: { status: 'ready'; value: NostrIo['publish'] } | { status: 'failed' }
}

export async function publishOrderChatToRelays(
	params: PublishOrderChatRelayParams,
	io?: OrderChatRelayPublishIo,
): Promise<PublishNip17OrderTransportResult> {
	const message = snapshotMessage(params)
	if (!isValidMessageSnapshot(message)) return invalidOrderMessage()

	let rumor: OrderMessageRumor
	try {
		const rumorParams: CreateOrderChatRumorParams = {
			senderPubkey: message.activeUserPubkey,
			recipientPubkey: message.recipientPubkey,
			content: message.content,
		}
		if (message.subject !== undefined) rumorParams.subject = message.subject
		if (message.createdAt !== undefined) rumorParams.createdAt = message.createdAt
		rumor = createOrderChatRumor(rumorParams)
	} catch {
		return invalidOrderMessage()
	}

	const signer = snapshotProperty(message.input, 'signer')
	const discoveryRelayUrls = snapshotProperty(message.input, 'discoveryRelayUrls')
	const timeoutMs = snapshotProperty(message.input, 'timeoutMs')
	const options = snapshotFetchOptions(discoveryRelayUrls, timeoutMs)
	const selectedIo = io === undefined ? getNostrIo() : io
	const ioSnapshot = snapshotIo(selectedIo)
	const fetchRelayListEvents = relayListFetcher(ioSnapshot, options)
	const publishGiftWrap = giftWrapPublisher(ioSnapshot)

	const transportParams: PublishNip17OrderTransportMessageParams = {
		rumor,
		signer: (signer.status === 'ready' ? signer.value : undefined) as Nip17OrderTransportSigner,
		fetchRelayListEvents,
		publishGiftWrap,
	}
	if (message.createdAt !== undefined) transportParams.createdAt = message.createdAt

	return publishNip17OrderTransportMessage(transportParams)
}

function snapshotMessage(value: unknown): MessageSnapshot {
	const input = snapshotRecord(value)
	const activeUserPubkey = snapshotProperty(input, 'activeUserPubkey')
	const recipientPubkey = snapshotProperty(input, 'recipientPubkey')
	const content = snapshotProperty(input, 'content')
	const subject = snapshotProperty(input, 'subject')
	const createdAt = snapshotProperty(input, 'createdAt')

	return {
		input,
		readable:
			activeUserPubkey.status === 'ready' &&
			recipientPubkey.status === 'ready' &&
			content.status === 'ready' &&
			subject.status === 'ready' &&
			createdAt.status === 'ready',
		activeUserPubkey: readyValue(activeUserPubkey),
		recipientPubkey: readyValue(recipientPubkey),
		content: readyValue(content),
		subject: readyValue(subject),
		createdAt: readyValue(createdAt),
	}
}

function isValidMessageSnapshot(message: MessageSnapshot): message is MessageSnapshot & {
	activeUserPubkey: string
	recipientPubkey: string
	content: string
	subject: string | undefined
	createdAt: number | undefined
} {
	return (
		message.readable &&
		isCanonicalPubkey(message.activeUserPubkey) &&
		isCanonicalPubkey(message.recipientPubkey) &&
		message.activeUserPubkey !== message.recipientPubkey &&
		typeof message.content === 'string' &&
		(message.subject === undefined || typeof message.subject === 'string') &&
		(message.createdAt === undefined || isPositiveSafeInteger(message.createdAt))
	)
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

function snapshotFetchOptions(discoveryRelayUrls: PropertySnapshot, timeoutMs: PropertySnapshot): FetchOptionsSnapshot {
	const relayUrls = snapshotOptionalDenseStringArray(discoveryRelayUrls)
	if (relayUrls.status === 'failed' || timeoutMs.status === 'unreadable') return { status: 'failed' }
	if (timeoutMs.value !== undefined && !isPositiveSafeInteger(timeoutMs.value)) return { status: 'failed' }

	return {
		status: 'ready',
		discoveryRelayUrls: relayUrls.value,
		timeoutMs: timeoutMs.value,
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

function snapshotIo(value: unknown): IoSnapshot {
	const io = snapshotRecord(value)
	const fetchEvents = snapshotProperty(io, 'fetchEvents')
	const publish = snapshotProperty(io, 'publish')

	return {
		fetchEvents:
			fetchEvents.status === 'ready' && typeof fetchEvents.value === 'function'
				? {
						status: 'ready',
						value: (filter, options) => (fetchEvents.value as NostrIo['fetchEvents']).call(value, filter, options),
					}
				: { status: 'failed' },
		publish:
			publish.status === 'ready' && typeof publish.value === 'function'
				? {
						status: 'ready',
						value: (event, options) => (publish.value as NostrIo['publish']).call(value, event, options),
					}
				: { status: 'failed' },
	}
}

function relayListFetcher(
	io: IoSnapshot,
	options: FetchOptionsSnapshot,
): (params: FetchNip17RelayListEventsParams) => Promise<Awaited<ReturnType<NostrIo['fetchEvents']>>> {
	if (io.fetchEvents.status === 'failed' || options.status === 'failed') {
		return async () => {
			throw new Error('Relay-list fetch unavailable')
		}
	}
	const fetchEvents = io.fetchEvents.value

	return async (params) => {
		const events = await fetchEvents(params.filter, createFetchOptions(options))
		if (!Array.isArray(events)) throw new Error('Relay-list fetch unavailable')
		return verifiedRelayListEvents(events, params.pubkey)
	}
}

function giftWrapPublisher(
	io: IoSnapshot,
): (params: PublishNip17OrderTransportGiftWrapParams) => Promise<Awaited<ReturnType<NostrIo['publish']>>> {
	if (io.publish.status === 'failed') {
		return async () => {
			throw new Error('Gift-wrap publish unavailable')
		}
	}
	const publish = io.publish.value

	return async (params) => {
		const relayUrls = params.relays.slice()
		return publish(params.giftWrap, { relayUrls })
	}
}

function createFetchOptions(options: Extract<FetchOptionsSnapshot, { status: 'ready' }>): FetchOptions | undefined {
	if (options.discoveryRelayUrls === undefined && options.timeoutMs === undefined) return undefined

	const result: FetchOptions = {}
	if (options.discoveryRelayUrls !== undefined) result.relayUrls = options.discoveryRelayUrls.slice()
	if (options.timeoutMs !== undefined) result.timeoutMs = options.timeoutMs
	return result
}

function verifiedRelayListEvents(value: unknown[], pubkey: string): Awaited<ReturnType<NostrIo['fetchEvents']>> {
	const verified: Awaited<ReturnType<NostrIo['fetchEvents']>> = []

	try {
		const length = value.length
		if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid relay-list result')

		for (let index = 0; index < length; index += 1) {
			if (!Object.prototype.hasOwnProperty.call(value, index)) continue
			const event = verifyAndSnapshotRelayListEvent(value[index], pubkey)
			if (event) verified.push(event)
		}
	} catch {
		throw new Error('Relay-list fetch unavailable')
	}

	return verified
}

function verifyAndSnapshotRelayListEvent(candidate: unknown, pubkey: string): NostrIoEvent | undefined {
	try {
		if (typeof candidate !== 'object' || candidate === null) return undefined
		const event = candidate as Record<string, unknown>
		const id = event.id
		const sig = event.sig
		const author = event.pubkey
		const kind = event.kind
		const createdAt = event.created_at
		const rawTags = event.tags
		const content = event.content
		const tags = snapshotStringTags(rawTags)

		if (typeof id !== 'string' || typeof sig !== 'string' || typeof author !== 'string' || typeof content !== 'string') {
			return undefined
		}
		if (!Number.isSafeInteger(kind) || (kind as number) < 0 || (kind as number) > 65535) return undefined
		if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0 || !tags) return undefined

		const snapshot: NostrIoEvent = {
			id,
			sig,
			pubkey: author,
			kind: kind as number,
			created_at: createdAt as number,
			tags,
			content,
		}
		if (snapshot.kind !== NIP17_DM_RELAY_LIST_KIND || snapshot.pubkey !== pubkey) return undefined
		return verifyEvent(snapshot) ? snapshot : undefined
	} catch {
		return undefined
	}
}

function snapshotStringTags(value: unknown): string[][] | undefined {
	try {
		if (!Array.isArray(value)) return undefined
		const outerLength = value.length
		if (!Number.isSafeInteger(outerLength) || outerLength < 0) return undefined

		const tags: string[][] = []
		for (let outerIndex = 0; outerIndex < outerLength; outerIndex += 1) {
			if (!Object.prototype.hasOwnProperty.call(value, outerIndex)) return undefined
			const tag = value[outerIndex]
			if (!Array.isArray(tag)) return undefined
			const innerLength = tag.length
			if (!Number.isSafeInteger(innerLength) || innerLength < 0) return undefined

			const tagSnapshot: string[] = []
			for (let innerIndex = 0; innerIndex < innerLength; innerIndex += 1) {
				if (!Object.prototype.hasOwnProperty.call(tag, innerIndex)) return undefined
				const entry = tag[innerIndex]
				if (typeof entry !== 'string') return undefined
				tagSnapshot.push(entry)
			}
			tags.push(tagSnapshot)
		}

		return tags
	} catch {
		return undefined
	}
}

function isCanonicalPubkey(value: unknown): value is string {
	return typeof value === 'string' && LOWERCASE_PUBKEY_RE.test(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function invalidOrderMessage(): PublishNip17OrderTransportResult {
	return {
		status: 'validation_failed',
		error: { code: 'invalid_order_message' },
	}
}

type NostrIoEvent = Awaited<ReturnType<NostrIo['fetchEvents']>>[number]
