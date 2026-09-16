import { captureObject, CocoHostError, fail } from '../errors'
import {
	buildCocoWalletNamespace,
	normalizeNostrPubkey,
	parseCocoEnvironment,
	parseCocoWalletNamespace,
	type CocoG9aEnvironment,
} from '../namespace'
import type { AuthorityStatus, MonetaryPermissionProjection } from './authority'
import { projectSealedMigrationInventoryAccounting, type MigrationAccountingReport } from './accounting'
import type {
	DomainCreationResult,
	MigrationCoordinatorStore,
	MigrationInventorySealResult,
	MigrationItemRecord,
	QuarantineRecoveryRecord,
} from './coordinator'
import {
	assertInventoryDispositionReferences,
	assertInventoryEntriesCoherent,
	completeInventorySource,
	createBuildingInventory,
	discoverInventoryEntry,
	invalidateInventory,
	inventoryEntryProjection,
	inventoryHasMigrationItem,
	inventoryProjection,
	parseStoredInventoryEntry,
	parseStoredInventoryHeader,
	requireInventoryRevision,
	sealInventory,
	updateInventoryEntryDisposition,
	type MigrationInventoryEntry,
	type MigrationInventoryEntryDiscoveryResult,
	type MigrationInventoryHeader,
} from './inventory'
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
export const PLEBEIAN_MIGRATION_CONTROL_DB_VERSION = 3

const AUTHORITY_STORE = 'authority'
const MIGRATION_ITEM_STORE = 'migrationItems'
const QUARANTINE_RECOVERY_STORE = 'quarantineRecovery'
const MIGRATION_INVENTORY_STORE = 'migrationInventory'
const MIGRATION_INVENTORY_ENTRY_STORE = 'migrationInventoryEntries'
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

function recoveryProjection(record: QuarantineRecoveryRecord): Readonly<QuarantineRecoveryRecord> {
	return Object.freeze({
		walletKey: record.walletKey,
		user: record.user,
		environment: record.environment,
		migrationEpoch: record.migrationEpoch,
		sourceItemId: record.sourceItemId,
		sourceItemRevision: record.sourceItemRevision,
		sourceBucketKey: record.sourceBucketKey,
		status: record.status,
		quarantineReason: record.quarantineReason,
		...(record.cocoOperationId ? { cocoOperationId: record.cocoOperationId } : {}),
	})
}

function quarantineRecoveryRecord(item: MigrationItemRecord): QuarantineRecoveryRecord {
	if (item.state !== 'quarantined' || !item.quarantineReason) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Recovery handoff requires a quarantined migration item')
	}
	return {
		walletKey: item.walletKey,
		user: item.user,
		environment: item.environment,
		migrationEpoch: item.migrationEpoch,
		sourceItemId: item.id,
		sourceItemRevision: item.revision,
		sourceBucketKey: item.sourceBucketKey,
		status: 'authoritative-reconciliation-required',
		quarantineReason: item.quarantineReason,
		...(item.cocoOperationId ? { cocoOperationId: item.cocoOperationId } : {}),
	}
}

const AUTHORITY_REVISION_BY_PHASE: Readonly<Record<MigrationPhase, number>> = Object.freeze({
	'legacy-active': 0,
	'migration-snapshot-frozen': 1,
	importing: 2,
	verifying: 3,
	'coco-ready': 4,
	'cutover-committed': 5,
})

function assertStoredAuthoritySemantics(phase: MigrationPhase, revision: number): void {
	if (AUTHORITY_REVISION_BY_PHASE[phase] !== revision) {
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration authority state is not reachable')
	}
}

const REACHABLE_MIGRATION_ITEM_STATES = new Set([
	'planned|0|unbound',
	'planned|1|bound',
	'prepared|1|unbound',
	'prepared|2|bound',
	'executing|3|bound',
	'verified|4|bound',
	'quarantined|1|unbound',
	'quarantined|2|unbound',
	'quarantined|2|bound',
	'quarantined|3|bound',
	'quarantined|4|bound',
])

function assertStoredMigrationItemSemantics(
	state: MigrationItemState,
	revision: number,
	cocoOperationId: string | undefined,
	sourceBucket: MonetaryBucketIdentity,
): void {
	if (sourceBucket.kind === 'coco-ordinary') {
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration item source is not migratable')
	}
	const binding = cocoOperationId === undefined ? 'unbound' : 'bound'
	if (!REACHABLE_MIGRATION_ITEM_STATES.has(`${state}|${revision}|${binding}`)) {
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration item state is not reachable')
	}
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
		assertStoredAuthoritySemantics(phase, revision)
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
		assertStoredMigrationItemSemantics(state, revision, cocoOperationId, bucket)
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

function storedRecovery(value: unknown): QuarantineRecoveryRecord {
	try {
		const captured = captureObject(
			value,
			[
				'walletKey',
				'user',
				'environment',
				'migrationEpoch',
				'sourceItemId',
				'sourceItemRevision',
				'sourceBucketKey',
				'status',
				'quarantineReason',
				'cocoOperationId',
			],
			'COORDINATOR_STORAGE_FAILURE',
			'Quarantine recovery record',
		)
		const wallet = parseCocoWalletNamespace(captured.walletKey)
		const user = normalizeNostrPubkey(captured.user)
		const environment = parseCocoEnvironment(captured.environment)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const sourceItemId = requireSafeId(captured.sourceItemId, 'source item id')
		const sourceItemRevision = requireRevision(captured.sourceItemRevision)
		if (sourceItemRevision < 1) fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery source revision is invalid')
		if (typeof captured.sourceBucketKey !== 'string') fail('COORDINATOR_STORAGE_FAILURE', 'Recovery bucket key is invalid')
		const bucket = decodeMonetaryBucketKey(captured.sourceBucketKey)
		const sourceBucketKey = monetaryBucketKey(bucket)
		if (captured.status !== 'authoritative-reconciliation-required') {
			fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery status is invalid')
		}
		const quarantineReason = parseQuarantineReason(captured.quarantineReason)
		const cocoOperationId = captured.cocoOperationId === undefined ? undefined : requireSafeId(captured.cocoOperationId, 'operationId')
		if (wallet.pubkey !== user || wallet.environment !== environment || bucket.user !== user) {
			fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery identity is inconsistent')
		}
		return {
			walletKey: wallet.namespace,
			user,
			environment,
			migrationEpoch,
			sourceItemId,
			sourceItemRevision,
			sourceBucketKey,
			status: 'authoritative-reconciliation-required',
			quarantineReason,
			...(cocoOperationId ? { cocoOperationId } : {}),
		}
	} catch (error) {
		if (error instanceof CocoHostError && error.code === 'COORDINATOR_STORAGE_FAILURE') throw error
		fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery record is invalid')
	}
}

function assertRecoveryMatchesItem(record: QuarantineRecoveryRecord, item: MigrationItemRecord | undefined): void {
	if (
		!item ||
		item.state !== 'quarantined' ||
		item.walletKey !== record.walletKey ||
		item.user !== record.user ||
		item.environment !== record.environment ||
		item.migrationEpoch !== record.migrationEpoch ||
		item.id !== record.sourceItemId ||
		item.revision !== record.sourceItemRevision ||
		item.sourceBucketKey !== record.sourceBucketKey ||
		item.quarantineReason !== record.quarantineReason ||
		item.cocoOperationId !== record.cocoOperationId
	) {
		fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery provenance does not match its source item')
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
				request.onupgradeneeded = (event) => {
					const database = request.result
					if (!database.objectStoreNames.contains(AUTHORITY_STORE)) {
						database.createObjectStore(AUTHORITY_STORE, { keyPath: 'walletKey' })
					}
					if (!database.objectStoreNames.contains(MIGRATION_ITEM_STORE)) {
						database.createObjectStore(MIGRATION_ITEM_STORE, { keyPath: ['walletKey', 'id'] })
					}
					if (!database.objectStoreNames.contains(QUARANTINE_RECOVERY_STORE)) {
						database.createObjectStore(QUARANTINE_RECOVERY_STORE, { keyPath: ['walletKey', 'sourceItemId'] })
					}
					if (!database.objectStoreNames.contains(MIGRATION_INVENTORY_STORE)) {
						database.createObjectStore(MIGRATION_INVENTORY_STORE, { keyPath: ['walletKey', 'migrationEpoch'] })
					}
					if (!database.objectStoreNames.contains(MIGRATION_INVENTORY_ENTRY_STORE)) {
						database.createObjectStore(MIGRATION_INVENTORY_ENTRY_STORE, {
							keyPath: ['walletKey', 'migrationEpoch', 'id'],
						})
					}
					const transaction = request.transaction
					if (!transaction) {
						rejectOpen('Migration authority database upgrade transaction is unavailable')
						return
					}
					if (event.oldVersion >= 2) return
					const cursorRequest = transaction.objectStore(MIGRATION_ITEM_STORE).openCursor()
					cursorRequest.onsuccess = () => {
						const cursor = cursorRequest.result
						if (!cursor) return
						try {
							const item = storedItem(cursor.value)
							if (item.state === 'quarantined') {
								transaction.objectStore(QUARANTINE_RECOVERY_STORE).add(quarantineRecoveryRecord(item))
							}
							cursor.continue()
						} catch {
							transaction.abort()
						}
					}
					cursorRequest.onerror = () => transaction.abort()
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
			const transaction = database.transaction([...stores], mode)
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

	#recoveryStore(transaction: IDBTransaction): IDBObjectStore {
		return transaction.objectStore(QUARANTINE_RECOVERY_STORE)
	}

	#inventoryStore(transaction: IDBTransaction): IDBObjectStore {
		return transaction.objectStore(MIGRATION_INVENTORY_STORE)
	}

	#inventoryEntryStore(transaction: IDBTransaction): IDBObjectStore {
		return transaction.objectStore(MIGRATION_INVENTORY_ENTRY_STORE)
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

	async #loadInventory(transaction: IDBTransaction, migrationEpoch: string): Promise<MigrationInventoryHeader> {
		await this.#loadAuthority(transaction, migrationEpoch)
		const value = await requestResult(this.#inventoryStore(transaction).get([this.#walletKey, migrationEpoch]))
		if (value === undefined) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration inventory was not found')
		try {
			const inventory = parseStoredInventoryHeader(value)
			this.#requireBoundIdentity(inventory.walletKey, migrationEpoch)
			if (inventory.user !== this.#user || inventory.environment !== this.#environment || inventory.migrationEpoch !== migrationEpoch) {
				fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory identity is inconsistent')
			}
			return inventory
		} catch (error) {
			if (error instanceof CocoHostError && error.code === 'COORDINATOR_STORAGE_FAILURE') throw error
			storageFailure()
		}
	}

	async #loadInventoryEntries(transaction: IDBTransaction, inventory: MigrationInventoryHeader): Promise<MigrationInventoryEntry[]> {
		try {
			const values = await requestResult(this.#inventoryEntryStore(transaction).getAll())
			const entries = values.map((value) => parseStoredInventoryEntry(value))
			if (
				entries.some(
					(entry) =>
						entry.walletKey !== inventory.walletKey ||
						entry.user !== inventory.user ||
						entry.environment !== inventory.environment ||
						entry.migrationEpoch !== inventory.migrationEpoch,
				)
			) {
				fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory entry belongs to another identity')
			}
			assertInventoryEntriesCoherent(inventory, entries)
			return entries
		} catch (error) {
			if (error instanceof CocoHostError && error.code === 'COORDINATOR_STORAGE_FAILURE') throw error
			storageFailure()
		}
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

	async createMigrationInventory(command: unknown): Promise<DomainCreationResult<MigrationInventoryHeader>> {
		const { migrationEpoch } = this.#captureAuthorityQuery(command)
		return this.#run([AUTHORITY_STORE, MIGRATION_INVENTORY_STORE], 'readwrite', async (transaction) => {
			const authority = await this.#loadAuthority(transaction, migrationEpoch)
			if (authority.phase !== 'legacy-active') fail('INVALID_TRANSITION', 'Migration inventory must begin before snapshot freeze')
			const store = this.#inventoryStore(transaction)
			const existing = await requestResult(store.get([this.#walletKey, migrationEpoch]))
			if (existing !== undefined) {
				const inventory = parseStoredInventoryHeader(existing)
				if (
					inventory.walletKey !== this.#walletKey ||
					inventory.user !== this.#user ||
					inventory.environment !== this.#environment ||
					inventory.migrationEpoch !== migrationEpoch
				) {
					fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory identity is inconsistent')
				}
				return Object.freeze({ created: false, value: inventoryProjection(inventory) })
			}
			const inventory = createBuildingInventory(authority)
			await requestResult(store.add(inventory))
			return Object.freeze({ created: true, value: inventoryProjection(inventory) })
		})
	}

	async loadMigrationInventory(query: unknown): Promise<Readonly<MigrationInventoryHeader>> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE, MIGRATION_INVENTORY_STORE], 'readonly', async (transaction) =>
			inventoryProjection(await this.#loadInventory(transaction, migrationEpoch)),
		)
	}

	async listMigrationInventoryEntries(query: unknown): Promise<readonly Readonly<MigrationInventoryEntry>[]> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE], 'readonly', async (transaction) => {
			const inventory = await this.#loadInventory(transaction, migrationEpoch)
			return Object.freeze(
				(await this.#loadInventoryEntries(transaction, inventory))
					.map(inventoryEntryProjection)
					.sort((left, right) => left.id.localeCompare(right.id)),
			)
		})
	}

	async discoverMigrationInventoryEntry(command: unknown): Promise<MigrationInventoryEntryDiscoveryResult> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'expectedInventoryRevision', 'entry'],
			'INVALID_TRANSITION',
			'Inventory discovery command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run(
			[AUTHORITY_STORE, MIGRATION_ITEM_STORE, QUARANTINE_RECOVERY_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE],
			'readwrite',
			async (transaction) => {
				const inventory = await this.#loadInventory(transaction, migrationEpoch)
				if (inventory.revision !== requireInventoryRevision(captured.expectedInventoryRevision)) {
					fail('STALE_REVISION', 'Observed migration inventory revision is not current')
				}
				const entries = await this.#loadInventoryEntries(transaction, inventory)
				const result = discoverInventoryEntry(inventory, entries, captured.entry)
				if (result.outcome === 'recorded') {
					const items = (await requestResult(this.#itemStore(transaction).getAll())).map(storedItem)
					const handoffs = (await requestResult(this.#recoveryStore(transaction).getAll())).map(storedRecovery)
					assertInventoryDispositionReferences(result.entry, items, handoffs)
				}
				await requestResult(this.#inventoryStore(transaction).put(result.inventory))
				if (result.outcome === 'recorded') await requestResult(this.#inventoryEntryStore(transaction).add(result.entry))
				return result
			},
		)
	}

	async completeMigrationInventorySource(command: unknown): Promise<Readonly<MigrationInventoryHeader>> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'expectedInventoryRevision', 'completion'],
			'INVALID_TRANSITION',
			'Inventory source completion command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run([AUTHORITY_STORE, MIGRATION_INVENTORY_STORE], 'readwrite', async (transaction) => {
			const inventory = await this.#loadInventory(transaction, migrationEpoch)
			if (inventory.revision !== requireInventoryRevision(captured.expectedInventoryRevision)) {
				fail('STALE_REVISION', 'Observed migration inventory revision is not current')
			}
			const next = completeInventorySource(inventory, captured.completion)
			await requestResult(this.#inventoryStore(transaction).put(next))
			return inventoryProjection(next)
		})
	}

	async sealInventoryAndFreezeSnapshot(command: unknown): Promise<Readonly<MigrationInventorySealResult>> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'expectedAuthorityRevision', 'expectedInventoryRevision'],
			'INVALID_TRANSITION',
			'Inventory seal command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run(
			[AUTHORITY_STORE, MIGRATION_ITEM_STORE, QUARANTINE_RECOVERY_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE],
			'readwrite',
			async (transaction) => {
				const authority = await this.#loadAuthority(transaction, migrationEpoch)
				const inventory = await this.#loadInventory(transaction, migrationEpoch)
				if (authority.revision !== requireRevision(captured.expectedAuthorityRevision)) {
					fail('STALE_REVISION', 'Observed authority revision is not current')
				}
				if (inventory.revision !== requireInventoryRevision(captured.expectedInventoryRevision)) {
					fail('STALE_REVISION', 'Observed migration inventory revision is not current')
				}
				if (authority.phase !== 'legacy-active') fail('INVALID_TRANSITION', 'Migration snapshot can only freeze from legacy-active')
				const entries = await this.#loadInventoryEntries(transaction, inventory)
				const items = (await requestResult(this.#itemStore(transaction).getAll())).map(storedItem)
				const handoffs = (await requestResult(this.#recoveryStore(transaction).getAll())).map(storedRecovery)
				for (const entry of entries) assertInventoryDispositionReferences(entry, items, handoffs)
				const sealed = sealInventory(inventory, entries, authority.revision, items)
				const nextAuthority: AuthorityRecord = {
					...authority,
					phase: 'migration-snapshot-frozen',
					revision: authority.revision + 1,
				}
				await requestResult(this.#inventoryStore(transaction).put(sealed))
				await requestResult(this.#authorityStore(transaction).put(nextAuthority))
				return Object.freeze({ authority: authorityProjection(nextAuthority), inventory: inventoryProjection(sealed) })
			},
		)
	}

	async updateMigrationInventoryDisposition(command: unknown): Promise<Readonly<MigrationInventoryEntry>> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'expectedInventoryRevision', 'entryId', 'expectedDispositionRevision', 'disposition'],
			'INVALID_TRANSITION',
			'Inventory disposition command',
		)
		const walletKey = parseCocoWalletNamespace(captured.walletKey).namespace
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const entryId = requireSafeId(captured.entryId, 'inventory entry id')
		this.#requireBoundIdentity(walletKey, migrationEpoch)
		return this.#run(
			[AUTHORITY_STORE, MIGRATION_ITEM_STORE, QUARANTINE_RECOVERY_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE],
			'readwrite',
			async (transaction) => {
				const inventory = await this.#loadInventory(transaction, migrationEpoch)
				if (inventory.revision !== requireInventoryRevision(captured.expectedInventoryRevision)) {
					fail('STALE_REVISION', 'Observed migration inventory revision is not current')
				}
				const entries = await this.#loadInventoryEntries(transaction, inventory)
				const entry = entries.find((candidate) => candidate.id === entryId)
				if (!entry) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration inventory entry was not found')
				if (entry.kind !== 'migration-claim') fail('INVALID_TRANSITION', 'Coco opening baseline has no migration disposition')
				if (entry.disposition.revision !== requireInventoryRevision(captured.expectedDispositionRevision)) {
					fail('STALE_REVISION', 'Observed inventory disposition revision is not current')
				}
				const next = updateInventoryEntryDisposition(inventory, entry, captured.disposition)
				const items = (await requestResult(this.#itemStore(transaction).getAll())).map(storedItem)
				const handoffs = (await requestResult(this.#recoveryStore(transaction).getAll())).map(storedRecovery)
				assertInventoryDispositionReferences(next.entry, items, handoffs)
				assertInventoryEntriesCoherent(
					next.inventory,
					entries.map((candidate) => (candidate.id === entryId ? next.entry : candidate)),
				)
				await requestResult(this.#inventoryStore(transaction).put(next.inventory))
				await requestResult(this.#inventoryEntryStore(transaction).put(next.entry))
				return inventoryEntryProjection(next.entry)
			},
		)
	}

	async migrationInventoryAccounting(query: unknown): Promise<readonly Readonly<MigrationAccountingReport>[]> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE], 'readonly', async (transaction) => {
			const inventory = await this.#loadInventory(transaction, migrationEpoch)
			return projectSealedMigrationInventoryAccounting(inventory, await this.#loadInventoryEntries(transaction, inventory))
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
			const nextPhase = assertLegalAuthorityAdvance(current.phase, captured.nextPhase)
			if (nextPhase === 'migration-snapshot-frozen') {
				fail('INVALID_TRANSITION', 'Snapshot freeze requires the atomic migration inventory seal operation')
			}
			const next: AuthorityRecord = {
				...current,
				phase: nextPhase,
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

	async listQuarantineRecoveryHandoffs(query: unknown): Promise<readonly Readonly<QuarantineRecoveryRecord>[]> {
		const { migrationEpoch } = this.#captureAuthorityQuery(query)
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE, QUARANTINE_RECOVERY_STORE], 'readonly', async (transaction) => {
			await this.#loadAuthority(transaction, migrationEpoch)
			const items = (await requestResult(this.#itemStore(transaction).getAll())).map(storedItem)
			const itemById = new Map(items.map((item) => [item.id, item]))
			const records = (await requestResult(this.#recoveryStore(transaction).getAll())).map(storedRecovery)
			if (records.some((record) => record.walletKey !== this.#walletKey || record.migrationEpoch !== migrationEpoch)) {
				fail('COORDINATOR_STORAGE_FAILURE', 'Quarantine recovery record belongs to another wallet or epoch')
			}
			const recordByItemId = new Map(records.map((record) => [record.sourceItemId, record]))
			if (
				items.some(
					(item) =>
						item.walletKey === this.#walletKey &&
						item.migrationEpoch === migrationEpoch &&
						item.state === 'quarantined' &&
						!recordByItemId.has(item.id),
				)
			) {
				fail('COORDINATOR_STORAGE_FAILURE', 'Quarantined migration item is missing its recovery handoff')
			}
			for (const record of records) assertRecoveryMatchesItem(record, itemById.get(record.sourceItemId))
			return Object.freeze(records.map(recoveryProjection).sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId)))
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
		return this.#run(
			[AUTHORITY_STORE, MIGRATION_ITEM_STORE, MIGRATION_INVENTORY_STORE, MIGRATION_INVENTORY_ENTRY_STORE],
			'readwrite',
			async (transaction) => {
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
				const inventoryValue = await requestResult(this.#inventoryStore(transaction).get([walletKey, migrationEpoch]))
				if (inventoryValue !== undefined) {
					const inventory = parseStoredInventoryHeader(inventoryValue)
					if (inventory.status === 'sealed') {
						const entries = await this.#loadInventoryEntries(transaction, inventory)
						if (!inventoryHasMigrationItem(entries, record)) {
							await requestResult(this.#inventoryStore(transaction).put(invalidateInventory(inventory, `migration-item:${id}`)))
						}
					}
				}
				await requestResult(store.add(record))
				return Object.freeze({ created: true, value: itemProjection(record) })
			},
		)
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
		return this.#run([AUTHORITY_STORE, MIGRATION_ITEM_STORE, QUARANTINE_RECOVERY_STORE], 'readwrite', async (transaction) => {
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
			const handoff = quarantineRecoveryRecord(next)
			await requestResult(this.#itemStore(transaction).put(next))
			await requestResult(this.#recoveryStore(transaction).add(handoff))
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
