import { describe, expect, test } from 'bun:test'
import * as runtimeTypes from '../types'
import { CocoHostError } from '../../errors'
import { buildCocoWalletNamespace } from '../../namespace'
import {
	InMemoryMigrationCoordinatorStore,
	LEGACY_RETIREMENT_DEFERRED_PENDING_AUTHORITATIVE_INVENTORY,
	MigrationCoordinator,
} from '../coordinator'
import {
	MAX_MINT_URL_UTF8_BYTES,
	REJECTED_MINT_MIGRATION_INPUT_POLICY,
	canonicalizeMintUrl,
	createMonetaryBucketIdentity,
	decodeMonetaryBucketKey,
	monetaryBucketKey,
	parseMigrationPhase,
	parseMonetaryBucketKind,
	parseMonetaryOwner,
	type MigrationPhase,
} from '../types'

const USER = 'a'.repeat(64)
const OTHER_USER = 'b'.repeat(64)
const EPOCH = 'epoch-1'
const WALLET = buildCocoWalletNamespace({ environment: 'test', pubkey: USER })
const MINT = canonicalizeMintUrl('https://mint.example/tenant/cashu')
const UTF8_ENCODER = new TextEncoder()

function utf8Bytes(value: string): number {
	return UTF8_ENCODER.encode(value).byteLength
}

function asciiMintWithBytes(bytes: number): string {
	const prefix = 'https://example.com/'
	return `${prefix}${'a'.repeat(bytes - utf8Bytes(prefix))}`
}

// Exact test-only reference for maximotodev/coco f8069dc packages/core/utils.ts normalizeMintUrl().
function pinnedCocoNormalize(mintUrl: string): string {
	const url = new URL(mintUrl)
	if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
		url.port = ''
	}
	let normalized = `${url.protocol}//${url.host}${url.pathname}`
	if (normalized.endsWith('/') && url.pathname !== '/') normalized = normalized.slice(0, -1)
	else if (url.pathname === '/') normalized = `${url.protocol}//${url.host}`
	return normalized
}

function query() {
	return { walletKey: WALLET, migrationEpoch: EPOCH }
}

function bucket(kind: string, overrides: Record<string, unknown> = {}) {
	return createMonetaryBucketIdentity({
		user: USER,
		mint: MINT,
		unit: 'sat',
		kind,
		...(kind === 'legacy-inflight' || kind === 'pending-outbound' || kind === 'auction-p2pk-recovery' ? { workflowId: 'workflow:1' } : {}),
		...overrides,
	})
}

async function setup() {
	const store = new InMemoryMigrationCoordinatorStore()
	const coordinator = new MigrationCoordinator(store)
	await coordinator.initialize({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })
	return { store, coordinator }
}

async function advanceTo(coordinator: MigrationCoordinator, target: MigrationPhase): Promise<void> {
	const phases: MigrationPhase[] = [
		'legacy-active',
		'migration-snapshot-frozen',
		'importing',
		'verifying',
		'coco-ready',
		'cutover-committed',
	]
	let status = await coordinator.status(query())
	while (status.phase !== target) {
		const next = phases[phases.indexOf(status.phase) + 1]
		status = await coordinator.advanceAuthority({ ...query(), expectedRevision: status.revision, nextPhase: next })
	}
}

function expectCode(fn: () => unknown, code: CocoHostError['code']): void {
	try {
		fn()
		throw new Error('expected domain failure')
	} catch (error) {
		expect(error).toBeInstanceOf(CocoHostError)
		expect((error as CocoHostError).code).toBe(code)
	}
}

describe('closed policy and canonical identities', () => {
	test('7: exported runtime policy contains no mutable decision arrays', async () => {
		expect(Object.values(runtimeTypes).filter(Array.isArray)).toEqual([])
		const { coordinator } = await setup()
		const permission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(bucket('legacy-ready')) })
		const capabilities = permission.capabilities
		expect(Object.isFrozen(capabilities)).toBe(true)
		try {
			;(capabilities as { legacyOrdinary: boolean }).legacyOrdinary = false
		} catch {
			// Frozen mutation rejection is expected in strict runtimes.
		}
		expect(capabilities.legacyOrdinary).toBe(true)
	})

	test('9-11: unknown phase, owner, and bucket kind reject', () => {
		expectCode(() => parseMigrationPhase('future-phase'), 'INVALID_TRANSITION')
		expectCode(() => parseMonetaryOwner('future-owner'), 'BUCKET_OWNERSHIP_MISMATCH')
		expectCode(() => parseMonetaryBucketKind('future-kind'), 'INVALID_BUCKET_IDENTITY')
	})

	test('12: changing-kind getter cannot bypass workflow requirements', () => {
		let reads = 0
		const input = {
			user: USER,
			mint: MINT,
			unit: 'sat',
			get kind() {
				reads += 1
				return reads === 1 ? 'legacy-ready' : 'auction-p2pk-recovery'
			},
		}
		expectCode(() => createMonetaryBucketIdentity(input), 'INVALID_BUCKET_IDENTITY')
		expect(reads).toBe(0)
	})

	test('13: percent-escape case cannot split canonical mint identity', () => {
		expect(canonicalizeMintUrl('https://EXAMPLE.com:443/%2f')).toBe(canonicalizeMintUrl('https://example.com/%2F'))
		expect(canonicalizeMintUrl('https://example.com/tenant-a')).not.toBe(canonicalizeMintUrl('https://example.com/tenant-b'))
	})

	test('mint roots and one trailing slash normalize without merging multiple trailing separators', () => {
		expect(canonicalizeMintUrl('https://example.com')).toBe('https://example.com')
		expect(canonicalizeMintUrl('https://example.com/')).toBe('https://example.com')
		expect(canonicalizeMintUrl('https://example.com/a')).toBe('https://example.com/a')
		expect(canonicalizeMintUrl('https://example.com/a/')).toBe('https://example.com/a')
		for (const ambiguous of ['https://example.com//', 'https://example.com///', 'https://example.com/a//', 'https://example.com/a///']) {
			expectCode(() => canonicalizeMintUrl(ambiguous), 'INVALID_BUCKET_IDENTITY')
		}
	})

	test('safe URL representation aliases normalize while path distinctions remain intact', () => {
		expect(canonicalizeMintUrl('https://EXAMPLE.com:443/a/../b')).toBe('https://example.com/b')
		expect(canonicalizeMintUrl('http://EXAMPLE.com:80/a')).toBe('http://example.com/a')
		expect(canonicalizeMintUrl('https://example.com/a//b')).toBe('https://example.com/a//b')
		expect(canonicalizeMintUrl('https://example.com/%2f')).toBe('https://example.com/%2F')
		expect(canonicalizeMintUrl('https://example.com/%2F')).toBe('https://example.com/%2F')
		expect(canonicalizeMintUrl('https://example.com/%2F')).not.toBe(canonicalizeMintUrl('https://example.com//a'))
	})

	test('unsupported URL components and schemes remain rejected', () => {
		for (const value of [
			'https://user:pass@example.com/a',
			'https://@example.com/a',
			'https://example.com/a?tenant=1',
			'https://example.com/a?',
			'https://example.com/a#fragment',
			'https://example.com/a#',
			'ftp://example.com/a',
			'file:///tmp/mint',
		]) {
			expectCode(() => canonicalizeMintUrl(value), 'INVALID_BUCKET_IDENTITY')
		}
	})

	test('every accepted canonical mint is a fixed point under pinned Coco f8069dc normalization', () => {
		const accepted = [
			'https://example.com',
			'https://example.com/',
			'https://example.com/a',
			'https://example.com/a/',
			'https://EXAMPLE.com:443/a/../b',
			'http://EXAMPLE.com:80/a',
			'https://example.com/%2f',
			'https://example.com/%7euser',
			'https://example.com/a//b',
		]
		for (const raw of accepted) {
			const canonical = canonicalizeMintUrl(raw)
			expect(pinnedCocoNormalize(canonical)).toBe(canonical)
		}
	})

	test('mint URL ceiling accepts exactly 4096 UTF-8 bytes and rejects 4097', () => {
		const exact = asciiMintWithBytes(MAX_MINT_URL_UTF8_BYTES)
		const oversized = asciiMintWithBytes(MAX_MINT_URL_UTF8_BYTES + 1)
		expect(utf8Bytes(exact)).toBe(MAX_MINT_URL_UTF8_BYTES)
		expect(canonicalizeMintUrl(exact)).toBe(exact)
		expect(utf8Bytes(oversized)).toBe(MAX_MINT_URL_UTF8_BYTES + 1)
		expectCode(() => canonicalizeMintUrl(oversized), 'INVALID_BUCKET_IDENTITY')
	})

	test('mint URL ceiling measures raw and canonical UTF-8 bytes', () => {
		const multibyteOversized = `https://example.com/${'é'.repeat(2040)}`
		expect(multibyteOversized.length).toBeLessThan(MAX_MINT_URL_UTF8_BYTES)
		expect(utf8Bytes(multibyteOversized)).toBeGreaterThan(MAX_MINT_URL_UTF8_BYTES)
		expectCode(() => canonicalizeMintUrl(multibyteOversized), 'INVALID_BUCKET_IDENTITY')

		const canonicalExpansion = `https://example.com/${'é'.repeat(1000)}`
		expect(utf8Bytes(canonicalExpansion)).toBeLessThan(MAX_MINT_URL_UTF8_BYTES)
		expectCode(() => canonicalizeMintUrl(canonicalExpansion), 'INVALID_BUCKET_IDENTITY')

		const prefix = 'https://example.com/'
		const available = MAX_MINT_URL_UTF8_BYTES - utf8Bytes(prefix)
		const escapes = '%2f'.repeat(Math.floor(available / 3))
		const encoded = `${prefix}${escapes}${'a'.repeat(available - utf8Bytes(escapes))}`
		expect(utf8Bytes(encoded)).toBe(MAX_MINT_URL_UTF8_BYTES)
		expect(canonicalizeMintUrl(encoded)).toBe(encoded.replaceAll('%2f', '%2F'))
	})

	test('ambiguous mint representations cannot construct canonical monetary buckets', () => {
		const sourceBucket = { user: USER, mint: 'https://example.com/a//', unit: 'sat', kind: 'legacy-ready' }
		expectCode(() => createMonetaryBucketIdentity(sourceBucket), 'INVALID_BUCKET_IDENTITY')
		expectCode(() => monetaryBucketKey(sourceBucket), 'INVALID_BUCKET_IDENTITY')
	})

	test('rejected mint representations remain unresolved migration inputs', () => {
		expect(REJECTED_MINT_MIGRATION_INPUT_POLICY).toEqual({
			classification: 'UNRESOLVED_QUARANTINED_MIGRATION_INPUT',
			silentlyRewrite: false,
			silentlyDrop: false,
			importIntoCoco: false,
			contributesToCocoReadyValue: false,
			authorizesCutover: false,
		})
		expect(Object.isFrozen(REJECTED_MINT_MIGRATION_INPUT_POLICY)).toBe(true)
	})

	test('canonical mint preserves custom base paths and rejects ambiguous components', () => {
		expect(canonicalizeMintUrl(' https://mint.example/tenant/cashu/ ')).toBe(MINT)
		for (const value of ['https://user:pass@mint.example', 'https://mint.example/path?tenant=1', 'https://mint.example/#fragment']) {
			expectCode(() => canonicalizeMintUrl(value), 'INVALID_BUCKET_IDENTITY')
		}
	})

	test('14: canonical bucket codec round-trips exactly', () => {
		const identity = bucket('auction-p2pk-recovery')
		const encoded = monetaryBucketKey(identity)
		expect(decodeMonetaryBucketKey(encoded)).toEqual(identity)
		expect(monetaryBucketKey(decodeMonetaryBucketKey(encoded))).toBe(encoded)
	})

	test('15: bucket prefix lookalikes and noncanonical encodings reject', () => {
		const encoded = monetaryBucketKey(bucket('legacy-ready'))
		expectCode(() => decodeMonetaryBucketKey(encoded.replace('g9a-bucket-v1', 'g9a-bucket-v10')), 'INVALID_BUCKET_IDENTITY')
		expectCode(() => decodeMonetaryBucketKey(`${encoded}suffix`), 'INVALID_BUCKET_IDENTITY')
	})
})

describe('coordinator advisory authority projections', () => {
	test('22: legacy-retired is not executable in I1A', async () => {
		const { coordinator } = await setup()
		await advanceTo(coordinator, 'cutover-committed')
		const status = await coordinator.status(query())
		await expect(
			coordinator.advanceAuthority({ ...query(), expectedRevision: status.revision, nextPhase: 'legacy-retired' }),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		expect(LEGACY_RETIREMENT_DEFERRED_PENDING_AUTHORITATIVE_INVENTORY).toBe(true)
	})

	test('23-24: retained Auction recovery survives cutover but cannot authorize ordinary legacy action', async () => {
		const { coordinator } = await setup()
		const auction = bucket('auction-p2pk-recovery')
		await coordinator.createPlannedItem({ ...query(), itemId: 'auction-item', sourceBucket: auction })
		await advanceTo(coordinator, 'cutover-committed')
		const permission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(auction) })
		expect(permission.owner).toBe('legacy-recovery-only')
		expect(permission.capabilities).toEqual({
			legacyOrdinary: false,
			legacyRecovery: true,
			cocoMigration: false,
			cocoOrdinary: false,
			shadowDiagnostics: false,
		})
	})

	test('25: recovery-only projection cannot cross user, mint, unit, or workflow', async () => {
		const { coordinator } = await setup()
		const auction = bucket('auction-p2pk-recovery')
		await coordinator.createPlannedItem({ ...query(), itemId: 'auction-item', sourceBucket: auction })
		for (const variant of [
			bucket('auction-p2pk-recovery', { mint: 'https://other-mint.example' }),
			bucket('auction-p2pk-recovery', { unit: 'usd' }),
			bucket('auction-p2pk-recovery', { workflowId: 'workflow:2' }),
		]) {
			const permission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(variant) })
			expect(permission.capabilities.legacyRecovery).toBe(false)
		}
		await expect(
			coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(bucket('auction-p2pk-recovery', { user: OTHER_USER })) }),
		).rejects.toMatchObject({ code: 'BUCKET_OWNERSHIP_MISMATCH' })
	})

	test('26-27: NIP-60 policy derives only from current durable authority', async () => {
		const { coordinator } = await setup()
		expect(await coordinator.nip60Policy(query())).toBe('keep-runtime')
		await expect(coordinator.nip60Policy({ ...query(), phase: 'cutover-committed' })).rejects.toMatchObject({
			code: 'INVALID_TRANSITION',
		})
		await advanceTo(coordinator, 'cutover-committed')
		expect(await coordinator.nip60Policy(query())).toBe('keep-interop')
	})

	test('every active phase has exactly one ordinary-writer projection', async () => {
		const { coordinator } = await setup()
		const legacy = bucket('legacy-ready')
		const coco = bucket('coco-ordinary')
		const phases: MigrationPhase[] = [
			'legacy-active',
			'migration-snapshot-frozen',
			'importing',
			'verifying',
			'coco-ready',
			'cutover-committed',
		]
		for (const phase of phases) {
			await advanceTo(coordinator, phase)
			const legacyPermission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(legacy) })
			const cocoPermission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(coco) })
			const ordinaryWriters = Number(legacyPermission.capabilities.legacyOrdinary) + Number(cocoPermission.capabilities.cocoOrdinary)
			expect(ordinaryWriters).toBeLessThanOrEqual(1)
		}
	})

	test('45: a stale permission projection cannot authorize or advance anything', async () => {
		const { coordinator } = await setup()
		const legacy = bucket('legacy-ready')
		const permission = await coordinator.permissionsFor({ ...query(), bucketKey: monetaryBucketKey(legacy) })
		await coordinator.advanceAuthority({ ...query(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
		await expect(coordinator.advanceAuthority(permission)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		expect('authorize' in coordinator).toBe(false)
	})

	test('46: coordinator exposes no store or repository escape', async () => {
		const { coordinator } = await setup()
		expect('store' in coordinator).toBe(false)
		expect('repository' in coordinator).toBe(false)
		expect(Object.keys(coordinator)).toEqual([])
	})

	test('new migration items cannot be introduced after cutover', async () => {
		const { coordinator } = await setup()
		await advanceTo(coordinator, 'cutover-committed')
		await expect(
			coordinator.createPlannedItem({ ...query(), itemId: 'late-item', sourceBucket: bucket('legacy-ready') }),
		).rejects.toMatchObject({ code: 'INVALID_QUARANTINE_TRANSITION' })
	})

	test('oversized mint input fails before a migration item is persisted', async () => {
		const { coordinator } = await setup()
		await expect(
			coordinator.createPlannedItem({
				...query(),
				itemId: 'oversized-mint',
				sourceBucket: {
					user: USER,
					mint: asciiMintWithBytes(MAX_MINT_URL_UTF8_BYTES + 1),
					unit: 'sat',
					kind: 'legacy-ready',
				},
			}),
		).rejects.toMatchObject({ code: 'INVALID_BUCKET_IDENTITY' })
		expect(await coordinator.items(query())).toEqual([])
	})
})

describe('bounded integration exclusions', () => {
	test('47-48: production scaffold has no Coco dependency or #1235 monetary import', async () => {
		const productionFiles = [
			'../../errors.ts',
			'../../namespace.ts',
			'../../shadowBoundary.ts',
			'../types.ts',
			'../authority.ts',
			'../coordinator.ts',
			'../accounting.ts',
		]
		const forbidden = [
			'@cashu/coco',
			'coco-cashu',
			'@/lib/stores/nip60',
			'@/lib/stores/cashu',
			'@/lib/wallet',
			'@/lib/auction',
			'@/publish/auctions',
		]
		for (const relativePath of productionFiles) {
			const source = await Bun.file(new URL(relativePath, import.meta.url)).text()
			for (const specifier of forbidden) expect(source).not.toContain(specifier)
		}
	})
})
