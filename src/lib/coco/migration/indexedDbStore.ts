import { captureObject, CocoHostError, fail } from '../errors'
import {
	buildCocoWalletNamespace,
	normalizeNostrPubkey,
	parseCocoEnvironment,
	parseCocoWalletNamespace,
	type CocoG9aEnvironment,
} from '../namespace'
import type { AuthorityStatus, MonetaryPermissionProjection } from './authority'
import type { DomainCreationResult, MigrationCoordinatorStore, MigrationItemRecord } from './coordinator'
import {
	canonicalizeMintUrl,
	createMonetaryBucketIdentity,
	decodeMonetaryBucketKey,
	monetaryBucketKey,
	normalizeUnit,
	parseMigrationItemState,
	parseMigrationPhase,
	parseQuarantineReason,
	requireSafeId,
	type MigrationItemState,
	type MigrationPhase,
	type MonetaryBucketIdentity,
	type MonetaryBucketKey,
	type MonetaryOwner,
	type Nip60Policy,
} from './types'

export const PLEBEIAN_MIGRATION_CONTROL_DB_PREFIX = 'plebeian-market:coco:migration-control:v1'
export const PLEBEIAN_MIGRATION_CONTROL_DB_VERSION = 1

const AUTHORITY_STORE = 'authority'
const MIGRATION_ITEM_STORE = 'migrationItems'
const SAFE_TEST_INSTANCE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

type AuthorityRecord = AuthorityStatus

export interface IndexedDbMigrationCoordinatorStoreConfig {
	walletIdentity: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	testInstanceId?: string
	indexedDB?: IDBFactory
}

export interface MigrationDispatchFenceSnapshot {
	authority: Readonly<AuthorityStatus>
	item: Readonly<MigrationItemRecord>
	bucket: Readonly<MonetaryBucketIdentity>
	workflow: 'legacy-ready-to-coco-receive'
}

export interface MigrationDispatchFenceStore extends MigrationCoordinatorStore {
	revalidateDispatchFence(command: unknown): Promise<Readonly<MigrationDispatchFenceSnapshot>>
}

function requireEpoch(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
		fail('WRONG_EPOCH', 'Migration epoch must be a non-empty sanitized identifier')
	}
	return value
}

function requireRevision(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) fail('STALE_REVISION', 'Revision must be a non-negative safe integer')
	return value as number
}

function requireDispatchWorkflow(value: unknown): 'legacy-ready-to-coco-receive' {
	if (value !== 'legacy-ready-to-coco-receive') fail('INVALID_TRANSITION', 'Migration dispatch workflow is invalid')
	return value
}

function nextAuthorityPhase(current: MigrationPhase): MigrationPhase | null {
	switch (current) {
		case 'legacy-active':
			return 'migration-snapshot-frozen'
		case 'migration-snapshot-frozen':
			return 'importing'
		case 'importing':
			return 'verifying'
		case 'verifying':
			return 'coco-ready'
		case 'coco-ready':
			return 'cutover-committed'
		case 'cutover-committed':
			return null
	}
}

function assertLegalAuthorityAdvance(current: MigrationPhase, requested: unknown): MigrationPhase {
	const next = parseMigrationPhase(requested)
	if (nextAuthorityPhase(current) !== next) fail('INVALID_TRANSITION', `Cannot transition authority from ${current} to ${next}`)
	return next
}

function parseItemAction(value: unknown): 'prepare' | 'begin-execution' | 'verify' {
	const captured = captureObject(value, ['type'], 'INVALID_QUARANTINE_TRANSITION', 'Migration item action')
	switch (captured.type) {
		case 'prepare':
		case 'begin-execution':
		case 'verify':
			return captured.type
		default:
			fail('INVALID_QUARANTINE_TRANSITION', 'Migration item action is invalid')
	}
}

function ownerForBucket(phase: MigrationPhase, bucket: MonetaryBucketIdentity, retainedRecovery: boolean): MonetaryOwner {
	switch (bucket.kind) {
		case 'unresolved':
			return 'quarantined'
		case 'legacy-inflight':
		case 'pending-outbound':
		case 'auction-p2pk-recovery':
			return retainedRecovery ? 'legacy-recovery-only' : 'quarantined'
		case 'coco-ordinary':
			return phase === 'cutover-committed' ? 'coco-canonical' : 'coco-shadow'
		case 'legacy-ready':
			switch (phase) {
				case 'legacy-active':
					return 'legacy-ordinary'
				case 'migration-snapshot-frozen':
					return 'migration-coordinator'
				case 'importing':
				case 'verifying':
				case 'coco-ready':
					return 'coco-migration'
				case 'cutover-committed':
					return 'coco-canonical'
			}
	}
}

function policyForCurrentAuthority(phase: MigrationPhase): Nip60Policy {
	return phase === 'cutover-committed' ? 'keep-interop' : 'keep-runtime'
}

function projectCapabilitiesForOwner(owner: MonetaryOwner): MonetaryPermissionProjection['capabilities'] {
	return Object.freeze({
		legacyOrdinary: owner === 'legacy-ordinary',
		legacyRecovery: owner === 'legacy-recovery-only',
		cocoMigration: owner === 'coco-migration',
		cocoOrdinary: owner === 'coco-canonical',
		shadowDiagnostics: owner === 'coco-shadow',
	})
}

function authorityProjection(record: AuthorityRecord): Readonly<AuthorityStatus> {
	return Object.freeze({
		walletKey: record.walletKey,
		user: record.user,
		environment: record.environment,
		migrationEpoch: record.migrationEpoch,
		revision: record.revision,
		phase: record.phase,
	})
}

function itemProjection(record: MigrationItemRecord): Readonly<MigrationItemRecord> {
	return Object.freeze({
		id: record.id,
		walletKey: record.walletKey,
		user: record.user,
		environment: record.environment,
		migrationEpoch: record.migrationEpoch,
		sourceBucketKey: record.sourceBucketKey,
		mint: record.mint,
		unit: record.unit,
		state: record.state,
		revision: record.revision,
		...(record.cocoOperationId ? { cocoOperationId: record.cocoOperationId } : {}),
		...(record.quarantineReason ? { quarantineReason: record.quarantineReason } : {}),
	})
}

function storedAuthority(value: unknown): AuthorityRecord {
	try {
		const captured = captureObject(
			value,
			['walletKey', 'user', 'environment', 'migrationEpoch', 'revision', 'phase'],
			'COORDINATOR_STORAGE_FAILURE',
			'Migration authority record',
		)
		const wallet = parseCocoWalletNamespace(captured.walletKey)
		const user = normalizeNostrPubkey(captured.user)
		const environment = parseCocoEnvironment(captured.environment)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const revision = requireRevision(captured.revision)
		const phase = parseMigrationPhase(captured.phase)
		if (wallet.pubkey !== user || wallet.environment !== environment) {
			fail('COORDINATOR_STORAGE_FAILURE', 'Migration authority identity is inconsistent')
		}
		return { walletKey: wallet.namespace, user, environment, migrationEpoch, revision, phase }
	} catch (error) {
		if (error instanceof CocoHostError && error.code === 'COORDINATOR_STORAGE_FAILURE') throw error
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration authority record is invalid')
	}
}

function storedItem(value: unknown): MigrationItemRecord {
	try {
		const captured = captureObject(
			value,
			[
				'id',
				'walletKey',
				'user',
				'environment',
				'migrationEpoch',
				'sourceBucketKey',
				'mint',
				'unit',
				'state',
				'cocoOperationId',
				'revision',
				'quarantineReason',
			],
			'COORDINATOR_STORAGE_FAILURE',
			'Migration item record',
		)
		const id = requireSafeId(captured.id, 'migration item id')
		const wallet = parseCocoWalletNamespace(captured.walletKey)
		const user = normalizeNostrPubkey(captured.user)
		const environment = parseCocoEnvironment(captured.environment)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		if (typeof captured.sourceBucketKey !== 'string') fail('COORDINATOR_STORAGE_FAILURE', 'Migration item bucket key is invalid')
		const bucket = decodeMonetaryBucketKey(captured.sourceBucketKey)
		const sourceBucketKey = monetaryBucketKey(bucket)
		const mint = canonicalizeMintUrl(captured.mint)
		const unit = normalizeUnit(captured.unit)
		const state = parseMigrationItemState(captured.state)
		const revision = requireRevision(captured.revision)
		const cocoOperationId = captured.cocoOperationId === undefined ? undefined : requireSafeId(captured.cocoOperationId, 'operationId')
		const quarantineReason = captured.quarantineReason === undefined ? undefined : parseQuarantineReason(captured.quarantineReason)
		if (
			wallet.pubkey !== user ||
			wallet.environment !== environment ||
			bucket.user !== user ||
			bucket.mint !== mint ||
			bucket.unit !== unit ||
			(state === 'quarantined') !== Boolean(quarantineReason)
		) {
			fail('COORDINATOR_STORAGE_FAILURE', 'Migration item identity is inconsistent')
		}
		return {
			id,
			walletKey: wallet.namespace,
			user,
			environment,
			migrationEpoch,
			sourceBucketKey,
			mint,
			unit,
			state,
			revision,
			...(cocoOperationId ? { cocoOperationId } : {}),
			...(quarantineReason ? { quarantineReason } : {}),
		}
	} catch (error) {
		if (error instanceof CocoHostError && error.code === 'COORDINATOR_STORAGE_FAILURE') throw error
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration item record is invalid')
	}
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onabort = () => reject(transaction.error)
		transaction.onerror = () => reject(transaction.error)
	})
}

function storageFailure(): never {
	fail('COORDINATOR_STORAGE_FAILURE', 'Migration authority storage operation failed')
}

function buildDatabaseName(walletKey: string, testInstanceId?: string): string {
	return `${PLEBEIAN_MIGRATION_CONTROL_DB_PREFIX}:${walletKey}${testInstanceId ? `:test:${testInstanceId}` : ''}`
}

export class IndexedDbMigrationCoordinatorStore implements MigrationDispatchFenceStore {
	readonly atomicity = 'linearizable-domain-transition-v1' as const
	readonly databaseName: string
	readonly #walletKey: string
	readonly #user: string
	readonly #environment: CocoG9aEnvironment
	readonly #migrationEpoch: string
	readonly #indexedDB: IDBFactory
	#database: Promise<IDBDatabase> | undefined

	constructor(config: IndexedDbMigrationCoordinatorStoreConfig) {
		const captured = captureObject(
			config,
			['walletIdentity', 'environment', 'migrationEpoch', 'testInstanceId', 'indexedDB'],
			'INVALID_NAMESPACE_IDENTITY',
			'IndexedDB migration store configuration',
		)
		this.#user = normalizeNostrPubkey(captured.walletIdentity)
		this.#environment = parseCocoEnvironment(captured.environment)
		this.#migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#walletKey = buildCocoWalletNamespace({ environment: this.#environment, pubkey: this.#user })
		const testInstanceId = captured.testInstanceId
		if (
			testInstanceId !== undefined &&
			(this.#environment !== 'test' || typeof testInstanceId !== 'string' || !SAFE_TEST_INSTANCE.test(testInstanceId))
		) {
			fail('INVALID_NAMESPACE_IDENTITY', 'IndexedDB test instance identity is invalid')
		}
		this.databaseName = buildDatabaseName(this.#walletKey, testInstanceId as string | undefined)
		const factory = captured.indexedDB ?? globalThis.indexedDB
		if (!factory || typeof (factory as IDBFactory).open !== 'function') storageFailure()
		this.#indexedDB = factory as IDBFactory
	}

	async close(): Promise<void> {
		const pending = this.#database
		this.#database = undefined
		if (pending) (await pending).close()
	}

	async #open(): Promise<IDBDatabase> {
		if (!this.#database) {
			let rejected = false
			const opening = new Promise<IDBDatabase>((resolve, reject) => {
				const rejectOpen = (message: string): void => {
					rejected = true
					reject(new CocoHostError('COORDINATOR_STORAGE_FAILURE', message))
				}
				let request: IDBOpenDBRequest
				try {
					request = this.#indexedDB.open(this.databaseName, PLEBEIAN_MIGRATION_CONTROL_DB_VERSION)
				} catch {
					rejectOpen('Migration authority database could not be opened')
					return
				}
				request.onupgradeneeded = () => {
					const database = request.result
					if (!database.objectStoreNames.contains(AUTHORITY_STORE)) {
						database.createObjectStore(AUTHORITY_STORE, { keyPath: 'walletKey' })
					}
					if (!database.objectStoreNames.contains(MIGRATION_ITEM_STORE)) {
						database.createObjectStore(MIGRATION_ITEM_STORE, { keyPath: ['walletKey', 'id'] })
					}
				}
				request.onsuccess = () => {
					const database = request.result
					if (rejected) {
						database.close()
						return
					}
					database.onversionchange = () => {
						database.close()
						if (this.#database === opening) this.#database = undefined
					}
					resolve(database)
				}
				request.onerror = () => rejectOpen('Migration authority database could not be opened')
				request.onblocked = () => rejectOpen('Migration authority database upgrade was blocked')
			})
			this.#database = opening
			opening.catch(() => {
				if (this.#database === opening) this.#database = undefined
			})
		}
		return this.#database
	}

	async #run<T>(stores: readonly string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
		try {
			const database = await this.#open()
			const transaction = database.transaction(stores, mode)
			const complete = transactionComplete(transaction)
			try {
				const result = await work(transaction)
				await complete
				return result
			} catch (error) {
				try {
					transaction.abort()
				} catch {
					// The transaction may already have failed or completed.
				}
				await complete.catch(() => undefined)
				throw error
			}
		} catch (error) {
			if (error instanceof CocoHostError) throw error
			storageFailure()
		}
	}

	#authorityStore(transaction: IDBTransaction): IDBObjectStore {
		return transaction.objectStore(AUTHORITY_STORE)
	}

	#itemStore(transaction: IDBTransaction): IDBObjectStore {
		return transaction.objectStore(MIGRATION_ITEM_STORE)
	}

	#requireBoundIdentity(walletKey: string, migrationEpoch: string): void {
		if (walletKey !== this.#walletKey) fail('BUCKET_OWNERSHIP_MISMATCH', 'Wallet identity does not match this migration database')
		if (migrationEpoch !== this.#migrationEpoch) fail('WRONG_EPOCH', 'Migration command belongs to another epoch')
	}

	async #loadAuthority(transaction: IDBTransaction, migrationEpoch: string): Promise<AuthorityRecord> {
		this.#requireBoundIdentity(this.#walletKey, migrationEpoch)
		const value = await requestResult(this.#authorityStore(transaction).get(this.#walletKey))
		if (value === undefined) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration authority record was not found')
		const authority = storedAuthority(value)
		this.#requireBoundIdentity(authority.walletKey, migrationEpoch)
		if (authority.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Migration authority belongs to another epoch')
		return authority
	}

	async #loadItem(transaction: IDBTransaction, migrationEpoch: string, itemId: string): Promise<MigrationItemRecord> {
		await this.#loadAuthority(transaction, migrationEpoch)
		const value = await requestResult(this.#itemStore(transaction).get([this.#walletKey, itemId]))
		if (value === undefined) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration item was not found')
		const item = storedItem(value)
		this.#requireBoundIdentity(item.walletKey, migrationEpoch)
		if (item.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Migration item belongs to another epoch')
		return item
	}

	#captureAuthorityQuery(input: unknown): { walletKey: string; migrationEpoch: string } {
		const captured = captureObject(input, ['walletKey', 'migrationEpoch'], 'INVALID_TRANSITION', 'Authority query')
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return { walletKey, migrationEpoch }
	}

	#captureVersionedCommand(input: unknown, extraFields: readonly string[] = []): Readonly<Record<string, unknown>> {
		return captureObject(
			input,
			['walletKey', 'migrationEpoch', 'expectedRevision', ...extraFields],
			'INVALID_TRANSITION',
			'Coordinator command',
		)
	}

	async loadAuthority(query: unknown): Promise<Readonly<AuthorityStatus>> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE], 'readonly', async (transaction) =>
			authorityProjection(await this.#loadAuthority(transaction, migrationEpoch)),
		)
	}

	async createInitialAuthority(command: unknown): Promise<DomainCreationResult<AuthorityStatus>> {
		const captured = captureObject(
			command,
			['walletIdentity', 'environment', 'migrationEpoch'],
			'INVALID_TRANSITION',
			'Initial authority command',
		)
		const user = normalizeNostrPubkey(captured.walletIdentity)
		const environment = parseCocoEnvironment(captured.environment)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const walletKey = buildCocoWalletNamespace({ environment, pubkey: user })
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE], 'readwrite', async (transaction) => {
			const store = this.#authorityStore(transaction)
			const existingValue = await requestResult(store.get(walletKey))
			if (existingValue !== undefined) {
				const existing = storedAuthority(existingValue)
				if (existing.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Wallet authority already exists for another epoch')
				return Object.freeze({ created: false, value: authorityProjection(existing) })
			}
			const record: AuthorityRecord = { walletKey, user, environment, migrationEpoch, revision: 0, phase: 'legacy-active' }
			await requestResult(store.add(record))
			return Object.freeze({ created: true, value: authorityProjection(record) })
		})
	}

	async advanceAuthorityPhase(command: unknown): Promise<Readonly<AuthorityStatus>> {
		const captured = this.#captureVersionedCommand(command, ['nextPhase'])
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE], 'readwrite', async (transaction) => {
			const current = await this.#loadAuthority(transaction, migrationEpoch)
			const expectedRevision = requireRevision(captured.expectedRevision)
			if (current.revision !== expectedRevision) fail('STALE_REVISION', 'Observed authority revision is not current')
			const next: AuthorityRecord = {
				...current,
				phase: assertLegalAuthorityAdvance(current.phase, captured.nextPhase),
				revision: current.revision + 1,
			}
			await requestResult(this.#authorityStore(transaction).put(next))
			return authorityProjection(next)
		})
	}

	async permissionsFor(query: unknown): Promise<Readonly<MonetaryPermissionProjection>> {
		const captured = captureObject(query, ['walletKey', 'migrationEpoch', 'bucketKey'], 'BUCKET_OWNERSHIP_MISMATCH', 'Permission query')
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readonly', async (transaction) => {
			const authority = await this.#loadAuthority(transaction, migrationEpoch)
			const bucketKey = monetaryBucketKey(decodeMonetaryBucketKey(captured.bucketKey))
			const bucket = decodeMonetaryBucketKey(bucketKey)
			if (bucket.user !== authority.user) fail('BUCKET_OWNERSHIP_MISMATCH', 'Bucket user does not match wallet authority')
			const values = await requestResult(this.#itemStore(transaction).getAll())
			const retainedRecovery = values
				.map(storedItem)
				.some(
					(item) =>
						item.migrationEpoch === migrationEpoch &&
						item.sourceBucketKey === bucketKey &&
						item.state !== 'verified' &&
						item.state !== 'quarantined',
				)
			const owner = ownerForBucket(authority.phase, bucket, retainedRecovery)
			return Object.freeze({
				...authorityProjection(authority),
				bucketKey,
				owner,
				capabilities: projectCapabilitiesForOwner(owner),
			})
		})
	}

	async nip60Policy(query: unknown): Promise<Nip60Policy> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE], 'readonly', async (transaction) =>
			policyForCurrentAuthority((await this.#loadAuthority(transaction, migrationEpoch)).phase),
		)
	}

	async loadMigrationItem(query: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = captureObject(
			query,
			['walletKey', 'migrationEpoch', 'itemId'],
			'INVALID_QUARANTINE_TRANSITION',
			'Migration item query',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readonly', async (transaction) =>
			itemProjection(await this.#loadItem(transaction, migrationEpoch, itemId)),
		)
	}

	async listMigrationItems(query: unknown): Promise<readonly Readonly<MigrationItemRecord>[]> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readonly', async (transaction) => {
			await this.#loadAuthority(transaction, migrationEpoch)
			const values = await requestResult(this.#itemStore(transaction).getAll())
			return Object.freeze(
				values
					.map(storedItem)
					.filter((item) => item.walletKey === this.#walletKey && item.migrationEpoch === migrationEpoch)
					.map(itemProjection)
					.sort((left, right) => left.id.localeCompare(right.id)),
			)
		})
	}

	async createPlannedMigrationItem(command: unknown): Promise<DomainCreationResult<MigrationItemRecord>> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'itemId', 'sourceBucket'],
			'INVALID_QUARANTINE_TRANSITION',
			'Create migration item command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readwrite', async (transaction) => {
			const authority = await this.#loadAuthority(transaction, migrationEpoch)
			if (authority.phase === 'cutover-committed') {
				fail('INVALID_QUARANTINE_TRANSITION', 'New migration items cannot be created after cutover')
			}
			const id = requireSafeId(captured.itemId, 'migration item id')
			const sourceBucket = createMonetaryBucketIdentity(captured.sourceBucket)
			if (sourceBucket.user !== authority.user) fail('BUCKET_OWNERSHIP_MISMATCH', 'Migration source belongs to another wallet')
			if (sourceBucket.kind === 'coco-ordinary')
				fail('INVALID_QUARANTINE_TRANSITION', 'Coco ordinary value is not a legacy migration source')
			const sourceBucketKey = monetaryBucketKey(sourceBucket)
			const store = this.#itemStore(transaction)
			const existingValue = await requestResult(store.get([walletKey, id]))
			if (existingValue !== undefined) {
				const existing = storedItem(existingValue)
				if (existing.migrationEpoch === migrationEpoch && existing.sourceBucketKey === sourceBucketKey) {
					return Object.freeze({ created: false, value: itemProjection(existing) })
				}
				fail('COORDINATOR_RECORD_EXISTS', 'Migration item identity already exists with different binding')
			}
			const record: MigrationItemRecord = {
				id,
				walletKey,
				user: authority.user,
				environment: authority.environment,
				migrationEpoch,
				sourceBucketKey,
				mint: canonicalizeMintUrl(sourceBucket.mint),
				unit: normalizeUnit(sourceBucket.unit),
				state: 'planned',
				revision: 0,
			}
			await requestResult(store.add(record))
			return Object.freeze({ created: true, value: itemProjection(record) })
		})
	}

	async bindCocoOperationOnce(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = this.#captureVersionedCommand(command, ['itemId', 'operationId'])
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readwrite', async (transaction) => {
			const item = await this.#loadItem(transaction, migrationEpoch, itemId)
			const expectedRevision = requireRevision(captured.expectedRevision)
			if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
			if (item.state !== 'planned' && item.state !== 'prepared')
				fail('INVALID_QUARANTINE_TRANSITION', 'Operation cannot bind in this state')
			if (item.cocoOperationId) fail('INVALID_QUARANTINE_TRANSITION', 'Coco operation identity is already bound')
			const operationId = requireSafeId(captured.operationId, 'operationId')
			const next = { ...item, cocoOperationId: operationId, revision: item.revision + 1 }
			await requestResult(this.#itemStore(transaction).put(next))
			return itemProjection(next)
		})
	}

	async advanceMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = this.#captureVersionedCommand(command, ['itemId', 'action'])
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readwrite', async (transaction) => {
			const item = await this.#loadItem(transaction, migrationEpoch, itemId)
			const expectedRevision = requireRevision(captured.expectedRevision)
			if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
			const action = parseItemAction(captured.action)
			let nextState: MigrationItemState
			if (item.state === 'planned' && action === 'prepare') nextState = 'prepared'
			else if (item.state === 'prepared' && action === 'begin-execution' && item.cocoOperationId) nextState = 'executing'
			else if (item.state === 'executing' && action === 'verify') nextState = 'verified'
			else fail('INVALID_QUARANTINE_TRANSITION', `Action ${action} is invalid from ${parseMigrationItemState(item.state)}`)
			const next = { ...item, state: nextState, revision: item.revision + 1 }
			await requestResult(this.#itemStore(transaction).put(next))
			return itemProjection(next)
		})
	}

	async quarantineMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = this.#captureVersionedCommand(command, ['itemId', 'reason'])
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readwrite', async (transaction) => {
			const item = await this.#loadItem(transaction, migrationEpoch, itemId)
			const expectedRevision = requireRevision(captured.expectedRevision)
			if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
			if (item.state === 'verified' || item.state === 'quarantined') {
				fail('INVALID_QUARANTINE_TRANSITION', 'Terminal migration item cannot be quarantined or reopened')
			}
			const reason = parseQuarantineReason(captured.reason)
			const next: MigrationItemRecord = {
				...item,
				state: 'quarantined',
				quarantineReason: reason,
				revision: item.revision + 1,
			}
			await requestResult(this.#itemStore(transaction).put(next))
			return itemProjection(next)
		})
	}

	async revalidateDispatchFence(command: unknown): Promise<Readonly<MigrationDispatchFenceSnapshot>> {
		const captured = captureObject(
			command,
			[
				'walletKey',
				'migrationEpoch',
				'expectedAuthorityRevision',
				'expectedEnvironment',
				'expectedPhase',
				'workflow',
				'bucketKey',
				'itemId',
				'expectedItemRevision',
				'expectedItemState',
				'expectedCocoOperationId',
			],
			'INVALID_TRANSITION',
			'Dispatch fence command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const expectedAuthorityRevision = requireRevision(captured.expectedAuthorityRevision)
		const expectedEnvironment = parseCocoEnvironment(captured.expectedEnvironment)
		const expectedPhase = parseMigrationPhase(captured.expectedPhase)
		const workflow = requireDispatchWorkflow(captured.workflow)
		const bucketKey = monetaryBucketKey(decodeMonetaryBucketKey(captured.bucketKey))
		const itemId = requireSafeId(captured.itemId, 'itemId')
		const expectedItemRevision = requireRevision(captured.expectedItemRevision)
		const expectedItemState = parseMigrationItemState(captured.expectedItemState)
		const expectedCocoOperationId = requireSafeId(captured.expectedCocoOperationId, 'operationId')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE], 'readonly', async (transaction) => {
			const authority = await this.#loadAuthority(transaction, migrationEpoch)
			const item = await this.#loadItem(transaction, migrationEpoch, itemId)
			const bucket = decodeMonetaryBucketKey(bucketKey)
			if (authority.revision !== expectedAuthorityRevision || item.revision !== expectedItemRevision) {
				fail('STALE_REVISION', 'Dispatch authority snapshot is stale')
			}
			if (
				authority.environment !== expectedEnvironment ||
				authority.phase !== expectedPhase ||
				item.state !== expectedItemState ||
				item.cocoOperationId !== expectedCocoOperationId
			) {
				fail('INVALID_TRANSITION', 'Dispatch authority state does not match the expected operation')
			}
			if (
				item.walletKey !== authority.walletKey ||
				item.user !== authority.user ||
				item.environment !== authority.environment ||
				item.sourceBucketKey !== bucketKey ||
				bucket.user !== authority.user ||
				bucket.mint !== item.mint ||
				bucket.unit !== item.unit
			) {
				fail('BUCKET_OWNERSHIP_MISMATCH', 'Dispatch bucket does not match migration authority')
			}
			if (bucket.kind !== 'legacy-ready') fail('INVALID_TRANSITION', 'Migration dispatch workflow does not match the source bucket')
			return Object.freeze({
				authority: authorityProjection(authority),
				item: itemProjection(item),
				bucket,
				workflow,
			})
		})
	}
}

export async function deleteIndexedDbMigrationControlTestDatabase(config: IndexedDbMigrationCoordinatorStoreConfig): Promise<void> {
	if (!config.testInstanceId || config.environment !== 'test') {
		fail('INVALID_NAMESPACE_IDENTITY', 'Only explicit test migration databases may be deleted by this helper')
	}
	const store = new IndexedDbMigrationCoordinatorStore(config)
	await store.close()
	await new Promise<void>((resolve, reject) => {
		const request = (config.indexedDB ?? globalThis.indexedDB).deleteDatabase(store.databaseName)
		request.onsuccess = () => resolve()
		request.onerror = () => reject(new CocoHostError('COORDINATOR_STORAGE_FAILURE', 'Test migration database could not be deleted'))
		request.onblocked = () => reject(new CocoHostError('COORDINATOR_STORAGE_FAILURE', 'Test migration database deletion was blocked'))
	})
}
