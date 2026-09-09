import { fail } from '../errors'
import { assertAuthorityInvariant, assertObservedVersion, authorizeMonetaryCapability, transitionAuthority } from './authority'
import {
	MIGRATION_QUARANTINE_REASONS,
	createMonetaryBucketIdentity,
	monetaryBucketKey,
	normalizeMintUrl,
	normalizeUnit,
	requireSafeId,
	type AuthorityVersion,
	type MigrationItemRecord,
	type MigrationQuarantineReason,
	type MigrationItemState,
	type MigrationPhase,
	type MonetaryCapability,
	type WalletAuthoritySnapshot,
} from './types'
import { normalizeNostrPubkey } from '../namespace'

export interface MigrationCoordinatorStore {
	load(walletKey: string): Promise<WalletAuthoritySnapshot | null>
	create(snapshot: WalletAuthoritySnapshot): Promise<boolean>
	compareAndSwap(walletKey: string, expected: AuthorityVersion, next: WalletAuthoritySnapshot): Promise<boolean>
	loadItem(walletKey: string, itemId: string): Promise<MigrationItemRecord | null>
	createItem(walletKey: string, item: MigrationItemRecord): Promise<boolean>
	compareAndSwapItem(walletKey: string, itemId: string, expected: AuthorityVersion, next: MigrationItemRecord): Promise<boolean>
}

export class InMemoryMigrationCoordinatorStore implements MigrationCoordinatorStore {
	readonly #records = new Map<string, WalletAuthoritySnapshot>()
	readonly #items = new Map<string, Map<string, MigrationItemRecord>>()

	async load(walletKey: string): Promise<WalletAuthoritySnapshot | null> {
		const value = this.#records.get(walletKey)
		return value ? structuredClone(value) : null
	}

	async create(snapshot: WalletAuthoritySnapshot): Promise<boolean> {
		assertAuthorityInvariant(snapshot)
		if (this.#records.has(snapshot.walletKey)) return false
		this.#records.set(snapshot.walletKey, structuredClone(snapshot))
		return true
	}

	async compareAndSwap(walletKey: string, expected: AuthorityVersion, next: WalletAuthoritySnapshot): Promise<boolean> {
		assertAuthorityInvariant(next)
		if (next.walletKey !== walletKey || next.migrationEpoch !== expected.migrationEpoch || next.revision !== expected.revision + 1) {
			fail('INVALID_TRANSITION', 'Compare-and-swap replacement does not advance the observed authority')
		}
		const current = this.#records.get(walletKey)
		if (!current || current.migrationEpoch !== expected.migrationEpoch || current.revision !== expected.revision) {
			return false
		}
		this.#records.set(walletKey, structuredClone(next))
		return true
	}

	async loadItem(walletKey: string, itemId: string): Promise<MigrationItemRecord | null> {
		const item = this.#items.get(walletKey)?.get(itemId)
		return item ? structuredClone(item) : null
	}

	async createItem(walletKey: string, item: MigrationItemRecord): Promise<boolean> {
		const authority = this.#records.get(walletKey)
		const validItem = validateMigrationItem(item)
		if (!authority || authority.migrationEpoch !== validItem.migrationEpoch) {
			fail('WRONG_EPOCH', 'Migration item does not belong to the current wallet epoch')
		}
		const items = this.#items.get(walletKey) ?? new Map<string, MigrationItemRecord>()
		if (items.has(validItem.id)) return false
		items.set(validItem.id, structuredClone(validItem))
		this.#items.set(walletKey, items)
		return true
	}

	async compareAndSwapItem(walletKey: string, itemId: string, expected: AuthorityVersion, next: MigrationItemRecord): Promise<boolean> {
		const validNext = validateMigrationItem(next)
		if (validNext.id !== itemId || validNext.migrationEpoch !== expected.migrationEpoch || validNext.revision !== expected.revision + 1) {
			fail('INVALID_QUARANTINE_TRANSITION', 'Item compare-and-swap replacement is not the observed successor')
		}
		const authority = this.#records.get(walletKey)
		const items = this.#items.get(walletKey)
		const current = items?.get(itemId)
		if (
			!authority ||
			authority.migrationEpoch !== expected.migrationEpoch ||
			!current ||
			current.migrationEpoch !== expected.migrationEpoch ||
			current.revision !== expected.revision
		) {
			return false
		}
		items!.set(itemId, structuredClone(validNext))
		return true
	}
}

export class MigrationAuthorityCoordinator {
	constructor(readonly store: MigrationCoordinatorStore) {}

	async initialize(snapshot: WalletAuthoritySnapshot): Promise<void> {
		assertAuthorityInvariant(snapshot)
		if (!(await this.store.create(snapshot))) {
			fail('COORDINATOR_RECORD_EXISTS', 'Migration authority record already exists')
		}
	}

	async load(walletKey: string): Promise<WalletAuthoritySnapshot> {
		const snapshot = await this.store.load(walletKey)
		if (!snapshot) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration authority record was not found')
		assertAuthorityInvariant(snapshot)
		return snapshot
	}

	async transition(walletKey: string, observed: AuthorityVersion, targetPhase: MigrationPhase): Promise<WalletAuthoritySnapshot> {
		const current = await this.load(walletKey)
		assertObservedVersion(current, observed)
		const next = transitionAuthority(current, observed, targetPhase)
		if (!(await this.store.compareAndSwap(walletKey, observed, next))) {
			fail('STALE_REVISION', 'Migration authority changed before compare-and-swap committed')
		}
		return next
	}

	async authorize(walletKey: string, observed: AuthorityVersion, bucketKey: string, capability: MonetaryCapability): Promise<void> {
		const current = await this.load(walletKey)
		authorizeMonetaryCapability(current, observed, bucketKey, capability)
	}

	async initializeItem(walletKey: string, item: MigrationItemRecord): Promise<void> {
		const authority = await this.load(walletKey)
		const validItem = validateMigrationItem(item)
		if (authority.migrationEpoch !== validItem.migrationEpoch) {
			fail('WRONG_EPOCH', 'Migration item does not belong to the current wallet epoch')
		}
		if (!(await this.store.createItem(walletKey, validItem))) {
			fail('COORDINATOR_RECORD_EXISTS', 'Migration item already exists')
		}
	}

	async loadItem(walletKey: string, itemId: string): Promise<MigrationItemRecord> {
		const item = await this.store.loadItem(walletKey, itemId)
		if (!item) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration item was not found')
		return validateMigrationItem(item)
	}

	async transitionItem(
		walletKey: string,
		itemId: string,
		observed: AuthorityVersion,
		targetState: MigrationItemState,
		options: { cocoOperationId?: string; quarantineReason?: MigrationQuarantineReason } = {},
	): Promise<MigrationItemRecord> {
		const current = await this.loadItem(walletKey, itemId)
		if (current.migrationEpoch !== observed.migrationEpoch) {
			fail('WRONG_EPOCH', 'Observed migration item epoch is not current')
		}
		if (current.revision !== observed.revision) {
			fail('STALE_REVISION', 'Observed migration item revision is not current')
		}
		const next = transitionMigrationItem(current, observed.revision, targetState, options)
		if (!(await this.store.compareAndSwapItem(walletKey, itemId, observed, next))) {
			fail('STALE_REVISION', 'Migration item changed before compare-and-swap committed')
		}
		return next
	}
}

const ITEM_TRANSITIONS: Record<MigrationItemState, readonly MigrationItemState[]> = {
	planned: ['prepared', 'quarantined'],
	prepared: ['executing', 'quarantined'],
	executing: ['verified', 'quarantined'],
	verified: [],
	quarantined: [],
}

export function createMigrationItem(input: unknown): MigrationItemRecord {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item input must be an object')
	}
	const candidate = input as {
		id?: unknown
		migrationEpoch?: unknown
		sourceBucket?: unknown
	}
	const id = requireSafeId(candidate.id, 'migration item id')
	const migrationEpoch = requireSafeId(candidate.migrationEpoch, 'migrationEpoch')
	const sourceBucket = createMonetaryBucketIdentity(candidate.sourceBucket)
	return Object.freeze({
		id,
		migrationEpoch,
		sourceBucketKey: monetaryBucketKey(sourceBucket),
		user: normalizeNostrPubkey(sourceBucket.user),
		mint: normalizeMintUrl(sourceBucket.mint),
		unit: normalizeUnit(sourceBucket.unit),
		state: 'planned',
		revision: 0,
	})
}

export function validateMigrationItem(value: unknown): MigrationItemRecord {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!Object.keys(value).every((key) =>
			[
				'id',
				'migrationEpoch',
				'sourceBucketKey',
				'user',
				'mint',
				'unit',
				'state',
				'cocoOperationId',
				'revision',
				'quarantineReason',
			].includes(key),
		)
	) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item is invalid')
	}
	const item = value as MigrationItemRecord
	if (!ITEM_TRANSITIONS[item.state]) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item state is invalid')
	}
	const normalized: MigrationItemRecord = {
		id: requireSafeId(item.id, 'migration item id'),
		migrationEpoch: requireSafeId(item.migrationEpoch, 'migrationEpoch'),
		sourceBucketKey: item.sourceBucketKey,
		user: normalizeNostrPubkey(item.user),
		mint: normalizeMintUrl(item.mint),
		unit: normalizeUnit(item.unit),
		state: item.state,
		revision: item.revision,
		...(item.cocoOperationId ? { cocoOperationId: requireSafeId(item.cocoOperationId, 'cocoOperationId') } : {}),
		...(item.quarantineReason ? { quarantineReason: item.quarantineReason } : {}),
	}
	if (
		typeof normalized.sourceBucketKey !== 'string' ||
		normalized.sourceBucketKey.length === 0 ||
		normalized.sourceBucketKey.length > 2048 ||
		/[\u0000-\u001f\u007f]/.test(normalized.sourceBucketKey) ||
		!normalized.sourceBucketKey.startsWith(`${normalized.user}|${normalized.mint}|${normalized.unit}|`)
	) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration source bucket key is invalid')
	}
	if (!Number.isSafeInteger(normalized.revision) || normalized.revision < 0) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item revision is invalid')
	}
	if (normalized.quarantineReason !== undefined && !MIGRATION_QUARANTINE_REASONS.includes(normalized.quarantineReason)) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item quarantine reason is invalid')
	}
	if (normalized.state === 'quarantined' && !normalized.quarantineReason) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Quarantined migration item requires a reason')
	}
	if (normalized.state !== 'quarantined' && normalized.quarantineReason) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Only quarantined migration items may contain a reason')
	}
	if ((normalized.state === 'executing' || normalized.state === 'verified') && !normalized.cocoOperationId) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Executing and verified items require a Coco operation ID')
	}
	return Object.freeze(normalized)
}

export function transitionMigrationItem(
	item: MigrationItemRecord,
	expectedRevision: number,
	targetState: MigrationItemState,
	options: { cocoOperationId?: string; quarantineReason?: MigrationQuarantineReason } = {},
): MigrationItemRecord {
	const normalized = validateMigrationItem(item)
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item transition options are invalid')
	}
	if (!Object.keys(options).every((key) => key === 'cocoOperationId' || key === 'quarantineReason')) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Migration item transition options contain undeclared fields')
	}
	if (normalized.revision !== expectedRevision) fail('STALE_REVISION', 'Migration item revision is stale')
	if (!ITEM_TRANSITIONS[normalized.state].includes(targetState)) {
		fail('INVALID_QUARANTINE_TRANSITION', `Cannot transition migration item from ${normalized.state} to ${targetState}`)
	}
	if (targetState === 'quarantined' && (!options.quarantineReason || !MIGRATION_QUARANTINE_REASONS.includes(options.quarantineReason))) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Quarantine requires a sanitized reason')
	}
	if (targetState !== 'quarantined' && options.quarantineReason !== undefined) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Quarantine reason is only valid for quarantined items')
	}
	const requestedOperationId = options.cocoOperationId
		? requireSafeId(options.cocoOperationId, 'cocoOperationId')
		: normalized.cocoOperationId
	if (normalized.cocoOperationId && requestedOperationId !== normalized.cocoOperationId) {
		fail('INVALID_QUARANTINE_TRANSITION', 'A bound Coco operation ID cannot be replaced')
	}
	const cocoOperationId = requestedOperationId
	if ((targetState === 'executing' || targetState === 'verified') && !cocoOperationId) {
		fail('INVALID_QUARANTINE_TRANSITION', 'Executing and verified items require a Coco operation ID')
	}
	return Object.freeze({
		id: normalized.id,
		migrationEpoch: normalized.migrationEpoch,
		sourceBucketKey: normalized.sourceBucketKey,
		user: normalized.user,
		mint: normalized.mint,
		unit: normalized.unit,
		state: targetState,
		revision: normalized.revision + 1,
		...(cocoOperationId ? { cocoOperationId } : {}),
		...(options.quarantineReason ? { quarantineReason: options.quarantineReason } : {}),
	})
}
