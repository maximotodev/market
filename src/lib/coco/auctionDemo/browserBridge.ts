import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey, type Event, type EventTemplate, type NostrEvent } from 'nostr-tools/pure'
import { computeValidatedBids } from '@/lib/auction/bidValidation'
import { AUCTION_BID_KIND, AUCTION_KIND, VALIDATOR_VERDICT_KIND, type Nut7ProofState } from '@/lib/auction/constants'
import {
	buildAuctionEventTags,
	buildBidEventTags,
	buildPathReleaseTags,
	buildSettlementTags,
	buildValidatorVerdictTags,
} from '@/lib/auction/tagBuilders'
import { fetchMintKeysets, validateBid, validatePathRelease, type BidValidationVerdict } from '@/lib/auction/validation'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { checkProofStateBatch } from '@/lib/cashu/nut7'
import { fetchEvents, publish } from '@/lib/nostr/io'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { COCO_AUCTION_CONTROL_DB_NAME, CocoAuctionWorkflowStore, getPageControllerIdentity } from './bindingStore'
import {
	buildAuctionConditionFingerprint,
	fingerprintAuctionReceiveCommitment,
	FrozenCocoAuctionWallet,
	readActualPrepareCallCount,
} from './cocoPort'
import { getLegacyAuctionMonetaryAudit } from './legacyAudit'
import { isCocoAuctionDemoMode } from './mode'
import {
	auctionOwnerPresenceLockName,
	auctionPrepareLockName,
	browserPrepareCoordinator,
	tryAcquireOwnerPresence,
	type CocoAuctionOwnerPresenceLease,
} from './prepareCoordinator'
import { assertSellerPathBinding, releaseExactlyBoundWinningBid } from './protocolBinding'
import {
	FROZEN_COCO_REFUND_COMMIT,
	type CocoAuctionBidIntent,
	type CocoAuctionLegRecord,
	type CocoAuctionPrepareAuthority,
	type CocoAuctionRunRecord,
	type CocoAuctionSellerReceiveRecord,
} from './types'

const SETTLEMENT_KIND = 1024
const PATH_RELEASE_KIND = 1025
const RUN_CLOSE_DELAY_SECONDS = 15
const SETTLEMENT_GRACE_SECONDS = 5

type DemoRole = 'seller' | 'auditor' | CocoAuctionLegRecord['role']
export type CocoAuctionCrashBoundary = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6'

export interface CocoAuctionDemoStartOptions {
	mintUrl?: string
	relayUrl?: string
	crashAt?: CocoAuctionCrashBoundary
	crashLeg?: 'bidder-a' | 'bidder-b'
	prepareCrashAt?: 'after-claim' | 'after-attempt' | 'after-prepare'
}

export type CocoAuctionSettlementCrashBoundary = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'

export interface CocoAuctionDemoResumeOptions {
	crashAt?: CocoAuctionSettlementCrashBoundary
}

export interface CocoAuctionDemoStartReport {
	runId: string
	auctionEventId: string
	bidderABidEventId: string
	bidderBBidEventId: string
	bidderAOperationId: string
	bidderBOperationId: string
	winnerBidEventId: string
	closeAt: number
	locktime: number
	states: { bidderA: string; bidderB: string }
	validation: {
		canonicalAuction: true
		validA: true
		validB: true
		malformedRejected: true
		wrongAuctionRejected: true
		invalidCollateralRejected: true
		lateArrivalRejected: true
	}
	lateBid: {
		accountId: string
		operationId: string
		bidEventId: string
		amount: 999
		createdAt: number
		publishedAt: number
		observedAt: number
	}
	reloadRequired: true
}

export interface CocoAuctionDemoFinalReport {
	runId: string
	auctionEventId: string
	winnerBidEventId: string
	winnerSendOperationId: string
	winnerSendState: string
	sellerReceiveOperationId: string
	sellerReceiveState: string
	loserSendOperationId: string
	loserPreRefundState: string
	loserPostRefundState: string
	terminalRefundState: string
	pathReleaseEventId: string
	settlementEventId: string
	settlementPublishedAfterReceive: boolean
	winnerReceiveEffects: number
	receiveOperations: number
	secondReceive: false
	loserRefundEffects: 1
	aggregateFinalBalance: number
	operationIdsStable: boolean
	secondLocks: number
	exactOperationBinding: true
	tokenCommitmentBinding: true
	sellerPathBinding: true
	legacyCalls: Readonly<Record<string, number>>
	conservation: {
		seller: { start: number; funded: number; locked: number; received: number; refunded: number; fees: number; end: number }
		bidderA: { start: number; funded: number; locked: number; received: number; refunded: number; fees: number; end: number }
		bidderB: { start: number; funded: number; locked: number; received: number; refunded: number; fees: number; end: number }
	}
}

export interface CocoAuctionSafeDiagnostics {
	controlDbName: string
	run: null | { runId: string; state: string; revision: number }
	legs: Array<{
		role: string
		accountId: string
		bidderLegId: string
		state: string
		prepareClaimId?: string
		prepareClaimStatus?: string
		prepareClaimOwnerControllerFingerprint?: string
		prepareClaimOwnerControllerGeneration?: number
		prepareClaimEpoch?: number
		prepareHighestOwnerGeneration?: number
		prepareAttemptCount: number
		actualPrepareCallCount: number
		operationId?: string
		signedBidEventId?: string
		revision: number
	}>
	operations: Array<{
		accountId: string
		operationId: string
		state: string
		method: string
		amount: number
		mintUrl: string
		unit: string
		conditionFingerprint: string | null
		fee: number | null
	}>
	sellerReceive: null | {
		phase: string
		claimIdFingerprint: string
		ownerControllerFingerprint: string
		ownerControllerGeneration: number
		claimEpoch: number
		highestOwnerGeneration: number
		receiveAttemptCount: number
		receiveOperationId?: string
		receiveOperationState?: string
		settlementEventId?: string
		revision: number
	}
	receiveOperations: Array<{
		operationId: string
		state: string
		mintUrl: string
		unit: string
		amount: number
		tokenFingerprint: string
		fee: number | null
	}>
	relayBidEventIds: string[]
	relaySettlementEventIds: string[]
}

const signerSecret = (role: DemoRole): Uint8Array => sha256(new TextEncoder().encode(`plebeian-market:coco-auction-demo:${role}:v2`))
const signedEvent = (template: EventTemplate, role: DemoRole): Event => finalizeEvent(template, signerSecret(role))
const eventPubkey = (role: DemoRole): string => getPublicKey(signerSecret(role))

const randomPath = (): string => {
	const words = crypto.getRandomValues(new Uint32Array(5))
	return `m/${Array.from(words, (word) => String(word & 0x7fffffff)).join('/')}`
}

const publishEvent = (relayUrl: string, event: NostrEvent): Promise<void> => publish(event, { relayUrls: [relayUrl] })

const fetchAuctionBidCandidates = (run: CocoAuctionRunRecord): Promise<NostrEvent[]> =>
	fetchEvents({ kinds: [AUCTION_BID_KIND], '#e': [run.auctionEventId] }, { relayUrls: [run.relayUrl], timeoutMs: 5_000 })

const fetchEventById = (relayUrl: string, eventId: string): Promise<NostrEvent[]> =>
	fetchEvents({ ids: [eventId] }, { relayUrls: [relayUrl], timeoutMs: 5_000 })

const maybeCrash = (
	options: CocoAuctionDemoStartOptions | undefined,
	boundary: CocoAuctionCrashBoundary,
	role: CocoAuctionLegRecord['role'],
): void => {
	if (options?.crashAt === boundary && (options.crashLeg ?? 'bidder-a') === role) throw new Error(`INJECTED_${boundary}_${role}`)
}

const requireCanonicalAuction = (event: NostrEvent): ParsedAuctionEvent => {
	const parsed = parseAuctionEvent(event)
	if (!parsed.ok) throw new Error(`Canonical Auction parse failed: ${JSON.stringify(parsed.error)}`)
	return parsed.value
}

const parseRequiredBid = (event: NostrEvent): ParsedBidEvent => {
	const parsed = parseBidEvent(event)
	if (!parsed.ok) throw new Error(`Canonical bid parse failed: ${JSON.stringify(parsed.error)}`)
	return parsed.value
}

const intentOf = (leg: CocoAuctionLegRecord): CocoAuctionBidIntent => ({
	runId: leg.runId,
	accountId: leg.accountId,
	auctionId: leg.auctionId,
	auctionCoordinate: leg.auctionCoordinate,
	bidderLegId: leg.bidderLegId,
	mintUrl: leg.mintUrl,
	unit: leg.unit,
	amount: leg.amount,
	locktime: leg.locktime,
	derivationPath: leg.derivationPath,
	recipientPublicKey: leg.recipientPublicKey,
	refundPublicKey: leg.refundPublicKey,
	conditionFingerprint: leg.conditionFingerprint,
	revision: leg.revision,
})

const makeBidEvent = (run: CocoAuctionRunRecord, leg: CocoAuctionLegRecord): NostrEvent => {
	if (!leg.lockSecrets || !leg.proofYs) throw new Error('Cannot sign a bid before Coco lock commitments exist')
	const event = signedEvent(
		{
			kind: AUCTION_BID_KIND,
			created_at: Math.floor(Date.now() / 1000),
			content: JSON.stringify({ type: 'auction_bid_v1', amount: leg.amount, mint: leg.mintUrl }),
			tags: buildBidEventTags({
				auctionRootEventId: run.auctionEventId,
				auctionCoordinate: run.auctionCoordinate,
				sellerPubkey: run.sellerPubkey,
				amount: leg.amount,
				mint: leg.mintUrl,
				locktime: leg.locktime,
				refundPubkey: leg.refundPublicKey,
				childPubkey: leg.recipientPublicKey,
				lockSecrets: [...leg.lockSecrets],
				proofYs: [...leg.proofYs],
				createdForEndAt: run.closeAt,
				bidNonce: `${run.runId}:${leg.role}`,
			}),
		},
		leg.role,
	)
	parseRequiredBid(event)
	return event
}

const ensureFunding = async (wallet: FrozenCocoAuctionWallet, mintUrl: string, target: number): Promise<void> => {
	const balance = await wallet.getBalance(mintUrl).catch(() => ({ spendable: 0, reserved: 0, total: 0 }))
	if (balance.total < target) await wallet.fundDemoWallet(mintUrl, target - balance.total)
}

const progressLegPromises = new Map<string, Promise<CocoAuctionLegRecord>>()
const pagePrepareAuthorities = new Map<string, CocoAuctionPrepareAuthority>()
const ownerPresenceLeases = new Map<string, CocoAuctionOwnerPresenceLease>()
const relinquishedLegs = new Set<string>()
const pageSellerReceiveAuthorities = new Map<string, CocoAuctionPrepareAuthority>()
const sellerReceivePresenceLeases = new Map<string, CocoAuctionOwnerPresenceLease>()
const testPrepareBarriers = new Map<string, { ready: boolean; release: () => void; promise: Promise<void> }>()

const controllerFingerprint = (controllerId: string): string =>
	Array.from(sha256(new TextEncoder().encode(controllerId)).slice(0, 8), (value) => value.toString(16).padStart(2, '0')).join('')

const durablePrepareAuthority = (leg: CocoAuctionLegRecord): CocoAuctionPrepareAuthority => {
	if (!leg.prepareClaimId || !leg.prepareClaimOwnerControllerId || !leg.prepareClaimOwnerControllerGeneration || !leg.prepareClaimEpoch) {
		throw new Error('PREPARING Auction leg has no complete durable authority tuple')
	}
	return {
		claimId: leg.prepareClaimId,
		ownerControllerId: leg.prepareClaimOwnerControllerId,
		ownerControllerGeneration: leg.prepareClaimOwnerControllerGeneration,
		claimEpoch: leg.prepareClaimEpoch,
	}
}

const samePrepareAuthority = (left: CocoAuctionPrepareAuthority, right: CocoAuctionPrepareAuthority): boolean =>
	left.claimId === right.claimId &&
	left.ownerControllerId === right.ownerControllerId &&
	left.ownerControllerGeneration === right.ownerControllerGeneration &&
	left.claimEpoch === right.claimEpoch

const durableSellerReceiveAuthority = (receive: CocoAuctionSellerReceiveRecord): CocoAuctionPrepareAuthority => ({
	claimId: receive.claimId,
	ownerControllerId: receive.ownerControllerId,
	ownerControllerGeneration: receive.ownerControllerGeneration,
	claimEpoch: receive.claimEpoch,
})

const releaseOwnerPresence = (bidderLegId: string, relinquish = false): void => {
	ownerPresenceLeases.get(bidderLegId)?.release()
	ownerPresenceLeases.delete(bidderLegId)
	if (relinquish) relinquishedLegs.add(bidderLegId)
}

const releaseSellerReceivePresence = (runId: string): void => {
	sellerReceivePresenceLeases.get(runId)?.release()
	sellerReceivePresenceLeases.delete(runId)
	pageSellerReceiveAuthorities.delete(runId)
}

const maybeSettlementCrash = (options: CocoAuctionDemoResumeOptions | undefined, boundary: CocoAuctionSettlementCrashBoundary): void => {
	if (options?.crashAt === boundary) throw new Error(`INJECTED_${boundary}`)
}

const waitForTestPrepareBarrier = async (barrierId: string): Promise<void> => {
	let barrier = testPrepareBarriers.get(barrierId)
	if (!barrier) {
		let release!: () => void
		const promise = new Promise<void>((resolve) => {
			release = resolve
		})
		barrier = { ready: true, release, promise }
		testPrepareBarriers.set(barrierId, barrier)
	}
	await barrier.promise
	testPrepareBarriers.delete(barrierId)
}

const releaseTestPrepareBarrier = (barrierId: string): void => {
	const barrier = testPrepareBarriers.get(barrierId)
	if (!barrier) throw new Error(`No ready test prepare barrier ${barrierId}`)
	barrier.release()
}

const maybePrepareCrash = (
	options: CocoAuctionDemoStartOptions | undefined,
	boundary: NonNullable<CocoAuctionDemoStartOptions['prepareCrashAt']>,
	role: CocoAuctionLegRecord['role'],
): void => {
	if (options?.prepareCrashAt === boundary && (options.crashLeg ?? 'bidder-a') === role) {
		throw new Error(`INJECTED_PREPARE_${boundary}_${role}`)
	}
}

const prepareAuctionBidWithAuthority = async (
	store: CocoAuctionWorkflowStore,
	wallet: FrozenCocoAuctionWallet,
	bidderLegId: string,
	authority: CocoAuctionPrepareAuthority,
): Promise<string> => {
	const current = await store.assertPrepareAuthority(bidderLegId, authority)
	return wallet.prepareAuctionBid(intentOf(current))
}

const bindPreparedOperationWithAuthority = async (
	store: CocoAuctionWorkflowStore,
	bidderLegId: string,
	authority: CocoAuctionPrepareAuthority,
	operationId: string,
): Promise<CocoAuctionLegRecord> => {
	await store.assertPrepareAuthority(bidderLegId, authority)
	return store.bindPreparedOperation(bidderLegId, authority, operationId)
}

const progressLegToOperationBound = async (
	run: CocoAuctionRunRecord,
	role: CocoAuctionLegRecord['role'],
	wallet: FrozenCocoAuctionWallet,
	authorityXpub: string,
	amount: number,
	store: CocoAuctionWorkflowStore,
	options?: CocoAuctionDemoStartOptions,
): Promise<CocoAuctionLegRecord> => {
	const bidderLegId = `${run.runId}:${role}`
	const identity = await getPageControllerIdentity()
	const coordinator = browserPrepareCoordinator()
	return coordinator.runExclusive(auctionPrepareLockName(run.runId, bidderLegId), async () => {
		let leg = await store.getLeg(bidderLegId)
		if (!leg) {
			const derivationPath = randomPath()
			const recipientPublicKey = deriveAuctionChildP2pkPubkeyFromXpub(authorityXpub, derivationPath)
			const refundPublicKey = (await wallet.createRefundAuthority()).publicKey
			const conditionFingerprint = buildAuctionConditionFingerprint({
				mintUrl: run.mintUrl,
				amount,
				recipientPublicKey,
				refundPublicKey,
				locktime: run.locktime,
			})
			const now = Date.now()
			leg = await store.createIntent({
				version: 2,
				runId: run.runId,
				state: 'INTENT',
				role,
				accountId: wallet.accountId,
				bidderPubkey: eventPubkey(role),
				auctionId: run.auctionEventId,
				auctionCoordinate: run.auctionCoordinate,
				bidderLegId,
				mintUrl: run.mintUrl,
				unit: 'sat',
				amount,
				locktime: run.locktime,
				derivationPath,
				recipientPublicKey,
				refundPublicKey,
				conditionFingerprint,
				prepareAttemptCount: 0,
				revision: 0,
				createdAt: now,
				updatedAt: now,
			})
			maybeCrash(options, 'C1', role)
		}

		if (leg.state !== 'INTENT' && leg.state !== 'PREPARING') {
			releaseOwnerPresence(bidderLegId)
			pagePrepareAuthorities.delete(bidderLegId)
			return leg
		}

		const retainedAuthority = pagePrepareAuthorities.get(bidderLegId)
		let operationId: string | null
		let authority: CocoAuctionPrepareAuthority
		if (retainedAuthority) {
			if (
				relinquishedLegs.has(bidderLegId) ||
				leg.state !== 'PREPARING' ||
				!samePrepareAuthority(retainedAuthority, durablePrepareAuthority(leg)) ||
				!ownerPresenceLeases.has(bidderLegId)
			) {
				throw new Error('STALE_CONTROLLER')
			}
			const claim = await store.claimPrepare(bidderLegId, retainedAuthority)
			if (!claim.mayPrepare) throw new Error('STALE_CONTROLLER')
			leg = claim.leg
			authority = retainedAuthority
			maybePrepareCrash(options, 'after-claim', role)
			operationId = await wallet.reconcilePreparedAuctionBid(intentOf(leg))
		} else if (leg.state === 'INTENT') {
			const lease = await tryAcquireOwnerPresence(auctionOwnerPresenceLockName(run.runId, bidderLegId))
			if (!lease) throw new Error('LIVE_OWNER')
			authority = {
				claimId: crypto.randomUUID(),
				ownerControllerId: identity.controllerId,
				ownerControllerGeneration: identity.controllerGeneration,
				claimEpoch: 1,
			}
			const claim = await store.claimPrepare(bidderLegId, authority).catch((error) => {
				lease.release()
				throw error
			})
			if (!claim.mayPrepare) {
				lease.release()
				throw new Error('Prepare claim was not installed atomically')
			}
			leg = claim.leg
			ownerPresenceLeases.set(bidderLegId, lease)
			pagePrepareAuthorities.set(bidderLegId, authority)
			maybePrepareCrash(options, 'after-claim', role)
			operationId = await wallet.reconcilePreparedAuctionBid(intentOf(leg))
		} else {
			if (identity.controllerGeneration <= (leg.prepareHighestOwnerGeneration ?? 0)) throw new Error('STALE_CONTROLLER')
			const lease = await tryAcquireOwnerPresence(auctionOwnerPresenceLockName(run.runId, bidderLegId))
			if (!lease) throw new Error('LIVE_OWNER')
			const incumbentAuthority = durablePrepareAuthority(leg)
			try {
				operationId = await wallet.reconcilePreparedAuctionBid(intentOf(leg))
			} catch (error) {
				lease.release()
				throw error
			}
			authority = {
				claimId: crypto.randomUUID(),
				ownerControllerId: identity.controllerId,
				ownerControllerGeneration: identity.controllerGeneration,
				claimEpoch: incumbentAuthority.claimEpoch + 1,
			}
			leg = await store.adoptPrepareClaim(bidderLegId, incumbentAuthority, authority).catch((error) => {
				lease.release()
				throw error
			})
			ownerPresenceLeases.set(bidderLegId, lease)
			pagePrepareAuthorities.set(bidderLegId, authority)
			maybePrepareCrash(options, 'after-claim', role)
		}

		if (!operationId) {
			leg = await store.recordPrepareAttempt(bidderLegId, authority)
			maybePrepareCrash(options, 'after-attempt', role)
			operationId = await prepareAuctionBidWithAuthority(store, wallet, bidderLegId, authority)
			maybePrepareCrash(options, 'after-prepare', role)
			maybeCrash(options, 'C2', role)
		}
		leg = await bindPreparedOperationWithAuthority(store, bidderLegId, authority, operationId)
		releaseOwnerPresence(bidderLegId)
		pagePrepareAuthorities.delete(bidderLegId)
		maybeCrash(options, 'C3', role)
		return leg
	})
}

const progressLegExclusive = async (
	run: CocoAuctionRunRecord,
	role: CocoAuctionLegRecord['role'],
	wallet: FrozenCocoAuctionWallet,
	authorityXpub: string,
	amount: number,
	store: CocoAuctionWorkflowStore,
	options?: CocoAuctionDemoStartOptions,
): Promise<CocoAuctionLegRecord> => {
	const bidderLegId = `${run.runId}:${role}`
	await progressLegToOperationBound(run, role, wallet, authorityXpub, amount, store, options)
	return browserPrepareCoordinator().runExclusive(auctionPrepareLockName(run.runId, bidderLegId), async () => {
		let leg = await store.getLeg(bidderLegId)
		if (!leg) throw new Error(`Auction leg ${bidderLegId} disappeared after operation bind`)
		if (leg.state === 'OPERATION_BOUND') {
			const commitments = await wallet.executeAuctionBid(intentOf(leg), leg.operationId!)
			maybeCrash(options, 'C4', role)
			leg = await store.updateLeg(bidderLegId, {
				state: 'LOCKED',
				lockSecrets: commitments.lockSecrets,
				proofYs: commitments.proofYs,
				updatedAt: Date.now(),
			})
		}

		if (leg.state === 'LOCKED') {
			leg = await store.updateLeg(bidderLegId, {
				state: 'BID_SIGNED',
				signedBidEvent: makeBidEvent(run, leg),
				updatedAt: Date.now(),
			})
			maybeCrash(options, 'C5', role)
		}

		if (leg.state === 'BID_SIGNED') {
			await publishEvent(run.relayUrl, leg.signedBidEvent!)
			maybeCrash(options, 'C6', role)
			leg = await store.updateLeg(bidderLegId, { state: 'BID_PUBLISHED', bidPublishedAt: Date.now(), updatedAt: Date.now() })
		}

		return leg
	})
}

const progressLeg = (
	run: CocoAuctionRunRecord,
	role: CocoAuctionLegRecord['role'],
	wallet: FrozenCocoAuctionWallet,
	authorityXpub: string,
	amount: number,
	store: CocoAuctionWorkflowStore,
	options?: CocoAuctionDemoStartOptions,
): Promise<CocoAuctionLegRecord> => {
	const bidderLegId = `${run.runId}:${role}`
	const existing = progressLegPromises.get(bidderLegId)
	if (existing) return existing
	const promise = progressLegExclusive(run, role, wallet, authorityXpub, amount, store, options)
	progressLegPromises.set(bidderLegId, promise)
	const cleanup = () => {
		if (progressLegPromises.get(bidderLegId) === promise) progressLegPromises.delete(bidderLegId)
	}
	void promise.then(cleanup, cleanup)
	return promise
}

const proofStateForBid = async (bid: ParsedBidEvent): Promise<{ aggregate: Nut7ProofState; byProof: Map<string, Nut7ProofState> }> => {
	const byProof = await checkProofStateBatch(bid.mint, bid.proofYs, { timeoutMs: 2_000 })
	const states = bid.proofYs.map((proofY) => byProof.get(proofY.toLowerCase()) ?? 'missing')
	const aggregate: Nut7ProofState = states.every((state) => state === 'unspent')
		? 'unspent'
		: states.some((state) => state === 'spent')
			? 'spent'
			: states.some((state) => state === 'pending')
				? 'pending'
				: 'missing'
	return { aggregate, byProof }
}

const verdictEvent = (run: CocoAuctionRunRecord, bid: ParsedBidEvent, verdict: BidValidationVerdict, observedAt: number): NostrEvent =>
	signedEvent(
		{
			kind: VALIDATOR_VERDICT_KIND,
			created_at: Math.floor(Date.now() / 1000),
			content: JSON.stringify({ type: 'coco_demo_validator_v1', detail: 'detail' in verdict ? verdict.detail : undefined }),
			tags: buildValidatorVerdictTags({
				bidderPubkey: bid.bidderPubkey,
				auctionRootEventId: bid.auctionRootEventId,
				auctionCoordinate: bid.auctionCoordinate,
				bidEventId: bid.id,
				claim: verdict.claim,
				observedAt,
				reason: 'reason' in verdict ? verdict.reason : undefined,
			}),
		},
		'auditor',
	)

const adversarialBidEvents = (run: CocoAuctionRunRecord, winnerLeg: CocoAuctionLegRecord): NostrEvent[] => {
	if (!winnerLeg.lockSecrets || !winnerLeg.proofYs) throw new Error('Winner commitments missing')
	const base = (
		amount: number,
		root = run.auctionEventId,
		coordinate = run.auctionCoordinate,
		proofYs = winnerLeg.proofYs,
	): EventTemplate => ({
		kind: AUCTION_BID_KIND,
		created_at: winnerLeg.signedBidEvent!.created_at,
		content: JSON.stringify({ type: 'auction_bid_v1', amount, mint: run.mintUrl }),
		tags: buildBidEventTags({
			auctionRootEventId: root,
			auctionCoordinate: coordinate,
			sellerPubkey: run.sellerPubkey,
			amount,
			mint: run.mintUrl,
			locktime: run.locktime,
			refundPubkey: winnerLeg.refundPublicKey,
			childPubkey: winnerLeg.recipientPublicKey,
			lockSecrets: [...winnerLeg.lockSecrets],
			proofYs: [...proofYs],
			createdForEndAt: run.closeAt,
			bidNonce: `${run.runId}:adversarial:${amount}`,
		}),
	})
	const malformedTemplate = base(999)
	malformedTemplate.tags = malformedTemplate.tags.filter((tag) => tag[0] !== 'proof_y')
	const malformed = signedEvent(malformedTemplate, 'bidder-b')
	const otherRoot = 'f'.repeat(64)
	const wrongAuction = signedEvent(base(999, otherRoot, `${AUCTION_KIND}:${run.sellerPubkey}:other-${run.runId}`), 'bidder-b')
	const invalidCollateral = signedEvent(base(999, run.auctionEventId, run.auctionCoordinate, [`02${'0'.repeat(64)}`]), 'bidder-b')
	return [malformed, wrongAuction, invalidCollateral]
}

const prepareLateAttackerBid = async (
	run: CocoAuctionRunRecord,
	auction: ParsedAuctionEvent,
	store: CocoAuctionWorkflowStore,
	wallet: FrozenCocoAuctionWallet,
): Promise<CocoAuctionLegRecord> => {
	const bidderLegId = `${run.runId}:late-attacker`
	await progressLegToOperationBound(run, 'late-attacker', wallet, auction.p2pkXpub, 999, store)
	return browserPrepareCoordinator().runExclusive(auctionPrepareLockName(run.runId, bidderLegId), async () => {
		let leg = await store.getLeg(bidderLegId)
		if (!leg) throw new Error('Independent late-arrival leg disappeared after operation bind')
		if (leg.state === 'OPERATION_BOUND') {
			const commitments = await wallet.executeAuctionBid(intentOf(leg), leg.operationId!)
			leg = await store.updateLeg(leg.bidderLegId, {
				state: 'LOCKED',
				lockSecrets: commitments.lockSecrets,
				proofYs: commitments.proofYs,
				updatedAt: Date.now(),
			})
		}
		if (leg.state === 'LOCKED') {
			if (Math.floor(Date.now() / 1000) > run.closeAt) {
				throw new Error('Independent late-arrival collateral was not signed before Auction close')
			}
			leg = await store.updateLeg(leg.bidderLegId, {
				state: 'BID_SIGNED',
				signedBidEvent: makeBidEvent(run, leg),
				updatedAt: Date.now(),
			})
		}
		if (leg.state !== 'BID_SIGNED' && leg.state !== 'BID_PUBLISHED') {
			throw new Error('Independent late-arrival bidder did not reach a signed collateralized state')
		}
		return leg
	})
}

const validatePublishedBids = async (
	run: CocoAuctionRunRecord,
	legA: CocoAuctionLegRecord,
	legB: CocoAuctionLegRecord,
	lateAttacker: CocoAuctionLegRecord,
	store: CocoAuctionWorkflowStore,
): Promise<{
	winner: ParsedBidEvent
	malformedRejected: true
	wrongAuctionRejected: true
	invalidCollateralRejected: true
	lateArrivalRejected: true
	lateBid: CocoAuctionDemoStartReport['lateBid']
}> => {
	if (!lateAttacker.signedBidEvent || !lateAttacker.operationId || lateAttacker.amount !== 999) {
		throw new Error('Independent late-arrival collateral is incomplete')
	}
	const adversarial = adversarialBidEvents(run, legB)
	await Promise.all(adversarial.map((event) => publishEvent(run.relayUrl, event)))
	const [firstExactCandidates, wrongAuctionObserved] = await Promise.all([
		fetchAuctionBidCandidates(run),
		fetchEventById(run.relayUrl, adversarial[1].id),
	])
	const firstObserved = [...firstExactCandidates, ...wrongAuctionObserved]
	const firstObservedAt = Math.floor(Date.now() / 1000)
	await Promise.all(firstObserved.map((event) => store.observeBid(event.id, firstObservedAt)))
	const auction = requireCanonicalAuction(run.signedAuctionEvent)
	const parsedLateAttacker = parseRequiredBid(lateAttacker.signedBidEvent)
	const lateCollateralState = await proofStateForBid(parsedLateAttacker)
	const inWindowVerdict = validateBid({
		auction,
		bid: parsedLateAttacker,
		observedAt: parsedLateAttacker.createdAt,
		nut7State: lateCollateralState.aggregate,
		nut7ProofStates: lateCollateralState.byProof,
		currentTopBid: legB.amount,
	})
	if (inWindowVerdict.claim !== 'valid_bid_placed') {
		throw new Error(`Independent late-arrival bid is not otherwise protocol-valid: ${JSON.stringify(inWindowVerdict)}`)
	}
	await waitUntil(() => Math.floor(Date.now() / 1000) > run.closeAt, 30_000, 'post-close adversarial observation')
	await publishEvent(run.relayUrl, lateAttacker.signedBidEvent)
	const publishedAt = Math.floor(Date.now() / 1000)
	await store.updateLeg(lateAttacker.bidderLegId, { state: 'BID_PUBLISHED', bidPublishedAt: Date.now(), updatedAt: Date.now() })
	const completeCandidates = [...(await fetchAuctionBidCandidates(run)), ...wrongAuctionObserved]
	const secondObservedAt = Math.floor(Date.now() / 1000)
	const observedAtById = new Map<string, number>()
	for (const event of completeCandidates) observedAtById.set(event.id, await store.observeBid(event.id, secondObservedAt))
	if (parseBidEvent(adversarial[0]).ok) throw new Error('Malformed higher bid unexpectedly passed canonical parsing')

	const bids = completeCandidates
		.flatMap((event) => {
			const parsed = parseBidEvent(event)
			return parsed.ok ? [parsed.value] : []
		})
		.sort(
			(left, right) =>
				observedAtById.get(left.id)! - observedAtById.get(right.id)! || left.amount - right.amount || left.id.localeCompare(right.id),
		)
	const verdicts: ParsedValidatorVerdictEvent[] = []
	const nut7States = new Map<string, Nut7ProofState>()
	let currentTop = 0
	const results = new Map<string, BidValidationVerdict>()
	for (const bid of bids) {
		const observedAt = observedAtById.get(bid.id)
		if (!observedAt) throw new Error(`Bid ${bid.id} has no durable trusted observation time`)
		const proofState = await proofStateForBid(bid)
		nut7States.set(bid.id, proofState.aggregate)
		const verdict = validateBid({
			auction,
			bid,
			observedAt,
			nut7State: proofState.aggregate,
			nut7ProofStates: proofState.byProof,
			currentTopBid: currentTop,
		})
		results.set(bid.id, verdict)
		if (verdict.claim === 'valid_bid_placed') currentTop = bid.amount
		const rawVerdict = verdictEvent(run, bid, verdict, observedAt)
		await publishEvent(run.relayUrl, rawVerdict)
		const parsed = parseValidatorVerdictEvent(rawVerdict)
		if (!parsed.ok) throw new Error('Demo validator produced a malformed verdict')
		verdicts.push(parsed.value)
	}
	if (
		results.get(legA.signedBidEvent!.id)?.claim !== 'valid_bid_placed' ||
		results.get(legB.signedBidEvent!.id)?.claim !== 'valid_bid_placed'
	) {
		throw new Error(
			`Real Auction validator did not admit both Coco-backed bids: ${JSON.stringify({
				bidderA: results.get(legA.signedBidEvent!.id),
				bidderB: results.get(legB.signedBidEvent!.id),
			})}`,
		)
	}
	if (results.get(adversarial[1].id)?.claim !== 'bid_invalid') throw new Error('Wrong-Auction higher bid was not rejected')
	if (results.get(adversarial[2].id)?.claim !== 'bid_invalid') throw new Error('Invalid-collateral higher bid was not rejected')
	const lateVerdict = results.get(lateAttacker.signedBidEvent.id)
	if (lateVerdict?.claim !== 'bid_invalid' || lateVerdict.reason !== 'late_arrival') {
		throw new Error('Post-close first-observed bid was not rejected as late_arrival')
	}
	const validated = computeValidatedBids({ auction, bids, verdicts, nut7States })
	if (validated.canonicalWinner?.id !== legB.signedBidEvent!.id)
		throw new Error('Existing winner derivation did not select bidder B from VALID bids only')
	return {
		winner: validated.canonicalWinner,
		malformedRejected: true,
		wrongAuctionRejected: true,
		invalidCollateralRejected: true,
		lateArrivalRejected: true,
		lateBid: {
			accountId: lateAttacker.accountId,
			operationId: lateAttacker.operationId,
			bidEventId: lateAttacker.signedBidEvent.id,
			amount: 999,
			createdAt: lateAttacker.signedBidEvent.created_at,
			publishedAt,
			observedAt: observedAtById.get(lateAttacker.signedBidEvent.id)!,
		},
	}
}

const createRun = async (mintUrl: string, relayUrl: string, store: CocoAuctionWorkflowStore): Promise<CocoAuctionRunRecord> => {
	const runId = crypto.randomUUID()
	const sellerAccountId = `${runId}:seller`
	const seller = new FrozenCocoAuctionWallet(sellerAccountId)
	await seller.boot()
	try {
		const authority = await seller.createAuctionAuthority()
		const now = Math.floor(Date.now() / 1000)
		const closeAt = now + RUN_CLOSE_DELAY_SECONDS
		const locktime = closeAt + SETTLEMENT_GRACE_SECONDS
		const sellerPubkey = eventPubkey('seller')
		const auditorPubkey = eventPubkey('auditor')
		const auctionCoordinate = `${AUCTION_KIND}:${sellerPubkey}:${runId}`
		const auctionEvent = signedEvent(
			{
				kind: AUCTION_KIND,
				created_at: now,
				content: 'Controlled Coco Auction protocol-binding demo',
				tags: buildAuctionEventTags({
					dTag: runId,
					title: 'Coco protocol-binding demo',
					startAt: now - 1,
					endAt: closeAt,
					maxEndAt: closeAt,
					settlementGrace: SETTLEMENT_GRACE_SECONDS,
					reserve: 0,
					startingBid: 16,
					bidIncrement: 16,
					mints: [mintUrl],
					p2pkXpub: authority.publicExtendedKey,
					auditors: [auditorPubkey],
					auditorQuorum: 1,
					minBidCurve: { shape: 'none', peakMultiplier: 1, raw: 'none:1.0' },
				}),
			},
			'seller',
		)
		requireCanonicalAuction(auctionEvent)
		const timestamp = Date.now()
		const identity = await getPageControllerIdentity()
		return await store.createRun({
			version: 2,
			runId,
			startedPageInstanceId: identity.controllerId,
			state: 'DISCOVERABLE',
			mintUrl,
			relayUrl,
			auctionEventId: auctionEvent.id,
			auctionCoordinate,
			signedAuctionEvent: auctionEvent,
			sellerAccountId,
			sellerPubkey,
			auditorPubkey,
			bidderAAccountId: `${runId}:bidder-a`,
			bidderBAccountId: `${runId}:bidder-b`,
			lateAttackerAccountId: `${runId}:late-attacker`,
			closeAt,
			locktime,
			revision: 0,
			bidObservations: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		})
	} finally {
		await seller.dispose()
	}
}

export const startCocoAuctionDemo = async (options?: CocoAuctionDemoStartOptions): Promise<CocoAuctionDemoStartReport> => {
	if (!isCocoAuctionDemoMode()) throw new Error('Coco Auction demo mode is not enabled')
	browserPrepareCoordinator()
	const mintUrl = options?.mintUrl ?? process.env.APP_DEV_TEST_MINT_URL ?? 'http://localhost:3338'
	const relayUrl = options?.relayUrl ?? process.env.APP_RELAY_URL ?? 'ws://localhost:10547'
	const store = new CocoAuctionWorkflowStore()
	let run = await store.getRun()
	if (!run || run.state === 'COMPLETE') run = await createRun(mintUrl, relayUrl, store)
	const auction = requireCanonicalAuction(run.signedAuctionEvent)
	const seller = new FrozenCocoAuctionWallet(run.sellerAccountId)
	const bidderA = new FrozenCocoAuctionWallet(run.bidderAAccountId)
	const bidderB = new FrozenCocoAuctionWallet(run.bidderBAccountId)
	const lateAttacker = new FrozenCocoAuctionWallet(run.lateAttackerAccountId)
	await Promise.all([seller.boot(), bidderA.boot(), bidderB.boot(), lateAttacker.boot()])
	try {
		await publishEvent(run.relayUrl, run.signedAuctionEvent)
		if (run.state === 'DISCOVERABLE') run = await store.updateRun({ state: 'AUCTION_PUBLISHED', updatedAt: Date.now() })
		if (run.state === 'AUCTION_PUBLISHED') {
			await Promise.all([
				ensureFunding(bidderA, run.mintUrl, 32),
				ensureFunding(bidderB, run.mintUrl, 64),
				ensureFunding(lateAttacker, run.mintUrl, 1024),
			])
			run = await store.updateRun({ state: 'FUNDED', updatedAt: Date.now() })
		}
		const legA = await progressLeg(run, 'bidder-a', bidderA, auction.p2pkXpub, 16, store, options)
		const legB = await progressLeg(run, 'bidder-b', bidderB, auction.p2pkXpub, 32, store, options)
		if (legA.state !== 'BID_PUBLISHED' || legB.state !== 'BID_PUBLISHED') throw new Error('Both bidder legs must be published')
		const lateAttackerLeg = await prepareLateAttackerBid(run, auction, store, lateAttacker)
		if (run.state === 'FUNDED') run = await store.updateRun({ state: 'BIDS_PUBLISHED', updatedAt: Date.now() })
		const validated = await validatePublishedBids(run, legA, legB, lateAttackerLeg, store)
		run = await store.updateRun({ state: 'WINNER_VALIDATED', winnerBidEventId: validated.winner.id, updatedAt: Date.now() })
		return {
			runId: run.runId,
			auctionEventId: run.auctionEventId,
			bidderABidEventId: legA.signedBidEvent!.id,
			bidderBBidEventId: legB.signedBidEvent!.id,
			bidderAOperationId: legA.operationId!,
			bidderBOperationId: legB.operationId!,
			winnerBidEventId: validated.winner.id,
			closeAt: run.closeAt,
			locktime: run.locktime,
			states: {
				bidderA: await bidderA.getOperationState(legA.operationId!),
				bidderB: await bidderB.getOperationState(legB.operationId!),
			},
			validation: {
				canonicalAuction: true,
				validA: true,
				validB: true,
				malformedRejected: validated.malformedRejected,
				wrongAuctionRejected: validated.wrongAuctionRejected,
				invalidCollateralRejected: validated.invalidCollateralRejected,
				lateArrivalRejected: validated.lateArrivalRejected,
			},
			lateBid: validated.lateBid,
			reloadRequired: true,
		}
	} finally {
		await Promise.all([seller.dispose(), bidderA.dispose(), bidderB.dispose(), lateAttacker.dispose()])
	}
}

const waitUntil = async (predicate: () => boolean, timeoutMs: number, label: string): Promise<void> => {
	const startedAt = Date.now()
	while (!predicate()) {
		if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

const lockCommitmentFingerprint = (conditionFingerprint: string, proofYs: readonly string[]): string =>
	Array.from(
		sha256(new TextEncoder().encode(JSON.stringify([conditionFingerprint, [...proofYs].map((value) => value.toLowerCase()).sort()]))),
		(value) => value.toString(16).padStart(2, '0'),
	).join('')

export const resumeCocoAuctionDemo = async (options?: CocoAuctionDemoResumeOptions): Promise<CocoAuctionDemoFinalReport> => {
	if (!isCocoAuctionDemoMode()) throw new Error('Coco Auction demo mode is not enabled')
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run || run.state !== 'WINNER_VALIDATED' || !run.winnerBidEventId) throw new Error('No validated Coco Auction demo run is available')
	if (run.startedPageInstanceId === (await getPageControllerIdentity()).controllerId)
		throw new Error('A hard page reload is required before resuming the Coco Auction demo')
	const legA = await store.getLeg(`${run.runId}:bidder-a`)
	const legB = await store.getLeg(`${run.runId}:bidder-b`)
	if (!legA?.operationId || !legB?.operationId || !legA.signedBidEvent || !legB.signedBidEvent)
		throw new Error('Persisted bidder legs are incomplete')
	const auction = requireCanonicalAuction(run.signedAuctionEvent)
	const winnerBid = parseRequiredBid(legB.signedBidEvent)
	if (winnerBid.id !== run.winnerBidEventId) throw new Error('Persisted winner changed across restart')
	const seller = new FrozenCocoAuctionWallet(run.sellerAccountId)
	const bidderA = new FrozenCocoAuctionWallet(legA.accountId)
	const bidderB = new FrozenCocoAuctionWallet(legB.accountId)
	await Promise.all([seller.boot(), bidderA.boot(), bidderB.boot()])
	try {
		const [stateA, stateB] = await Promise.all([bidderA.resumeAuctionBid(legA.operationId), bidderB.resumeAuctionBid(legB.operationId)])
		const receiveAtBoot = await store.getSellerReceive(run.runId)
		const winnerAlreadyReceived =
			stateB === 'finalized' && receiveAtBoot?.receiveOperationState === 'finalized' && Boolean(receiveAtBoot.receiveOperationId)
		if (stateA !== 'pending' || (stateB !== 'pending' && !winnerAlreadyReceived))
			throw new Error(`Restart did not reconnect the exact pending locks (${stateA}, ${stateB})`)
		await waitUntil(() => Math.floor(Date.now() / 1000) >= run.closeAt, 30_000, 'Auction close')
		const releaseRun = await store.getRun()
		const releaseLeg = await store.getLeg(`${run.runId}:bidder-b`)
		if (!releaseRun?.winnerBidEventId || !releaseLeg?.operationId || !releaseLeg.signedBidEvent || !releaseLeg.proofYs?.length) {
			throw new Error('Winner workflow binding disappeared before bearer release')
		}
		const releaseBid = parseRequiredBid(releaseLeg.signedBidEvent)
		if (releaseBid.id !== releaseRun.winnerBidEventId) throw new Error('Winning bid changed before bearer release')
		const release = await releaseExactlyBoundWinningBid(bidderB, releaseLeg, releaseBid)
		const existingReceive = await store.getSellerReceive(run.runId)
		const pathReleaseCreatedAt = existingReceive?.pathReleaseCreatedAt ?? Math.floor(Date.now() / 1000)
		const pathRelease = signedEvent(
			{
				kind: PATH_RELEASE_KIND,
				created_at: pathReleaseCreatedAt,
				content: JSON.stringify({ type: 'auction_path_release_v1', reason: 'settlement' }),
				tags: buildPathReleaseTags({
					bidEventId: releaseBid.id,
					auctionCoordinate: run.auctionCoordinate,
					sellerPubkey: run.sellerPubkey,
					derivationPath: releaseLeg.derivationPath,
					childPubkey: releaseLeg.recipientPublicKey,
					releaseReason: 'settlement',
					cashuToken: release.token,
				}),
			},
			'bidder-b',
		)
		if (existingReceive && existingReceive.pathReleaseEventId !== pathRelease.id) {
			throw new Error('Recovered path release does not reproduce the durable public event identity')
		}
		const parsedRelease = parsePathReleaseEvent(pathRelease)
		if (!parsedRelease.ok) throw new Error('Winner path release is malformed')
		assertSellerPathBinding(auction, releaseBid, parsedRelease.value.derivationPath)
		const releaseValidity = validatePathRelease({
			auction,
			bid: releaseBid,
			release: parsedRelease.value,
			now: pathRelease.created_at,
			postCloseDecision: 'winner',
			expectedTokenAmount: releaseLeg.amount,
			mintKeysets: await fetchMintKeysets(run.mintUrl),
		})
		if (!releaseValidity.isValid) throw new Error(`Winner token/path binding failed: ${releaseValidity.failureCode}`)
		const receiveInput = {
			token: release.token,
			derivationPath: releaseLeg.derivationPath,
			mintUrl: run.mintUrl,
			expectedRecipientPublicKey: releaseLeg.recipientPublicKey,
		}
		const descriptor = await seller.inspectWinningReceive(receiveInput)
		const expectedTokenFingerprint = fingerprintAuctionReceiveCommitment(run.mintUrl, 'sat', releaseLeg.amount, releaseLeg.proofYs)
		if (descriptor.tokenFingerprint !== expectedTokenFingerprint || descriptor.amount !== releaseLeg.amount) {
			throw new Error('Released winning token does not match the durable lock commitment')
		}
		const receiveLegId = `${run.runId}:seller-receive`
		const identity = await getPageControllerIdentity()
		let sellerReceive = await browserPrepareCoordinator().runExclusive(auctionPrepareLockName(run.runId, receiveLegId), async () => {
			let durable = await store.getSellerReceive(run.runId)
			let authority = pageSellerReceiveAuthorities.get(run.runId)
			if (!durable) {
				const lease = await tryAcquireOwnerPresence(auctionOwnerPresenceLockName(run.runId, receiveLegId))
				if (!lease) throw new Error('LIVE_OWNER')
				authority = {
					claimId: crypto.randomUUID(),
					ownerControllerId: identity.controllerId,
					ownerControllerGeneration: identity.controllerGeneration,
					claimEpoch: 1,
				}
				const now = Date.now()
				durable = await store
					.createSellerReceiveIntent({
						schemaVersion: 1,
						runId: run.runId,
						auctionId: run.auctionEventId,
						auctionCoordinate: run.auctionCoordinate,
						winningBidEventId: winnerBid.id,
						winnerBidderAccountId: releaseLeg.accountId,
						winnerSendOperationId: releaseLeg.operationId!,
						sellerAccountId: run.sellerAccountId,
						mintUrl: descriptor.mintUrl,
						unit: descriptor.unit,
						amount: descriptor.amount,
						expectedRecipientPublicKey: releaseLeg.recipientPublicKey,
						derivationPath: releaseLeg.derivationPath,
						conditionFingerprint: releaseLeg.conditionFingerprint,
						lockCommitmentFingerprint: lockCommitmentFingerprint(releaseLeg.conditionFingerprint, releaseLeg.proofYs!),
						tokenFingerprint: descriptor.tokenFingerprint,
						pathReleaseEventId: pathRelease.id,
						pathReleaseCreatedAt,
						phase: 'RECEIVE_INTENT',
						...authority,
						highestOwnerGeneration: authority.ownerControllerGeneration,
						receiveAttemptCount: 0,
						revision: 0,
						createdAt: now,
						updatedAt: now,
					})
					.catch((error) => {
						lease.release()
						throw error
					})
				sellerReceivePresenceLeases.set(run.runId, lease)
				pageSellerReceiveAuthorities.set(run.runId, authority)
				await publishEvent(run.relayUrl, pathRelease)
				maybeSettlementCrash(options, 'S1')
			} else {
				for (const [label, actual, expected] of [
					['auction', durable.auctionId, run.auctionEventId],
					['winner', durable.winningBidEventId, winnerBid.id],
					['winner operation', durable.winnerSendOperationId, releaseLeg.operationId],
					['seller', durable.sellerAccountId, run.sellerAccountId],
					['token commitment', durable.tokenFingerprint, descriptor.tokenFingerprint],
					['path release', durable.pathReleaseEventId, pathRelease.id],
				] as const) {
					if (actual !== expected) throw new Error(`Recovered seller Receive ${label} changed`)
				}
				if (authority) {
					if (!samePrepareAuthority(authority, durableSellerReceiveAuthority(durable)) || !sellerReceivePresenceLeases.has(run.runId)) {
						throw new Error('STALE_CONTROLLER')
					}
				} else {
					if (identity.controllerGeneration <= durable.highestOwnerGeneration) throw new Error('STALE_CONTROLLER')
					const lease = await tryAcquireOwnerPresence(auctionOwnerPresenceLockName(run.runId, receiveLegId))
					if (!lease) throw new Error('LIVE_OWNER')
					try {
						await seller.reconcileWinningReceive({
							...receiveInput,
							tokenFingerprint: durable.tokenFingerprint,
						})
						authority = {
							claimId: crypto.randomUUID(),
							ownerControllerId: identity.controllerId,
							ownerControllerGeneration: identity.controllerGeneration,
							claimEpoch: durable.claimEpoch + 1,
						}
						durable = await store.adoptSellerReceive(run.runId, durableSellerReceiveAuthority(durable), authority)
					} catch (error) {
						lease.release()
						throw error
					}
					sellerReceivePresenceLeases.set(run.runId, lease)
					pageSellerReceiveAuthorities.set(run.runId, authority)
				}
				await publishEvent(run.relayUrl, pathRelease)
			}
			if (!authority) throw new Error('Seller Receive has no page-local authority')

			let exact = await seller.reconcileWinningReceive({
				...receiveInput,
				tokenFingerprint: durable.tokenFingerprint,
			})
			if (!exact) {
				if (durable.receiveAttemptCount !== 0 || durable.receiveOperationId) {
					throw new Error('SELLER_RECEIVE_CORRELATION_BLOCKER')
				}
				durable = await store.recordSellerReceiveAttempt(run.runId, authority)
				await store.assertSellerReceiveAuthority(run.runId, authority)
				exact = await seller.prepareWinningReceive({
					...receiveInput,
					tokenFingerprint: durable.tokenFingerprint,
				})
				maybeSettlementCrash(options, 'S2')
			}
			if (exact.tokenFingerprint !== durable.tokenFingerprint) throw new Error('Exact Coco Receive correlation changed')
			if (!durable.receiveOperationId) {
				durable = await store.bindSellerReceiveOperation(run.runId, authority, exact.operationId, exact.state)
			} else if (durable.receiveOperationId !== exact.operationId) {
				throw new Error('Recovered Coco Receive does not match the durably bound operation')
			}
			if (durable.phase === 'RECEIVE_OPERATION_BOUND') maybeSettlementCrash(options, 'S3')
			if (durable.phase === 'RECEIVE_OPERATION_BOUND') {
				durable = await store.markSellerReceiveExecuting(run.runId, authority)
			}
			if (durable.phase === 'RECEIVE_EXECUTING') {
				await store.assertSellerReceiveAuthority(run.runId, authority)
				const finalized = await seller.resumeWinningReceive(exact.operationId, durable.tokenFingerprint)
				durable = await store.markSellerReceiveFinalized(run.runId, authority, finalized.operationId)
				maybeSettlementCrash(options, 'S4')
			}
			if (durable.phase === 'RECEIVE_FINALIZED') {
				const settlement = signedEvent(
					{
						kind: SETTLEMENT_KIND,
						created_at: Math.floor(Date.now() / 1000),
						content: JSON.stringify({ type: 'auction_settlement_v1', status: 'settled' }),
						tags: buildSettlementTags({
							auctionRootEventId: run.auctionEventId,
							auctionCoordinate: run.auctionCoordinate,
							status: 'settled',
							closeAt: run.closeAt,
							finalAmount: legB.amount,
							winningBidId: winnerBid.id,
							winnerPubkey: legB.bidderPubkey,
							pathReleaseEventId: durable.pathReleaseEventId,
							payouts: [{ bidEventId: winnerBid.id, amount: legB.amount, status: 'redeemed' }],
						}),
					},
					'seller',
				)
				durable = await store.storeSignedSettlement(run.runId, authority, settlement)
				maybeSettlementCrash(options, 'S5')
			}
			if (durable.phase === 'SETTLEMENT_SIGNED') {
				await store.assertSellerReceiveAuthority(run.runId, authority)
				await publishEvent(run.relayUrl, durable.settlementEvent!)
				maybeSettlementCrash(options, 'S6')
				durable = await store.markSettlementPublished(run.runId, authority, durable.settlementEvent!.id)
			}
			return durable
		})
		if (sellerReceive.phase !== 'SETTLEMENT_PUBLISHED' || !sellerReceive.settlementEvent || !sellerReceive.receiveOperationId) {
			throw new Error('Seller Receive/settlement workflow did not reach its durable terminal phase')
		}
		releaseSellerReceivePresence(run.runId)
		await waitUntil(() => Math.floor(Date.now() / 1000) > run.locktime, 30_000, 'strict P2PK refund expiry')
		const loserPreRefundState = await bidderA.getOperationState(legA.operationId)
		const loserPostRefundState = await bidderA.refundLosingBid(legA.operationId)
		const terminalRefundState = await bidderA.refundLosingBid(legA.operationId)
		const [sellerBalance, bidderABalance, bidderBBalance] = await Promise.all([
			seller.getBalance(run.mintUrl),
			bidderA.getBalance(run.mintUrl),
			bidderB.getBalance(run.mintUrl),
		])
		const [receiveOperations, receiveEffects] = await Promise.all([seller.listReceiveDiagnostics(), seller.readReceiveEffectCounts()])
		const exactReceiveOperations = receiveOperations.filter((operation) => operation.tokenFingerprint === sellerReceive.tokenFingerprint)
		if (exactReceiveOperations.length !== 1 || exactReceiveOperations[0].operationId !== sellerReceive.receiveOperationId) {
			throw new Error('Independent Coco Receive inventory is not exactly one operation')
		}
		const [bidderASendFee, bidderBSendFee] = await Promise.all([bidderA.getSendFee(legA.operationId), bidderB.getSendFee(legB.operationId)])
		const sellerReceiveFee = exactReceiveOperations[0].fee
		if (sellerReceiveFee === null) throw new Error('Finalized seller Receive has no authoritative fee')
		if (bidderASendFee !== 0 || bidderBSendFee !== 0 || sellerReceiveFee !== 0) {
			throw new Error(
				`Controlled local mint unexpectedly charged fees (A=${bidderASendFee}, B=${bidderBSendFee}, seller=${sellerReceiveFee})`,
			)
		}
		const aggregateFinalBalance = sellerBalance.spendable + bidderABalance.spendable + bidderBBalance.spendable
		await store.updateRun({ state: 'COMPLETE', updatedAt: Date.now() })
		return {
			runId: run.runId,
			auctionEventId: run.auctionEventId,
			winnerBidEventId: winnerBid.id,
			winnerSendOperationId: legB.operationId,
			winnerSendState: await bidderB.getOperationState(legB.operationId),
			sellerReceiveOperationId: sellerReceive.receiveOperationId,
			sellerReceiveState: sellerReceive.receiveOperationState!,
			loserSendOperationId: legA.operationId,
			loserPreRefundState,
			loserPostRefundState,
			terminalRefundState,
			pathReleaseEventId: pathRelease.id,
			settlementEventId: sellerReceive.settlementEvent.id,
			settlementPublishedAfterReceive: sellerReceive.settlementPublishedAt! >= sellerReceive.receiveFinalizedAt!,
			winnerReceiveEffects: receiveEffects.remoteEffects,
			receiveOperations: exactReceiveOperations.length,
			secondReceive: false,
			loserRefundEffects: 1,
			aggregateFinalBalance,
			operationIdsStable: true,
			secondLocks: 0,
			exactOperationBinding: true,
			tokenCommitmentBinding: true,
			sellerPathBinding: true,
			legacyCalls: getLegacyAuctionMonetaryAudit(),
			conservation: {
				seller: {
					start: 0,
					funded: 0,
					locked: 0,
					received: legB.amount,
					refunded: 0,
					fees: sellerReceiveFee,
					end: sellerBalance.spendable,
				},
				bidderA: {
					start: 0,
					funded: 32,
					locked: legA.amount,
					received: 0,
					refunded: legA.amount,
					fees: bidderASendFee,
					end: bidderABalance.spendable,
				},
				bidderB: {
					start: 0,
					funded: 64,
					locked: legB.amount,
					received: 0,
					refunded: 0,
					fees: bidderBSendFee,
					end: bidderBBalance.spendable,
				},
			},
		}
	} finally {
		await Promise.all([seller.dispose(), bidderA.dispose(), bidderB.dispose()])
	}
}

const readSafeDiagnostics = async (): Promise<CocoAuctionSafeDiagnostics> => {
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	const legs = await store.listLegs()
	const operations: CocoAuctionSafeDiagnostics['operations'] = []
	let receiveOperations: CocoAuctionSafeDiagnostics['receiveOperations'] = []
	for (const accountId of [...new Set(legs.map((leg) => leg.accountId))]) {
		const wallet = new FrozenCocoAuctionWallet(accountId)
		await wallet.boot()
		try {
			for (const operation of await wallet.listSendDiagnostics()) operations.push({ accountId, ...operation })
		} finally {
			await wallet.dispose()
		}
	}
	const sellerReceive = run ? await store.getSellerReceive(run.runId) : null
	if (run) {
		const seller = new FrozenCocoAuctionWallet(run.sellerAccountId)
		await seller.boot()
		try {
			receiveOperations = (await seller.listReceiveDiagnostics()).map((operation) => ({
				operationId: operation.operationId,
				state: operation.state,
				mintUrl: operation.mintUrl,
				unit: operation.unit,
				amount: operation.amount,
				tokenFingerprint: operation.tokenFingerprint,
				fee: operation.fee,
			}))
		} finally {
			await seller.dispose()
		}
	}
	const relayBidEventIds = run ? (await fetchAuctionBidCandidates(run)).map((event) => event.id).sort() : []
	const relaySettlementEventIds = run
		? (await fetchEvents({ kinds: [SETTLEMENT_KIND], '#e': [run.auctionEventId] }, { relayUrls: [run.relayUrl], timeoutMs: 5_000 }))
				.map((event) => event.id)
				.sort()
		: []
	return {
		controlDbName: COCO_AUCTION_CONTROL_DB_NAME,
		run: run ? { runId: run.runId, state: run.state, revision: run.revision } : null,
		legs: await Promise.all(
			legs.map(async (leg) => ({
				role: leg.role,
				accountId: leg.accountId,
				bidderLegId: leg.bidderLegId,
				state: leg.state,
				prepareClaimId: leg.prepareClaimId,
				prepareClaimStatus: leg.prepareClaimStatus,
				prepareClaimOwnerControllerFingerprint: leg.prepareClaimOwnerControllerId
					? controllerFingerprint(leg.prepareClaimOwnerControllerId)
					: undefined,
				prepareClaimOwnerControllerGeneration: leg.prepareClaimOwnerControllerGeneration,
				prepareClaimEpoch: leg.prepareClaimEpoch,
				prepareHighestOwnerGeneration: leg.prepareHighestOwnerGeneration,
				prepareAttemptCount: leg.prepareAttemptCount ?? 0,
				actualPrepareCallCount: await readActualPrepareCallCount(leg.accountId, leg.bidderLegId),
				operationId: leg.operationId,
				signedBidEventId: leg.signedBidEvent?.id,
				revision: leg.revision,
			})),
		),
		operations,
		sellerReceive: sellerReceive
			? {
					phase: sellerReceive.phase,
					claimIdFingerprint: controllerFingerprint(sellerReceive.claimId),
					ownerControllerFingerprint: controllerFingerprint(sellerReceive.ownerControllerId),
					ownerControllerGeneration: sellerReceive.ownerControllerGeneration,
					claimEpoch: sellerReceive.claimEpoch,
					highestOwnerGeneration: sellerReceive.highestOwnerGeneration,
					receiveAttemptCount: sellerReceive.receiveAttemptCount,
					receiveOperationId: sellerReceive.receiveOperationId,
					receiveOperationState: sellerReceive.receiveOperationState,
					settlementEventId: sellerReceive.settlementEvent?.id,
					revision: sellerReceive.revision,
				}
			: null,
		receiveOperations,
		relayBidEventIds,
		relaySettlementEventIds,
	}
}

const testClaimPrepare = async (bidderLegId: string, claimId: string, claimEpoch = 1) => {
	const identity = await getPageControllerIdentity()
	const claim = await new CocoAuctionWorkflowStore().claimPrepare(bidderLegId, {
		claimId,
		ownerControllerId: identity.controllerId,
		ownerControllerGeneration: identity.controllerGeneration,
		claimEpoch,
	})
	return {
		mayPrepare: claim.mayPrepare,
		claimId: claim.leg.prepareClaimId,
		ownerControllerFingerprint: claim.leg.prepareClaimOwnerControllerId
			? controllerFingerprint(claim.leg.prepareClaimOwnerControllerId)
			: undefined,
		ownerControllerGeneration: claim.leg.prepareClaimOwnerControllerGeneration,
		claimEpoch: claim.leg.prepareClaimEpoch,
		highestOwnerGeneration: claim.leg.prepareHighestOwnerGeneration,
		revision: claim.leg.revision,
		state: claim.leg.state,
	}
}

const testRecordPrepareAttempt = async (bidderLegId: string, claimId: string, claimEpoch: number) => {
	const identity = await getPageControllerIdentity()
	return new CocoAuctionWorkflowStore().recordPrepareAttempt(bidderLegId, {
		claimId,
		ownerControllerId: identity.controllerId,
		ownerControllerGeneration: identity.controllerGeneration,
		claimEpoch,
	})
}

const testBindPreparedOperation = async (bidderLegId: string, claimId: string, claimEpoch: number, operationId: string) => {
	const identity = await getPageControllerIdentity()
	return bindPreparedOperationWithAuthority(
		new CocoAuctionWorkflowStore(),
		bidderLegId,
		{
			claimId,
			ownerControllerId: identity.controllerId,
			ownerControllerGeneration: identity.controllerGeneration,
			claimEpoch,
		},
		operationId,
	)
}

const testBypassPreparingAuthority = (bidderLegId: string, mutation: 'phase' | 'metadata') =>
	new CocoAuctionWorkflowStore().updateLeg(
		bidderLegId,
		mutation === 'phase'
			? { state: 'OPERATION_BOUND', operationId: 'unauthorized-operation' }
			: {
					prepareClaimId: 'unauthorized-claim',
					prepareClaimOwnerControllerId: 'unauthorized-controller',
					prepareClaimOwnerControllerGeneration: 999,
					prepareClaimEpoch: 999,
					prepareHighestOwnerGeneration: 999,
				},
	)

const testProgressPrepare = async (
	role: 'bidder-a' | 'bidder-b',
	options?: { barrierId?: string; crashAt?: 'after-claim' | 'after-attempt' | 'after-prepare' },
) => {
	if (options?.barrierId) await waitForTestPrepareBarrier(options.barrierId)
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run || run.state === 'COMPLETE') throw new Error('No active Coco Auction test run')
	const auction = requireCanonicalAuction(run.signedAuctionEvent)
	const accountId = role === 'bidder-a' ? run.bidderAAccountId : run.bidderBAccountId
	const wallet = new FrozenCocoAuctionWallet(accountId)
	await wallet.boot()
	try {
		const leg = await progressLegToOperationBound(run, role, wallet, auction.p2pkXpub, role === 'bidder-a' ? 16 : 32, store, {
			crashLeg: role,
			prepareCrashAt: options?.crashAt,
		})
		return {
			bidderLegId: leg.bidderLegId,
			state: leg.state,
			claimId: leg.prepareClaimId,
			ownerControllerFingerprint: leg.prepareClaimOwnerControllerId ? controllerFingerprint(leg.prepareClaimOwnerControllerId) : undefined,
			ownerControllerGeneration: leg.prepareClaimOwnerControllerGeneration,
			claimEpoch: leg.prepareClaimEpoch,
			highestOwnerGeneration: leg.prepareHighestOwnerGeneration,
			operationId: leg.operationId,
			prepareAttemptCount: leg.prepareAttemptCount ?? 0,
			actualPrepareCallCount: await readActualPrepareCallCount(leg.accountId, leg.bidderLegId),
		}
	} finally {
		await wallet.dispose()
	}
}

const testControllerIdentity = async () => {
	const identity = await getPageControllerIdentity()
	return {
		controllerFingerprint: controllerFingerprint(identity.controllerId),
		controllerGeneration: identity.controllerGeneration,
	}
}

const testRelinquishOwnerPresence = (bidderLegId: string): void => releaseOwnerPresence(bidderLegId, true)

const testDelayedPrepare = async (role: 'bidder-a' | 'bidder-b', barrierId: string) => {
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run) throw new Error('No active Coco Auction test run')
	const bidderLegId = `${run.runId}:${role}`
	const authority = pagePrepareAuthorities.get(bidderLegId)
	if (!authority) throw new Error('No retained controller authority for delayed prepare')
	const accountId = role === 'bidder-a' ? run.bidderAAccountId : run.bidderBAccountId
	const wallet = new FrozenCocoAuctionWallet(accountId)
	await wallet.boot()
	try {
		await waitForTestPrepareBarrier(barrierId)
		return await prepareAuctionBidWithAuthority(store, wallet, bidderLegId, authority)
	} finally {
		await wallet.dispose()
	}
}

const testDelayedBind = async (role: 'bidder-a' | 'bidder-b', operationId: string, barrierId: string) => {
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run) throw new Error('No active Coco Auction test run')
	const bidderLegId = `${run.runId}:${role}`
	const authority = pagePrepareAuthorities.get(bidderLegId)
	if (!authority) throw new Error('No retained controller authority for delayed bind')
	await waitForTestPrepareBarrier(barrierId)
	return bindPreparedOperationWithAuthority(store, bidderLegId, authority, operationId)
}

const readAccountOperations = async (accountId: string) => {
	const wallet = new FrozenCocoAuctionWallet(accountId)
	await wallet.boot()
	try {
		return await wallet.listSendDiagnostics()
	} finally {
		await wallet.dispose()
	}
}

const readAccountReceiveOperations = async (accountId: string) => {
	const wallet = new FrozenCocoAuctionWallet(accountId)
	await wallet.boot()
	try {
		return await wallet.listReceiveDiagnostics()
	} finally {
		await wallet.dispose()
	}
}

const testSettlementBeforeFinalized = async (): Promise<void> => {
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run) throw new Error('No active Coco Auction test run')
	const authority = pageSellerReceiveAuthorities.get(run.runId)
	if (!authority) throw new Error('No retained seller Receive authority')
	const event = signedEvent({ kind: SETTLEMENT_KIND, created_at: Math.floor(Date.now() / 1000), content: '', tags: [] }, 'seller')
	await store.storeSignedSettlement(run.runId, authority, event)
}

const testCreateDuplicateExactReceive = async (): Promise<void> => {
	const store = new CocoAuctionWorkflowStore()
	const run = await store.getRun()
	if (!run?.winnerBidEventId) throw new Error('No validated Coco Auction test run')
	const leg = await store.getLeg(`${run.runId}:bidder-b`)
	if (!leg?.operationId || !leg.signedBidEvent) throw new Error('Winning bidder leg is incomplete')
	const bidder = new FrozenCocoAuctionWallet(leg.accountId)
	const seller = new FrozenCocoAuctionWallet(run.sellerAccountId)
	await Promise.all([bidder.boot(), seller.boot()])
	try {
		const release = await releaseExactlyBoundWinningBid(bidder, leg, parseRequiredBid(leg.signedBidEvent))
		const input = {
			token: release.token,
			derivationPath: leg.derivationPath,
			mintUrl: run.mintUrl,
			expectedRecipientPublicKey: leg.recipientPublicKey,
		}
		const descriptor = await seller.inspectWinningReceive(input)
		await seller.prepareWinningReceive({ ...input, tokenFingerprint: descriptor.tokenFingerprint })
	} finally {
		await Promise.all([bidder.dispose(), seller.dispose()])
	}
}

export const installCocoAuctionDemoBridge = (): void => {
	if (!isCocoAuctionDemoMode() || typeof window === 'undefined') return
	void getPageControllerIdentity().catch(() => undefined)
	const testControls =
		process.env.NODE_ENV === 'test'
			? {
					testClaimPrepare,
					testRecordPrepareAttempt,
					testBindPreparedOperation,
					testBypassPreparingAuthority,
					testProgressPrepare,
					testControllerIdentity,
					testRelinquishOwnerPresence,
					testDelayedPrepare,
					testDelayedBind,
					testPrepareBarrierReady: (barrierId: string) => testPrepareBarriers.get(barrierId)?.ready === true,
					testReleasePrepareBarrier: releaseTestPrepareBarrier,
					testPrepareLockName: (runId: string, bidderLegId: string) => auctionPrepareLockName(runId, bidderLegId),
					testOwnerPresenceLockName: (runId: string, bidderLegId: string) => auctionOwnerPresenceLockName(runId, bidderLegId),
					testSettlementBeforeFinalized,
					testCreateDuplicateExactReceive,
				}
			: {}
	Object.defineProperty(window, '__cocoAuctionDemo', {
		configurable: true,
		value: Object.freeze({
			commit: FROZEN_COCO_REFUND_COMMIT,
			start: startCocoAuctionDemo,
			resume: resumeCocoAuctionDemo,
			diagnostics: readSafeDiagnostics,
			accountOperations: readAccountOperations,
			accountReceiveOperations: readAccountReceiveOperations,
			...testControls,
		}),
	})
}

declare global {
	interface Window {
		__cocoAuctionDemo?: {
			commit: typeof FROZEN_COCO_REFUND_COMMIT
			start(input?: CocoAuctionDemoStartOptions): Promise<CocoAuctionDemoStartReport>
			resume(input?: CocoAuctionDemoResumeOptions): Promise<CocoAuctionDemoFinalReport>
			diagnostics(): Promise<CocoAuctionSafeDiagnostics>
			accountOperations(accountId: string): ReturnType<typeof readAccountOperations>
			accountReceiveOperations(accountId: string): ReturnType<typeof readAccountReceiveOperations>
			testClaimPrepare(bidderLegId: string, claimId: string, claimEpoch?: number): ReturnType<typeof testClaimPrepare>
			testRecordPrepareAttempt(bidderLegId: string, claimId: string, claimEpoch: number): ReturnType<typeof testRecordPrepareAttempt>
			testBindPreparedOperation(
				bidderLegId: string,
				claimId: string,
				claimEpoch: number,
				operationId: string,
			): ReturnType<typeof testBindPreparedOperation>
			testBypassPreparingAuthority(bidderLegId: string, mutation: 'phase' | 'metadata'): ReturnType<typeof testBypassPreparingAuthority>
			testProgressPrepare(
				role: 'bidder-a' | 'bidder-b',
				options?: Parameters<typeof testProgressPrepare>[1],
			): ReturnType<typeof testProgressPrepare>
			testControllerIdentity(): ReturnType<typeof testControllerIdentity>
			testRelinquishOwnerPresence(bidderLegId: string): void
			testDelayedPrepare(role: 'bidder-a' | 'bidder-b', barrierId: string): ReturnType<typeof testDelayedPrepare>
			testDelayedBind(role: 'bidder-a' | 'bidder-b', operationId: string, barrierId: string): ReturnType<typeof testDelayedBind>
			testPrepareBarrierReady(barrierId: string): boolean
			testReleasePrepareBarrier(barrierId: string): void
			testPrepareLockName(runId: string, bidderLegId: string): string
			testOwnerPresenceLockName(runId: string, bidderLegId: string): string
			testSettlementBeforeFinalized(): Promise<void>
			testCreateDuplicateExactReceive(): Promise<void>
		}
	}
}
