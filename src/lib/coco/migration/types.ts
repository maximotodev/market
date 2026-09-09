import { fail } from '../errors'
import { normalizeNostrPubkey } from '../namespace'

export const MIGRATION_PHASES = [
	'legacy-active',
	'migration-snapshot-frozen',
	'importing',
	'verifying',
	'coco-ready',
	'cutover-committed',
	'legacy-retired',
] as const

export type MigrationPhase = (typeof MIGRATION_PHASES)[number]

export const MONETARY_BUCKET_KINDS = [
	'legacy-ready',
	'legacy-inflight',
	'pending-outbound',
	'auction-p2pk-recovery',
	'unresolved',
	'coco-ordinary',
] as const

export type MonetaryBucketKind = (typeof MONETARY_BUCKET_KINDS)[number]

export const MONETARY_OWNERS = [
	'legacy-ordinary',
	'legacy-recovery-only',
	'migration-coordinator',
	'coco-shadow',
	'coco-migration',
	'coco-canonical',
	'quarantined',
] as const

export type MonetaryOwner = (typeof MONETARY_OWNERS)[number]

export type MonetaryCapability =
	| 'legacy-ordinary-mutation'
	| 'legacy-recovery-mutation'
	| 'coco-migration-mutation'
	| 'coco-ordinary-mutation'
	| 'shadow-diagnostics'

export type Nip60Policy = 'keep-runtime' | 'keep-interop'

export interface MonetaryBucketIdentity {
	user: string
	mint: string
	unit: string
	kind: MonetaryBucketKind
	workflowId?: string
}

export interface BucketAuthority {
	bucket: MonetaryBucketIdentity
	owner: MonetaryOwner
}

export interface AuthorityVersion {
	migrationEpoch: string
	revision: number
}

export interface WalletAuthoritySnapshot extends AuthorityVersion {
	walletKey: string
	phase: MigrationPhase
	buckets: BucketAuthority[]
}

export type MigrationItemState = 'planned' | 'prepared' | 'executing' | 'verified' | 'quarantined'

export const MIGRATION_QUARANTINE_REASONS = [
	'mint-state-unresolved',
	'source-ownership-mismatch',
	'prepared-operation-ambiguous',
	'accounting-mismatch',
	'malformed-source',
	'coco-collision',
] as const

export type MigrationQuarantineReason = (typeof MIGRATION_QUARANTINE_REASONS)[number]

export interface MigrationItemRecord {
	id: string
	migrationEpoch: string
	sourceBucketKey: string
	user: string
	mint: string
	unit: string
	state: MigrationItemState
	cocoOperationId?: string
	revision: number
	quarantineReason?: MigrationQuarantineReason
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/
const UNIT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/

export function requireSafeId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
		fail('INVALID_BUCKET_IDENTITY', `${field} must be a non-empty sanitized identifier`)
	}
	return value
}

export function normalizeMintUrl(value: unknown): string {
	if (typeof value !== 'string') fail('INVALID_BUCKET_IDENTITY', 'Mint URL must be a string')
	let url: URL
	try {
		url = new URL(value)
	} catch {
		fail('INVALID_BUCKET_IDENTITY', 'Mint URL must be valid')
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
		fail('INVALID_BUCKET_IDENTITY', 'Mint URL contains unsupported components')
	}
	url.pathname = url.pathname.replace(/\/+$/, '') || '/'
	return url.toString().replace(/\/$/, '')
}

export function normalizeUnit(value: unknown): string {
	if (typeof value !== 'string') fail('INVALID_BUCKET_IDENTITY', 'Unit must be a string')
	const normalized = value.toLowerCase()
	if (!UNIT_PATTERN.test(normalized)) fail('INVALID_BUCKET_IDENTITY', 'Unit is invalid')
	return normalized
}

export function createMonetaryBucketIdentity(input: unknown): MonetaryBucketIdentity {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket identity must be an object')
	}
	const candidate = input as Partial<MonetaryBucketIdentity>
	if (!MONETARY_BUCKET_KINDS.includes(candidate.kind as MonetaryBucketKind)) {
		fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket kind is invalid')
	}
	const workflowRequired = ['legacy-inflight', 'pending-outbound', 'auction-p2pk-recovery'].includes(candidate.kind as string)
	const workflowId = candidate.workflowId === undefined ? undefined : requireSafeId(candidate.workflowId, 'workflowId')
	if (workflowRequired && !workflowId) {
		fail('INVALID_BUCKET_IDENTITY', 'This monetary bucket requires an explicit workflowId')
	}
	if (!workflowRequired && workflowId) {
		fail('INVALID_BUCKET_IDENTITY', 'This monetary bucket must not include a workflowId')
	}
	return Object.freeze({
		user: normalizeNostrPubkey(candidate.user),
		mint: normalizeMintUrl(candidate.mint),
		unit: normalizeUnit(candidate.unit),
		kind: candidate.kind as MonetaryBucketKind,
		...(workflowId ? { workflowId } : {}),
	})
}

export function monetaryBucketKey(input: unknown): string {
	const bucket = createMonetaryBucketIdentity(input)
	return [bucket.user, bucket.mint, bucket.unit, bucket.kind, bucket.workflowId ?? '-'].join('|')
}

export function nip60PolicyForPhase(phase: MigrationPhase): Nip60Policy {
	if (!MIGRATION_PHASES.includes(phase)) fail('INVALID_TRANSITION', 'Migration phase is invalid')
	return phase === 'cutover-committed' || phase === 'legacy-retired' ? 'keep-interop' : 'keep-runtime'
}
