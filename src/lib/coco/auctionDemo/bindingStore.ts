import type { NostrEvent } from 'nostr-tools/pure'
import type {
	CocoAuctionControllerIdentity,
	CocoAuctionLegRecord,
	CocoAuctionLegState,
	CocoAuctionPrepareAuthority,
	CocoAuctionRunRecord,
	CocoAuctionSellerReceivePhase,
	CocoAuctionSellerReceiveRecord,
} from './types'

export const COCO_AUCTION_CONTROL_DB_NAME = 'plebeian-market-coco-auction-control-v3'
export const COCO_AUCTION_CONTROL_DB_VERSION = 3

const META_STORE = 'meta'
const RUN_STORE = 'runs'
const LEG_STORE = 'legs'
const CONTROLLER_STORE = 'controllers'
const SELLER_RECEIVE_STORE = 'seller-receives'
const SENTINEL_KEY = 'workflow-sentinel'
const CONTROLLER_GENERATION_KEY = 'controller-generation'

interface WorkflowSentinel {
	key: typeof SENTINEL_KEY
	schemaVersion: 3
	currentRunId: string | null
	recoveryRequired: boolean
	legIds: string[]
}

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_33 = /^(02|03)[0-9a-f]{64}$/
const LEG_STATES: CocoAuctionLegState[] = ['INTENT', 'PREPARING', 'OPERATION_BOUND', 'LOCKED', 'BID_SIGNED', 'BID_PUBLISHED']
const LEG_ORDER = new Map(LEG_STATES.map((state, index) => [state, index]))
const RUN_STATES: CocoAuctionRunRecord['state'][] = [
	'DISCOVERABLE',
	'AUCTION_PUBLISHED',
	'FUNDED',
	'BIDS_PUBLISHED',
	'WINNER_VALIDATED',
	'COMPLETE',
]
const RUN_ORDER = new Map(RUN_STATES.map((state, index) => [state, index]))
const SELLER_RECEIVE_PHASES: CocoAuctionSellerReceivePhase[] = [
	'RECEIVE_INTENT',
	'RECEIVE_OPERATION_BOUND',
	'RECEIVE_EXECUTING',
	'RECEIVE_FINALIZED',
	'SETTLEMENT_SIGNED',
	'SETTLEMENT_PUBLISHED',
]
const SELLER_RECEIVE_ORDER = new Map(SELLER_RECEIVE_PHASES.map((state, index) => [state, index]))
const SENSITIVE_FIELD = /^(?:token|cashuToken|proofs|rawProofs|privateKey|refundPrivateKey|witness|outputData|seed)$/i

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Auction control database request failed'))
	})

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error ?? new Error('Auction control database transaction failed'))
		transaction.onabort = () => reject(transaction.error ?? new Error('Auction control database transaction aborted'))
	})

const openControlDatabase = (): Promise<IDBDatabase> => {
	if (!globalThis.indexedDB) throw new Error('IndexedDB is required for the Coco Auction workflow control database')
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(COCO_AUCTION_CONTROL_DB_NAME, COCO_AUCTION_CONTROL_DB_VERSION)
		request.onupgradeneeded = (event) => {
			const database = request.result
			const transaction = request.transaction!
			const meta = database.objectStoreNames.contains(META_STORE)
				? transaction.objectStore(META_STORE)
				: database.createObjectStore(META_STORE, { keyPath: 'key' })
			if (!database.objectStoreNames.contains(RUN_STORE)) database.createObjectStore(RUN_STORE, { keyPath: 'runId' })
			if (!database.objectStoreNames.contains(LEG_STORE)) {
				const legs = database.createObjectStore(LEG_STORE, { keyPath: 'bidderLegId' })
				legs.createIndex('runId', 'runId', { unique: false })
			}
			if (!database.objectStoreNames.contains(CONTROLLER_STORE)) {
				database.createObjectStore(CONTROLLER_STORE, { keyPath: 'controllerId' })
			}
			if (!database.objectStoreNames.contains(SELLER_RECEIVE_STORE)) {
				database.createObjectStore(SELLER_RECEIVE_STORE, { keyPath: 'runId' })
			}
			if (event.oldVersion === 0) {
				meta.put({
					key: SENTINEL_KEY,
					schemaVersion: 3,
					currentRunId: null,
					recoveryRequired: false,
					legIds: [],
				} satisfies WorkflowSentinel)
				meta.put({ key: CONTROLLER_GENERATION_KEY, generation: 0 })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Auction control database open failed'))
		request.onblocked = () => reject(new Error('Auction control database upgrade is blocked'))
	})
}

const assertPublicEvent = (value: unknown, label: string): NostrEvent => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a signed public event`)
	const event = value as Partial<NostrEvent>
	if (!HEX_32.test(event.id ?? '') || !HEX_32.test(event.pubkey ?? '') || !/^[0-9a-f]{128}$/.test(event.sig ?? '')) {
		throw new Error(`${label} is not signed`)
	}
	if (!Number.isSafeInteger(event.kind) || !Number.isSafeInteger(event.created_at) || !Array.isArray(event.tags)) {
		throw new Error(`${label} is malformed`)
	}
	return value as NostrEvent
}

const rejectBearerFields = (value: unknown, path = 'workflow'): void => {
	if (!value || typeof value !== 'object') return
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) rejectBearerFields(value[index], `${path}[${index}]`)
		return
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (SENSITIVE_FIELD.test(key)) throw new Error(`${path} contains forbidden bearer field "${key}"`)
		rejectBearerFields(child, `${path}.${key}`)
	}
}

export const assertNonBearerAuctionLeg = (value: unknown): CocoAuctionLegRecord => {
	rejectBearerFields(value)
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Auction leg must be an object')
	const leg = value as CocoAuctionLegRecord
	if (leg.version !== 2 || !LEG_ORDER.has(leg.state)) throw new Error('Auction leg version/state is invalid')
	for (const key of ['runId', 'accountId', 'auctionId', 'auctionCoordinate', 'bidderLegId', 'mintUrl', 'derivationPath'] as const) {
		if (typeof leg[key] !== 'string' || !leg[key]) throw new Error(`Auction leg ${key} is required`)
	}
	if (
		!HEX_32.test(leg.auctionId) ||
		!HEX_32.test(leg.bidderPubkey) ||
		!HEX_33.test(leg.recipientPublicKey) ||
		!HEX_33.test(leg.refundPublicKey)
	) {
		throw new Error('Auction leg public commitments are invalid')
	}
	if (
		!HEX_32.test(leg.conditionFingerprint) ||
		leg.unit !== 'sat' ||
		!Number.isSafeInteger(leg.amount) ||
		leg.amount <= 0 ||
		!Number.isSafeInteger(leg.locktime) ||
		!Number.isSafeInteger(leg.revision) ||
		leg.revision < 0
	) {
		throw new Error('Auction leg immutable target is invalid')
	}
	if (LEG_ORDER.get(leg.state)! >= LEG_ORDER.get('PREPARING')! && (!leg.prepareClaimId || !leg.prepareClaimStatus)) {
		throw new Error('Preparing Auction leg requires a durable prepare claim')
	}
	if (
		LEG_ORDER.get(leg.state)! >= LEG_ORDER.get('PREPARING')! &&
		(!leg.prepareClaimOwnerControllerId ||
			!Number.isSafeInteger(leg.prepareClaimOwnerControllerGeneration) ||
			leg.prepareClaimOwnerControllerGeneration! < 1 ||
			!Number.isSafeInteger(leg.prepareClaimEpoch) ||
			leg.prepareClaimEpoch! < 1 ||
			!Number.isSafeInteger(leg.prepareHighestOwnerGeneration) ||
			leg.prepareHighestOwnerGeneration !== leg.prepareClaimOwnerControllerGeneration ||
			!Number.isSafeInteger(leg.prepareClaimedAt) ||
			leg.prepareClaimedAt! <= 0)
	) {
		throw new Error('Preparing Auction leg requires a complete durable claim authority tuple')
	}
	if (!Number.isSafeInteger(leg.prepareAttemptCount ?? 0) || (leg.prepareAttemptCount ?? 0) < 0) {
		throw new Error('Auction leg prepare attempt count is invalid')
	}
	if (LEG_ORDER.get(leg.state)! >= LEG_ORDER.get('OPERATION_BOUND')! && (!leg.operationId || leg.prepareClaimStatus !== 'bound')) {
		throw new Error('Bound Auction leg requires operationId and bound prepare claim')
	}
	if (
		LEG_ORDER.get(leg.state)! >= LEG_ORDER.get('LOCKED')! &&
		(!leg.lockSecrets?.length || leg.lockSecrets.length !== leg.proofYs?.length)
	) {
		throw new Error('Locked Auction leg requires parallel public commitments')
	}
	if (LEG_ORDER.get(leg.state)! >= LEG_ORDER.get('BID_SIGNED')!) assertPublicEvent(leg.signedBidEvent, 'Auction bid event')
	return Object.freeze({ ...leg })
}

export const assertNonBearerAuctionRun = (value: unknown): CocoAuctionRunRecord => {
	rejectBearerFields(value)
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Auction run must be an object')
	const run = value as CocoAuctionRunRecord
	if (
		run.version !== 2 ||
		!RUN_ORDER.has(run.state) ||
		!run.runId ||
		!run.sellerAccountId ||
		!run.bidderAAccountId ||
		!run.bidderBAccountId ||
		!run.lateAttackerAccountId ||
		!run.bidObservations ||
		typeof run.bidObservations !== 'object'
	) {
		throw new Error('Auction run identity is invalid')
	}
	if (!Number.isSafeInteger(run.revision) || run.revision < 0) throw new Error('Auction run revision is invalid')
	for (const observedAt of Object.values(run.bidObservations)) {
		if (!Number.isSafeInteger(observedAt) || observedAt <= 0) throw new Error('Auction bid observation time is invalid')
	}
	if (!HEX_32.test(run.auctionEventId) || !HEX_32.test(run.sellerPubkey) || !HEX_32.test(run.auditorPubkey)) {
		throw new Error('Auction run public identifiers are invalid')
	}
	assertPublicEvent(run.signedAuctionEvent, 'Auction event')
	return Object.freeze({ ...run, bidObservations: Object.freeze({ ...run.bidObservations }) })
}

export const assertNonBearerSellerReceive = (value: unknown): CocoAuctionSellerReceiveRecord => {
	rejectBearerFields(value)
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Seller Receive intent must be an object')
	const receive = value as CocoAuctionSellerReceiveRecord
	if (receive.schemaVersion !== 1 || !SELLER_RECEIVE_ORDER.has(receive.phase)) {
		throw new Error('Seller Receive schema/phase is invalid')
	}
	for (const key of [
		'runId',
		'auctionCoordinate',
		'winnerBidderAccountId',
		'winnerSendOperationId',
		'sellerAccountId',
		'mintUrl',
		'derivationPath',
		'claimId',
		'ownerControllerId',
	] as const) {
		if (typeof receive[key] !== 'string' || !receive[key]) throw new Error(`Seller Receive ${key} is required`)
	}
	for (const key of [
		'auctionId',
		'winningBidEventId',
		'conditionFingerprint',
		'lockCommitmentFingerprint',
		'tokenFingerprint',
		'pathReleaseEventId',
	] as const) {
		if (!HEX_32.test(receive[key])) throw new Error(`Seller Receive ${key} is invalid`)
	}
	if (!HEX_33.test(receive.expectedRecipientPublicKey) || receive.unit !== 'sat') {
		throw new Error('Seller Receive public recipient/unit is invalid')
	}
	for (const [label, number, minimum] of [
		['amount', receive.amount, 1],
		['pathReleaseCreatedAt', receive.pathReleaseCreatedAt, 1],
		['ownerControllerGeneration', receive.ownerControllerGeneration, 1],
		['claimEpoch', receive.claimEpoch, 1],
		['highestOwnerGeneration', receive.highestOwnerGeneration, 1],
		['receiveAttemptCount', receive.receiveAttemptCount, 0],
		['revision', receive.revision, 0],
		['createdAt', receive.createdAt, 1],
		['updatedAt', receive.updatedAt, 1],
	] as const) {
		if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`Seller Receive ${label} is invalid`)
	}
	if (receive.ownerControllerGeneration !== receive.highestOwnerGeneration) {
		throw new Error('Seller Receive current owner must equal its highest controller generation')
	}
	if (SELLER_RECEIVE_ORDER.get(receive.phase)! >= SELLER_RECEIVE_ORDER.get('RECEIVE_OPERATION_BOUND')! && !receive.receiveOperationId) {
		throw new Error('Seller Receive operation must be bound before progression')
	}
	if (SELLER_RECEIVE_ORDER.get(receive.phase)! >= SELLER_RECEIVE_ORDER.get('RECEIVE_FINALIZED')!) {
		if (receive.receiveOperationState !== 'finalized' || !Number.isSafeInteger(receive.receiveFinalizedAt)) {
			throw new Error('Seller Receive finalization requires authoritative Coco state')
		}
	}
	if (SELLER_RECEIVE_ORDER.get(receive.phase)! >= SELLER_RECEIVE_ORDER.get('SETTLEMENT_SIGNED')!) {
		const settlement = assertPublicEvent(receive.settlementEvent, 'Settlement event')
		if (settlement.kind !== 1024) throw new Error('Seller settlement event kind is invalid')
	}
	if (
		SELLER_RECEIVE_ORDER.get(receive.phase)! >= SELLER_RECEIVE_ORDER.get('SETTLEMENT_PUBLISHED')! &&
		(!Number.isSafeInteger(receive.settlementPublishedAt) || receive.settlementPublishedAt! <= 0)
	) {
		throw new Error('Published settlement requires a durable publication marker')
	}
	return Object.freeze({ ...receive })
}

const IMMUTABLE_LEG_KEYS = [
	'accountId',
	'runId',
	'auctionId',
	'auctionCoordinate',
	'bidderLegId',
	'mintUrl',
	'unit',
	'amount',
	'locktime',
	'derivationPath',
	'recipientPublicKey',
	'refundPublicKey',
	'conditionFingerprint',
	'role',
	'bidderPubkey',
] as const

const getSentinel = async (store: IDBObjectStore): Promise<WorkflowSentinel> => {
	const sentinel = (await requestResult(store.get(SENTINEL_KEY))) as WorkflowSentinel | undefined
	if (!sentinel || sentinel.schemaVersion !== 3 || !Array.isArray(sentinel.legIds)) {
		throw new Error('Auction workflow recovery sentinel is missing or corrupt')
	}
	return sentinel
}

export interface PrepareClaimResult {
	leg: CocoAuctionLegRecord
	mayPrepare: boolean
}

const requirePrepareAuthority = (authority: CocoAuctionPrepareAuthority): void => {
	if (
		!authority.claimId ||
		!authority.ownerControllerId ||
		!Number.isSafeInteger(authority.ownerControllerGeneration) ||
		authority.ownerControllerGeneration < 1 ||
		!Number.isSafeInteger(authority.claimEpoch) ||
		authority.claimEpoch < 1
	) {
		throw new Error('Complete prepare claim authority is required')
	}
}

const hasPrepareAuthority = (leg: CocoAuctionLegRecord, authority: CocoAuctionPrepareAuthority): boolean =>
	leg.prepareClaimId === authority.claimId &&
	leg.prepareClaimOwnerControllerId === authority.ownerControllerId &&
	leg.prepareClaimOwnerControllerGeneration === authority.ownerControllerGeneration &&
	leg.prepareClaimEpoch === authority.claimEpoch &&
	leg.prepareHighestOwnerGeneration === authority.ownerControllerGeneration

const requireRegisteredController = async (store: IDBObjectStore, authority: CocoAuctionPrepareAuthority): Promise<void> => {
	const registered = (await requestResult(store.get(authority.ownerControllerId))) as CocoAuctionControllerIdentity | undefined
	if (!registered || registered.controllerGeneration !== authority.ownerControllerGeneration) {
		throw new Error('Prepare claimant controller identity is not registered')
	}
}

const sellerReceiveAuthority = (receive: CocoAuctionSellerReceiveRecord): CocoAuctionPrepareAuthority => ({
	claimId: receive.claimId,
	ownerControllerId: receive.ownerControllerId,
	ownerControllerGeneration: receive.ownerControllerGeneration,
	claimEpoch: receive.claimEpoch,
})

const hasSellerReceiveAuthority = (receive: CocoAuctionSellerReceiveRecord, authority: CocoAuctionPrepareAuthority): boolean =>
	receive.claimId === authority.claimId &&
	receive.ownerControllerId === authority.ownerControllerId &&
	receive.ownerControllerGeneration === authority.ownerControllerGeneration &&
	receive.claimEpoch === authority.claimEpoch &&
	receive.highestOwnerGeneration === authority.ownerControllerGeneration

const IMMUTABLE_SELLER_RECEIVE_KEYS = [
	'runId',
	'auctionId',
	'auctionCoordinate',
	'winningBidEventId',
	'winnerBidderAccountId',
	'winnerSendOperationId',
	'sellerAccountId',
	'mintUrl',
	'unit',
	'amount',
	'expectedRecipientPublicKey',
	'derivationPath',
	'conditionFingerprint',
	'lockCommitmentFingerprint',
	'tokenFingerprint',
	'pathReleaseEventId',
	'pathReleaseCreatedAt',
] as const

const assertSameSellerReceiveIntent = (left: CocoAuctionSellerReceiveRecord, right: CocoAuctionSellerReceiveRecord): void => {
	for (const key of IMMUTABLE_SELLER_RECEIVE_KEYS) {
		if (left[key] !== right[key]) throw new Error(`Seller Receive immutable field ${key} changed`)
	}
}

let pageControllerId: string | null = null
let pageControllerIdentityPromise: Promise<CocoAuctionControllerIdentity> | null = null

export const getPageControllerIdentity = (): Promise<CocoAuctionControllerIdentity> => {
	if (pageControllerIdentityPromise) return pageControllerIdentityPromise
	if (!globalThis.crypto?.randomUUID) throw new Error('Secure page-local controller identity is required')
	pageControllerId ??= globalThis.crypto.randomUUID()
	pageControllerIdentityPromise = (async () => {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			const meta = transaction.objectStore(META_STORE)
			const controllers = transaction.objectStore(CONTROLLER_STORE)
			const existing = (await requestResult(controllers.get(pageControllerId!))) as CocoAuctionControllerIdentity | undefined
			if (existing) {
				await done
				return Object.freeze(existing)
			}
			const generationRecord = (await requestResult(meta.get(CONTROLLER_GENERATION_KEY))) as
				| { key: typeof CONTROLLER_GENERATION_KEY; generation: number }
				| undefined
			const previous = generationRecord?.generation ?? 0
			if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('Controller generation allocator is corrupt')
			const identity = { controllerId: pageControllerId!, controllerGeneration: previous + 1 }
			controllers.add(identity)
			meta.put({ key: CONTROLLER_GENERATION_KEY, generation: identity.controllerGeneration })
			await done
			return Object.freeze(identity)
		} finally {
			database.close()
		}
	})()
	return pageControllerIdentityPromise
}

export class CocoAuctionWorkflowStore {
	async getRun(): Promise<CocoAuctionRunRecord | null> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE], 'readonly')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (!sentinel.currentRunId) {
				await done
				return null
			}
			const run = await requestResult(transaction.objectStore(RUN_STORE).get(sentinel.currentRunId))
			await done
			if (!run) throw new Error('Auction workflow state is missing while recovery sentinel is active')
			return assertNonBearerAuctionRun(run)
		} finally {
			database.close()
		}
	}

	async createRun(run: CocoAuctionRunRecord): Promise<CocoAuctionRunRecord> {
		const validated = assertNonBearerAuctionRun(run)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE, LEG_STORE], 'readwrite')
			const done = transactionDone(transaction)
			const meta = transaction.objectStore(META_STORE)
			const runs = transaction.objectStore(RUN_STORE)
			const sentinel = await getSentinel(meta)
			if (sentinel.currentRunId) {
				const currentRaw = await requestResult(runs.get(sentinel.currentRunId))
				if (!currentRaw) throw new Error('Auction workflow state is missing while recovery sentinel is active')
				const current = assertNonBearerAuctionRun(currentRaw)
				if (current.state !== 'COMPLETE') {
					await done
					return current
				}
			}
			runs.put(validated)
			meta.put({ ...sentinel, currentRunId: validated.runId, recoveryRequired: true, legIds: [] })
			await done
			return validated
		} finally {
			database.close()
		}
	}

	async updateRun(
		patch: Partial<Pick<CocoAuctionRunRecord, 'state' | 'winnerBidEventId' | 'startedPageInstanceId' | 'updatedAt'>>,
	): Promise<CocoAuctionRunRecord> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE], 'readwrite')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (!sentinel.currentRunId) throw new Error('No Coco Auction run exists')
			const runs = transaction.objectStore(RUN_STORE)
			const raw = await requestResult(runs.get(sentinel.currentRunId))
			if (!raw) throw new Error('Auction workflow state is missing while recovery sentinel is active')
			const current = assertNonBearerAuctionRun(raw)
			if (patch.state && RUN_ORDER.get(patch.state)! < RUN_ORDER.get(current.state)!) {
				throw new Error('Auction run state cannot move backwards')
			}
			const next = assertNonBearerAuctionRun({ ...current, ...patch, revision: current.revision + 1 })
			runs.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async observeBid(eventId: string, observedAt: number): Promise<number> {
		if (!HEX_32.test(eventId) || !Number.isSafeInteger(observedAt) || observedAt <= 0) throw new Error('Bid observation is invalid')
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE], 'readwrite')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (!sentinel.currentRunId) throw new Error('No Coco Auction run exists')
			const runs = transaction.objectStore(RUN_STORE)
			const raw = await requestResult(runs.get(sentinel.currentRunId))
			if (!raw) throw new Error('Auction workflow state is missing while recovery sentinel is active')
			const current = assertNonBearerAuctionRun(raw)
			const existing = current.bidObservations[eventId]
			if (existing) {
				await done
				return existing
			}
			const next = assertNonBearerAuctionRun({
				...current,
				bidObservations: { ...current.bidObservations, [eventId]: observedAt },
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			runs.put(next)
			await done
			return observedAt
		} finally {
			database.close()
		}
	}

	async listLegs(): Promise<readonly CocoAuctionLegRecord[]> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE, LEG_STORE], 'readonly')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (!sentinel.currentRunId) {
				await done
				return Object.freeze([])
			}
			const run = await requestResult(transaction.objectStore(RUN_STORE).get(sentinel.currentRunId))
			if (!run) throw new Error('Auction workflow state is missing while recovery sentinel is active')
			const values = await requestResult(transaction.objectStore(LEG_STORE).index('runId').getAll(sentinel.currentRunId))
			await done
			if (values.length !== sentinel.legIds.length || sentinel.legIds.some((id) => !values.some((value) => value.bidderLegId === id))) {
				throw new Error('Auction leg workflow state is missing while recovery sentinel is active')
			}
			return Object.freeze(values.map(assertNonBearerAuctionLeg))
		} finally {
			database.close()
		}
	}

	async getLeg(bidderLegId: string): Promise<CocoAuctionLegRecord | null> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, LEG_STORE], 'readonly')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			const value = await requestResult(transaction.objectStore(LEG_STORE).get(bidderLegId))
			await done
			if (!value && sentinel.legIds.includes(bidderLegId)) {
				throw new Error('Auction leg workflow state is missing while recovery sentinel is active')
			}
			return value ? assertNonBearerAuctionLeg(value) : null
		} finally {
			database.close()
		}
	}

	async createIntent(intent: CocoAuctionLegRecord): Promise<CocoAuctionLegRecord> {
		const validated = assertNonBearerAuctionLeg(intent)
		if (validated.state !== 'INTENT' || validated.revision !== 0) throw new Error('New Auction leg must begin at INTENT revision 0')
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE, LEG_STORE], 'readwrite')
			const done = transactionDone(transaction)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (!sentinel.currentRunId || sentinel.currentRunId !== validated.runId)
				throw new Error('Auction leg does not belong to the durable run')
			const runRaw = await requestResult(transaction.objectStore(RUN_STORE).get(validated.runId))
			if (!runRaw) throw new Error('Auction workflow state is missing while recovery sentinel is active')
			const run = assertNonBearerAuctionRun(runRaw)
			if (validated.auctionId !== run.auctionEventId || validated.auctionCoordinate !== run.auctionCoordinate) {
				throw new Error('Auction leg does not belong to the durable Auction')
			}
			const legs = transaction.objectStore(LEG_STORE)
			const existingRaw = await requestResult(legs.get(validated.bidderLegId))
			if (existingRaw) {
				const existing = assertNonBearerAuctionLeg(existingRaw)
				for (const key of IMMUTABLE_LEG_KEYS) {
					if (existing[key] !== validated[key]) throw new Error(`Auction leg immutable field ${key} changed`)
				}
				await done
				return existing
			}
			if (sentinel.legIds.includes(validated.bidderLegId)) {
				throw new Error('Auction leg workflow state is missing while recovery sentinel is active')
			}
			const siblings = await requestResult(legs.index('runId').getAll(validated.runId))
			if (
				siblings.some((value) => {
					const leg = assertNonBearerAuctionLeg(value)
					return leg.accountId === validated.accountId && leg.auctionId === validated.auctionId
				})
			) {
				throw new Error('Coco account already has a leg for this Auction')
			}
			legs.add(validated)
			transaction.objectStore(META_STORE).put({ ...sentinel, legIds: [...sentinel.legIds, validated.bidderLegId] })
			await done
			return validated
		} finally {
			database.close()
		}
	}

	async claimPrepare(bidderLegId: string, authority: CocoAuctionPrepareAuthority): Promise<PrepareClaimResult> {
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([LEG_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const legs = transaction.objectStore(LEG_STORE)
			const raw = await requestResult(legs.get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (current.state !== 'INTENT' && current.state !== 'PREPARING') {
				await done
				return { leg: current, mayPrepare: false }
			}
			if (current.state === 'PREPARING') {
				await done
				return { leg: current, mayPrepare: hasPrepareAuthority(current, authority) }
			}
			if (authority.claimEpoch !== 1) throw new Error('Initial prepare claim must begin at epoch 1')
			const next = assertNonBearerAuctionLeg({
				...current,
				state: 'PREPARING',
				prepareClaimId: authority.claimId,
				prepareClaimStatus: 'claimed',
				prepareClaimOwnerControllerId: authority.ownerControllerId,
				prepareClaimOwnerControllerGeneration: authority.ownerControllerGeneration,
				prepareClaimEpoch: authority.claimEpoch,
				prepareHighestOwnerGeneration: authority.ownerControllerGeneration,
				prepareClaimedAt: Date.now(),
				prepareAttemptCount: current.prepareAttemptCount ?? 0,
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			legs.put(next)
			await done
			return { leg: next, mayPrepare: true }
		} finally {
			database.close()
		}
	}

	async adoptPrepareClaim(
		bidderLegId: string,
		expectedAuthority: CocoAuctionPrepareAuthority,
		recoveryAuthority: CocoAuctionPrepareAuthority,
	): Promise<CocoAuctionLegRecord> {
		requirePrepareAuthority(expectedAuthority)
		requirePrepareAuthority(recoveryAuthority)
		if (
			expectedAuthority.claimId === recoveryAuthority.claimId ||
			expectedAuthority.ownerControllerId === recoveryAuthority.ownerControllerId ||
			recoveryAuthority.claimEpoch !== expectedAuthority.claimEpoch + 1
		) {
			throw new Error('Prepare recovery requires a distinct page owner and next claim epoch')
		}
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([LEG_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), recoveryAuthority)
			const legs = transaction.objectStore(LEG_STORE)
			const raw = await requestResult(legs.get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (current.state !== 'PREPARING' || !hasPrepareAuthority(current, expectedAuthority)) {
				throw new Error('Prepare recovery claim no longer matches durable PREPARING state')
			}
			if (recoveryAuthority.ownerControllerGeneration <= (current.prepareHighestOwnerGeneration ?? 0)) {
				throw new Error('STALE_CONTROLLER')
			}
			const next = assertNonBearerAuctionLeg({
				...current,
				prepareClaimId: recoveryAuthority.claimId,
				prepareClaimStatus: 'recovered',
				prepareClaimOwnerControllerId: recoveryAuthority.ownerControllerId,
				prepareClaimOwnerControllerGeneration: recoveryAuthority.ownerControllerGeneration,
				prepareClaimEpoch: recoveryAuthority.claimEpoch,
				prepareHighestOwnerGeneration: recoveryAuthority.ownerControllerGeneration,
				prepareClaimedAt: Date.now(),
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			legs.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async assertPrepareAuthority(bidderLegId: string, authority: CocoAuctionPrepareAuthority): Promise<CocoAuctionLegRecord> {
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([LEG_STORE, CONTROLLER_STORE], 'readonly')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const raw = await requestResult(transaction.objectStore(LEG_STORE).get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (current.state !== 'PREPARING' || !hasPrepareAuthority(current, authority)) throw new Error('STALE_CONTROLLER')
			await done
			return current
		} finally {
			database.close()
		}
	}

	async recordPrepareAttempt(bidderLegId: string, authority: CocoAuctionPrepareAuthority): Promise<CocoAuctionLegRecord> {
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([LEG_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const legs = transaction.objectStore(LEG_STORE)
			const raw = await requestResult(legs.get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (current.state !== 'PREPARING' || !hasPrepareAuthority(current, authority)) {
				throw new Error('Only the durable prepare claimant may originate Coco prepare')
			}
			const next = assertNonBearerAuctionLeg({
				...current,
				prepareAttemptCount: (current.prepareAttemptCount ?? 0) + 1,
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			legs.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async bindPreparedOperation(
		bidderLegId: string,
		authority: CocoAuctionPrepareAuthority,
		operationId: string,
	): Promise<CocoAuctionLegRecord> {
		requirePrepareAuthority(authority)
		if (!operationId) throw new Error('Coco operation identity is required')
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([LEG_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const legs = transaction.objectStore(LEG_STORE)
			const raw = await requestResult(legs.get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (current.state !== 'PREPARING' || !hasPrepareAuthority(current, authority)) {
				throw new Error('Only the durable prepare claimant may bind the Coco operation')
			}
			const siblings = await requestResult(legs.index('runId').getAll(current.runId))
			if (siblings.some((value) => value.bidderLegId !== bidderLegId && value.operationId === operationId)) {
				throw new Error('Coco operation is already bound to another Auction leg')
			}
			const next = assertNonBearerAuctionLeg({
				...current,
				state: 'OPERATION_BOUND',
				operationId,
				prepareClaimStatus: 'bound',
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			legs.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async updateLeg(bidderLegId: string, patch: Partial<CocoAuctionLegRecord>): Promise<CocoAuctionLegRecord> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction(LEG_STORE, 'readwrite')
			const done = transactionDone(transaction)
			const legs = transaction.objectStore(LEG_STORE)
			const raw = await requestResult(legs.get(bidderLegId))
			if (!raw) throw new Error(`No Auction leg ${bidderLegId}`)
			const current = assertNonBearerAuctionLeg(raw)
			if (patch.revision !== undefined) throw new Error('Auction leg revision is store-controlled')
			if (current.state === 'PREPARING') {
				throw new Error('PREPARING Auction leg mutations require the complete claimant authority tuple')
			}
			for (const key of [
				'prepareClaimId',
				'prepareClaimStatus',
				'prepareClaimOwnerControllerId',
				'prepareClaimOwnerControllerGeneration',
				'prepareClaimEpoch',
				'prepareHighestOwnerGeneration',
				'prepareClaimedAt',
				'prepareAttemptCount',
				'operationId',
			] as const) {
				if (patch[key] !== undefined) throw new Error(`Auction leg ${key} is claimant-authority controlled`)
			}
			for (const key of IMMUTABLE_LEG_KEYS) {
				if (patch[key] !== undefined && patch[key] !== current[key]) throw new Error(`Auction leg immutable field ${key} changed`)
			}
			const nextState = patch.state ?? current.state
			if (LEG_ORDER.get(nextState)! < LEG_ORDER.get(current.state)!) throw new Error('Auction leg state cannot move backwards')
			if (current.operationId && patch.operationId && current.operationId !== patch.operationId) {
				throw new Error('Auction leg is already bound to another Coco operation')
			}
			if (patch.operationId) {
				const siblings = await requestResult(legs.index('runId').getAll(current.runId))
				if (siblings.some((value) => value.bidderLegId !== bidderLegId && value.operationId === patch.operationId)) {
					throw new Error('Coco operation is already bound to another Auction leg')
				}
			}
			const next = assertNonBearerAuctionLeg({ ...current, ...patch, revision: current.revision + 1 })
			legs.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async getSellerReceive(runId: string): Promise<CocoAuctionSellerReceiveRecord | null> {
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction(SELLER_RECEIVE_STORE, 'readonly')
			const done = transactionDone(transaction)
			const raw = await requestResult(transaction.objectStore(SELLER_RECEIVE_STORE).get(runId))
			await done
			return raw ? assertNonBearerSellerReceive(raw) : null
		} finally {
			database.close()
		}
	}

	async createSellerReceiveIntent(intent: CocoAuctionSellerReceiveRecord): Promise<CocoAuctionSellerReceiveRecord> {
		const validated = assertNonBearerSellerReceive(intent)
		if (
			validated.phase !== 'RECEIVE_INTENT' ||
			validated.claimEpoch !== 1 ||
			validated.receiveAttemptCount !== 0 ||
			validated.revision !== 0
		) {
			throw new Error('New seller Receive must begin as an unattempted epoch-1 intent')
		}
		const authority = sellerReceiveAuthority(validated)
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([META_STORE, RUN_STORE, SELLER_RECEIVE_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const sentinel = await getSentinel(transaction.objectStore(META_STORE))
			if (sentinel.currentRunId !== validated.runId) throw new Error('Seller Receive does not belong to the durable run')
			const runRaw = await requestResult(transaction.objectStore(RUN_STORE).get(validated.runId))
			if (!runRaw) throw new Error('Seller Receive durable run is missing')
			const run = assertNonBearerAuctionRun(runRaw)
			if (
				run.state !== 'WINNER_VALIDATED' ||
				run.auctionEventId !== validated.auctionId ||
				run.winnerBidEventId !== validated.winningBidEventId ||
				run.sellerAccountId !== validated.sellerAccountId
			) {
				throw new Error('Seller Receive intent is not bound to the validated winner')
			}
			const receives = transaction.objectStore(SELLER_RECEIVE_STORE)
			const existingRaw = await requestResult(receives.get(validated.runId))
			if (existingRaw) {
				const existing = assertNonBearerSellerReceive(existingRaw)
				assertSameSellerReceiveIntent(existing, validated)
				await done
				return existing
			}
			receives.add(validated)
			await done
			return validated
		} finally {
			database.close()
		}
	}

	async adoptSellerReceive(
		runId: string,
		expectedAuthority: CocoAuctionPrepareAuthority,
		recoveryAuthority: CocoAuctionPrepareAuthority,
	): Promise<CocoAuctionSellerReceiveRecord> {
		requirePrepareAuthority(expectedAuthority)
		requirePrepareAuthority(recoveryAuthority)
		if (
			expectedAuthority.claimId === recoveryAuthority.claimId ||
			expectedAuthority.ownerControllerId === recoveryAuthority.ownerControllerId ||
			recoveryAuthority.claimEpoch !== expectedAuthority.claimEpoch + 1
		) {
			throw new Error('Seller Receive recovery requires a distinct controller and next claim epoch')
		}
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([SELLER_RECEIVE_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), recoveryAuthority)
			const receives = transaction.objectStore(SELLER_RECEIVE_STORE)
			const raw = await requestResult(receives.get(runId))
			if (!raw) throw new Error('Seller Receive intent is missing')
			const current = assertNonBearerSellerReceive(raw)
			if (!hasSellerReceiveAuthority(current, expectedAuthority)) throw new Error('Seller Receive recovery tuple is stale')
			if (recoveryAuthority.ownerControllerGeneration <= current.highestOwnerGeneration) throw new Error('STALE_CONTROLLER')
			const next = assertNonBearerSellerReceive({
				...current,
				claimId: recoveryAuthority.claimId,
				ownerControllerId: recoveryAuthority.ownerControllerId,
				ownerControllerGeneration: recoveryAuthority.ownerControllerGeneration,
				claimEpoch: recoveryAuthority.claimEpoch,
				highestOwnerGeneration: recoveryAuthority.ownerControllerGeneration,
				revision: current.revision + 1,
				updatedAt: Date.now(),
			})
			receives.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}

	async assertSellerReceiveAuthority(runId: string, authority: CocoAuctionPrepareAuthority): Promise<CocoAuctionSellerReceiveRecord> {
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([SELLER_RECEIVE_STORE, CONTROLLER_STORE], 'readonly')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const raw = await requestResult(transaction.objectStore(SELLER_RECEIVE_STORE).get(runId))
			if (!raw) throw new Error('Seller Receive intent is missing')
			const current = assertNonBearerSellerReceive(raw)
			if (!hasSellerReceiveAuthority(current, authority)) throw new Error('STALE_CONTROLLER')
			await done
			return current
		} finally {
			database.close()
		}
	}

	async recordSellerReceiveAttempt(runId: string, authority: CocoAuctionPrepareAuthority): Promise<CocoAuctionSellerReceiveRecord> {
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (current.phase !== 'RECEIVE_INTENT' || current.receiveOperationId) {
				throw new Error('Seller Receive may originate only from an unbound durable intent')
			}
			return { ...current, receiveAttemptCount: current.receiveAttemptCount + 1 }
		})
	}

	async bindSellerReceiveOperation(
		runId: string,
		authority: CocoAuctionPrepareAuthority,
		operationId: string,
		operationState: string,
	): Promise<CocoAuctionSellerReceiveRecord> {
		if (!operationId) throw new Error('Seller Receive operation identity is required')
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (current.receiveOperationId && current.receiveOperationId !== operationId) {
				throw new Error('Seller Receive is already bound to another Coco operation')
			}
			if (current.phase !== 'RECEIVE_INTENT' && current.phase !== 'RECEIVE_OPERATION_BOUND') {
				throw new Error('Seller Receive operation binding is no longer permitted')
			}
			return { ...current, phase: 'RECEIVE_OPERATION_BOUND', receiveOperationId: operationId, receiveOperationState: operationState }
		})
	}

	async markSellerReceiveExecuting(runId: string, authority: CocoAuctionPrepareAuthority): Promise<CocoAuctionSellerReceiveRecord> {
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (current.phase !== 'RECEIVE_OPERATION_BOUND' || !current.receiveOperationId) {
				throw new Error('Seller Receive must be bound before execution')
			}
			return { ...current, phase: 'RECEIVE_EXECUTING', receiveOperationState: 'executing' }
		})
	}

	async markSellerReceiveFinalized(
		runId: string,
		authority: CocoAuctionPrepareAuthority,
		operationId: string,
	): Promise<CocoAuctionSellerReceiveRecord> {
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (
				(current.phase !== 'RECEIVE_OPERATION_BOUND' && current.phase !== 'RECEIVE_EXECUTING') ||
				current.receiveOperationId !== operationId
			) {
				throw new Error('Authoritative Coco Receive finalization does not match the bound operation')
			}
			return {
				...current,
				phase: 'RECEIVE_FINALIZED',
				receiveOperationState: 'finalized',
				receiveFinalizedAt: Date.now(),
			}
		})
	}

	async storeSignedSettlement(
		runId: string,
		authority: CocoAuctionPrepareAuthority,
		settlementEvent: NostrEvent,
	): Promise<CocoAuctionSellerReceiveRecord> {
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (current.phase === 'SETTLEMENT_SIGNED' && current.settlementEvent?.id === settlementEvent.id) return current
			if (current.phase !== 'RECEIVE_FINALIZED' || current.receiveOperationState !== 'finalized') {
				throw new Error('SETTLEMENT_REQUIRES_FINALIZED_RECEIVE')
			}
			assertPublicEvent(settlementEvent, 'Settlement event')
			return { ...current, phase: 'SETTLEMENT_SIGNED', settlementEvent }
		})
	}

	async markSettlementPublished(
		runId: string,
		authority: CocoAuctionPrepareAuthority,
		settlementEventId: string,
	): Promise<CocoAuctionSellerReceiveRecord> {
		return this.#mutateSellerReceive(runId, authority, (current) => {
			if (current.phase === 'SETTLEMENT_PUBLISHED' && current.settlementEvent?.id === settlementEventId) return current
			if (current.phase !== 'SETTLEMENT_SIGNED' || current.settlementEvent?.id !== settlementEventId) {
				throw new Error('Only the durable signed settlement may be marked published')
			}
			return { ...current, phase: 'SETTLEMENT_PUBLISHED', settlementPublishedAt: Date.now() }
		})
	}

	async #mutateSellerReceive(
		runId: string,
		authority: CocoAuctionPrepareAuthority,
		mutate: (current: CocoAuctionSellerReceiveRecord) => CocoAuctionSellerReceiveRecord,
	): Promise<CocoAuctionSellerReceiveRecord> {
		requirePrepareAuthority(authority)
		const database = await openControlDatabase()
		try {
			const transaction = database.transaction([SELLER_RECEIVE_STORE, CONTROLLER_STORE], 'readwrite')
			const done = transactionDone(transaction)
			await requireRegisteredController(transaction.objectStore(CONTROLLER_STORE), authority)
			const receives = transaction.objectStore(SELLER_RECEIVE_STORE)
			const raw = await requestResult(receives.get(runId))
			if (!raw) throw new Error('Seller Receive intent is missing')
			const current = assertNonBearerSellerReceive(raw)
			if (!hasSellerReceiveAuthority(current, authority)) throw new Error('STALE_CONTROLLER')
			const candidate = mutate(current)
			assertSameSellerReceiveIntent(current, candidate)
			if (SELLER_RECEIVE_ORDER.get(candidate.phase)! < SELLER_RECEIVE_ORDER.get(current.phase)!) {
				throw new Error('Seller Receive phase cannot move backwards')
			}
			const next = assertNonBearerSellerReceive({ ...candidate, revision: current.revision + 1, updatedAt: Date.now() })
			receives.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}
}
