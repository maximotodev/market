import { describe, expect, spyOn, test } from 'bun:test'
import * as orderChatRelayPublish from '@/lib/orders/nip17OrderChatRelayPublish'
import * as orderChatRelayRead from '@/lib/orders/nip17OrderChatRelayRead'
import type { PublishOrderChatRelayParams } from '@/lib/orders/nip17OrderChatRelayPublish'
import type { PublishNip17OrderTransportResult } from '@/lib/orders/nip17OrderTransport'
import { createPublishOrderChatMutationOptions } from '@/publish/orderChat'

const ACTIVE_USER_PUBKEY = 'a'.repeat(64)
const RECIPIENT_PUBKEY = 'b'.repeat(64)

function baseParams(): PublishOrderChatRelayParams {
	return {
		activeUserPubkey: ACTIVE_USER_PUBKEY,
		recipientPubkey: RECIPIENT_PUBKEY,
		content: 'private order chat content',
		signer: undefined,
	}
}

async function executeMutation(params: PublishOrderChatRelayParams): Promise<PublishNip17OrderTransportResult> {
	const mutationFn = createPublishOrderChatMutationOptions().mutationFn
	if (!mutationFn) throw new Error('expected mutation function')
	return mutationFn(params, undefined as never)
}

describe('order-chat publish mutation options contract', () => {
	test('invokes the adapter exactly once, forwards variables exactly, and returns its result by identity', async () => {
		const params = baseParams()
		const expected = { status: 'validation_failed', error: { code: 'signer_pubkey_unavailable' } } as PublishNip17OrderTransportResult
		const publishSpy = spyOn(orderChatRelayPublish, 'publishOrderChatToRelays').mockResolvedValue(expected)

		try {
			const actual = await executeMutation(params)
			expect(actual).toBe(expected)
			expect(publishSpy).toHaveBeenCalledTimes(1)
			expect(publishSpy.mock.calls[0]?.[0]).toBe(params)
		} finally {
			publishSpy.mockRestore()
		}
	})

	test('passes every transport-result union member through unchanged as resolved mutation data', async () => {
		const results = [
			{ status: 'validation_failed' },
			{ status: 'relay_targets_failed' },
			{ status: 'wrap_failed' },
			{ status: 'sender_publish_failed' },
			{ status: 'recipient_publish_failed' },
			{ status: 'published' },
		] as PublishNip17OrderTransportResult[]
		let index = 0
		const publishSpy = spyOn(orderChatRelayPublish, 'publishOrderChatToRelays').mockImplementation(async () => results[index++]!)

		try {
			for (const expected of results) {
				const actual = await executeMutation(baseParams())
				expect(actual).toBe(expected)
			}
			expect(publishSpy).toHaveBeenCalledTimes(results.length)
		} finally {
			publishSpy.mockRestore()
		}
	})

	test('keeps recipient_publish_failed as ordinary resolved data', async () => {
		const expected = { status: 'recipient_publish_failed' } as PublishNip17OrderTransportResult
		const publishSpy = spyOn(orderChatRelayPublish, 'publishOrderChatToRelays').mockResolvedValue(expected)

		try {
			await expect(executeMutation(baseParams())).resolves.toBe(expected)
		} finally {
			publishSpy.mockRestore()
		}
	})

	test('sets retry false and defines no success, error, invalidation, refresh, or optimistic callbacks', () => {
		const options = createPublishOrderChatMutationOptions()
		expect(options.retry).toBe(false)
		expect(Object.keys(options).sort()).toEqual(['mutationFn', 'retry'])
		expect('onSuccess' in options).toBe(false)
		expect('onError' in options).toBe(false)
		expect('onMutate' in options).toBe(false)
		expect('onSettled' in options).toBe(false)
	})

	test('does not retry or convert an adapter exception', async () => {
		const failure = new Error('adapter failure')
		const publishSpy = spyOn(orderChatRelayPublish, 'publishOrderChatToRelays').mockRejectedValue(failure)

		try {
			await expect(executeMutation(baseParams())).rejects.toBe(failure)
			expect(publishSpy).toHaveBeenCalledTimes(1)
		} finally {
			publishSpy.mockRestore()
		}
	})

	test('performs no read-after-write, logging, toast, invented state, or secondary action', async () => {
		const expected = { status: 'published' } as PublishNip17OrderTransportResult
		const publishSpy = spyOn(orderChatRelayPublish, 'publishOrderChatToRelays').mockResolvedValue(expected)
		const readSpy = spyOn(orderChatRelayRead, 'readOrderChatFromRelays')
		const logSpy = spyOn(console, 'log').mockImplementation(() => {})
		const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
		const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

		try {
			const actual = await executeMutation(baseParams())
			expect(actual).toBe(expected)
			expect(publishSpy).toHaveBeenCalledTimes(1)
			expect(readSpy).not.toHaveBeenCalled()
			expect(logSpy).not.toHaveBeenCalled()
			expect(warnSpy).not.toHaveBeenCalled()
			expect(errorSpy).not.toHaveBeenCalled()
		} finally {
			publishSpy.mockRestore()
			readSpy.mockRestore()
			logSpy.mockRestore()
			warnSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})
})
