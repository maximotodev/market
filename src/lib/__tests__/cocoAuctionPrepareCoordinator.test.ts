import { describe, expect, test } from 'bun:test'
import { auctionOwnerPresenceLockName, auctionPrepareLockName, browserPrepareCoordinator } from '@/lib/coco/auctionDemo/prepareCoordinator'

describe('Coco Auction cross-page prepare coordinator', () => {
	test('uses the complete deterministic run and leg identity', () => {
		const runId = 'run-with-a-long-exact-identity'
		const legId = `${runId}:bidder-a`
		expect(auctionPrepareLockName(runId, legId)).toBe(`coco-auction-demo:${runId}:${legId}:prepare`)
		expect(auctionOwnerPresenceLockName(runId, legId)).toBe(`coco-auction-demo:${runId}:${legId}:owner`)
		expect(() => auctionPrepareLockName(runId, 'other-run:bidder-a')).toThrow('exact run/leg identity')
		expect(() => auctionOwnerPresenceLockName(runId, 'other-run:bidder-a')).toThrow('exact run/leg identity')
	})

	test('fails closed when Web Locks are unavailable', () => {
		expect(() => browserPrepareCoordinator()).toThrow('Web Locks API is required')
	})
})
