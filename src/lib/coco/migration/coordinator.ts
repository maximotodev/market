import { captureObject, fail } from '../errors'
import {
	buildCocoWalletNamespace,
	normalizeNostrPubkey,
	parseCocoEnvironment,
	parseCocoWalletNamespace,
	type CocoG9aEnvironment,
} from '../namespace'
import type { AuthorityStatus, MonetaryPermissionProjection } from './authority'
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
	type CanonicalMintUrl,
	type MigrationItemState,
	type MigrationPhase,
	type MigrationQuarantineReason,
	type MonetaryBucketIdentity,
	type MonetaryBucketKey,
	type MonetaryOwner,
	type Nip60Policy,
} from './types'

export const I1B_HOST_DISPATCH_FENCE_REQUIRED = true
export const LEGACY_RETIREMENT_DEFERRED_PENDING_AUTHORITATIVE_INVENTORY = true

type AuthorityRecord = AuthorityStatus

export interface MigrationItemRecord {
	id: string
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	sourceBucketKey: MonetaryBucketKey
	mint: CanonicalMintUrl
	unit: string
	state: MigrationItemState
	cocoOperationId?: string
	revision: number
	quarantineReason?: MigrationQuarantineReason
}

export interface DomainCreationResult<T> {
	created: boolean
	value: Readonly<T>
}

/**
 * Every mutation is normatively one linearizable atomic
 * read/precondition/derive/write operation for its authority or item key. A
 * conforming adapter may not implement these commands as an application-level
 * load/await/save sequence, and callers never supply a replacement record.
 */
export interface MigrationCoordinatorStore {
	readonly atomicity: 'linearizable-domain-transition-v1'

	loadAuthority(query: unknown): Promise<Readonly<AuthorityStatus>>
	createInitialAuthority(command: unknown): Promise<DomainCreationResult<AuthorityStatus>>
	advanceAuthorityPhase(command: unknown): Promise<Readonly<AuthorityStatus>>
	permissionsFor(query: unknown): Promise<Readonly<MonetaryPermissionProjection>>
	nip60Policy(query: unknown): Promise<Nip60Policy>

	loadMigrationItem(query: unknown): Promise<Readonly<MigrationItemRecord>>
	listMigrationItems(query: unknown): Promise<readonly Readonly<MigrationItemRecord>[]>
	createPlannedMigrationItem(command: unknown): Promise<DomainCreationResult<MigrationItemRecord>>
	bindCocoOperationOnce(command: unknown): Promise<Readonly<MigrationItemRecord>>
	advanceMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>>
	quarantineMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>>
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

function projectCapabilitiesForOwner(owner: MonetaryOwner): MonetaryPermissionProjection['capabilities'] {
	return Object.freeze({
		legacyOrdinary: owner === 'legacy-ordinary',
		legacyRecovery: owner === 'legacy-recovery-only',
		cocoMigration: owner === 'coco-migration',
		cocoOrdinary: owner === 'coco-canonical',
		shadowDiagnostics: owner === 'coco-shadow',
	})
}

function requireWalletKey(value: unknown): string {
	return parseCocoWalletNamespace(value).namespace
}

function captureAuthorityQuery(input: unknown): { walletKey: string; migrationEpoch: string } {
	const captured = captureObject(input, ['walletKey', 'migrationEpoch'], 'INVALID_TRANSITION', 'Authority query')
	return { walletKey: requireWalletKey(captured.walletKey), migrationEpoch: requireEpoch(captured.migrationEpoch) }
}

function captureVersionedCommand(input: unknown, extraFields: readonly string[] = []): Readonly<Record<string, unknown>> {
	return captureObject(
		input,
		['walletKey', 'migrationEpoch', 'expectedRevision', ...extraFields],
		'INVALID_TRANSITION',
		'Coordinator command',
	)
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
	switch (phase) {
		case 'legacy-active':
		case 'migration-snapshot-frozen':
		case 'importing':
		case 'verifying':
		case 'coco-ready':
			return 'keep-runtime'
		case 'cutover-committed':
			return 'keep-interop'
	}
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

export class InMemoryMigrationCoordinatorStore implements MigrationCoordinatorStore {
	readonly atomicity = 'linearizable-domain-transition-v1' as const
	readonly #authorities = new Map<string, AuthorityRecord>()
	readonly #items = new Map<string, Map<string, MigrationItemRecord>>()

	#requireAuthority(walletKey: string, migrationEpoch: string): AuthorityRecord {
		const authority = this.#authorities.get(walletKey)
		if (!authority) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration authority record was not found')
		if (authority.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Migration authority belongs to another epoch')
		return authority
	}

	#requireVersion(authority: AuthorityRecord, expectedRevision: unknown): number {
		const revision = requireRevision(expectedRevision)
		if (authority.revision !== revision) fail('STALE_REVISION', 'Observed authority revision is not current')
		return revision
	}

	#requireItem(walletKey: string, migrationEpoch: string, itemId: string): MigrationItemRecord {
		this.#requireAuthority(walletKey, migrationEpoch)
		const item = this.#items.get(walletKey)?.get(itemId)
		if (!item) fail('COORDINATOR_RECORD_NOT_FOUND', 'Migration item was not found')
		if (item.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Migration item belongs to another epoch')
		return item
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
		const existing = this.#authorities.get(walletKey)
		if (existing) {
			if (existing.migrationEpoch !== migrationEpoch) fail('WRONG_EPOCH', 'Wallet authority already exists for another epoch')
			return Object.freeze({ created: false, value: authorityProjection(existing) })
		}
		const record: AuthorityRecord = { walletKey, user, environment, migrationEpoch, revision: 0, phase: 'legacy-active' }
		this.#authorities.set(walletKey, record)
		return Object.freeze({ created: true, value: authorityProjection(record) })
	}

	async loadAuthority(query: unknown): Promise<Readonly<AuthorityStatus>> {
		const { walletKey, migrationEpoch } = captureAuthorityQuery(query)
		return authorityProjection(this.#requireAuthority(walletKey, migrationEpoch))
	}

	async advanceAuthorityPhase(command: unknown): Promise<Readonly<AuthorityStatus>> {
		const captured = captureVersionedCommand(command, ['nextPhase'])
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const authority = this.#requireAuthority(walletKey, migrationEpoch)
		this.#requireVersion(authority, captured.expectedRevision)
		const nextPhase = assertLegalAuthorityAdvance(authority.phase, captured.nextPhase)
		const next: AuthorityRecord = { ...authority, phase: nextPhase, revision: authority.revision + 1 }
		this.#authorities.set(walletKey, next)
		return authorityProjection(next)
	}

	async permissionsFor(query: unknown): Promise<Readonly<MonetaryPermissionProjection>> {
		const captured = captureObject(query, ['walletKey', 'migrationEpoch', 'bucketKey'], 'BUCKET_OWNERSHIP_MISMATCH', 'Permission query')
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const authority = this.#requireAuthority(walletKey, migrationEpoch)
		const bucketKey = monetaryBucketKey(decodeMonetaryBucketKey(captured.bucketKey))
		const bucket = decodeMonetaryBucketKey(bucketKey)
		if (bucket.user !== authority.user) fail('BUCKET_OWNERSHIP_MISMATCH', 'Bucket user does not match wallet authority')
		const retainedRecovery = [...(this.#items.get(walletKey)?.values() ?? [])].some(
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
	}

	async nip60Policy(query: unknown): Promise<Nip60Policy> {
		const { walletKey, migrationEpoch } = captureAuthorityQuery(query)
		return policyForCurrentAuthority(this.#requireAuthority(walletKey, migrationEpoch).phase)
	}

	async createPlannedMigrationItem(command: unknown): Promise<DomainCreationResult<MigrationItemRecord>> {
		const captured = captureObject(
			command,
			['walletKey', 'migrationEpoch', 'itemId', 'sourceBucket'],
			'INVALID_QUARANTINE_TRANSITION',
			'Create migration item command',
		)
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const authority = this.#requireAuthority(walletKey, migrationEpoch)
		if (authority.phase === 'cutover-committed') {
			fail('INVALID_QUARANTINE_TRANSITION', 'New migration items cannot be created after cutover')
		}
		const id = requireSafeId(captured.itemId, 'migration item id')
		const sourceBucket = createMonetaryBucketIdentity(captured.sourceBucket)
		if (sourceBucket.user !== authority.user) fail('BUCKET_OWNERSHIP_MISMATCH', 'Migration source belongs to another wallet')
		if (sourceBucket.kind === 'coco-ordinary') fail('INVALID_QUARANTINE_TRANSITION', 'Coco ordinary value is not a legacy migration source')
		const sourceBucketKey = monetaryBucketKey(sourceBucket)
		const items = this.#items.get(walletKey) ?? new Map<string, MigrationItemRecord>()
		const existing = items.get(id)
		if (existing) {
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
		items.set(id, record)
		this.#items.set(walletKey, items)
		return Object.freeze({ created: true, value: itemProjection(record) })
	}

	async loadMigrationItem(query: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = captureObject(
			query,
			['walletKey', 'migrationEpoch', 'itemId'],
			'INVALID_QUARANTINE_TRANSITION',
			'Migration item query',
		)
		return itemProjection(
			this.#requireItem(
				requireWalletKey(captured.walletKey),
				requireEpoch(captured.migrationEpoch),
				requireSafeId(captured.itemId, 'itemId'),
			),
		)
	}

	async listMigrationItems(query: unknown): Promise<readonly Readonly<MigrationItemRecord>[]> {
		const { walletKey, migrationEpoch } = captureAuthorityQuery(query)
		this.#requireAuthority(walletKey, migrationEpoch)
		return Object.freeze(
			[...(this.#items.get(walletKey)?.values() ?? [])]
				.filter((item) => item.migrationEpoch === migrationEpoch)
				.map(itemProjection)
				.sort((left, right) => left.id.localeCompare(right.id)),
		)
	}

	async bindCocoOperationOnce(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = captureVersionedCommand(command, ['itemId', 'operationId'])
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		const item = this.#requireItem(walletKey, migrationEpoch, itemId)
		const expectedRevision = requireRevision(captured.expectedRevision)
		if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
		if (item.state !== 'planned' && item.state !== 'prepared') fail('INVALID_QUARANTINE_TRANSITION', 'Operation cannot bind in this state')
		if (item.cocoOperationId) fail('INVALID_QUARANTINE_TRANSITION', 'Coco operation identity is already bound')
		const next: MigrationItemRecord = {
			...item,
			cocoOperationId: requireSafeId(captured.operationId, 'operationId'),
			revision: item.revision + 1,
		}
		this.#items.get(walletKey)!.set(itemId, next)
		return itemProjection(next)
	}

	async advanceMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = captureVersionedCommand(command, ['itemId', 'action'])
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		const item = this.#requireItem(walletKey, migrationEpoch, itemId)
		const expectedRevision = requireRevision(captured.expectedRevision)
		if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
		const action = parseItemAction(captured.action)
		let nextState: MigrationItemState
		if (item.state === 'planned' && action === 'prepare') nextState = 'prepared'
		else if (item.state === 'prepared' && action === 'begin-execution' && item.cocoOperationId) nextState = 'executing'
		else if (item.state === 'executing' && action === 'verify') nextState = 'verified'
		else fail('INVALID_QUARANTINE_TRANSITION', `Action ${action} is invalid from ${parseMigrationItemState(item.state)}`)
		const next: MigrationItemRecord = { ...item, state: nextState, revision: item.revision + 1 }
		this.#items.get(walletKey)!.set(itemId, next)
		return itemProjection(next)
	}

	async quarantineMigrationItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		const captured = captureVersionedCommand(command, ['itemId', 'reason'])
		const walletKey = requireWalletKey(captured.walletKey)
		const migrationEpoch = requireEpoch(captured.migrationEpoch)
		const itemId = requireSafeId(captured.itemId, 'itemId')
		const item = this.#requireItem(walletKey, migrationEpoch, itemId)
		const expectedRevision = requireRevision(captured.expectedRevision)
		if (item.revision !== expectedRevision) fail('STALE_REVISION', 'Observed migration item revision is not current')
		if (item.state === 'verified' || item.state === 'quarantined') {
			fail('INVALID_QUARANTINE_TRANSITION', 'Terminal migration item cannot be quarantined or reopened')
		}
		const next: MigrationItemRecord = {
			...item,
			state: 'quarantined',
			quarantineReason: parseQuarantineReason(captured.reason),
			revision: item.revision + 1,
		}
		this.#items.get(walletKey)!.set(itemId, next)
		return itemProjection(next)
	}
}

export class MigrationCoordinator {
	readonly #store: MigrationCoordinatorStore

	constructor(store: MigrationCoordinatorStore) {
		if (!store || store.atomicity !== 'linearizable-domain-transition-v1') {
			fail('INVALID_TRANSITION', 'Migration store does not declare the required atomic domain semantics')
		}
		this.#store = store
	}

	initialize(command: unknown): Promise<DomainCreationResult<AuthorityStatus>> {
		return this.#store.createInitialAuthority(command)
	}

	status(query: unknown): Promise<Readonly<AuthorityStatus>> {
		return this.#store.loadAuthority(query)
	}

	advanceAuthority(command: unknown): Promise<Readonly<AuthorityStatus>> {
		return this.#store.advanceAuthorityPhase(command)
	}

	permissionsFor(query: unknown): Promise<Readonly<MonetaryPermissionProjection>> {
		return this.#store.permissionsFor(query)
	}

	nip60Policy(query: unknown): Promise<Nip60Policy> {
		return this.#store.nip60Policy(query)
	}

	createPlannedItem(command: unknown): Promise<DomainCreationResult<MigrationItemRecord>> {
		return this.#store.createPlannedMigrationItem(command)
	}

	item(query: unknown): Promise<Readonly<MigrationItemRecord>> {
		return this.#store.loadMigrationItem(query)
	}

	items(query: unknown): Promise<readonly Readonly<MigrationItemRecord>[]> {
		return this.#store.listMigrationItems(query)
	}

	bindCocoOperation(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		return this.#store.bindCocoOperationOnce(command)
	}

	advanceItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		return this.#store.advanceMigrationItem(command)
	}

	quarantineItem(command: unknown): Promise<Readonly<MigrationItemRecord>> {
		return this.#store.quarantineMigrationItem(command)
	}
}
