import { expect, test, type Browser, type Page } from '@playwright/test'
import { SimplePool } from 'nostr-tools'

const CONTROL_DB = 'plebeian-market-coco-auction-control-v3'
const RELAY_URL = 'ws://localhost:10547'
const crashBoundaries = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const
const settlementCrashBoundaries = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const
const bidderRoles = ['bidder-a', 'bidder-b'] as const

type ControlSnapshot = {
	sentinel: { currentRunId: string; legIds: string[] }
	run: {
		runId: string
		auctionEventId: string
		sellerPubkey: string
		state: string
		closeAt: number
		bidObservations: Record<string, number>
	}
	legs: Array<{
		bidderLegId: string
		role: string
		accountId: string
		state: string
		operationId?: string
		prepareClaimId?: string
		prepareClaimOwnerControllerId?: string
		prepareClaimOwnerControllerGeneration?: number
		prepareClaimEpoch?: number
		prepareHighestOwnerGeneration?: number
		prepareAttemptCount?: number
		revision: number
		refundPublicKey: string
		lockSecrets?: string[]
		proofYs?: string[]
		signedBidEvent?: { id: string }
	}>
	sellerReceive?: {
		phase: string
		receiveOperationId?: string
		receiveOperationState?: string
		receiveAttemptCount: number
		tokenFingerprint: string
		settlementEvent?: { id: string }
		settlementPublishedAt?: number
		receiveFinalizedAt?: number
		claimEpoch: number
		highestOwnerGeneration: number
	}
	serialized: string
}

const readControl = (page: Page): Promise<ControlSnapshot> =>
	page.evaluate(async (databaseName) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		try {
			const read = <T>(request: IDBRequest<T>) =>
				new Promise<T>((resolve, reject) => {
					request.onsuccess = () => resolve(request.result)
					request.onerror = () => reject(request.error)
				})
			const transaction = database.transaction(['meta', 'runs', 'legs', 'seller-receives'], 'readonly')
			const sentinel = await read(transaction.objectStore('meta').get('workflow-sentinel'))
			const runs = await read(transaction.objectStore('runs').getAll())
			const legs = await read(transaction.objectStore('legs').getAll())
			const sellerReceives = await read(transaction.objectStore('seller-receives').getAll())
			return {
				sentinel,
				run: runs[0],
				legs,
				sellerReceive: sellerReceives[0],
				serialized: JSON.stringify({ sentinel, runs, legs, sellerReceives }),
			}
		} finally {
			database.close()
		}
	}, CONTROL_DB)

const corruptControl = (page: Page, target: 'delete-leg' | 'corrupt-leg' | 'corrupt-run', legId: string, runId: string) =>
	page.evaluate(
		async ({ databaseName, target, legId, runId }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName)
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error)
			})
			try {
				const storeName = target === 'corrupt-run' ? 'runs' : 'legs'
				const transaction = database.transaction(storeName, 'readwrite')
				const store = transaction.objectStore(storeName)
				if (target === 'delete-leg') store.delete(legId)
				else store.put(target === 'corrupt-run' ? { runId, corrupt: true } : { bidderLegId: legId, corrupt: true })
				await new Promise<void>((resolve, reject) => {
					transaction.oncomplete = () => resolve()
					transaction.onerror = () => reject(transaction.error)
				})
			} finally {
				database.close()
			}
		},
		{ databaseName: CONTROL_DB, target, legId, runId },
	)

const relayBidIds = async (auctionEventId: string): Promise<string[]> => {
	const pool = new SimplePool()
	try {
		const events = await pool.querySync([RELAY_URL], { kinds: [1023], '#e': [auctionEventId] }, { maxWait: 5_000 })
		return [...new Set(events.map((event) => event.id))].sort()
	} finally {
		pool.close([RELAY_URL])
	}
}

const relaySettlementIds = async (auctionEventId: string): Promise<string[]> => {
	const pool = new SimplePool()
	try {
		const events = await pool.querySync([RELAY_URL], { kinds: [1024], '#e': [auctionEventId] }, { maxWait: 5_000 })
		return [...new Set(events.map((event) => event.id))].sort()
	} finally {
		pool.close([RELAY_URL])
	}
}

const runCrashCase = async (browser: Browser, boundary: (typeof crashBoundaries)[number], role: (typeof bidderRoles)[number]) => {
	const context = await browser.newContext()
	const page = await context.newPage()
	try {
		await page.goto('/')
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const failure = await page.evaluate(
			async ({ crashAt, crashLeg }) => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt, crashLeg })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			},
			{ crashAt: boundary, crashLeg: role },
		)
		expect(failure).toContain(`INJECTED_${boundary}_${role}`)

		const before = await readControl(page)
		const beforeLeg = before.legs.find((leg) => leg.role === role)!
		const beforeDiagnostics = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
		const beforeOperations = beforeDiagnostics.operations.filter((operation) => operation.accountId === beforeLeg.accountId)
		const beforeRelayIds = await relayBidIds(before.run.auctionEventId)
		expect(before.sentinel.currentRunId).toBe(before.run.runId)
		expect(before.sentinel.legIds).toContain(beforeLeg.bidderLegId)
		expect(before.serialized).not.toMatch(/cashuToken|"token"|privateKey|refundPrivateKey|"proofs"|witness|outputData|seed/i)
		if (boundary === 'C1') expect(beforeOperations).toHaveLength(0)
		else expect(beforeOperations).toHaveLength(1)
		if (boundary === 'C2') {
			expect(beforeLeg.state).toBe('PREPARING')
			expect(beforeLeg.operationId).toBeUndefined()
			expect(beforeOperations[0].state).toBe('prepared')
		}

		await page.reload()
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const completed = await page.evaluate(() => window.__cocoAuctionDemo!.start())
		expect(completed.winnerBidEventId).toBe(completed.bidderBBidEventId)
		const after = await readControl(page)
		const afterLeg = after.legs.find((leg) => leg.role === role)!
		const afterDiagnostics = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
		const afterOperations = afterDiagnostics.operations.filter((operation) => operation.accountId === beforeLeg.accountId)
		const afterRelayIds = await relayBidIds(after.run.auctionEventId)
		expect(after.run.runId).toBe(before.run.runId)
		expect(afterLeg.bidderLegId).toBe(beforeLeg.bidderLegId)
		expect(afterLeg.accountId).toBe(beforeLeg.accountId)
		expect(afterLeg.state).toBe('BID_PUBLISHED')
		expect(afterOperations).toHaveLength(1)
		expect(afterOperations[0].state).not.toBe('prepared')
		if (beforeOperations[0]) expect(afterOperations[0].operationId).toBe(beforeOperations[0].operationId)
		if (beforeLeg.operationId) expect(afterLeg.operationId).toBe(beforeLeg.operationId)
		if (beforeLeg.signedBidEvent) expect(afterLeg.signedBidEvent?.id).toBe(beforeLeg.signedBidEvent.id)
		if (boundary === 'C6') expect(beforeRelayIds).toContain(beforeLeg.signedBidEvent!.id)
		if (afterLeg.signedBidEvent) expect(afterRelayIds.filter((id) => id === afterLeg.signedBidEvent!.id)).toHaveLength(1)
	} finally {
		await context.close()
	}
}

const runSettlementCrashCase = async (browser: Browser, boundary: (typeof settlementCrashBoundaries)[number]) => {
	const context = await browser.newContext()
	let page = await context.newPage()
	try {
		await page.goto('/')
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const started = await page.evaluate(() => window.__cocoAuctionDemo!.start())
		await page.reload()
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const failure = await page.evaluate(async (crashAt) => {
			try {
				await window.__cocoAuctionDemo!.resume({ crashAt })
				return ''
			} catch (error) {
				return error instanceof Error ? (error.stack ?? error.message) : String(error)
			}
		}, boundary)
		expect(failure).toContain(`INJECTED_${boundary}`)
		const before = await readControl(page)
		const beforeDiagnostics = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
		expect(before.run.runId).toBe(started.runId)
		expect(before.serialized).not.toMatch(/cashuToken|"token"|privateKey|refundPrivateKey|"proofs"|witness|outputData|seed/i)
		expect(before.sellerReceive).toBeTruthy()
		if (boundary === 'S1') {
			expect(before.sellerReceive!.phase).toBe('RECEIVE_INTENT')
			expect(beforeDiagnostics.receiveOperations).toHaveLength(0)
			const earlySettlement = await page.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testSettlementBeforeFinalized()
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(earlySettlement).toContain('SETTLEMENT_REQUIRES_FINALIZED_RECEIVE')
		}
		if (boundary === 'S2') {
			expect(before.sellerReceive!.receiveOperationId).toBeUndefined()
			expect(beforeDiagnostics.receiveOperations).toHaveLength(1)
			expect(beforeDiagnostics.receiveOperations[0].state).toBe('prepared')
		}
		if (boundary === 'S3') expect(before.sellerReceive!.phase).toBe('RECEIVE_OPERATION_BOUND')
		if (boundary === 'S4') {
			expect(before.sellerReceive!.phase).toBe('RECEIVE_FINALIZED')
			expect(beforeDiagnostics.receiveOperations).toHaveLength(1)
			expect(beforeDiagnostics.receiveOperations[0].state).toBe('finalized')
		}
		if (boundary === 'S5' || boundary === 'S6') {
			expect(before.sellerReceive!.phase).toBe('SETTLEMENT_SIGNED')
			expect(before.sellerReceive!.settlementEvent?.id).toBeTruthy()
		}
		const receiveOperationIdBefore = before.sellerReceive!.receiveOperationId ?? beforeDiagnostics.receiveOperations[0]?.operationId
		const settlementEventIdBefore = before.sellerReceive!.settlementEvent?.id
		await page.close()
		page = await context.newPage()
		await page.goto('/')
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const finished = await page.evaluate(() => window.__cocoAuctionDemo!.resume())
		const after = await readControl(page)
		const afterDiagnostics = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
		const relayIds = await relaySettlementIds(started.auctionEventId)
		expect(finished.runId).toBe(started.runId)
		expect(finished.winnerSendOperationId).toBe(started.bidderBOperationId)
		expect(finished.sellerReceiveState).toBe('finalized')
		expect(finished.receiveOperations).toBe(1)
		expect(finished.winnerReceiveEffects).toBe(1)
		expect(finished.secondReceive).toBe(false)
		expect(finished.loserSendOperationId).toBe(started.bidderAOperationId)
		expect(finished.loserPostRefundState).toBe('rolled_back')
		expect(finished.terminalRefundState).toBe('rolled_back')
		expect(finished.loserRefundEffects).toBe(1)
		expect(finished.conservation.seller.end).toBe(32)
		expect(finished.conservation.bidderA.end).toBe(32)
		expect(finished.conservation.bidderB.end).toBe(32)
		expect(finished.aggregateFinalBalance).toBe(96)
		expect(after.sellerReceive!.phase).toBe('SETTLEMENT_PUBLISHED')
		expect(after.sellerReceive!.claimEpoch).toBe(before.sellerReceive!.claimEpoch + 1)
		expect(after.sellerReceive!.highestOwnerGeneration).toBeGreaterThan(before.sellerReceive!.highestOwnerGeneration)
		expect(afterDiagnostics.receiveOperations).toHaveLength(1)
		expect(afterDiagnostics.receiveOperations[0].operationId).toBe(finished.sellerReceiveOperationId)
		if (receiveOperationIdBefore) expect(finished.sellerReceiveOperationId).toBe(receiveOperationIdBefore)
		if (settlementEventIdBefore) expect(finished.settlementEventId).toBe(settlementEventIdBefore)
		expect(relayIds).toEqual([finished.settlementEventId])
		expect(Object.values(finished.legacyCalls).every((count) => count === 0)).toBe(true)
		console.log(
			'COCO_R3_SAFE_REHEARSAL',
			JSON.stringify({
				boundary,
				runId: finished.runId,
				auctionId: finished.auctionEventId,
				bidAEventId: started.bidderABidEventId,
				bidBEventId: started.bidderBBidEventId,
				winnerRole: 'bidder-b',
				winnerSendOperationId: finished.winnerSendOperationId,
				sellerReceiveOperationId: finished.sellerReceiveOperationId,
				settlementEventId: finished.settlementEventId,
				loserSendOperationId: finished.loserSendOperationId,
				balances: {
					seller: finished.conservation.seller.end,
					bidderA: finished.conservation.bidderA.end,
					bidderB: finished.conservation.bidderB.end,
					aggregate: finished.aggregateFinalBalance,
				},
			}),
		)
	} finally {
		await context.close()
	}
}

test.describe('controlled full Coco Auction lifecycle demo', () => {
	test('validates the complete candidate set with trusted observation time and settles exact winner', async ({ page }) => {
		test.skip(process.env.APP_AUCTION_MONETARY_MODE !== 'coco-auction-demo', 'requires explicit coco-auction-demo mode')
		await page.goto('/')
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))

		const started = await page.evaluate(() => window.__cocoAuctionDemo!.start())
		expect(started.states).toEqual({ bidderA: 'pending', bidderB: 'pending' })
		expect(started.winnerBidEventId).toBe(started.bidderBBidEventId)
		expect(started.validation).toEqual({
			canonicalAuction: true,
			validA: true,
			validB: true,
			malformedRejected: true,
			wrongAuctionRejected: true,
			invalidCollateralRejected: true,
			lateArrivalRejected: true,
		})
		const control = await readControl(page)
		const lateLeg = control.legs.find((leg) => leg.role === 'late-attacker')!
		const winnerLeg = control.legs.find((leg) => leg.role === 'bidder-b')!
		const lateOperations = await page.evaluate(
			(accountId) => window.__cocoAuctionDemo!.accountOperations(accountId),
			started.lateBid.accountId,
		)
		const exactRelayIds = await relayBidIds(started.auctionEventId)
		expect(started.lateBid.amount).toBe(999)
		expect(started.lateBid.createdAt).toBeLessThanOrEqual(started.closeAt)
		expect(started.lateBid.publishedAt).toBeGreaterThan(started.closeAt)
		expect(started.lateBid.observedAt).toBeGreaterThan(started.closeAt)
		expect(control.run.bidObservations[started.lateBid.bidEventId]).toBe(started.lateBid.observedAt)
		expect(exactRelayIds).toContain(started.lateBid.bidEventId)
		expect(lateOperations).toHaveLength(1)
		expect(lateOperations[0]).toMatchObject({ operationId: started.lateBid.operationId, amount: 999, method: 'p2pk' })
		expect(lateLeg.accountId).not.toBe(winnerLeg.accountId)
		expect(lateLeg.operationId).not.toBe(winnerLeg.operationId)
		expect(lateLeg.refundPublicKey).not.toBe(winnerLeg.refundPublicKey)
		expect(lateLeg.lockSecrets).not.toEqual(winnerLeg.lockSecrets)
		expect(lateLeg.proofYs).not.toEqual(winnerLeg.proofYs)
		expect(Object.values(control.run.bidObservations).length).toBeGreaterThanOrEqual(5)

		await page.reload()
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const finished = await page.evaluate(() => window.__cocoAuctionDemo!.resume())
		console.log('COCO_AUCTION_DEMO_SAFE_REPORT', JSON.stringify(finished))
		expect(finished.auctionEventId).toBe(started.auctionEventId)
		expect(finished.winnerBidEventId).toBe(started.bidderBBidEventId)
		expect(finished.winnerSendOperationId).toBe(started.bidderBOperationId)
		expect(finished.sellerReceiveState).toBe('finalized')
		expect(finished.loserPostRefundState).toBe('rolled_back')
		expect(finished.terminalRefundState).toBe('rolled_back')
		expect(finished.exactOperationBinding).toBe(true)
		expect(finished.tokenCommitmentBinding).toBe(true)
		expect(finished.sellerPathBinding).toBe(true)
		expect(finished.receiveOperations).toBe(1)
		expect(finished.winnerReceiveEffects).toBe(1)
		expect(finished.secondReceive).toBe(false)
		expect(finished.loserRefundEffects).toBe(1)
		expect(finished.conservation.seller.end).toBe(32)
		expect(finished.conservation.bidderA.end).toBe(32)
		expect(finished.conservation.bidderB.end).toBe(32)
		expect(finished.aggregateFinalBalance).toBe(96)
		expect(await relaySettlementIds(finished.auctionEventId)).toEqual([finished.settlementEventId])
		expect(Object.values(finished.legacyCalls).every((count) => count === 0)).toBe(true)
	})

	test('recovers one exact seller Receive and one settlement across S1-S6 hard restarts', async ({ browser }) => {
		test.setTimeout(6 * 180_000)
		for (const boundary of settlementCrashBoundaries) {
			if (process.env.R3_CRASH_CASE && process.env.R3_CRASH_CASE !== boundary) continue
			console.log(`COCO_R3_CRASH_CASE ${boundary}`)
			await runSettlementCrashCase(browser, boundary)
		}
	})

	test('fails closed when more than one exact seller Receive operation exists', async ({ browser }) => {
		test.setTimeout(180_000)
		const context = await browser.newContext()
		let page = await context.newPage()
		try {
			await page.goto('/')
			await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const started = await page.evaluate(() => window.__cocoAuctionDemo!.start())
			await page.reload()
			await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const injected = await page.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.resume({ crashAt: 'S2' })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(injected).toContain('INJECTED_S2')
			await page.evaluate(() => window.__cocoAuctionDemo!.testCreateDuplicateExactReceive())
			const before = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			expect(before.receiveOperations).toHaveLength(2)
			expect(before.receiveOperations.every((operation) => operation.state === 'prepared')).toBe(true)
			await page.close()
			page = await context.newPage()
			await page.goto('/')
			await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const failure = await page.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.resume()
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(failure).toContain('More than one exact Coco Receive operation')
			const after = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			expect(after.receiveOperations).toHaveLength(2)
			expect(after.receiveOperations.every((operation) => operation.state === 'prepared')).toBe(true)
			expect(after.relaySettlementEventIds).toEqual([])
			expect((await readControl(page)).run.runId).toBe(started.runId)
		} finally {
			await context.close()
		}
	})

	test('recovers every bidder leg at C1-C6 with independent control, Coco, and relay evidence', async ({ browser }) => {
		test.setTimeout(12 * 180_000)
		for (const role of bidderRoles) {
			for (const boundary of crashBoundaries) {
				if (process.env.R2B_CRASH_CASE && process.env.R2B_CRASH_CASE !== `${role}:${boundary}`) continue
				console.log(`COCO_R2B_CRASH_CASE ${role} ${boundary}`)
				await runCrashCase(browser, boundary, role)
			}
		}
	})

	test('CONCURRENT_START awards one prepare claim and creates one Send per leg', async ({ page }) => {
		test.setTimeout(180_000)
		await page.goto('/')
		await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
		const injected = await page.evaluate(async () => {
			try {
				await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				return ''
			} catch (error) {
				return error instanceof Error ? error.message : String(error)
			}
		})
		expect(injected).toContain('INJECTED_C1_bidder-a')
		const [first, second] = await page.evaluate(() => Promise.all([window.__cocoAuctionDemo!.start(), window.__cocoAuctionDemo!.start()]))
		expect(first.bidderAOperationId).toBe(second.bidderAOperationId)
		expect(first.bidderBOperationId).toBe(second.bidderBOperationId)
		const control = await readControl(page)
		const diagnostics = await page.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
		for (const leg of control.legs) {
			expect(leg.prepareClaimId).toBeTruthy()
			expect(diagnostics.operations.filter((operation) => operation.accountId === leg.accountId)).toHaveLength(1)
		}
	})

	test('controller generations fence stale owners while a fresh page recovers the dead owner', async ({ browser }) => {
		const context = await browser.newContext()
		const pageA = await context.newPage()
		const pageB = await context.newPage()
		try {
			await pageA.goto('/')
			await pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const identityA = await pageA.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			const identityARepeat = await pageA.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			expect(identityARepeat).toEqual(identityA)
			await pageB.goto('/')
			await pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const identityB = await pageB.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			expect(identityB.controllerGeneration).toBeGreaterThan(identityA.controllerGeneration)
			expect(identityB.controllerFingerprint).not.toBe(identityA.controllerFingerprint)
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const claimCrash = await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-claim' })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(claimCrash).toContain('INJECTED_PREPARE_after-claim_bidder-a')
			const claimed = await readControl(pageA)
			const legA = claimed.legs.find((leg) => leg.role === 'bidder-a')!
			expect(legA).toMatchObject({
				state: 'PREPARING',
				prepareClaimOwnerControllerGeneration: identityA.controllerGeneration,
				prepareClaimEpoch: 1,
				prepareHighestOwnerGeneration: identityA.controllerGeneration,
			})

			const replay = await pageB.evaluate(
				({ legId, claimId, epoch }) => window.__cocoAuctionDemo!.testClaimPrepare(legId, claimId, epoch),
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			expect(replay).toMatchObject({
				mayPrepare: false,
				claimId: legA.prepareClaimId,
				ownerControllerFingerprint: identityA.controllerFingerprint,
				ownerControllerGeneration: identityA.controllerGeneration,
				claimEpoch: 1,
				highestOwnerGeneration: identityA.controllerGeneration,
			})
			expect(replay.revision).toBe(legA.revision)

			const rejectedAttempt = await pageB.evaluate(
				async ({ legId, claimId, epoch }) => {
					try {
						await window.__cocoAuctionDemo!.testRecordPrepareAttempt(legId, claimId, epoch)
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				},
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			const rejectedBind = await pageB.evaluate(
				async ({ legId, claimId, epoch }) => {
					try {
						await window.__cocoAuctionDemo!.testBindPreparedOperation(legId, claimId, epoch, 'replay-operation')
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				},
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			expect(rejectedAttempt).toMatch(/durable prepare claimant/i)
			expect(rejectedBind).toMatch(/STALE_CONTROLLER|durable prepare claimant/i)
			expect((await readControl(pageA)).serialized).toBe(claimed.serialized)
			const liveOwnerDenied = await pageB.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a')
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(liveOwnerDenied).toContain('LIVE_OWNER')
			expect((await readControl(pageA)).serialized).toBe(claimed.serialized)

			const repeated = await pageA.evaluate(
				({ legId, claimId, epoch }) => window.__cocoAuctionDemo!.testClaimPrepare(legId, claimId, epoch),
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			expect(repeated).toMatchObject({
				mayPrepare: true,
				ownerControllerFingerprint: identityA.controllerFingerprint,
				ownerControllerGeneration: identityA.controllerGeneration,
				claimEpoch: 1,
				revision: replay.revision,
			})
			const wrongClaim = await pageA.evaluate(
				({ legId, epoch }) => window.__cocoAuctionDemo!.testClaimPrepare(legId, 'different-claim', epoch),
				{ legId: legA.bidderLegId, epoch: legA.prepareClaimEpoch! },
			)
			const wrongEpoch = await pageA.evaluate(
				({ legId, claimId, epoch }) => window.__cocoAuctionDemo!.testClaimPrepare(legId, claimId, epoch + 1),
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			expect(wrongClaim).toMatchObject({ mayPrepare: false, revision: replay.revision })
			expect(wrongEpoch).toMatchObject({ mayPrepare: false, revision: replay.revision })
			expect((await readControl(pageA)).serialized).toBe(claimed.serialized)
			await pageA.evaluate((legId) => window.__cocoAuctionDemo!.testRelinquishOwnerPresence(legId), legA.bidderLegId)

			const adoptionCrash = await pageB.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-claim' })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(adoptionCrash).toContain('INJECTED_PREPARE_after-claim_bidder-a')
			const adopted = await readControl(pageB)
			const legB = adopted.legs.find((leg) => leg.role === 'bidder-a')!
			expect(legB.prepareClaimId).not.toBe(legA.prepareClaimId)
			expect(legB.prepareClaimOwnerControllerGeneration).toBe(identityB.controllerGeneration)
			expect(legB.prepareClaimEpoch).toBe(legA.prepareClaimEpoch! + 1)
			expect(legB.prepareHighestOwnerGeneration).toBe(identityB.controllerGeneration)

			const pageC = await context.newPage()
			await pageC.goto('/')
			await pageC.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const identityC = await pageC.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			expect(identityC.controllerGeneration).toBeGreaterThan(identityB.controllerGeneration)
			const liveBNotStolen = await pageC.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a')
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(liveBNotStolen).toContain('LIVE_OWNER')
			expect((await readControl(pageC)).serialized).toBe(adopted.serialized)
			await pageB.evaluate((legId) => window.__cocoAuctionDemo!.testRelinquishOwnerPresence(legId), legA.bidderLegId)

			const staleAttempt = await pageA.evaluate(
				async ({ legId, claimId, epoch }) => {
					try {
						await window.__cocoAuctionDemo!.testRecordPrepareAttempt(legId, claimId, epoch)
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				},
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			const staleBind = await pageA.evaluate(
				async ({ legId, claimId, epoch }) => {
					try {
						await window.__cocoAuctionDemo!.testBindPreparedOperation(legId, claimId, epoch, 'stale-operation')
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				},
				{ legId: legA.bidderLegId, claimId: legA.prepareClaimId!, epoch: legA.prepareClaimEpoch! },
			)
			const stalePhase = await pageA.evaluate(async (legId) => {
				try {
					await window.__cocoAuctionDemo!.testBypassPreparingAuthority(legId, 'phase')
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			}, legA.bidderLegId)
			const staleMetadata = await pageA.evaluate(async (legId) => {
				try {
					await window.__cocoAuctionDemo!.testBypassPreparingAuthority(legId, 'metadata')
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			}, legA.bidderLegId)
			expect(staleAttempt).toMatch(/durable prepare claimant/i)
			expect(staleBind).toMatch(/STALE_CONTROLLER|durable prepare claimant/i)
			expect(stalePhase).toMatch(/complete claimant authority tuple/i)
			expect(staleMetadata).toMatch(/complete claimant authority tuple/i)
			expect((await readControl(pageB)).serialized).toBe(adopted.serialized)
			const staleProgress = await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a')
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(staleProgress).toContain('STALE_CONTROLLER')
			const afterStale = await pageA.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const afterStaleLeg = afterStale.legs.find((leg) => leg.role === 'bidder-a')!
			expect(afterStaleLeg).toMatchObject({
				prepareClaimEpoch: 2,
				prepareHighestOwnerGeneration: identityB.controllerGeneration,
				actualPrepareCallCount: 0,
			})
			expect(afterStale.operations.filter((operation) => operation.accountId === legB.accountId)).toHaveLength(0)

			const recovered = await pageC.evaluate(() => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a'))
			expect(recovered).toMatchObject({
				state: 'OPERATION_BOUND',
				ownerControllerFingerprint: identityC.controllerFingerprint,
				ownerControllerGeneration: identityC.controllerGeneration,
				claimEpoch: 3,
				highestOwnerGeneration: identityC.controllerGeneration,
			})
			expect(recovered.prepareAttemptCount).toBe(1)
			expect(recovered.actualPrepareCallCount).toBe(1)
			const operations = await pageC.evaluate((accountId) => window.__cocoAuctionDemo!.accountOperations(accountId), legB.accountId)
			expect(operations).toHaveLength(1)
			expect(operations[0].operationId).toBe(recovered.operationId)
		} finally {
			await context.close()
		}
	})

	test('stale async continuation is rejected immediately before actual prepare', async ({ browser }) => {
		const context = await browser.newContext()
		const pageA = await context.newPage()
		const pageB = await context.newPage()
		try {
			await pageA.goto('/')
			await pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageA.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			await pageB.goto('/')
			await pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageB.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-claim' })
				} catch {}
			})
			const before = await readControl(pageA)
			const leg = before.legs.find((candidate) => candidate.role === 'bidder-a')!
			const barrierId = `stale-before-prepare-${Date.now()}`
			const delayed = pageA.evaluate(async (id) => {
				try {
					await window.__cocoAuctionDemo!.testDelayedPrepare('bidder-a', id)
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			}, barrierId)
			await pageA.waitForFunction((id) => window.__cocoAuctionDemo!.testPrepareBarrierReady(id), barrierId)
			await pageA.evaluate((legId) => window.__cocoAuctionDemo!.testRelinquishOwnerPresence(legId), leg.bidderLegId)
			const adopted = await pageB.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-claim' })
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
				return ''
			})
			expect(adopted).toContain('INJECTED_PREPARE_after-claim_bidder-a')
			await pageA.evaluate((id) => window.__cocoAuctionDemo!.testReleasePrepareBarrier(id), barrierId)
			expect(await delayed).toContain('STALE_CONTROLLER')
			const diagnostics = await pageB.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const durable = diagnostics.legs.find((candidate) => candidate.role === 'bidder-a')!
			expect(durable).toMatchObject({ state: 'PREPARING', prepareClaimEpoch: 2, actualPrepareCallCount: 0 })
			expect(diagnostics.operations.filter((operation) => operation.accountId === durable.accountId)).toHaveLength(0)
		} finally {
			await context.close()
		}
	})

	test('stale async continuation is rejected immediately before bind', async ({ browser }) => {
		const context = await browser.newContext()
		const pageA = await context.newPage()
		const pageB = await context.newPage()
		try {
			await pageA.goto('/')
			await pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageA.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			await pageB.goto('/')
			await pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageB.evaluate(() => window.__cocoAuctionDemo!.testControllerIdentity())
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const preparedFailure = await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-prepare' })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(preparedFailure).toContain('INJECTED_PREPARE_after-prepare_bidder-a')
			const before = await pageA.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const leg = before.legs.find((candidate) => candidate.role === 'bidder-a')!
			const operation = before.operations.find((candidate) => candidate.accountId === leg.accountId)!
			expect(leg).toMatchObject({ state: 'PREPARING', operationId: undefined, actualPrepareCallCount: 1 })
			const barrierId = `stale-before-bind-${Date.now()}`
			const delayed = pageA.evaluate(
				async ({ id, operationId }) => {
					try {
						await window.__cocoAuctionDemo!.testDelayedBind('bidder-a', operationId, id)
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				},
				{ id: barrierId, operationId: operation.operationId },
			)
			await pageA.waitForFunction((id) => window.__cocoAuctionDemo!.testPrepareBarrierReady(id), barrierId)
			await pageA.evaluate((legId) => window.__cocoAuctionDemo!.testRelinquishOwnerPresence(legId), leg.bidderLegId)
			const adopted = await pageB.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-claim' })
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
				return ''
			})
			expect(adopted).toContain('INJECTED_PREPARE_after-claim_bidder-a')
			await pageA.evaluate((id) => window.__cocoAuctionDemo!.testReleasePrepareBarrier(id), barrierId)
			expect(await delayed).toContain('STALE_CONTROLLER')
			const afterStale = await pageB.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const durable = afterStale.legs.find((candidate) => candidate.role === 'bidder-a')!
			expect(durable).toMatchObject({ state: 'PREPARING', operationId: undefined, actualPrepareCallCount: 1 })
			expect(afterStale.operations.filter((candidate) => candidate.accountId === durable.accountId)).toHaveLength(1)
			const recovered = await pageB.evaluate(() => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a'))
			expect(recovered.operationId).toBe(operation.operationId)
			expect(recovered.actualPrepareCallCount).toBe(1)
		} finally {
			await context.close()
		}
	})

	test('exact Web Lock prevents a second page from preparing while the first owns the leg lock', async ({ browser }) => {
		const context = await browser.newContext()
		const pageA = await context.newPage()
		const pageB = await context.newPage()
		try {
			await Promise.all([pageA.goto('/'), pageB.goto('/')])
			await Promise.all([
				pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo)),
				pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo)),
			])
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const control = await readControl(pageA)
			const leg = control.legs.find((candidate) => candidate.role === 'bidder-a')!
			const lockName = await pageA.evaluate(({ runId, legId }) => window.__cocoAuctionDemo!.testPrepareLockName(runId, legId), {
				runId: control.run.runId,
				legId: leg.bidderLegId,
			})
			const holding = pageA.evaluate(async (name) => {
				await navigator.locks.request(name, { mode: 'exclusive' }, async () => {
					;(window as unknown as { __r2cLockHeld: boolean }).__r2cLockHeld = true
					await new Promise<void>((resolve) => {
						;(window as unknown as { __r2cReleaseLock: () => void }).__r2cReleaseLock = resolve
					})
				})
			}, lockName)
			await pageA.waitForFunction(() => (window as unknown as { __r2cLockHeld?: boolean }).__r2cLockHeld === true)
			let secondFinished = false
			const second = pageB
				.evaluate(() => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a'))
				.then((value) => {
					secondFinished = true
					return value
				})
			await pageB.waitForTimeout(250)
			expect(secondFinished).toBe(false)
			expect(await pageB.evaluate((accountId) => window.__cocoAuctionDemo!.accountOperations(accountId), leg.accountId)).toHaveLength(0)
			await pageA.evaluate(() => (window as unknown as { __r2cReleaseLock: () => void }).__r2cReleaseLock())
			await holding
			const result = await second
			expect(result.state).toBe('OPERATION_BOUND')
			expect(result.prepareAttemptCount).toBe(1)
			expect(result.actualPrepareCallCount).toBe(1)
		} finally {
			await context.close()
		}
	})

	test('two actual pages repeatedly converge on one prepare claim and one Coco Send', async ({ browser }) => {
		test.setTimeout(3 * 120_000)
		for (let iteration = 0; iteration < 3; iteration += 1) {
			const context = await browser.newContext()
			const pageA = await context.newPage()
			const pageB = await context.newPage()
			try {
				await Promise.all([pageA.goto('/'), pageB.goto('/')])
				await Promise.all([
					pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo)),
					pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo)),
				])
				await pageA.evaluate(async () => {
					try {
						await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
					} catch {}
				})
				const barrierId = `two-page-${iteration}-${Date.now()}`
				const first = pageA.evaluate((id) => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { barrierId: id }), barrierId)
				const second = pageB.evaluate((id) => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { barrierId: id }), barrierId)
				await Promise.all([
					pageA.waitForFunction((id) => window.__cocoAuctionDemo!.testPrepareBarrierReady(id), barrierId),
					pageB.waitForFunction((id) => window.__cocoAuctionDemo!.testPrepareBarrierReady(id), barrierId),
				])
				await Promise.all([
					pageA.evaluate((id) => window.__cocoAuctionDemo!.testReleasePrepareBarrier(id), barrierId),
					pageB.evaluate((id) => window.__cocoAuctionDemo!.testReleasePrepareBarrier(id), barrierId),
				])
				const [resultA, resultB] = await Promise.all([first, second])
				expect(resultA.operationId).toBe(resultB.operationId)
				const after = await readControl(pageA)
				const leg = after.legs.find((candidate) => candidate.role === 'bidder-a')!
				const operations = await pageA.evaluate((accountId) => window.__cocoAuctionDemo!.accountOperations(accountId), leg.accountId)
				expect(leg.prepareAttemptCount).toBe(1)
				expect(operations).toHaveLength(1)
				expect(operations[0].operationId).toBe(leg.operationId)
				expect(leg.operationId).toBe(resultA.operationId)
			} finally {
				await context.close()
			}
		}
	})

	test('three actual pages under pressure create one claimant generation and one Coco Send', async ({ browser }) => {
		const context = await browser.newContext()
		const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()])
		try {
			await Promise.all(pages.map((page) => page.goto('/')))
			await Promise.all(pages.map((page) => page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))))
			await pages[0].evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const barrierId = `three-page-${Date.now()}`
			const progressing = pages.map((page) =>
				page.evaluate((id) => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { barrierId: id }), barrierId),
			)
			await Promise.all(pages.map((page) => page.waitForFunction((id) => window.__cocoAuctionDemo!.testPrepareBarrierReady(id), barrierId)))
			await Promise.all(pages.map((page) => page.evaluate((id) => window.__cocoAuctionDemo!.testReleasePrepareBarrier(id), barrierId)))
			const results = await Promise.all(progressing)
			expect(new Set(results.map((result) => result.operationId)).size).toBe(1)
			const diagnostics = await pages[0].evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const leg = diagnostics.legs.find((candidate) => candidate.role === 'bidder-a')!
			expect(leg.prepareClaimEpoch).toBe(1)
			expect(leg.prepareAttemptCount).toBe(1)
			expect(leg.actualPrepareCallCount).toBe(1)
			expect(diagnostics.operations.filter((operation) => operation.accountId === leg.accountId)).toHaveLength(1)
		} finally {
			await context.close()
		}
	})

	test('crash after durable attempt but before adapter entry recovers with two attempts and one actual Send', async ({ browser }) => {
		const context = await browser.newContext()
		const pageA = await context.newPage()
		try {
			await pageA.goto('/')
			await pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const failure = await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: 'after-attempt' })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			})
			expect(failure).toContain('INJECTED_PREPARE_after-attempt_bidder-a')
			const before = await pageA.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const beforeLeg = before.legs.find((leg) => leg.role === 'bidder-a')!
			expect(beforeLeg).toMatchObject({ state: 'PREPARING', prepareAttemptCount: 1, actualPrepareCallCount: 0 })
			expect(before.operations.filter((operation) => operation.accountId === beforeLeg.accountId)).toHaveLength(0)

			await pageA.close()
			const pageB = await context.newPage()
			await pageB.goto('/')
			await pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const recovered = await pageB.evaluate(() => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a'))
			const after = await pageB.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			const afterLeg = after.legs.find((leg) => leg.role === 'bidder-a')!
			const sends = after.operations.filter((operation) => operation.accountId === afterLeg.accountId)
			expect(recovered.operationId).toBe(afterLeg.operationId)
			expect(afterLeg.prepareAttemptCount).toBe(2)
			expect(afterLeg.actualPrepareCallCount).toBe(1)
			expect(sends).toHaveLength(1)
			expect(sends[0].operationId).toBe(afterLeg.operationId)
		} finally {
			await context.close()
		}
	})

	test('claimant crash before and after prepare safely hands the exact leg to a second page', async ({ browser }) => {
		for (const crashAt of ['after-claim', 'after-prepare'] as const) {
			const context = await browser.newContext()
			const pageA = await context.newPage()
			await pageA.goto('/')
			await pageA.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			await pageA.evaluate(async () => {
				try {
					await window.__cocoAuctionDemo!.start({ crashAt: 'C1', crashLeg: 'bidder-a' })
				} catch {}
			})
			const failure = await pageA.evaluate(async (boundary) => {
				try {
					await window.__cocoAuctionDemo!.testProgressPrepare('bidder-a', { crashAt: boundary })
					return ''
				} catch (error) {
					return error instanceof Error ? error.message : String(error)
				}
			}, crashAt)
			expect(failure).toContain(`INJECTED_PREPARE_${crashAt}_bidder-a`)
			const before = await readControl(pageA)
			const beforeLeg = before.legs.find((leg) => leg.role === 'bidder-a')!
			const beforeOperations = await pageA.evaluate(
				(accountId) => window.__cocoAuctionDemo!.accountOperations(accountId),
				beforeLeg.accountId,
			)
			expect(beforeLeg.state).toBe('PREPARING')
			expect(beforeLeg.operationId).toBeUndefined()
			expect(beforeLeg.prepareAttemptCount).toBe(crashAt === 'after-claim' ? 0 : 1)
			expect(beforeOperations).toHaveLength(crashAt === 'after-claim' ? 0 : 1)
			const beforeDiagnostics = await pageA.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			expect(beforeDiagnostics.legs.find((leg) => leg.role === 'bidder-a')!.actualPrepareCallCount).toBe(crashAt === 'after-claim' ? 0 : 1)
			await pageA.close()
			const pageB = await context.newPage()
			await pageB.goto('/')
			await pageB.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
			const recovered = await pageB.evaluate(() => window.__cocoAuctionDemo!.testProgressPrepare('bidder-a'))
			const after = await readControl(pageB)
			const afterLeg = after.legs.find((leg) => leg.role === 'bidder-a')!
			const afterOperations = await pageB.evaluate(
				(accountId) => window.__cocoAuctionDemo!.accountOperations(accountId),
				afterLeg.accountId,
			)
			expect(recovered.operationId).toBe(afterLeg.operationId)
			expect(afterLeg.prepareAttemptCount).toBe(1)
			expect(afterOperations).toHaveLength(1)
			const afterDiagnostics = await pageB.evaluate(() => window.__cocoAuctionDemo!.diagnostics())
			expect(afterDiagnostics.legs.find((leg) => leg.role === 'bidder-a')!.actualPrepareCallCount).toBe(1)
			if (beforeOperations[0]) expect(afterOperations[0].operationId).toBe(beforeOperations[0].operationId)
			await context.close()
		}
	})

	test('workflow loss at C2/C3/C4 fails closed without replacement money movement', async ({ browser }) => {
		test.setTimeout(3 * 120_000)
		const attacks = [
			['C2', 'delete-leg'],
			['C3', 'corrupt-run'],
			['C4', 'corrupt-leg'],
		] as const
		for (const [boundary, attack] of attacks) {
			const context = await browser.newContext()
			const page = await context.newPage()
			try {
				await page.goto('/')
				await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
				await page.evaluate(async (crashAt) => {
					try {
						await window.__cocoAuctionDemo!.start({ crashAt, crashLeg: 'bidder-a' })
					} catch {}
				}, boundary)
				const before = await readControl(page)
				const leg = before.legs.find((candidate) => candidate.role === 'bidder-a')!
				const operationsBefore = await page.evaluate((accountId) => window.__cocoAuctionDemo!.accountOperations(accountId), leg.accountId)
				await corruptControl(page, attack, leg.bidderLegId, before.run.runId)
				await page.reload()
				await page.waitForFunction(() => Boolean(window.__cocoAuctionDemo))
				const failure = await page.evaluate(async () => {
					try {
						await window.__cocoAuctionDemo!.start()
						return ''
					} catch (error) {
						return error instanceof Error ? error.message : String(error)
					}
				})
				expect(failure).toMatch(/missing|corrupt|invalid/i)
				const operationsAfter = await page.evaluate((accountId) => window.__cocoAuctionDemo!.accountOperations(accountId), leg.accountId)
				expect(operationsAfter.map((operation) => operation.operationId)).toEqual(
					operationsBefore.map((operation) => operation.operationId),
				)
			} finally {
				await context.close()
			}
		}
	})
})
