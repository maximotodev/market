import { fail } from '../errors'
import { isCocoG9aNamespace } from '../namespace'
import {
	MIGRATION_PHASES,
	MONETARY_OWNERS,
	monetaryBucketKey,
	type AuthorityVersion,
	type BucketAuthority,
	type MigrationPhase,
	type MonetaryBucketIdentity,
	type MonetaryCapability,
	type MonetaryOwner,
	type WalletAuthoritySnapshot,
	createMonetaryBucketIdentity,
} from './types'

const NEXT_PHASE: Partial<Record<MigrationPhase, MigrationPhase>> = {
	'legacy-active': 'migration-snapshot-frozen',
	'migration-snapshot-frozen': 'importing',
	importing: 'verifying',
	verifying: 'coco-ready',
	'coco-ready': 'cutover-committed',
	'cutover-committed': 'legacy-retired',
}

export interface OrdinaryWriterPermissions {
	legacyOrdinary: boolean
	cocoOrdinary: boolean
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key))
}

function assertPhase(value: unknown): asserts value is MigrationPhase {
	if (!MIGRATION_PHASES.includes(value as MigrationPhase)) {
		fail('INVALID_TRANSITION', 'Migration phase is invalid')
	}
}

function assertRevision(value: unknown): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		fail('STALE_REVISION', 'Authority revision must be a non-negative safe integer')
	}
}

function assertEpoch(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
		fail('WRONG_EPOCH', 'Migration epoch must be a non-empty sanitized identifier')
	}
}

function isOrdinaryOwner(owner: MonetaryOwner): boolean {
	return owner === 'legacy-ordinary' || owner === 'coco-canonical'
}

function ownerForPhase(bucket: MonetaryBucketIdentity, phase: MigrationPhase): MonetaryOwner {
	if (bucket.kind === 'unresolved') return 'quarantined'
	if (bucket.kind === 'auction-p2pk-recovery' || bucket.kind === 'legacy-inflight' || bucket.kind === 'pending-outbound') {
		return 'legacy-recovery-only'
	}
	if (bucket.kind === 'coco-ordinary') {
		return phase === 'cutover-committed' || phase === 'legacy-retired' ? 'coco-canonical' : 'coco-shadow'
	}
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
		case 'legacy-retired':
			return 'coco-canonical'
	}
}

export function getOrdinaryWriterPermissions(phase: MigrationPhase): OrdinaryWriterPermissions {
	assertPhase(phase)
	return Object.freeze({
		legacyOrdinary: phase === 'legacy-active',
		cocoOrdinary: phase === 'cutover-committed' || phase === 'legacy-retired',
	})
}

export function assertAuthorityInvariant(value: unknown): asserts value is WalletAuthoritySnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail('INVALID_TRANSITION', 'Authority snapshot must be an object')
	}
	const snapshot = value as Partial<WalletAuthoritySnapshot>
	if (!hasOnlyKeys(snapshot, ['walletKey', 'migrationEpoch', 'revision', 'phase', 'buckets'])) {
		fail('INVALID_TRANSITION', 'Authority snapshot contains undeclared fields')
	}
	assertEpoch(snapshot.migrationEpoch)
	assertRevision(snapshot.revision)
	assertPhase(snapshot.phase)
	if (!isCocoG9aNamespace(snapshot.walletKey) || !Array.isArray(snapshot.buckets)) {
		fail('INVALID_TRANSITION', 'Authority snapshot shape is invalid')
	}
	const walletUser = snapshot.walletKey.split(':').at(-1)

	const seen = new Map<string, MonetaryOwner>()
	for (const entry of snapshot.buckets as BucketAuthority[]) {
		if (!entry || typeof entry !== 'object' || !entry.bucket || !MONETARY_OWNERS.includes(entry.owner)) {
			fail('BUCKET_OWNERSHIP_MISMATCH', 'Bucket authority entry is invalid')
		}
		if (!hasOnlyKeys(entry, ['bucket', 'owner']) || !hasOnlyKeys(entry.bucket, ['user', 'mint', 'unit', 'kind', 'workflowId'])) {
			fail('BUCKET_OWNERSHIP_MISMATCH', 'Bucket authority entry contains undeclared fields')
		}
		const normalizedBucket = createMonetaryBucketIdentity(entry.bucket)
		if (normalizedBucket.user !== walletUser) {
			fail('BUCKET_OWNERSHIP_MISMATCH', 'Bucket user does not match the wallet namespace')
		}
		const key = monetaryBucketKey(normalizedBucket)
		if (
			entry.bucket.user !== normalizedBucket.user ||
			entry.bucket.mint !== normalizedBucket.mint ||
			entry.bucket.unit !== normalizedBucket.unit ||
			entry.bucket.kind !== normalizedBucket.kind ||
			entry.bucket.workflowId !== normalizedBucket.workflowId
		) {
			fail('BUCKET_OWNERSHIP_MISMATCH', 'Monetary bucket identity is not normalized')
		}
		const existing = seen.get(key)
		if (existing) {
			if (isOrdinaryOwner(existing) && isOrdinaryOwner(entry.owner) && existing !== entry.owner) {
				fail('DUAL_WRITER_ATTEMPT', 'A monetary bucket cannot have legacy and Coco ordinary writers')
			}
			fail('BUCKET_OWNERSHIP_MISMATCH', 'A monetary bucket cannot have multiple authority entries')
		}
		seen.set(key, entry.owner)
		const expected = ownerForPhase(entry.bucket, snapshot.phase)
		if (entry.owner !== expected) {
			fail('BUCKET_OWNERSHIP_MISMATCH', `Bucket owner is invalid for phase ${snapshot.phase}`)
		}
	}

	const permissions = getOrdinaryWriterPermissions(snapshot.phase)
	if (permissions.legacyOrdinary && permissions.cocoOrdinary) {
		fail('DUAL_WRITER_ATTEMPT', 'Legacy and Coco ordinary writers cannot both be authorized')
	}
}

export function createInitialAuthority(input: {
	walletKey: string
	migrationEpoch: string
	buckets: MonetaryBucketIdentity[]
}): WalletAuthoritySnapshot {
	if (!input || typeof input !== 'object') fail('INVALID_TRANSITION', 'Initial authority input must be an object')
	assertEpoch(input.migrationEpoch)
	if (typeof input.walletKey !== 'string' || input.walletKey.length === 0 || !Array.isArray(input.buckets)) {
		fail('INVALID_TRANSITION', 'Initial authority input is invalid')
	}
	const snapshot: WalletAuthoritySnapshot = {
		walletKey: input.walletKey,
		migrationEpoch: input.migrationEpoch,
		revision: 0,
		phase: 'legacy-active',
		buckets: input.buckets.map((value) => {
			const bucket = createMonetaryBucketIdentity(value)
			return { bucket, owner: ownerForPhase(bucket, 'legacy-active') }
		}),
	}
	assertAuthorityInvariant(snapshot)
	return structuredClone(snapshot)
}

export function assertObservedVersion(snapshot: WalletAuthoritySnapshot, observed: AuthorityVersion): void {
	if (!observed || typeof observed !== 'object') fail('WRONG_EPOCH', 'Observed authority version is invalid')
	if (observed.migrationEpoch !== snapshot.migrationEpoch) {
		fail('WRONG_EPOCH', 'Observed migration epoch is not current')
	}
	if (observed.revision !== snapshot.revision) {
		fail('STALE_REVISION', 'Observed authority revision is not current')
	}
}

export function transitionAuthority(
	snapshot: WalletAuthoritySnapshot,
	observed: AuthorityVersion,
	targetPhase: MigrationPhase,
): WalletAuthoritySnapshot {
	assertAuthorityInvariant(snapshot)
	assertObservedVersion(snapshot, observed)
	assertPhase(targetPhase)
	if (NEXT_PHASE[snapshot.phase] !== targetPhase) {
		fail('INVALID_TRANSITION', `Cannot transition from ${snapshot.phase} to ${targetPhase}`)
	}
	if (targetPhase === 'legacy-retired' && snapshot.buckets.some((entry) => entry.owner === 'legacy-recovery-only')) {
		fail('INVALID_TRANSITION', 'Legacy recovery buckets must drain before legacy retirement')
	}
	const next: WalletAuthoritySnapshot = {
		walletKey: snapshot.walletKey,
		migrationEpoch: snapshot.migrationEpoch,
		phase: targetPhase,
		revision: snapshot.revision + 1,
		buckets: snapshot.buckets.map(({ bucket }) => ({ bucket, owner: ownerForPhase(bucket, targetPhase) })),
	}
	assertAuthorityInvariant(next)
	return structuredClone(next)
}

export function authorizeMonetaryCapability(
	snapshot: WalletAuthoritySnapshot,
	observed: AuthorityVersion,
	bucketKey: string,
	capability: MonetaryCapability,
): void {
	assertAuthorityInvariant(snapshot)
	assertObservedVersion(snapshot, observed)
	const entry = snapshot.buckets.find((candidate) => monetaryBucketKey(candidate.bucket) === bucketKey)
	if (!entry) fail('BUCKET_OWNERSHIP_MISMATCH', 'Monetary bucket is not part of this authority snapshot')

	const ownerForCapability: Record<MonetaryCapability, MonetaryOwner> = {
		'legacy-ordinary-mutation': 'legacy-ordinary',
		'legacy-recovery-mutation': 'legacy-recovery-only',
		'coco-migration-mutation': 'coco-migration',
		'coco-ordinary-mutation': 'coco-canonical',
		'shadow-diagnostics': 'coco-shadow',
	}
	if (entry.owner !== ownerForCapability[capability]) {
		fail('BUCKET_OWNERSHIP_MISMATCH', `Bucket owner cannot authorize ${capability}`)
	}
	if (capability === 'legacy-recovery-mutation' && !entry.bucket.workflowId) {
		fail('BUCKET_OWNERSHIP_MISMATCH', 'Legacy recovery authority requires an explicit workflow')
	}
}
