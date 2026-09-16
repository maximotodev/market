import { captureArray, captureObject, fail, type CocoHostErrorCode } from '../errors'
import { normalizeNostrPubkey, parseCocoEnvironment, parseCocoWalletNamespace, type CocoG9aEnvironment } from '../namespace'
import {
	canonicalizeMintUrl,
	createMonetaryBucketIdentity,
	decodeMonetaryBucketKey,
	monetaryBucketKey,
	normalizeUnit,
	requireSafeId,
	type CanonicalMintUrl,
	type MigrationItemState,
	type MonetaryBucketIdentity,
	type MonetaryBucketKey,
} from './types'

export const PRODUCTION_MIGRATION_INVENTORY_SEAL_SUPPORTED = false

export const REQUIRED_MIGRATION_SOURCE_DOMAINS = Object.freeze([
	'legacy-proof-store',
	'legacy-reservations',
	'pending-outbound',
	'auction-p2pk-locks',
	'coco-opening-baseline',
] as const)

export type MigrationInventorySourceDomain = (typeof REQUIRED_MIGRATION_SOURCE_DOMAINS)[number]
export type MigrationInventoryStatus = 'building' | 'sealed' | 'invalidated'
export type MigrationInventoryInvalidationReason = 'late-monetary-discovery'
export type MigrationSourceCategory = 'legacy-ready' | 'legacy-locked' | 'legacy-unresolved' | 'legacy-pending-outbound'
export type MigrationDestinationDisposition =
	| 'coco-ready'
	| 'coco-reserved'
	| 'retained-legacy-workflow'
	| 'quarantined'
	| 'verified-consumed-external'

export interface MigrationInventorySourceCompletion {
	sourceDomain: MigrationInventorySourceDomain
	evidenceKind: 'test-fixture-snapshot'
	snapshotId: string
	inventoryRevision: number
}

export interface MigrationInventoryInvalidation {
	reason: MigrationInventoryInvalidationReason
	sourceLocator: string
}

export interface MigrationInventoryHeader {
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	revision: number
	status: MigrationInventoryStatus
	requiredSources: readonly MigrationInventorySourceDomain[]
	completedSources: readonly Readonly<MigrationInventorySourceCompletion>[]
	sealedEntryCount?: number
	sealedAuthorityRevision?: number
	invalidation?: Readonly<MigrationInventoryInvalidation>
}

export interface MigrationInventoryDisposition {
	destinationDisposition: MigrationDestinationDisposition
	destinationAmount: bigint
	verifiedProtocolFee: bigint
	revision: number
	migrationItemId?: string
	migrationItemRevision?: number
	cocoOperationId?: string
	quarantineHandoffItemId?: string
	quarantineHandoffItemRevision?: number
}

interface MigrationInventoryEntryBase {
	id: string
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	membershipRevision: number
	sourceDomain: MigrationInventorySourceDomain
	sourceLocator: string
	mint: CanonicalMintUrl
	unit: string
	amount: bigint
}

export interface MigrationInventoryClaimEntry extends MigrationInventoryEntryBase {
	kind: 'migration-claim'
	sourceBucketKey: MonetaryBucketKey
	disposition: Readonly<MigrationInventoryDisposition>
}

export interface MigrationInventoryOpeningBaselineEntry extends MigrationInventoryEntryBase {
	kind: 'coco-opening-baseline'
	sourceDomain: 'coco-opening-baseline'
}

export type MigrationInventoryEntry = MigrationInventoryClaimEntry | MigrationInventoryOpeningBaselineEntry

export type MigrationInventoryEntryDiscoveryResult =
	| {
			outcome: 'recorded'
			inventory: Readonly<MigrationInventoryHeader>
			entry: Readonly<MigrationInventoryEntry>
	  }
	| {
			outcome: 'already-recorded'
			inventory: Readonly<MigrationInventoryHeader>
			entry: Readonly<MigrationInventoryEntry>
	  }
	| {
			outcome: 'late-discovery-invalidated'
			inventory: Readonly<MigrationInventoryHeader>
	  }

export interface MigrationInventoryItemReference {
	id: string
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	state: MigrationItemState
	revision: number
	sourceBucketKey: MonetaryBucketKey
}

export interface MigrationInventoryHandoffReference {
	sourceItemId: string
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
	sourceItemRevision: number
	sourceBucketKey: MonetaryBucketKey
}

const SOURCE_DOMAIN_SET = new Set<string>(REQUIRED_MIGRATION_SOURCE_DOMAINS)

function requireEpoch(value: unknown, code: CocoHostErrorCode): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
		fail(code, 'Migration inventory epoch is invalid')
	}
	return value
}

export function requireInventoryRevision(value: unknown, code: CocoHostErrorCode = 'STALE_REVISION'): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code, 'Migration inventory revision is invalid')
	return value as number
}

export function requireMigrationAmount(value: unknown, code: CocoHostErrorCode = 'ACCOUNTING_INPUT_INVALID'): bigint {
	if (typeof value !== 'bigint' || value < 0n) fail(code, 'Migration amount must be a non-negative bigint')
	return value
}

export function parseMigrationInventorySourceDomain(
	value: unknown,
	code: CocoHostErrorCode = 'INVALID_TRANSITION',
): MigrationInventorySourceDomain {
	if (typeof value !== 'string' || !SOURCE_DOMAIN_SET.has(value)) fail(code, 'Migration inventory source domain is invalid')
	return value as MigrationInventorySourceDomain
}

export function parseMigrationInventoryStatus(value: unknown, code: CocoHostErrorCode = 'INVALID_TRANSITION'): MigrationInventoryStatus {
	switch (value) {
		case 'building':
		case 'sealed':
		case 'invalidated':
			return value
		default:
			fail(code, 'Migration inventory status is invalid')
	}
}

export function parseMigrationSourceCategory(
	value: unknown,
	code: CocoHostErrorCode = 'ACCOUNTING_INPUT_INVALID',
): MigrationSourceCategory {
	switch (value) {
		case 'legacy-ready':
		case 'legacy-locked':
		case 'legacy-unresolved':
		case 'legacy-pending-outbound':
			return value
		default:
			fail(code, 'Migration source category is invalid')
	}
}

export function parseMigrationDestinationDisposition(
	value: unknown,
	code: CocoHostErrorCode = 'ACCOUNTING_INPUT_INVALID',
): MigrationDestinationDisposition {
	switch (value) {
		case 'coco-ready':
		case 'coco-reserved':
		case 'retained-legacy-workflow':
		case 'quarantined':
		case 'verified-consumed-external':
			return value
		default:
			fail(code, 'Migration destination disposition is invalid')
	}
}

function parseInvalidationReason(value: unknown, code: CocoHostErrorCode): MigrationInventoryInvalidationReason {
	if (value !== 'late-monetary-discovery') fail(code, 'Migration inventory invalidation reason is invalid')
	return value
}

function sourceCompletionProjection(value: MigrationInventorySourceCompletion): Readonly<MigrationInventorySourceCompletion> {
	return Object.freeze({
		sourceDomain: value.sourceDomain,
		evidenceKind: value.evidenceKind,
		snapshotId: value.snapshotId,
		inventoryRevision: value.inventoryRevision,
	})
}

function invalidationProjection(value: MigrationInventoryInvalidation): Readonly<MigrationInventoryInvalidation> {
	return Object.freeze({ reason: value.reason, sourceLocator: value.sourceLocator })
}

export function inventoryProjection(value: MigrationInventoryHeader): Readonly<MigrationInventoryHeader> {
	return Object.freeze({
		walletKey: value.walletKey,
		user: value.user,
		environment: value.environment,
		migrationEpoch: value.migrationEpoch,
		revision: value.revision,
		status: value.status,
		requiredSources: Object.freeze([...value.requiredSources]),
		completedSources: Object.freeze(value.completedSources.map(sourceCompletionProjection)),
		...(value.sealedEntryCount === undefined ? {} : { sealedEntryCount: value.sealedEntryCount }),
		...(value.sealedAuthorityRevision === undefined ? {} : { sealedAuthorityRevision: value.sealedAuthorityRevision }),
		...(value.invalidation ? { invalidation: invalidationProjection(value.invalidation) } : {}),
	})
}

function dispositionProjection(value: MigrationInventoryDisposition): Readonly<MigrationInventoryDisposition> {
	return Object.freeze({
		destinationDisposition: value.destinationDisposition,
		destinationAmount: value.destinationAmount,
		verifiedProtocolFee: value.verifiedProtocolFee,
		revision: value.revision,
		...(value.migrationItemId ? { migrationItemId: value.migrationItemId } : {}),
		...(value.migrationItemRevision === undefined ? {} : { migrationItemRevision: value.migrationItemRevision }),
		...(value.cocoOperationId ? { cocoOperationId: value.cocoOperationId } : {}),
		...(value.quarantineHandoffItemId ? { quarantineHandoffItemId: value.quarantineHandoffItemId } : {}),
		...(value.quarantineHandoffItemRevision === undefined ? {} : { quarantineHandoffItemRevision: value.quarantineHandoffItemRevision }),
	})
}

export function inventoryEntryProjection(value: MigrationInventoryEntry): Readonly<MigrationInventoryEntry> {
	const common = {
		id: value.id,
		walletKey: value.walletKey,
		user: value.user,
		environment: value.environment,
		migrationEpoch: value.migrationEpoch,
		membershipRevision: value.membershipRevision,
		sourceDomain: value.sourceDomain,
		sourceLocator: value.sourceLocator,
		mint: value.mint,
		unit: value.unit,
		amount: value.amount,
	}
	return value.kind === 'coco-opening-baseline'
		? Object.freeze({ ...common, kind: value.kind, sourceDomain: value.sourceDomain })
		: Object.freeze({
				...common,
				kind: value.kind,
				sourceBucketKey: value.sourceBucketKey,
				disposition: dispositionProjection(value.disposition),
			})
}

function captureCompletionEvidence(value: unknown, code: CocoHostErrorCode): Omit<MigrationInventorySourceCompletion, 'inventoryRevision'> {
	const captured = captureObject(value, ['sourceDomain', 'evidenceKind', 'snapshotId'], code, 'Inventory source completion')
	if (captured.evidenceKind !== 'test-fixture-snapshot') fail(code, 'Inventory source completeness evidence is not trusted')
	return Object.freeze({
		sourceDomain: parseMigrationInventorySourceDomain(captured.sourceDomain, code),
		evidenceKind: 'test-fixture-snapshot',
		snapshotId: requireSafeId(captured.snapshotId, 'source snapshot id'),
	})
}

function captureStoredCompletion(value: unknown, code: CocoHostErrorCode): Readonly<MigrationInventorySourceCompletion> {
	const captured = captureObject(
		value,
		['sourceDomain', 'evidenceKind', 'snapshotId', 'inventoryRevision'],
		code,
		'Inventory source completion',
	)
	const evidence = captureCompletionEvidence(
		{ sourceDomain: captured.sourceDomain, evidenceKind: captured.evidenceKind, snapshotId: captured.snapshotId },
		code,
	)
	return Object.freeze({ ...evidence, inventoryRevision: requireInventoryRevision(captured.inventoryRevision, code) })
}

function captureDisposition(value: unknown, code: CocoHostErrorCode): Readonly<MigrationInventoryDisposition> {
	const captured = captureObject(
		value,
		[
			'destinationDisposition',
			'destinationAmount',
			'verifiedProtocolFee',
			'revision',
			'migrationItemId',
			'migrationItemRevision',
			'cocoOperationId',
			'quarantineHandoffItemId',
			'quarantineHandoffItemRevision',
		],
		code,
		'Inventory disposition',
	)
	const destinationDisposition = parseMigrationDestinationDisposition(captured.destinationDisposition, code)
	const verifiedProtocolFee = requireMigrationAmount(captured.verifiedProtocolFee, code)
	if ((destinationDisposition === 'retained-legacy-workflow' || destinationDisposition === 'quarantined') && verifiedProtocolFee !== 0n) {
		fail(code, 'Retained and quarantined inventory dispositions cannot charge a protocol fee')
	}
	const migrationItemId = captured.migrationItemId === undefined ? undefined : requireSafeId(captured.migrationItemId, 'migration item id')
	const migrationItemRevision =
		captured.migrationItemRevision === undefined ? undefined : requireInventoryRevision(captured.migrationItemRevision, code)
	const cocoOperationId = captured.cocoOperationId === undefined ? undefined : requireSafeId(captured.cocoOperationId, 'operationId')
	const quarantineHandoffItemId =
		captured.quarantineHandoffItemId === undefined
			? undefined
			: requireSafeId(captured.quarantineHandoffItemId, 'quarantine handoff item id')
	const quarantineHandoffItemRevision =
		captured.quarantineHandoffItemRevision === undefined
			? undefined
			: requireInventoryRevision(captured.quarantineHandoffItemRevision, code)
	if ((migrationItemId === undefined) !== (migrationItemRevision === undefined)) {
		fail(code, 'Inventory disposition migration item reference is incomplete')
	}
	if ((quarantineHandoffItemId === undefined) !== (quarantineHandoffItemRevision === undefined)) {
		fail(code, 'Inventory disposition quarantine handoff reference is incomplete')
	}
	if (quarantineHandoffItemId !== undefined && destinationDisposition !== 'quarantined') {
		fail(code, 'Inventory quarantine handoff reference requires a quarantined disposition')
	}
	if (
		migrationItemId !== undefined &&
		quarantineHandoffItemId !== undefined &&
		(migrationItemId !== quarantineHandoffItemId || migrationItemRevision !== quarantineHandoffItemRevision)
	) {
		fail(code, 'Inventory migration item and quarantine handoff bindings disagree')
	}
	return Object.freeze({
		destinationDisposition,
		destinationAmount: requireMigrationAmount(captured.destinationAmount, code),
		verifiedProtocolFee,
		revision: requireInventoryRevision(captured.revision, code),
		...(migrationItemId ? { migrationItemId, migrationItemRevision } : {}),
		...(cocoOperationId ? { cocoOperationId } : {}),
		...(quarantineHandoffItemId ? { quarantineHandoffItemId, quarantineHandoffItemRevision } : {}),
	})
}

export function parseStoredInventoryHeader(
	value: unknown,
	code: CocoHostErrorCode = 'COORDINATOR_STORAGE_FAILURE',
): MigrationInventoryHeader {
	const captured = captureObject(
		value,
		[
			'walletKey',
			'user',
			'environment',
			'migrationEpoch',
			'revision',
			'status',
			'requiredSources',
			'completedSources',
			'sealedEntryCount',
			'sealedAuthorityRevision',
			'invalidation',
		],
		code,
		'Migration inventory header',
	)
	const wallet = parseCocoWalletNamespace(captured.walletKey)
	const user = normalizeNostrPubkey(captured.user)
	const environment = parseCocoEnvironment(captured.environment)
	const migrationEpoch = requireEpoch(captured.migrationEpoch, code)
	const revision = requireInventoryRevision(captured.revision, code)
	const status = parseMigrationInventoryStatus(captured.status, code)
	const requiredSources = captureArray(captured.requiredSources, code, 'Required inventory sources').map((source) =>
		parseMigrationInventorySourceDomain(source, code),
	)
	const completedSources = captureArray(captured.completedSources, code, 'Completed inventory sources').map((source) =>
		captureStoredCompletion(source, code),
	)
	if (
		wallet.pubkey !== user ||
		wallet.environment !== environment ||
		requiredSources.length !== REQUIRED_MIGRATION_SOURCE_DOMAINS.length ||
		requiredSources.some((source, index) => source !== REQUIRED_MIGRATION_SOURCE_DOMAINS[index]) ||
		new Set(completedSources.map((source) => source.sourceDomain)).size !== completedSources.length ||
		completedSources.some((source) => source.inventoryRevision < 1 || source.inventoryRevision > revision)
	) {
		fail(code, 'Migration inventory header identity or source contract is inconsistent')
	}
	const sealedEntryCount = captured.sealedEntryCount === undefined ? undefined : requireInventoryRevision(captured.sealedEntryCount, code)
	const sealedAuthorityRevision =
		captured.sealedAuthorityRevision === undefined ? undefined : requireInventoryRevision(captured.sealedAuthorityRevision, code)
	let invalidation: Readonly<MigrationInventoryInvalidation> | undefined
	if (captured.invalidation !== undefined) {
		const invalidationValue = captureObject(captured.invalidation, ['reason', 'sourceLocator'], code, 'Inventory invalidation')
		invalidation = Object.freeze({
			reason: parseInvalidationReason(invalidationValue.reason, code),
			sourceLocator: requireSafeId(invalidationValue.sourceLocator, 'late source locator'),
		})
	}
	if (
		(status === 'building' && (sealedEntryCount !== undefined || sealedAuthorityRevision !== undefined || invalidation)) ||
		(status === 'sealed' && (sealedEntryCount === undefined || sealedAuthorityRevision === undefined || invalidation)) ||
		(status === 'invalidated' && !invalidation)
	) {
		fail(code, 'Migration inventory header lifecycle is inconsistent')
	}
	return {
		walletKey: wallet.namespace,
		user,
		environment,
		migrationEpoch,
		revision,
		status,
		requiredSources: Object.freeze([...requiredSources]),
		completedSources: Object.freeze(completedSources),
		...(sealedEntryCount === undefined ? {} : { sealedEntryCount }),
		...(sealedAuthorityRevision === undefined ? {} : { sealedAuthorityRevision }),
		...(invalidation ? { invalidation } : {}),
	}
}

export function parseStoredInventoryEntry(
	value: unknown,
	code: CocoHostErrorCode = 'COORDINATOR_STORAGE_FAILURE',
): MigrationInventoryEntry {
	const captured = captureObject(
		value,
		[
			'id',
			'walletKey',
			'user',
			'environment',
			'migrationEpoch',
			'membershipRevision',
			'kind',
			'sourceDomain',
			'sourceLocator',
			'mint',
			'unit',
			'amount',
			'sourceBucketKey',
			'disposition',
		],
		code,
		'Migration inventory entry',
	)
	const id = requireSafeId(captured.id, 'inventory entry id')
	const wallet = parseCocoWalletNamespace(captured.walletKey)
	const user = normalizeNostrPubkey(captured.user)
	const environment = parseCocoEnvironment(captured.environment)
	const migrationEpoch = requireEpoch(captured.migrationEpoch, code)
	const membershipRevision = requireInventoryRevision(captured.membershipRevision, code)
	const sourceDomain = parseMigrationInventorySourceDomain(captured.sourceDomain, code)
	const sourceLocator = requireSafeId(captured.sourceLocator, 'source locator')
	const mint = canonicalizeMintUrl(captured.mint)
	const unit = normalizeUnit(captured.unit)
	const amount = requireMigrationAmount(captured.amount, code)
	if (wallet.pubkey !== user || wallet.environment !== environment || membershipRevision < 1) {
		fail(code, 'Migration inventory entry identity is inconsistent')
	}
	if (captured.kind === 'coco-opening-baseline') {
		if (sourceDomain !== 'coco-opening-baseline' || captured.sourceBucketKey !== undefined || captured.disposition !== undefined) {
			fail(code, 'Coco opening baseline inventory entry is inconsistent')
		}
		return {
			id,
			walletKey: wallet.namespace,
			user,
			environment,
			migrationEpoch,
			membershipRevision,
			kind: captured.kind,
			sourceDomain,
			sourceLocator,
			mint,
			unit,
			amount,
		}
	}
	if (captured.kind !== 'migration-claim' || sourceDomain === 'coco-opening-baseline' || typeof captured.sourceBucketKey !== 'string') {
		fail(code, 'Migration claim inventory entry is inconsistent')
	}
	const sourceBucket = createMonetaryBucketIdentity({ ...parseStoredBucket(captured.sourceBucketKey, code) })
	const sourceBucketKey = monetaryBucketKey(sourceBucket)
	if (
		sourceBucket.user !== user ||
		sourceBucket.mint !== mint ||
		sourceBucket.unit !== unit ||
		!sourceDomainAcceptsBucket(sourceDomain, sourceBucket)
	) {
		fail(code, 'Migration inventory source provenance is inconsistent')
	}
	return {
		id,
		walletKey: wallet.namespace,
		user,
		environment,
		migrationEpoch,
		membershipRevision,
		kind: captured.kind,
		sourceDomain,
		sourceLocator,
		mint,
		unit,
		amount,
		sourceBucketKey,
		disposition: captureDisposition(captured.disposition, code),
	}
}

function parseStoredBucket(value: string, code: CocoHostErrorCode): Readonly<MonetaryBucketIdentity> {
	try {
		return decodeMonetaryBucketKey(value)
	} catch {
		fail(code, 'Inventory source bucket key is invalid')
	}
}

function sourceDomainAcceptsBucket(sourceDomain: MigrationInventorySourceDomain, bucket: MonetaryBucketIdentity): boolean {
	if (bucket.kind === 'unresolved') return sourceDomain !== 'coco-opening-baseline'
	switch (sourceDomain) {
		case 'legacy-proof-store':
			return bucket.kind === 'legacy-ready'
		case 'legacy-reservations':
			return bucket.kind === 'legacy-inflight'
		case 'pending-outbound':
			return bucket.kind === 'pending-outbound'
		case 'auction-p2pk-locks':
			return bucket.kind === 'auction-p2pk-recovery'
		case 'coco-opening-baseline':
			return false
	}
}

export function sourceCategoryForInventoryEntry(entry: MigrationInventoryClaimEntry): MigrationSourceCategory {
	const bucket = parseStoredBucket(entry.sourceBucketKey, 'ACCOUNTING_INPUT_INVALID')
	switch (bucket.kind) {
		case 'legacy-ready':
			return 'legacy-ready'
		case 'legacy-inflight':
		case 'auction-p2pk-recovery':
			return 'legacy-locked'
		case 'pending-outbound':
			return 'legacy-pending-outbound'
		case 'unresolved':
			return 'legacy-unresolved'
		case 'coco-ordinary':
			fail('ACCOUNTING_INPUT_INVALID', 'Coco ordinary bucket cannot be a migration claim source')
	}
}

export function createBuildingInventory(authority: {
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	migrationEpoch: string
}): MigrationInventoryHeader {
	return {
		walletKey: authority.walletKey,
		user: authority.user,
		environment: authority.environment,
		migrationEpoch: authority.migrationEpoch,
		revision: 0,
		status: 'building',
		requiredSources: REQUIRED_MIGRATION_SOURCE_DOMAINS,
		completedSources: Object.freeze([]),
	}
}

function safelyAssociatedId(input: unknown, field: 'entryId' | 'sourceLocator', label: string): string | undefined {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
	try {
		const descriptor = Reflect.getOwnPropertyDescriptor(input, field)
		if (!descriptor || !('value' in descriptor)) return undefined
		try {
			return requireSafeId(descriptor.value, label)
		} catch {
			return undefined
		}
	} catch {
		return undefined
	}
}

function associatedSealedEntry(input: unknown, entries: readonly MigrationInventoryEntry[]): MigrationInventoryEntry | undefined {
	const id = safelyAssociatedId(input, 'entryId', 'inventory entry id')
	const sourceLocator = safelyAssociatedId(input, 'sourceLocator', 'source locator')
	return entries.find(
		(entry) => (id !== undefined && entry.id === id) || (sourceLocator !== undefined && entry.sourceLocator === sourceLocator),
	)
}

export function discoverInventoryEntry(
	header: MigrationInventoryHeader,
	entries: readonly MigrationInventoryEntry[],
	input: unknown,
): MigrationInventoryEntryDiscoveryResult {
	if (header.status === 'invalidated') fail('INVALID_TRANSITION', 'Invalidated migration inventory cannot accept discoveries')
	const associated = header.status === 'sealed' ? associatedSealedEntry(input, entries) : undefined
	let id: string
	let sourceLocator: string
	let entry: MigrationInventoryEntry
	try {
		const captured = captureObject(
			input,
			['entryId', 'kind', 'sourceDomain', 'sourceLocator', 'mint', 'unit', 'amount', 'sourceBucket', 'disposition'],
			'INVALID_TRANSITION',
			'Inventory entry discovery',
		)
		sourceLocator = requireSafeId(captured.sourceLocator, 'source locator')
		id = requireSafeId(captured.entryId, 'inventory entry id')
		const sourceDomain = parseMigrationInventorySourceDomain(captured.sourceDomain)
		const mint = canonicalizeMintUrl(captured.mint)
		const unit = normalizeUnit(captured.unit)
		const amount = requireMigrationAmount(captured.amount, 'INVALID_TRANSITION')
		const common: MigrationInventoryEntryBase = {
			id,
			walletKey: header.walletKey,
			user: header.user,
			environment: header.environment,
			migrationEpoch: header.migrationEpoch,
			membershipRevision: header.revision + 1,
			sourceDomain,
			sourceLocator,
			mint,
			unit,
			amount,
		}
		if (captured.kind === 'coco-opening-baseline') {
			if (sourceDomain !== 'coco-opening-baseline' || captured.sourceBucket !== undefined || captured.disposition !== undefined) {
				fail('INVALID_TRANSITION', 'Coco opening baseline discovery is inconsistent')
			}
			entry = { ...common, kind: captured.kind, sourceDomain }
		} else {
			if (captured.kind !== 'migration-claim' || sourceDomain === 'coco-opening-baseline') {
				fail('INVALID_TRANSITION', 'Migration inventory entry kind is invalid')
			}
			const sourceBucket = createMonetaryBucketIdentity(captured.sourceBucket)
			if (
				sourceBucket.user !== header.user ||
				sourceBucket.mint !== mint ||
				sourceBucket.unit !== unit ||
				!sourceDomainAcceptsBucket(sourceDomain, sourceBucket)
			) {
				fail('BUCKET_OWNERSHIP_MISMATCH', 'Migration inventory source does not match its wallet or source domain')
			}
			const disposition = captureDisposition(captured.disposition, 'INVALID_TRANSITION')
			if (disposition.revision !== 0) fail('INVALID_TRANSITION', 'Initial inventory disposition must start at revision zero')
			entry = { ...common, kind: captured.kind, sourceBucketKey: monetaryBucketKey(sourceBucket), disposition }
		}
	} catch (error) {
		if (header.status !== 'sealed' || !associated) throw error
		return Object.freeze({
			outcome: 'late-discovery-invalidated',
			inventory: inventoryProjection(invalidateInventory(header, associated.sourceLocator)),
		})
	}
	if (header.status === 'sealed') {
		const existing = entries.find((candidate) => candidate.id === id || candidate.sourceLocator === sourceLocator)
		if (existing && existing.id === id && existing.sourceLocator === sourceLocator && immutableInventorySourceMatches(existing, entry)) {
			return Object.freeze({
				outcome: 'already-recorded',
				inventory: inventoryProjection(header),
				entry: inventoryEntryProjection(existing),
			})
		}
		return Object.freeze({
			outcome: 'late-discovery-invalidated',
			inventory: inventoryProjection(invalidateInventory(header, associated?.sourceLocator ?? sourceLocator)),
		})
	}
	if (entries.some((candidate) => candidate.id === id || candidate.sourceLocator === sourceLocator)) {
		fail('COORDINATOR_RECORD_EXISTS', 'Migration inventory source identity already exists')
	}
	if (
		entry.kind === 'coco-opening-baseline' &&
		entries.some(
			(candidate) => candidate.kind === 'coco-opening-baseline' && candidate.mint === entry.mint && candidate.unit === entry.unit,
		)
	) {
		fail('COORDINATOR_RECORD_EXISTS', 'Coco opening baseline already exists for mint and unit')
	}
	const inventory = inventoryProjection({
		...header,
		revision: header.revision + 1,
		completedSources: Object.freeze(header.completedSources.filter((completion) => completion.sourceDomain !== entry.sourceDomain)),
	})
	return Object.freeze({ outcome: 'recorded', inventory, entry: inventoryEntryProjection(entry) })
}

function immutableInventorySourceMatches(left: MigrationInventoryEntry, right: MigrationInventoryEntry): boolean {
	return (
		left.id === right.id &&
		left.walletKey === right.walletKey &&
		left.user === right.user &&
		left.environment === right.environment &&
		left.migrationEpoch === right.migrationEpoch &&
		left.kind === right.kind &&
		left.sourceDomain === right.sourceDomain &&
		left.sourceLocator === right.sourceLocator &&
		left.mint === right.mint &&
		left.unit === right.unit &&
		left.amount === right.amount &&
		(left.kind === 'coco-opening-baseline' || (right.kind === 'migration-claim' && left.sourceBucketKey === right.sourceBucketKey))
	)
}

export function completeInventorySource(header: MigrationInventoryHeader, input: unknown): Readonly<MigrationInventoryHeader> {
	if (header.status !== 'building') fail('INVALID_TRANSITION', 'Only a building inventory may record source completeness')
	if (header.environment !== 'test') fail('INVALID_TRANSITION', 'Trusted production source enumeration is not available')
	const evidence = captureCompletionEvidence(input, 'INVALID_TRANSITION')
	const completion = Object.freeze({ ...evidence, inventoryRevision: header.revision + 1 })
	if (header.completedSources.some((source) => source.sourceDomain === completion.sourceDomain)) {
		fail('COORDINATOR_RECORD_EXISTS', 'Migration inventory source is already complete')
	}
	return inventoryProjection({
		...header,
		revision: header.revision + 1,
		completedSources: Object.freeze(
			[...header.completedSources, completion].sort((left, right) => left.sourceDomain.localeCompare(right.sourceDomain)),
		),
	})
}

export function sealInventory(
	header: MigrationInventoryHeader,
	entries: readonly MigrationInventoryEntry[],
	authorityRevision: number,
	items: readonly { id: string; sourceBucketKey: MonetaryBucketKey }[],
): Readonly<MigrationInventoryHeader> {
	if (header.status !== 'building') fail('INVALID_TRANSITION', 'Only a building inventory may be sealed')
	// The explicit test environment is the only currently trusted enumeration boundary.
	if (header.environment !== 'test') fail('INVALID_TRANSITION', 'Production migration inventory sealing is not supported')
	if (
		header.completedSources.length !== REQUIRED_MIGRATION_SOURCE_DOMAINS.length ||
		REQUIRED_MIGRATION_SOURCE_DOMAINS.some(
			(sourceDomain) => !header.completedSources.some((completion) => completion.sourceDomain === sourceDomain),
		)
	) {
		fail('INVALID_TRANSITION', 'Migration inventory source enumeration is incomplete')
	}
	assertInventoryEntriesCoherent(header, entries)
	for (const item of items) {
		const matches = entries.filter(
			(entry) =>
				entry.kind === 'migration-claim' && entry.disposition.migrationItemId === item.id && entry.sourceBucketKey === item.sourceBucketKey,
		)
		if (matches.length !== 1) fail('INVALID_TRANSITION', 'Migration item is not represented exactly once in the sealed inventory')
	}
	return inventoryProjection({
		...header,
		revision: header.revision + 1,
		status: 'sealed',
		sealedEntryCount: entries.length,
		sealedAuthorityRevision: authorityRevision + 1,
	})
}

export function invalidateInventory(header: MigrationInventoryHeader, sourceLocator: string): Readonly<MigrationInventoryHeader> {
	if (header.status === 'invalidated') return inventoryProjection(header)
	return inventoryProjection({
		...header,
		revision: header.revision + 1,
		status: 'invalidated',
		invalidation: Object.freeze({ reason: 'late-monetary-discovery', sourceLocator: requireSafeId(sourceLocator, 'late source locator') }),
	})
}

export function updateInventoryEntryDisposition(
	header: MigrationInventoryHeader,
	entry: MigrationInventoryEntry,
	input: unknown,
): { inventory: Readonly<MigrationInventoryHeader>; entry: Readonly<MigrationInventoryEntry> } {
	if (header.status !== 'sealed') fail('INVALID_TRANSITION', 'Only a sealed inventory may evolve a disposition')
	if (entry.kind !== 'migration-claim') fail('INVALID_TRANSITION', 'Coco opening baseline has no migration disposition')
	assertInventoryEntryBinding(header, entry)
	const disposition = captureDisposition(input, 'INVALID_TRANSITION')
	if (disposition.revision !== entry.disposition.revision + 1) {
		fail('STALE_REVISION', 'Inventory disposition successor revision is invalid')
	}
	if (
		(entry.disposition.migrationItemId &&
			(entry.disposition.migrationItemId !== disposition.migrationItemId ||
				(disposition.migrationItemRevision ?? -1) < (entry.disposition.migrationItemRevision ?? -1))) ||
		(entry.disposition.cocoOperationId && entry.disposition.cocoOperationId !== disposition.cocoOperationId) ||
		(entry.disposition.quarantineHandoffItemId &&
			(entry.disposition.quarantineHandoffItemId !== disposition.quarantineHandoffItemId ||
				entry.disposition.quarantineHandoffItemRevision !== disposition.quarantineHandoffItemRevision))
	) {
		fail('INVALID_TRANSITION', 'Inventory disposition identity cannot be rebound')
	}
	return Object.freeze({
		inventory: inventoryProjection({ ...header, revision: header.revision + 1 }),
		entry: inventoryEntryProjection({ ...entry, disposition }),
	})
}

function migrationItemStateAcceptsDisposition(state: MigrationItemState, disposition: MigrationDestinationDisposition): boolean {
	switch (state) {
		case 'planned':
		case 'prepared':
		case 'executing':
			return disposition === 'retained-legacy-workflow'
		case 'verified':
			return disposition === 'retained-legacy-workflow'
		case 'quarantined':
			return disposition === 'quarantined'
	}
}

export function assertInventoryDispositionReferences(
	entry: MigrationInventoryEntry,
	items: readonly MigrationInventoryItemReference[],
	handoffs: readonly MigrationInventoryHandoffReference[],
	code: CocoHostErrorCode = 'INVALID_TRANSITION',
): void {
	if (entry.kind !== 'migration-claim') return
	const disposition = entry.disposition
	if (disposition.migrationItemId !== undefined) {
		const item = items.find((candidate) => candidate.id === disposition.migrationItemId)
		if (
			!item ||
			item.walletKey !== entry.walletKey ||
			item.user !== entry.user ||
			item.environment !== entry.environment ||
			item.migrationEpoch !== entry.migrationEpoch ||
			item.revision !== disposition.migrationItemRevision ||
			item.sourceBucketKey !== entry.sourceBucketKey ||
			!migrationItemStateAcceptsDisposition(item.state, disposition.destinationDisposition)
		) {
			fail(code, 'Inventory migration item provenance does not match the durable source item')
		}
	}
	if (disposition.quarantineHandoffItemId !== undefined) {
		const handoff = handoffs.find((candidate) => candidate.sourceItemId === disposition.quarantineHandoffItemId)
		const sourceItem = items.find((candidate) => candidate.id === disposition.quarantineHandoffItemId)
		if (
			!handoff ||
			!sourceItem ||
			handoff.walletKey !== entry.walletKey ||
			handoff.user !== entry.user ||
			handoff.environment !== entry.environment ||
			handoff.migrationEpoch !== entry.migrationEpoch ||
			handoff.sourceItemRevision !== disposition.quarantineHandoffItemRevision ||
			handoff.sourceBucketKey !== entry.sourceBucketKey ||
			sourceItem.walletKey !== handoff.walletKey ||
			sourceItem.user !== handoff.user ||
			sourceItem.environment !== handoff.environment ||
			sourceItem.migrationEpoch !== handoff.migrationEpoch ||
			sourceItem.state !== 'quarantined' ||
			sourceItem.revision !== handoff.sourceItemRevision ||
			sourceItem.sourceBucketKey !== handoff.sourceBucketKey
		) {
			fail(code, 'Inventory quarantine provenance does not match the durable recovery handoff')
		}
	}
}

export function assertInventoryEntryBinding(header: MigrationInventoryHeader, entry: MigrationInventoryEntry): void {
	if (
		entry.walletKey !== header.walletKey ||
		entry.user !== header.user ||
		entry.environment !== header.environment ||
		entry.migrationEpoch !== header.migrationEpoch ||
		entry.membershipRevision > header.revision
	) {
		fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory entry does not match its header')
	}
}

export function assertInventoryEntriesCoherent(header: MigrationInventoryHeader, entries: readonly MigrationInventoryEntry[]): void {
	const ids = new Set<string>()
	const sourceLocators = new Set<string>()
	const migrationItemIds = new Set<string>()
	const openingBaselines = new Set<string>()
	for (const entry of entries) {
		assertInventoryEntryBinding(header, entry)
		if (ids.has(entry.id) || sourceLocators.has(entry.sourceLocator)) {
			fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory contains duplicate source identity')
		}
		ids.add(entry.id)
		sourceLocators.add(entry.sourceLocator)
		if (entry.kind === 'coco-opening-baseline') {
			const key = JSON.stringify([entry.mint, entry.unit])
			if (openingBaselines.has(key)) fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory contains duplicate opening baseline')
			openingBaselines.add(key)
		} else if (entry.disposition.migrationItemId) {
			if (migrationItemIds.has(entry.disposition.migrationItemId)) {
				fail('COORDINATOR_STORAGE_FAILURE', 'Migration inventory contains duplicate migration item identity')
			}
			migrationItemIds.add(entry.disposition.migrationItemId)
		}
	}
}

export function inventoryHasMigrationItem(
	entries: readonly MigrationInventoryEntry[],
	item: { id: string; sourceBucketKey: MonetaryBucketKey },
): boolean {
	return entries.some(
		(entry) =>
			entry.kind === 'migration-claim' && entry.disposition.migrationItemId === item.id && entry.sourceBucketKey === item.sourceBucketKey,
	)
}
