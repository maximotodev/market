import { captureObject, fail } from '../errors'
import { normalizeNostrPubkey } from '../namespace'

export type MigrationPhase = 'legacy-active' | 'migration-snapshot-frozen' | 'importing' | 'verifying' | 'coco-ready' | 'cutover-committed'

export type MonetaryBucketKind =
	| 'legacy-ready'
	| 'legacy-inflight'
	| 'pending-outbound'
	| 'auction-p2pk-recovery'
	| 'unresolved'
	| 'coco-ordinary'

export type MonetaryOwner =
	| 'legacy-ordinary'
	| 'legacy-recovery-only'
	| 'migration-coordinator'
	| 'coco-shadow'
	| 'coco-migration'
	| 'coco-canonical'
	| 'quarantined'

export type MigrationItemState = 'planned' | 'prepared' | 'executing' | 'verified' | 'quarantined'

export type MigrationQuarantineReason =
	| 'mint-state-unresolved'
	| 'source-ownership-mismatch'
	| 'prepared-operation-ambiguous'
	| 'accounting-mismatch'
	| 'malformed-source'
	| 'coco-collision'

export type Nip60Policy = 'keep-runtime' | 'keep-interop'

declare const canonicalMintBrand: unique symbol
export type CanonicalMintUrl = string & { readonly [canonicalMintBrand]: true }

declare const bucketKeyBrand: unique symbol
export type MonetaryBucketKey = string & { readonly [bucketKeyBrand]: true }

export interface MonetaryBucketIdentity {
	user: string
	mint: CanonicalMintUrl
	unit: string
	kind: MonetaryBucketKind
	workflowId?: string
}

const UNIT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/
const BUCKET_KEY_PREFIX = 'g9a-bucket-v1'

export const MAX_MINT_URL_UTF8_BYTES = 4096
export const REJECTED_MINT_MIGRATION_INPUT_POLICY = Object.freeze({
	classification: 'UNRESOLVED_QUARANTINED_MIGRATION_INPUT',
	silentlyRewrite: false,
	silentlyDrop: false,
	importIntoCoco: false,
	contributesToCocoReadyValue: false,
	authorizesCutover: false,
} as const)

export function parseMigrationPhase(value: unknown): MigrationPhase {
	switch (value) {
		case 'legacy-active':
		case 'migration-snapshot-frozen':
		case 'importing':
		case 'verifying':
		case 'coco-ready':
		case 'cutover-committed':
			return value
		default:
			fail('INVALID_TRANSITION', 'Migration phase is invalid or not executable in I1A')
	}
}

export function parseMonetaryBucketKind(value: unknown): MonetaryBucketKind {
	switch (value) {
		case 'legacy-ready':
		case 'legacy-inflight':
		case 'pending-outbound':
		case 'auction-p2pk-recovery':
		case 'unresolved':
		case 'coco-ordinary':
			return value
		default:
			fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket kind is invalid')
	}
}

export function parseMonetaryOwner(value: unknown): MonetaryOwner {
	switch (value) {
		case 'legacy-ordinary':
		case 'legacy-recovery-only':
		case 'migration-coordinator':
		case 'coco-shadow':
		case 'coco-migration':
		case 'coco-canonical':
		case 'quarantined':
			return value
		default:
			fail('BUCKET_OWNERSHIP_MISMATCH', 'Monetary owner is invalid')
	}
}

export function parseMigrationItemState(value: unknown): MigrationItemState {
	switch (value) {
		case 'planned':
		case 'prepared':
		case 'executing':
		case 'verified':
		case 'quarantined':
			return value
		default:
			fail('INVALID_QUARANTINE_TRANSITION', 'Migration item state is invalid')
	}
}

export function parseQuarantineReason(value: unknown): MigrationQuarantineReason {
	switch (value) {
		case 'mint-state-unresolved':
		case 'source-ownership-mismatch':
		case 'prepared-operation-ambiguous':
		case 'accounting-mismatch':
		case 'malformed-source':
		case 'coco-collision':
			return value
		default:
			fail('INVALID_QUARANTINE_TRANSITION', 'Migration quarantine reason is invalid')
	}
}

export function requireSafeId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
		fail('INVALID_BUCKET_IDENTITY', `${field} must be a non-empty sanitized identifier`)
	}
	return value
}

function normalizePercentEncoding(pathname: string): string {
	if (/%(?![0-9a-fA-F]{2})/.test(pathname)) fail('INVALID_BUCKET_IDENTITY', 'Mint URL contains malformed percent encoding')
	return pathname.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
		const character = String.fromCharCode(Number.parseInt(hex, 16))
		return /^[A-Za-z0-9._~-]$/.test(character) ? character : `%${hex.toUpperCase()}`
	})
}

function assertBoundedMintUrl(value: string): void {
	let bytes = 0
	for (const character of value) {
		const codePoint = character.codePointAt(0)!
		bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
		if (bytes > MAX_MINT_URL_UTF8_BYTES) {
			fail('INVALID_BUCKET_IDENTITY', 'Mint URL exceeds the migration identity resource ceiling')
		}
	}
}

export function canonicalizeMintUrl(value: unknown): CanonicalMintUrl {
	if (typeof value !== 'string') fail('INVALID_BUCKET_IDENTITY', 'Mint URL must be a string')
	assertBoundedMintUrl(value)
	const candidate = value.trim()
	let url: URL
	try {
		url = new URL(candidate)
	} catch {
		fail('INVALID_BUCKET_IDENTITY', 'Mint URL must be valid')
	}
	const authority = candidate.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)/)?.[1]
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		url.username ||
		url.password ||
		authority?.includes('@') ||
		candidate.includes('?') ||
		candidate.includes('#')
	) {
		fail('INVALID_BUCKET_IDENTITY', 'Mint URL contains unsupported components')
	}
	if (/\/{2,}$/.test(url.pathname)) {
		fail('INVALID_BUCKET_IDENTITY', 'Mint URL contains ambiguous trailing path separators')
	}
	const normalizedPathname = normalizePercentEncoding(url.pathname)
	url.pathname = normalizedPathname.endsWith('/') && normalizedPathname !== '/' ? normalizedPathname.slice(0, -1) : normalizedPathname
	const canonical = url.toString().replace(/\/$/, '')
	assertBoundedMintUrl(canonical)
	return canonical as CanonicalMintUrl
}

export function normalizeUnit(value: unknown): string {
	if (typeof value !== 'string') fail('INVALID_BUCKET_IDENTITY', 'Unit must be a string')
	const normalized = value.toLowerCase()
	if (!UNIT_PATTERN.test(normalized)) fail('INVALID_BUCKET_IDENTITY', 'Unit is invalid')
	return normalized
}

function requiresWorkflow(kind: MonetaryBucketKind): boolean {
	switch (kind) {
		case 'legacy-inflight':
		case 'pending-outbound':
		case 'auction-p2pk-recovery':
			return true
		case 'legacy-ready':
		case 'unresolved':
		case 'coco-ordinary':
			return false
	}
}

export function createMonetaryBucketIdentity(input: unknown): Readonly<MonetaryBucketIdentity> {
	const captured = captureObject(
		input,
		['user', 'mint', 'unit', 'kind', 'workflowId'],
		'INVALID_BUCKET_IDENTITY',
		'Monetary bucket identity',
	)
	const kind = parseMonetaryBucketKind(captured.kind)
	const workflowId = captured.workflowId === undefined ? undefined : requireSafeId(captured.workflowId, 'workflowId')
	if (requiresWorkflow(kind) !== Boolean(workflowId)) {
		fail('INVALID_BUCKET_IDENTITY', requiresWorkflow(kind) ? 'This bucket requires workflowId' : 'This bucket forbids workflowId')
	}
	return Object.freeze({
		user: normalizeNostrPubkey(captured.user),
		mint: canonicalizeMintUrl(captured.mint),
		unit: normalizeUnit(captured.unit),
		kind,
		...(workflowId ? { workflowId } : {}),
	})
}

function encodePart(value: string): string {
	return encodeURIComponent(value)
}

function decodePart(value: string): string {
	try {
		return decodeURIComponent(value)
	} catch {
		fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket key encoding is invalid')
	}
}

export function encodeMonetaryBucketIdentity(input: unknown): MonetaryBucketKey {
	const bucket = createMonetaryBucketIdentity(input)
	return [
		BUCKET_KEY_PREFIX,
		encodePart(bucket.user),
		encodePart(bucket.mint),
		encodePart(bucket.unit),
		encodePart(bucket.kind),
		encodePart(bucket.workflowId ?? ''),
	].join('|') as MonetaryBucketKey
}

export function decodeMonetaryBucketKey(value: unknown): Readonly<MonetaryBucketIdentity> {
	if (typeof value !== 'string') fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket key must be a string')
	const parts = value.split('|')
	if (parts.length !== 6 || parts[0] !== BUCKET_KEY_PREFIX) fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket key is invalid')
	const bucket = createMonetaryBucketIdentity({
		user: decodePart(parts[1]),
		mint: decodePart(parts[2]),
		unit: decodePart(parts[3]),
		kind: decodePart(parts[4]),
		workflowId: decodePart(parts[5]) || undefined,
	})
	if (encodeMonetaryBucketIdentity(bucket) !== value) fail('INVALID_BUCKET_IDENTITY', 'Monetary bucket key is not canonical')
	return bucket
}

export const monetaryBucketKey = encodeMonetaryBucketIdentity
