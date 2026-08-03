import { queryOptions, useQuery } from '@tanstack/react-query'
import * as orderChatRelayRead from '@/lib/orders/nip17OrderChatRelayRead'
import type { Nip17OrderTransportSigner } from '@/lib/orders/nip17OrderTransport'
import {
	orderChatKeys,
	type OrderChatNumericKeyState,
	type OrderChatOrderContextKeyState,
	type OrderChatOrderIdKeyState,
	type OrderChatParticipantKeyState,
	type OrderChatReadKeySnapshot,
	type OrderChatRelayArrayKeyState,
	type OrderChatSignerKeyState,
} from './queryKeyFactory'
import type { ReadOrderChatRelayParams } from '@/lib/orders/nip17OrderChatRelayRead'

const LOWERCASE_PUBKEY_RE = /^[0-9a-f]{64}$/
const MAX_LEGACY_LIMIT_PER_DIRECTION = 500
const MAX_GIFT_WRAP_LIMIT = 500
const UNREADABLE_QUERY_INPUT = 'Unreadable query input'

type PropertySnapshot = { status: 'readable'; value: unknown } | { status: 'unreadable' }

type ParticipantSnapshot =
	| { key: Extract<OrderChatParticipantKeyState, { state: 'canonical' }>; value: string }
	| { key: Extract<OrderChatParticipantKeyState, { state: 'malformed' }> }
	| { key: Extract<OrderChatParticipantKeyState, { state: 'unreadable' }> }

type OrderIdSnapshot =
	| { key: Extract<OrderChatOrderIdKeyState, { state: 'valid' }>; value: string }
	| { key: Exclude<OrderChatOrderIdKeyState, { state: 'valid' }> }

type OrderContextSnapshot =
	| { key: Extract<OrderChatOrderContextKeyState, { state: 'absent' }> }
	| { key: Extract<OrderChatOrderContextKeyState, { state: 'invalid_container' }> }
	| { key: Extract<OrderChatOrderContextKeyState, { state: 'unreadable' }> }
	| {
			key: Extract<OrderChatOrderContextKeyState, { state: 'supplied' }>
			orderId: OrderIdSnapshot
			buyerPubkey: ParticipantSnapshot
			sellerPubkey: ParticipantSnapshot
	  }

type RelayArraySnapshot =
	| { key: Extract<OrderChatRelayArrayKeyState, { state: 'absent' }> }
	| { key: Extract<OrderChatRelayArrayKeyState, { state: 'empty' }>; value: [] }
	| { key: Extract<OrderChatRelayArrayKeyState, { state: 'values' }>; value: string[] }
	| { key: Extract<OrderChatRelayArrayKeyState, { state: 'malformed' }> }
	| { key: Extract<OrderChatRelayArrayKeyState, { state: 'unreadable' }> }

type NumericSnapshot =
	| { key: Extract<OrderChatNumericKeyState, { state: 'absent' }> }
	| { key: Extract<OrderChatNumericKeyState, { state: 'valid' }>; value: number }
	| { key: Extract<OrderChatNumericKeyState, { state: 'invalid' }> }
	| { key: Extract<OrderChatNumericKeyState, { state: 'unreadable' }> }

type SignerSnapshot =
	| { key: Extract<OrderChatSignerKeyState, { state: 'absent' }>; value: null | undefined }
	| { key: Extract<OrderChatSignerKeyState, { state: 'present' }>; value: unknown }
	| { key: Extract<OrderChatSignerKeyState, { state: 'unreadable' }> }

type DetachedOrderChatSnapshot = {
	key: OrderChatReadKeySnapshot
	activeUserPubkey: ParticipantSnapshot
	counterpartyPubkey: ParticipantSnapshot
	orderContext: OrderContextSnapshot
	legacyRelayUrls: RelayArraySnapshot
	discoveryRelayUrls: RelayArraySnapshot
	legacyLimitPerDirection: NumericSnapshot
	giftWrapLimit: NumericSnapshot
	timeoutMs: NumericSnapshot
	signer: SignerSnapshot
}

export function createOrderChatQueryOptions(params: ReadOrderChatRelayParams) {
	const snapshot = snapshotQueryInput(params)
	const adapterParams = reconstructAdapterParams(snapshot)

	return queryOptions({
		queryKey: orderChatKeys.read(snapshot.key),
		queryFn: () => orderChatRelayRead.readOrderChatFromRelays(adapterParams),
		enabled: snapshot.activeUserPubkey.key.state === 'canonical' && snapshot.counterpartyPubkey.key.state === 'canonical',
		retry: false,
	})
}

export function useOrderChatQuery(params: ReadOrderChatRelayParams) {
	return useQuery(createOrderChatQueryOptions(params))
}

function snapshotQueryInput(value: unknown): DetachedOrderChatSnapshot {
	const input = snapshotRecord(value)
	const activeUserPubkey = snapshotParticipant(snapshotProperty(input, 'activeUserPubkey'))
	const counterpartyPubkey = snapshotParticipant(snapshotProperty(input, 'counterpartyPubkey'))
	const orderContext = snapshotOrderContext(snapshotProperty(input, 'orderContext'))
	const signer = snapshotSigner(snapshotProperty(input, 'signer'))
	const legacyRelayUrls = snapshotRelayArray(snapshotProperty(input, 'legacyRelayUrls'))
	const discoveryRelayUrls = snapshotRelayArray(snapshotProperty(input, 'discoveryRelayUrls'))
	const legacyLimitPerDirection = snapshotNumeric(snapshotProperty(input, 'legacyLimitPerDirection'), MAX_LEGACY_LIMIT_PER_DIRECTION)
	const giftWrapLimit = snapshotNumeric(snapshotProperty(input, 'giftWrapLimit'), MAX_GIFT_WRAP_LIMIT)
	const timeoutMs = snapshotNumeric(snapshotProperty(input, 'timeoutMs'))

	return {
		key: {
			activeUserPubkey: activeUserPubkey.key,
			counterpartyPubkey: counterpartyPubkey.key,
			orderContext: orderContext.key,
			legacyRelayUrls: detachedRelayKey(legacyRelayUrls),
			discoveryRelayUrls: detachedRelayKey(discoveryRelayUrls),
			legacyLimitPerDirection: legacyLimitPerDirection.key,
			giftWrapLimit: giftWrapLimit.key,
			timeoutMs: timeoutMs.key,
			signer: signer.key,
		},
		activeUserPubkey,
		counterpartyPubkey,
		orderContext,
		legacyRelayUrls,
		discoveryRelayUrls,
		legacyLimitPerDirection,
		giftWrapLimit,
		timeoutMs,
		signer,
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

function snapshotProperty(input: Record<string, unknown> | undefined, property: string): PropertySnapshot {
	if (!input) return { status: 'unreadable' }

	try {
		return { status: 'readable', value: input[property] }
	} catch {
		return { status: 'unreadable' }
	}
}

function snapshotParticipant(property: PropertySnapshot): ParticipantSnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (typeof property.value === 'string' && LOWERCASE_PUBKEY_RE.test(property.value)) {
		return { key: { state: 'canonical', value: property.value }, value: property.value }
	}
	return { key: { state: 'malformed' } }
}

function snapshotOrderId(property: PropertySnapshot): OrderIdSnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (typeof property.value !== 'string') return { key: { state: 'invalid_type' } }
	if (property.value.length === 0) return { key: { state: 'invalid_value' } }
	return { key: { state: 'valid', value: property.value }, value: property.value }
}

function snapshotOrderContext(property: PropertySnapshot): OrderContextSnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (property.value === undefined) return { key: { state: 'absent' } }

	const context = snapshotRecord(property.value)
	if (!context) return { key: { state: 'invalid_container' } }

	const orderId = snapshotOrderId(snapshotProperty(context, 'orderId'))
	const buyerPubkey = snapshotParticipant(snapshotProperty(context, 'buyerPubkey'))
	const sellerPubkey = snapshotParticipant(snapshotProperty(context, 'sellerPubkey'))

	return {
		key: {
			state: 'supplied',
			orderId: orderId.key,
			buyerPubkey: buyerPubkey.key,
			sellerPubkey: sellerPubkey.key,
		},
		orderId,
		buyerPubkey,
		sellerPubkey,
	}
}

function snapshotRelayArray(property: PropertySnapshot): RelayArraySnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (property.value === undefined) return { key: { state: 'absent' } }

	try {
		if (!Array.isArray(property.value)) return { key: { state: 'malformed' } }
		const length = property.value.length
		if (!Number.isSafeInteger(length) || length < 0) return { key: { state: 'malformed' } }

		const values: string[] = []
		for (let index = 0; index < length; index += 1) {
			if (!Object.prototype.hasOwnProperty.call(property.value, index)) return { key: { state: 'malformed' } }
			const entry = property.value[index]
			if (typeof entry !== 'string') return { key: { state: 'malformed' } }
			values.push(entry)
		}

		if (values.length === 0) return { key: { state: 'empty' }, value: [] }
		return { key: { state: 'values', value: values.slice() }, value: values }
	} catch {
		return { key: { state: 'malformed' } }
	}
}

function detachedRelayKey(snapshot: RelayArraySnapshot): OrderChatRelayArrayKeyState {
	return snapshot.key.state === 'values' ? { state: 'values', value: snapshot.key.value.slice() } : snapshot.key
}

function snapshotNumeric(property: PropertySnapshot, maximum?: number): NumericSnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (property.value === undefined) return { key: { state: 'absent' } }
	if (
		typeof property.value === 'number' &&
		Number.isSafeInteger(property.value) &&
		property.value > 0 &&
		(maximum === undefined || property.value <= maximum)
	) {
		return { key: { state: 'valid', value: property.value }, value: property.value }
	}
	return { key: { state: 'invalid' } }
}

function snapshotSigner(property: PropertySnapshot): SignerSnapshot {
	if (property.status === 'unreadable') return { key: { state: 'unreadable' } }
	if (property.value === null || property.value === undefined) {
		return { key: { state: 'absent' }, value: property.value }
	}
	return { key: { state: 'present' }, value: property.value }
}

function reconstructAdapterParams(snapshot: DetachedOrderChatSnapshot): ReadOrderChatRelayParams {
	const result: Record<string, unknown> = {}
	reconstructParticipant(result, 'activeUserPubkey', snapshot.activeUserPubkey)
	reconstructParticipant(result, 'counterpartyPubkey', snapshot.counterpartyPubkey)
	reconstructOrderContext(result, snapshot.orderContext)
	reconstructSigner(result, snapshot.signer)
	reconstructRelayArray(result, 'legacyRelayUrls', snapshot.legacyRelayUrls)
	reconstructRelayArray(result, 'discoveryRelayUrls', snapshot.discoveryRelayUrls)
	reconstructNumeric(result, 'legacyLimitPerDirection', snapshot.legacyLimitPerDirection)
	reconstructNumeric(result, 'giftWrapLimit', snapshot.giftWrapLimit)
	reconstructNumeric(result, 'timeoutMs', snapshot.timeoutMs)
	return result as ReadOrderChatRelayParams
}

function reconstructParticipant(target: Record<string, unknown>, property: string, snapshot: ParticipantSnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, property)
	target[property] = 'value' in snapshot ? snapshot.value : ''
}

function reconstructOrderContext(target: Record<string, unknown>, snapshot: OrderContextSnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, 'orderContext')
	if (snapshot.key.state === 'absent') {
		target.orderContext = undefined
		return
	}
	if (snapshot.key.state === 'invalid_container') {
		target.orderContext = null
		return
	}
	if (!('orderId' in snapshot)) return

	const context: Record<string, unknown> = {}
	reconstructOrderId(context, snapshot.orderId)
	reconstructParticipant(context, 'buyerPubkey', snapshot.buyerPubkey)
	reconstructParticipant(context, 'sellerPubkey', snapshot.sellerPubkey)
	target.orderContext = context
}

function reconstructOrderId(target: Record<string, unknown>, snapshot: OrderIdSnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, 'orderId')
	target.orderId = 'value' in snapshot ? snapshot.value : ''
}

function reconstructSigner(target: Record<string, unknown>, snapshot: SignerSnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, 'signer')
	target.signer = ('value' in snapshot ? snapshot.value : undefined) as Nip17OrderTransportSigner | null | undefined
}

function reconstructRelayArray(target: Record<string, unknown>, property: string, snapshot: RelayArraySnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, property)
	if (snapshot.key.state === 'absent') {
		target[property] = undefined
		return
	}
	if (snapshot.key.state === 'malformed') {
		target[property] = null
		return
	}
	target[property] = 'value' in snapshot ? snapshot.value.slice() : undefined
}

function reconstructNumeric(target: Record<string, unknown>, property: string, snapshot: NumericSnapshot): void {
	if (snapshot.key.state === 'unreadable') return defineUnreadable(target, property)
	if (snapshot.key.state === 'absent') {
		target[property] = undefined
		return
	}
	target[property] = 'value' in snapshot ? snapshot.value : 0
}

function defineUnreadable(target: object, property: string): void {
	Object.defineProperty(target, property, {
		enumerable: true,
		configurable: false,
		get() {
			throw new Error(UNREADABLE_QUERY_INPUT)
		},
	})
}
