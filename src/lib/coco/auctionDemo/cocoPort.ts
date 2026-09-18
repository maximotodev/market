import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'
import {
	getEncodedToken,
	initializeCoco,
	normalizeMintUrl,
	type Manager,
	type ReceiveOperation,
	type SendOperation,
} from '@cashu/coco-core'
import { IndexedDbRepositories } from '@cashu/coco-indexeddb'
import { AUCTION_HD_ACCOUNT_PATH } from '@/lib/auctionHd'
import { deriveAuctionChildP2pkPubkeyFromXpub, normalizeAuctionDerivationPath } from '@/lib/auctionP2pk'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import type {
	CocoAuctionAuthority,
	CocoAuctionBalance,
	CocoAuctionBidCommitments,
	CocoAuctionBidIntent,
	CocoAuctionFundingResult,
	CocoAuctionOperationState,
	CocoAuctionReceiveDescriptor,
	CocoAuctionReceiveDiagnostic,
	CocoAuctionRefundAuthority,
	CocoAuctionSendDiagnostic,
	CocoAuctionWalletPort,
	CocoAuctionWinnerRelease,
} from './types'

const SEED_VAULT_DB = 'plebeian-market-coco-auction-demo-seed-vault-v1'
const SEED_VAULT_STORE = 'wallet-seeds'
const PREPARE_DIAGNOSTICS_DB = 'plebeian-market-coco-auction-adapter-diagnostics-v1'
const PREPARE_DIAGNOSTICS_STORE = 'actual-prepare-calls'
const RECEIVE_DIAGNOSTICS_STORE = 'actual-receive-effects'
const DB_PREFIX = 'plebeian-market-coco-auction-demo-v1-'
const COMPRESSED_KEY = /^(02|03)[0-9a-f]{64}$/

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const hexToBytes = (value: string): Uint8Array => {
	if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) throw new Error('Stored Coco demo seed is malformed')
	return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16))
}

const getOrCreateSeed = async (accountId: string): Promise<Uint8Array> => {
	if (!globalThis.indexedDB || !globalThis.crypto?.getRandomValues)
		throw new Error('Secure browser persistence is required for Coco Auction demo mode')
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(SEED_VAULT_DB, 1)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(SEED_VAULT_STORE)) request.result.createObjectStore(SEED_VAULT_STORE)
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction seed vault open failed'))
	})
	try {
		const stored = await new Promise<string | undefined>((resolve, reject) => {
			const request = database.transaction(SEED_VAULT_STORE, 'readonly').objectStore(SEED_VAULT_STORE).get(accountId)
			request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined)
			request.onerror = () => reject(request.error ?? new Error('Coco Auction seed vault read failed'))
		})
		if (stored) return hexToBytes(stored)
		const seed = globalThis.crypto.getRandomValues(new Uint8Array(64))
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(SEED_VAULT_STORE, 'readwrite')
			transaction.objectStore(SEED_VAULT_STORE).add(bytesToHex(seed), accountId)
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(transaction.error ?? new Error('Coco Auction seed vault write failed'))
		})
		return seed
	} finally {
		database.close()
	}
}

const prepareDiagnosticKey = (accountId: string, bidderLegId: string): string => `${accountId}\u0000${bidderLegId}`

const openPrepareDiagnosticsDatabase = (): Promise<IDBDatabase> => {
	if (!globalThis.indexedDB) throw new Error('IndexedDB is required for Coco Auction adapter diagnostics')
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(PREPARE_DIAGNOSTICS_DB, 2)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(PREPARE_DIAGNOSTICS_STORE)) {
				request.result.createObjectStore(PREPARE_DIAGNOSTICS_STORE)
			}
			if (!request.result.objectStoreNames.contains(RECEIVE_DIAGNOSTICS_STORE)) {
				request.result.createObjectStore(RECEIVE_DIAGNOSTICS_STORE)
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction adapter diagnostics open failed'))
	})
}

interface ReceiveEffectCounts {
	originated: number
	remoteEffects: number
}

const updateReceiveEffectCounts = async (accountId: string, field: keyof ReceiveEffectCounts): Promise<void> => {
	const database = await openPrepareDiagnosticsDatabase()
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(RECEIVE_DIAGNOSTICS_STORE, 'readwrite')
			const store = transaction.objectStore(RECEIVE_DIAGNOSTICS_STORE)
			const request = store.get(accountId)
			request.onsuccess = () => {
				const current = (request.result as ReceiveEffectCounts | undefined) ?? { originated: 0, remoteEffects: 0 }
				store.put({ ...current, [field]: current[field] + 1 }, accountId)
			}
			request.onerror = () => reject(request.error ?? new Error('Coco Receive diagnostics read failed'))
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(transaction.error ?? new Error('Coco Receive diagnostics write failed'))
			transaction.onabort = () => reject(transaction.error ?? new Error('Coco Receive diagnostics write aborted'))
		})
	} finally {
		database.close()
	}
}

const readReceiveEffectCounts = async (accountId: string): Promise<ReceiveEffectCounts> => {
	const database = await openPrepareDiagnosticsDatabase()
	try {
		return await new Promise<ReceiveEffectCounts>((resolve, reject) => {
			const request = database.transaction(RECEIVE_DIAGNOSTICS_STORE, 'readonly').objectStore(RECEIVE_DIAGNOSTICS_STORE).get(accountId)
			request.onsuccess = () => resolve((request.result as ReceiveEffectCounts | undefined) ?? { originated: 0, remoteEffects: 0 })
			request.onerror = () => reject(request.error ?? new Error('Coco Receive diagnostics read failed'))
		})
	} finally {
		database.close()
	}
}

const recordActualPrepareCall = async (accountId: string, bidderLegId: string): Promise<void> => {
	const database = await openPrepareDiagnosticsDatabase()
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(PREPARE_DIAGNOSTICS_STORE, 'readwrite')
			const store = transaction.objectStore(PREPARE_DIAGNOSTICS_STORE)
			const key = prepareDiagnosticKey(accountId, bidderLegId)
			const request = store.get(key)
			request.onsuccess = () => store.put((typeof request.result === 'number' ? request.result : 0) + 1, key)
			request.onerror = () => reject(request.error ?? new Error('Coco Auction adapter diagnostics read failed'))
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(transaction.error ?? new Error('Coco Auction adapter diagnostics write failed'))
			transaction.onabort = () => reject(transaction.error ?? new Error('Coco Auction adapter diagnostics write aborted'))
		})
	} finally {
		database.close()
	}
}

export const readActualPrepareCallCount = async (accountId: string, bidderLegId: string): Promise<number> => {
	const database = await openPrepareDiagnosticsDatabase()
	try {
		return await new Promise<number>((resolve, reject) => {
			const request = database
				.transaction(PREPARE_DIAGNOSTICS_STORE, 'readonly')
				.objectStore(PREPARE_DIAGNOSTICS_STORE)
				.get(prepareDiagnosticKey(accountId, bidderLegId))
			request.onsuccess = () => resolve(typeof request.result === 'number' ? request.result : 0)
			request.onerror = () => reject(request.error ?? new Error('Coco Auction adapter diagnostics read failed'))
		})
	} finally {
		database.close()
	}
}

const canonicalCompressedKey = (value: string, label: string): string => {
	const normalized = value.trim().toLowerCase()
	if (!COMPRESSED_KEY.test(normalized)) throw new Error(`${label} must be a compressed secp256k1 public key`)
	return normalized
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface AuctionP2pkConditionInput {
	mintUrl: string
	amount: number
	unit?: string
	recipientPublicKey?: string
	recipientPublicKeys?: readonly string[]
	refundPublicKey?: string
	refundPublicKeys?: readonly string[]
	locktime: number
	sigFlag?: string
	requiredSignatures?: number
	requiredRefundSignatures?: number
	additionalTags?: readonly unknown[]
	blindKeys?: boolean
	additionalOptions?: Readonly<Record<string, unknown>>
}

export interface AuctionP2pkConditionProjection {
	version: 3
	method: 'p2pk'
	mintUrl: string
	amount: number
	unit: string
	recipientPublicKeys: readonly string[]
	refundPublicKeys: readonly string[]
	locktime: number
	sigFlag: string
	requiredSignatures: number
	requiredRefundSignatures: number
	additionalTags: readonly JsonValue[]
	blindKeys: boolean
	additionalOptions: Readonly<Record<string, JsonValue>>
}

const canonicalJson = (value: unknown): JsonValue => {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('P2PK condition contains a non-finite number')
		return value
	}
	if (Array.isArray(value)) return value.map(canonicalJson)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, child]) => child !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalJson(child)]),
		)
	}
	throw new Error('P2PK condition contains a non-serializable value')
}

const canonicalKeySet = (values: readonly string[], label: string): readonly string[] =>
	Object.freeze([...new Set(values.map((value) => canonicalCompressedKey(value, label)))].sort())

export const projectAuctionP2pkCondition = (input: AuctionP2pkConditionInput): AuctionP2pkConditionProjection => {
	const recipients = input.recipientPublicKeys ?? (input.recipientPublicKey ? [input.recipientPublicKey] : [])
	const refunds = input.refundPublicKeys ?? (input.refundPublicKey ? [input.refundPublicKey] : [])
	if (!recipients.length) throw new Error('P2PK condition requires at least one recipient key')
	return Object.freeze({
		version: 3,
		method: 'p2pk' as const,
		mintUrl: normalizeMintUrl(input.mintUrl),
		amount: input.amount,
		unit: (input.unit ?? 'sat').trim().toLowerCase(),
		recipientPublicKeys: canonicalKeySet(recipients, 'Auction recipient key'),
		refundPublicKeys: canonicalKeySet(refunds, 'Auction refund key'),
		locktime: input.locktime,
		sigFlag: (input.sigFlag ?? 'SIG_INPUTS').toUpperCase(),
		requiredSignatures: input.requiredSignatures ?? 1,
		requiredRefundSignatures: input.requiredRefundSignatures ?? 1,
		additionalTags: Object.freeze(
			(input.additionalTags ?? []).map(canonicalJson).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		),
		blindKeys: input.blindKeys ?? false,
		additionalOptions: Object.freeze(canonicalJson(input.additionalOptions ?? {}) as Record<string, JsonValue>),
	}) as AuctionP2pkConditionProjection
}

export const fingerprintAuctionP2pkCondition = (projection: AuctionP2pkConditionProjection): string =>
	bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(projection))))

export const buildAuctionConditionFingerprint = (input: AuctionP2pkConditionInput): string =>
	fingerprintAuctionP2pkCondition(projectAuctionP2pkCondition(input))

const projectSendOperationCondition = (operation: SendOperation): AuctionP2pkConditionProjection | null => {
	if (operation.method !== 'p2pk') return null
	const methodData = operation.methodData as { pubkey?: string; options?: Record<string, unknown> }
	if (methodData.pubkey) {
		return projectAuctionP2pkCondition({
			mintUrl: operation.mintUrl,
			amount: operation.amount.toNumber(),
			unit: operation.unit,
			recipientPublicKey: methodData.pubkey,
			locktime: 0,
		})
	}
	const options = methodData.options
	if (!options) return null
	const rawPubkey = options.pubkey ?? options.data
	const recipientPublicKeys = Array.isArray(rawPubkey) ? rawPubkey : rawPubkey ? [rawPubkey] : []
	const refundPublicKeys = Array.isArray(options.refundKeys) ? options.refundKeys : []
	const known = new Set([
		'kind',
		'pubkey',
		'data',
		'refundKeys',
		'locktime',
		'requiredSignatures',
		'requiredRefundSignatures',
		'additionalTags',
		'tags',
		'blindKeys',
		'sigFlag',
	])
	const additionalOptions = Object.fromEntries(Object.entries(options).filter(([key]) => !known.has(key)))
	return projectAuctionP2pkCondition({
		mintUrl: operation.mintUrl,
		amount: operation.amount.toNumber(),
		unit: operation.unit,
		recipientPublicKeys: recipientPublicKeys as string[],
		refundPublicKeys: refundPublicKeys as string[],
		locktime: typeof options.locktime === 'number' ? options.locktime : 0,
		sigFlag: typeof options.sigFlag === 'string' ? options.sigFlag : undefined,
		requiredSignatures: typeof options.requiredSignatures === 'number' ? options.requiredSignatures : undefined,
		requiredRefundSignatures: typeof options.requiredRefundSignatures === 'number' ? options.requiredRefundSignatures : undefined,
		additionalTags: Array.isArray(options.additionalTags) ? options.additionalTags : Array.isArray(options.tags) ? options.tags : undefined,
		blindKeys: typeof options.blindKeys === 'boolean' ? options.blindKeys : undefined,
		additionalOptions,
	})
}

const requireSendOperation = async (manager: Manager, operationId: string): Promise<SendOperation> => {
	const operation = await manager.ops.send.get(operationId)
	if (!operation) throw new Error(`Coco Send operation ${operationId} was not found`)
	return operation
}

const operationMatchesIntent = (operation: SendOperation, intent: CocoAuctionBidIntent): boolean => {
	try {
		const actual = projectSendOperationCondition(operation)
		return actual !== null && fingerprintAuctionP2pkCondition(actual) === intent.conditionFingerprint
	} catch {
		return false
	}
}

export const selectUniquePreparedOperation = (operations: readonly SendOperation[], intent: CocoAuctionBidIntent): SendOperation | null => {
	const matches = operations.filter((operation) => operationMatchesIntent(operation, intent))
	if (matches.length > 1) throw new Error('More than one exact prepared Coco operation matches the Auction intent')
	return matches[0] ?? null
}

const receiveFingerprint = (mintUrl: string, unit: string, amount: number, proofYs: readonly string[]): string => {
	if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Coco Receive amount must be a positive integer')
	const normalizedYs = [...new Set(proofYs.map((value) => value.toLowerCase()))].sort()
	if (!normalizedYs.length || normalizedYs.some((value) => !/^[0-9a-f]{66}$/.test(value))) {
		throw new Error('Coco Receive proof commitments are invalid')
	}
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([normalizeMintUrl(mintUrl), unit.toLowerCase(), amount, normalizedYs]))))
}

export const fingerprintAuctionReceiveCommitment = (mintUrl: string, unit: string, amount: number, proofYs: readonly string[]): string =>
	receiveFingerprint(mintUrl, unit, amount, proofYs)

const receiveDescriptorFromToken = async (manager: Manager, token: string, mintUrlHint: string): Promise<CocoAuctionReceiveDescriptor> => {
	const decoded = await manager.wallet.decodeToken(token, mintUrlHint)
	const mintUrl = normalizeMintUrl(decoded.mint)
	const unit = (decoded.unit ?? 'sat').toLowerCase()
	if (unit !== 'sat') throw new Error(`Seller Coco Receive requires sat, got ${unit}`)
	const amount = decoded.proofs.reduce((sum, proof) => {
		const rawAmount = proof.amount as unknown
		const value =
			typeof rawAmount === 'number'
				? rawAmount
				: typeof (rawAmount as { toNumber?: unknown })?.toNumber === 'function'
					? (rawAmount as { toNumber(): number }).toNumber()
					: Number(rawAmount)
		return sum + value
	}, 0)
	const proofYs = Object.freeze(decoded.proofs.map((proof) => hashToCurveHexFromString(proof.secret)).sort())
	return Object.freeze({ mintUrl, unit: 'sat', amount, proofYs, tokenFingerprint: receiveFingerprint(mintUrl, unit, amount, proofYs) })
}

const receiveDiagnostic = (operation: ReceiveOperation): CocoAuctionReceiveDiagnostic => {
	const proofYs = Object.freeze(operation.inputProofs.map((proof) => hashToCurveHexFromString(proof.secret)).sort())
	const amount = operation.amount.toNumber()
	return Object.freeze({
		operationId: operation.id,
		state: operation.state,
		mintUrl: normalizeMintUrl(operation.mintUrl),
		unit: operation.unit.toLowerCase() as 'sat',
		amount,
		proofYs,
		tokenFingerprint: receiveFingerprint(operation.mintUrl, operation.unit, amount, proofYs),
		fee: operation.state === 'init' ? null : operation.fee.toNumber(),
	})
}

const listReceiveOperations = async (manager: Manager): Promise<ReceiveOperation[]> => {
	const operations = new Map<string, ReceiveOperation>()
	for (const operation of [...(await manager.ops.receive.listPrepared()), ...(await manager.ops.receive.listInFlight())]) {
		operations.set(operation.id, operation)
	}
	for (let offset = 0; ; offset += 100) {
		const entries = await manager.history.getPaginatedHistory(offset, 100)
		for (const entry of entries) {
			if (entry.source !== 'operation' || entry.type !== 'receive') continue
			const operation = await manager.ops.receive.get(entry.operationId)
			if (operation) operations.set(operation.id, operation)
		}
		if (entries.length < 100) break
	}
	return [...operations.values()]
}

export class FrozenCocoAuctionWallet implements CocoAuctionWalletPort {
	readonly accountId: string
	#manager: Manager | null = null
	#seed: Uint8Array | null = null

	constructor(accountId: string) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(accountId)) throw new Error('Coco Auction account id is invalid')
		this.accountId = accountId
	}

	async boot(): Promise<void> {
		if (this.#manager) return
		const seed = await getOrCreateSeed(this.accountId)
		const repositories = new IndexedDbRepositories({ name: `${DB_PREFIX}${this.accountId}` })
		this.#manager = await initializeCoco({
			repo: repositories,
			seedGetter: async () => seed,
			watchers: {
				mintOperationWatcher: { disabled: true },
				proofStateWatcher: { disabled: true },
				meltQuoteWatcher: { disabled: true },
			},
			processors: {
				mintOperationProcessor: { disabled: true },
				meltSettlementProcessor: { disabled: true },
			},
		})
		this.#seed = seed
	}

	async dispose(): Promise<void> {
		await this.#manager?.dispose()
		this.#manager = null
		this.#seed = null
	}

	async fundDemoWallet(mintUrl: string, amount: number): Promise<CocoAuctionFundingResult> {
		const manager = this.#requireManager()
		if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Demo funding amount must be a positive integer')
		await manager.mint.addMint(mintUrl, { trusted: true })
		let quote = await manager.quotes.mint.create({ mintUrl, method: 'bolt11', amount, unit: 'sat', locked: true })
		const quoteIdentity = { mintUrl, quoteId: quote.quoteId }
		for (let attempt = 0; quote.state !== 'PAID' && quote.state !== 'ISSUED' && attempt < 40; attempt += 1) {
			await sleep(100)
			quote = await manager.quotes.mint.refresh(quoteIdentity)
		}
		if (quote.state !== 'PAID' && quote.state !== 'ISSUED') {
			throw new Error(
				`Coco demo funding quote timed out (quoteId ${quote.quoteId}; mintQuoteState ${quote.state}; operationState not-created)`,
			)
		}
		const quotePaymentState = quote.state
		const prepared = await manager.ops.mint.prepare({ quote, amount })
		let operation = await manager.ops.mint.execute(prepared.id)
		for (let attempt = 0; operation.state !== 'finalized' && operation.state !== 'failed' && attempt < 80; attempt += 1) {
			await sleep(100)
			operation = await manager.ops.mint.refresh(operation.id)
		}
		if (operation.state !== 'finalized') {
			const detail = operation.terminalFailure?.reason ?? operation.error ?? 'no failure detail'
			const lastQuote = await manager.quotes.mint.get(quoteIdentity)
			throw new Error(
				`Coco demo funding did not finalize (quoteId ${quote.quoteId}; operationState ${operation.state}; mintQuoteState ${lastQuote?.state ?? 'missing'}; lastSafeState ${detail})`,
			)
		}
		const finalQuote = await manager.quotes.mint.refresh(quoteIdentity)
		return {
			operationId: operation.id,
			state: operation.state,
			amount,
			quoteId: quote.quoteId,
			quotePaymentState,
			finalQuoteState: finalQuote.state,
			lastObservedSafeState: `quote:${finalQuote.state};operation:${operation.state}`,
		}
	}

	async createAuctionAuthority(): Promise<CocoAuctionAuthority> {
		const account = this.#auctionAccount()
		if (!account.publicExtendedKey) throw new Error('Coco Auction authority could not derive a public extended key')
		return { publicExtendedKey: account.publicExtendedKey }
	}

	async createRefundAuthority(): Promise<CocoAuctionRefundAuthority> {
		const { publicKeyHex } = await this.#requireManager().keyring.generateKeyPair(false)
		return { publicKey: canonicalCompressedKey(publicKeyHex, 'Coco refund key') }
	}

	async prepareAuctionBid(intent: CocoAuctionBidIntent): Promise<string> {
		this.#assertIntent(intent)
		await recordActualPrepareCall(intent.accountId, intent.bidderLegId)
		const manager = this.#requireManager()
		await manager.mint.addMint(intent.mintUrl, { trusted: true })
		const prepared = await manager.ops.send.prepare({
			mintUrl: intent.mintUrl,
			amount: intent.amount,
			unit: 'sat',
			target: {
				type: 'p2pk',
				options: {
					pubkey: intent.recipientPublicKey,
					locktime: intent.locktime,
					refundKeys: [intent.refundPublicKey],
					requiredSignatures: 1,
					requiredRefundSignatures: 1,
					sigFlag: 'SIG_INPUTS',
				},
			},
		})
		if (!operationMatchesIntent(prepared, intent))
			throw new Error('Prepared Coco operation does not exactly match persisted Auction intent')
		return prepared.id
	}

	async reconcilePreparedAuctionBid(intent: CocoAuctionBidIntent): Promise<string | null> {
		this.#assertIntent(intent)
		const manager = this.#requireManager()
		const operations = [...(await manager.ops.send.listPrepared()), ...(await manager.ops.send.listInFlight())]
		const unique = [...new Map(operations.map((operation) => [operation.id, operation])).values()]
		const match = selectUniquePreparedOperation(unique, intent)
		return match?.id ?? null
	}

	async executeAuctionBid(intent: CocoAuctionBidIntent, operationId: string): Promise<CocoAuctionBidCommitments> {
		this.#assertIntent(intent)
		const operation = await requireSendOperation(this.#requireManager(), operationId)
		if (!operationMatchesIntent(operation, intent)) throw new Error('Bound Coco operation does not exactly match Auction intent')
		if (operation.state === 'prepared') await this.#requireManager().ops.send.execute(operationId)
		return this.inspectAuctionBid(intent, operationId)
	}

	async inspectAuctionBid(intent: CocoAuctionBidIntent, operationId: string): Promise<CocoAuctionBidCommitments> {
		this.#assertIntent(intent)
		const operation = await requireSendOperation(this.#requireManager(), operationId)
		if (!operationMatchesIntent(operation, intent)) throw new Error('Coco operation immutable target no longer matches Auction intent')
		const condition = projectSendOperationCondition(operation)
		if (!condition) throw new Error('Coco operation has no supported P2PK condition')
		if ((operation.state !== 'pending' && operation.state !== 'finalized') || !operation.token) {
			throw new Error(`Coco operation ${operationId} has no locked token (state ${operation.state})`)
		}
		const lockSecrets = operation.token.proofs.map((proof) => proof.secret)
		if (!lockSecrets.length) throw new Error('Coco P2PK Send returned no locked proofs')
		return {
			operationId,
			mintUrl: condition.mintUrl,
			unit: condition.unit as 'sat',
			amount: condition.amount,
			locktime: condition.locktime,
			recipientPublicKey: condition.recipientPublicKeys[0],
			refundPublicKey: condition.refundPublicKeys[0],
			conditionFingerprint: fingerprintAuctionP2pkCondition(condition),
			lockSecrets: Object.freeze(lockSecrets),
			proofYs: Object.freeze(lockSecrets.map(hashToCurveHexFromString)),
		}
	}

	async resumeAuctionBid(operationId: string): Promise<CocoAuctionOperationState> {
		const manager = this.#requireManager()
		let operation = await requireSendOperation(manager, operationId)
		if (operation.state === 'prepared') operation = (await manager.ops.send.execute(operation.id)).operation
		if (operation.state === 'executing' || operation.state === 'rolling_back') {
			await manager.ops.send.recovery.run()
			operation = await requireSendOperation(manager, operationId)
		}
		return operation.state
	}

	async releaseWinningBid(operationId: string): Promise<CocoAuctionWinnerRelease> {
		const operation = await requireSendOperation(this.#requireManager(), operationId)
		if ((operation.state !== 'pending' && operation.state !== 'finalized') || !operation.token) {
			throw new Error(`Winning Coco Send operation is not releasable (state ${operation.state})`)
		}
		return { operationId, token: getEncodedToken(operation.token) }
	}

	async inspectWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
	}): Promise<CocoAuctionReceiveDescriptor> {
		await this.#installSellerReceiveAuthority(input)
		const descriptor = await receiveDescriptorFromToken(this.#requireManager(), input.token, input.mintUrl)
		if (descriptor.mintUrl !== normalizeMintUrl(input.mintUrl)) throw new Error('Winning token mint does not match the Auction')
		return descriptor
	}

	async reconcileWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
		tokenFingerprint: string
	}): Promise<CocoAuctionReceiveDiagnostic | null> {
		const descriptor = await this.inspectWinningReceive(input)
		if (descriptor.tokenFingerprint !== input.tokenFingerprint) throw new Error('Winning token commitment changed during recovery')
		const operations = await listReceiveOperations(this.#requireManager())
		const matches = operations.map(receiveDiagnostic).filter((operation) => operation.tokenFingerprint === input.tokenFingerprint)
		if (matches.length > 1) throw new Error('More than one exact Coco Receive operation matches the seller Receive intent')
		return matches[0] ?? null
	}

	async prepareWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
		tokenFingerprint: string
	}): Promise<CocoAuctionReceiveDiagnostic> {
		const descriptor = await this.inspectWinningReceive(input)
		if (descriptor.tokenFingerprint !== input.tokenFingerprint) throw new Error('Winning token commitment changed before Receive prepare')
		await updateReceiveEffectCounts(this.accountId, 'originated')
		const prepared = await this.#requireManager().ops.receive.prepare({ token: input.token })
		const diagnostic = receiveDiagnostic(prepared)
		if (diagnostic.tokenFingerprint !== input.tokenFingerprint) throw new Error('Prepared Receive does not match durable seller intent')
		return diagnostic
	}

	async resumeWinningReceive(operationId: string, tokenFingerprint: string): Promise<CocoAuctionReceiveDiagnostic> {
		const manager = this.#requireManager()
		let operation = await manager.ops.receive.get(operationId)
		if (!operation) throw new Error(`Coco Receive operation ${operationId} was not found`)
		if (receiveDiagnostic(operation).tokenFingerprint !== tokenFingerprint) {
			throw new Error('Bound Coco Receive operation no longer matches the durable seller intent')
		}
		if (operation.state === 'prepared') {
			await updateReceiveEffectCounts(this.accountId, 'remoteEffects')
			operation = await manager.ops.receive.execute(operation.id)
		} else if (operation.state === 'executing') {
			operation = await manager.ops.receive.refresh(operation.id)
		}
		if (operation.state !== 'finalized') throw new Error(`Seller Coco Receive did not finalize (state ${operation.state})`)
		return receiveDiagnostic(operation)
	}

	async listReceiveDiagnostics(): Promise<readonly CocoAuctionReceiveDiagnostic[]> {
		return Object.freeze((await listReceiveOperations(this.#requireManager())).map(receiveDiagnostic))
	}

	async readReceiveEffectCounts(): Promise<ReceiveEffectCounts> {
		return readReceiveEffectCounts(this.accountId)
	}

	async #installSellerReceiveAuthority(input: {
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
	}): Promise<void> {
		const manager = this.#requireManager()
		const account = this.#auctionAccount()
		if (!account.publicExtendedKey) throw new Error('Seller Auction authority is missing its public extended key')
		const publicChild = deriveAuctionChildP2pkPubkeyFromXpub(account.publicExtendedKey, input.derivationPath)
		if (publicChild.toLowerCase() !== canonicalCompressedKey(input.expectedRecipientPublicKey, 'Expected seller recipient key')) {
			throw new Error('Released seller path does not derive the winning bid recipient key')
		}
		const child = account.derive(normalizeAuctionDerivationPath(input.derivationPath))
		if (!child.privateKey || !child.publicKey) throw new Error('Seller Auction child authority derivation failed')
		const publicKey = bytesToHex(child.publicKey)
		if (publicKey.toLowerCase() !== publicChild.toLowerCase())
			throw new Error('Seller private derivation disagrees with verified public path')
		await manager.mint.addMint(input.mintUrl, { trusted: true })
		if (!(await manager.keyring.getKeyPair(publicKey))) await manager.keyring.addKeyPair(child.privateKey)
	}

	async refundLosingBid(operationId: string): Promise<CocoAuctionOperationState> {
		return (await this.#requireManager().ops.send.reclaim(operationId, { spendingPath: 'refund' })).state
	}

	async getOperationState(operationId: string): Promise<CocoAuctionOperationState> {
		const manager = this.#requireManager()
		let operation = await requireSendOperation(manager, operationId)
		if (operation.state === 'pending') operation = await manager.ops.send.refresh(operationId)
		return operation.state
	}

	async getSendFee(operationId: string): Promise<number> {
		const operation = await requireSendOperation(this.#requireManager(), operationId)
		if (operation.state === 'init') throw new Error('Coco Send fee is unavailable before prepare')
		return operation.fee.toNumber()
	}

	async listSendDiagnostics(): Promise<readonly CocoAuctionSendDiagnostic[]> {
		const manager = this.#requireManager()
		const operations = [...(await manager.ops.send.listPrepared()), ...(await manager.ops.send.listInFlight())]
		return Object.freeze(
			[...new Map(operations.map((operation) => [operation.id, operation])).values()].map((operation) => {
				let conditionFingerprint: string | null = null
				try {
					const condition = projectSendOperationCondition(operation)
					conditionFingerprint = condition ? fingerprintAuctionP2pkCondition(condition) : null
				} catch {
					conditionFingerprint = null
				}
				return Object.freeze({
					operationId: operation.id,
					state: operation.state,
					method: operation.method,
					mintUrl: operation.mintUrl,
					unit: operation.unit,
					amount: operation.amount.toNumber(),
					conditionFingerprint,
					fee: operation.state === 'init' ? null : operation.fee.toNumber(),
				})
			}),
		)
	}

	async getBalance(mintUrl: string): Promise<CocoAuctionBalance> {
		const balance = await this.#requireManager().wallet.balances.total({ mintUrls: [mintUrl], units: ['sat'] })
		return { spendable: balance.spendable.toNumber(), reserved: balance.reserved.toNumber(), total: balance.total.toNumber() }
	}

	#assertIntent(intent: CocoAuctionBidIntent): void {
		if (intent.accountId !== this.accountId) throw new Error('Auction intent does not belong to this Coco account')
		if (!intent.runId || !intent.bidderLegId.startsWith(`${intent.runId}:`)) throw new Error('Auction intent run identity is invalid')
		if (intent.unit !== 'sat') throw new Error('Auction intent unit must be sat')
		if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0) throw new Error('Auction lock amount must be a positive integer')
		canonicalCompressedKey(intent.recipientPublicKey, 'Auction recipient key')
		canonicalCompressedKey(intent.refundPublicKey, 'Auction refund key')
		if (buildAuctionConditionFingerprint(intent) !== intent.conditionFingerprint)
			throw new Error('Auction intent condition fingerprint mismatch')
	}

	#requireManager(): Manager {
		if (!this.#manager) throw new Error('Coco Auction wallet is not booted')
		return this.#manager
	}

	#auctionAccount(): HDKey {
		if (!this.#seed) throw new Error('Coco Auction wallet is not booted')
		return HDKey.fromMasterSeed(this.#seed).derive(AUCTION_HD_ACCOUNT_PATH)
	}
}
