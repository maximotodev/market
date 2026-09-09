import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../../errors'
import { buildCocoWalletNamespace } from '../../namespace'
import {
	assertAuthorityInvariant,
	authorizeMonetaryCapability,
	createInitialAuthority,
	getOrdinaryWriterPermissions,
	transitionAuthority,
} from '../authority'
import {
	InMemoryMigrationCoordinatorStore,
	MigrationAuthorityCoordinator,
	createMigrationItem,
	transitionMigrationItem,
} from '../coordinator'
import {
	MIGRATION_PHASES,
	createMonetaryBucketIdentity,
	monetaryBucketKey,
	nip60PolicyForPhase,
	type MigrationPhase,
	type MonetaryBucketIdentity,
	type WalletAuthoritySnapshot,
} from '../types'

const USER = 'a'.repeat(64)
const MINT = 'https://mint.example'
const WALLET_KEY = buildCocoWalletNamespace({ environment: 'test', pubkey: USER })

const ordinary = createMonetaryBucketIdentity({ user: USER, mint: MINT, unit: 'SAT', kind: 'legacy-ready' })
const coco = createMonetaryBucketIdentity({ user: USER, mint: MINT, unit: 'sat', kind: 'coco-ordinary' })
const auction = createMonetaryBucketIdentity({
	user: USER,
	mint: MINT,
	unit: 'sat',
	kind: 'auction-p2pk-recovery',
	workflowId: 'auction:bid:1',
})
const unresolved = createMonetaryBucketIdentity({ user: USER, mint: MINT, unit: 'sat', kind: 'unresolved' })

function initial(buckets: MonetaryBucketIdentity[] = [ordinary, coco]): WalletAuthoritySnapshot {
	return createInitialAuthority({ walletKey: WALLET_KEY, migrationEpoch: 'epoch-1', buckets })
}

function advance(snapshot: WalletAuthoritySnapshot, target: MigrationPhase): WalletAuthoritySnapshot {
	return transitionAuthority(snapshot, snapshot, target)
}

function snapshotsForEveryPhase(): WalletAuthoritySnapshot[] {
	const snapshots = [initial()]
	for (const phase of MIGRATION_PHASES.slice(1)) snapshots.push(advance(snapshots.at(-1)!, phase))
	return snapshots
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

describe('migration authority state and bucket ownership', () => {
	test('6: every authority state has explicit legacy and Coco permissions', () => {
		const expected = {
			'legacy-active': [true, false],
			'migration-snapshot-frozen': [false, false],
			importing: [false, false],
			verifying: [false, false],
			'coco-ready': [false, false],
			'cutover-committed': [false, true],
			'legacy-retired': [false, true],
		} satisfies Record<MigrationPhase, [boolean, boolean]>

		for (const phase of MIGRATION_PHASES) {
			const permissions = getOrdinaryWriterPermissions(phase)
			expect([permissions.legacyOrdinary, permissions.cocoOrdinary]).toEqual(expected[phase])
		}
	})

	test('7: no state permits dual ordinary writers', () => {
		for (const snapshot of snapshotsForEveryPhase()) {
			assertAuthorityInvariant(snapshot)
			const permissions = getOrdinaryWriterPermissions(snapshot.phase)
			expect(permissions.legacyOrdinary && permissions.cocoOrdinary).toBe(false)
		}
	})

	test('explicitly rejects a runtime snapshot that attempts two ordinary owners for one bucket', () => {
		const snapshot = initial([ordinary])
		const hostile = {
			...snapshot,
			buckets: [
				{ bucket: ordinary, owner: 'legacy-ordinary' },
				{ bucket: ordinary, owner: 'coco-canonical' },
			],
		}
		expectCode(() => assertAuthorityInvariant(hostile), 'DUAL_WRITER_ATTEMPT')
	})

	test('rejects undeclared fields from durable authority records', () => {
		expectCode(() => assertAuthorityInvariant({ ...initial(), secret: 'must-not-survive' }), 'INVALID_TRANSITION')
	})

	test('8: stale authority revision rejects before authorization', () => {
		const snapshot = initial([ordinary])
		expectCode(
			() =>
				authorizeMonetaryCapability(
					snapshot,
					{ migrationEpoch: 'epoch-1', revision: 1 },
					monetaryBucketKey(ordinary),
					'legacy-ordinary-mutation',
				),
			'STALE_REVISION',
		)
	})

	test('9: stale epoch rejects before authorization', () => {
		const snapshot = initial([ordinary])
		expectCode(
			() =>
				authorizeMonetaryCapability(
					snapshot,
					{ migrationEpoch: 'epoch-old', revision: 0 },
					monetaryBucketKey(ordinary),
					'legacy-ordinary-mutation',
				),
			'WRONG_EPOCH',
		)
	})

	test('12: cutover cannot happen directly from legacy-active', () => {
		const snapshot = initial()
		expectCode(() => transitionAuthority(snapshot, snapshot, 'cutover-committed'), 'INVALID_TRANSITION')
	})

	test('13: import cannot begin before legacy freeze', () => {
		const snapshot = initial()
		expectCode(() => transitionAuthority(snapshot, snapshot, 'importing'), 'INVALID_TRANSITION')
	})

	test('14: legacy ordinary mutation is blocked after freeze', () => {
		const frozen = advance(initial([ordinary]), 'migration-snapshot-frozen')
		expectCode(
			() => authorizeMonetaryCapability(frozen, frozen, monetaryBucketKey(ordinary), 'legacy-ordinary-mutation'),
			'BUCKET_OWNERSHIP_MISMATCH',
		)
	})

	test('15: Coco ordinary mutation is blocked before committed cutover', () => {
		for (const snapshot of snapshotsForEveryPhase().slice(0, 5)) {
			expectCode(
				() => authorizeMonetaryCapability(snapshot, snapshot, monetaryBucketKey(coco), 'coco-ordinary-mutation'),
				'BUCKET_OWNERSHIP_MISMATCH',
			)
		}
	})

	test('authorizes only the expected ordinary or migration writer at each boundary', () => {
		const active = initial([ordinary])
		expect(() => authorizeMonetaryCapability(active, active, monetaryBucketKey(ordinary), 'legacy-ordinary-mutation')).not.toThrow()

		const importing = advance(advance(active, 'migration-snapshot-frozen'), 'importing')
		expect(() => authorizeMonetaryCapability(importing, importing, monetaryBucketKey(ordinary), 'coco-migration-mutation')).not.toThrow()

		let cutover = importing
		for (const phase of ['verifying', 'coco-ready', 'cutover-committed'] as const) cutover = advance(cutover, phase)
		expect(() => authorizeMonetaryCapability(cutover, cutover, monetaryBucketKey(ordinary), 'coco-ordinary-mutation')).not.toThrow()
	})

	test('16-17: retained Auction recovery survives ordinary cutover but cannot authorize an ordinary send', () => {
		let snapshot = initial([ordinary, auction])
		for (const phase of MIGRATION_PHASES.slice(1, 6)) snapshot = advance(snapshot, phase)
		const entry = snapshot.buckets.find(({ bucket }) => monetaryBucketKey(bucket) === monetaryBucketKey(auction))
		expect(snapshot.phase).toBe('cutover-committed')
		expect(entry?.owner).toBe('legacy-recovery-only')
		expect(() => authorizeMonetaryCapability(snapshot, snapshot, monetaryBucketKey(auction), 'legacy-recovery-mutation')).not.toThrow()
		expectCode(
			() => authorizeMonetaryCapability(snapshot, snapshot, monetaryBucketKey(auction), 'legacy-ordinary-mutation'),
			'BUCKET_OWNERSHIP_MISMATCH',
		)
		expectCode(() => advance(snapshot, 'legacy-retired'), 'INVALID_TRANSITION')
	})

	test('18: quarantine has no monetary capability', () => {
		const snapshot = initial([unresolved])
		for (const capability of [
			'legacy-ordinary-mutation',
			'legacy-recovery-mutation',
			'coco-migration-mutation',
			'coco-ordinary-mutation',
		] as const) {
			expectCode(
				() => authorizeMonetaryCapability(snapshot, snapshot, monetaryBucketKey(unresolved), capability),
				'BUCKET_OWNERSHIP_MISMATCH',
			)
		}
	})

	test('19: authority phases cannot roll back after ownership advances', () => {
		const importing = advance(advance(initial(), 'migration-snapshot-frozen'), 'importing')
		expectCode(() => transitionAuthority(importing, importing, 'legacy-active'), 'INVALID_TRANSITION')
	})

	test('encodes NIP-60 as runtime before cutover and interop after cutover', () => {
		for (const phase of MIGRATION_PHASES.slice(0, 5)) expect(nip60PolicyForPhase(phase)).toBe('keep-runtime')
		expect(nip60PolicyForPhase('cutover-committed')).toBe('keep-interop')
		expect(nip60PolicyForPhase('legacy-retired')).toBe('keep-interop')
	})
})

describe('CAS coordinator contract', () => {
	test('10-11: valid CAS succeeds once and a duplicate observed revision rejects', async () => {
		const coordinator = new MigrationAuthorityCoordinator(new InMemoryMigrationCoordinatorStore())
		const snapshot = initial()
		await coordinator.initialize(snapshot)
		const observed = await coordinator.load(snapshot.walletKey)
		const frozen = await coordinator.transition(snapshot.walletKey, observed, 'migration-snapshot-frozen')
		expect(frozen.revision).toBe(1)

		await expect(coordinator.transition(snapshot.walletKey, observed, 'migration-snapshot-frozen')).rejects.toMatchObject({
			code: 'STALE_REVISION',
		})
	})

	test('a stale caller cannot authorize through the coordinator after authority advances', async () => {
		const coordinator = new MigrationAuthorityCoordinator(new InMemoryMigrationCoordinatorStore())
		const snapshot = initial([ordinary])
		await coordinator.initialize(snapshot)
		await coordinator.transition(snapshot.walletKey, snapshot, 'migration-snapshot-frozen')

		await expect(
			coordinator.authorize(snapshot.walletKey, snapshot, monetaryBucketKey(ordinary), 'legacy-ordinary-mutation'),
		).rejects.toMatchObject({ code: 'STALE_REVISION' })
	})

	test('store returns clones so callers cannot mutate durable authority', async () => {
		const store = new InMemoryMigrationCoordinatorStore()
		const snapshot = initial()
		expect(await store.create(snapshot)).toBe(true)
		const loaded = await store.load(snapshot.walletKey)
		loaded!.buckets.length = 0
		expect((await store.load(snapshot.walletKey))!.buckets).toHaveLength(2)
	})

	test('the store rejects a CAS replacement for a different wallet or non-successor revision', async () => {
		const store = new InMemoryMigrationCoordinatorStore()
		const snapshot = initial()
		expect(await store.create(snapshot)).toBe(true)
		await expect(
			store.compareAndSwap(snapshot.walletKey, snapshot, {
				...snapshot,
				walletKey: buildCocoWalletNamespace({ environment: 'production', pubkey: USER }),
				revision: 1,
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
	})

	test('persists migration items behind their own epoch/revision CAS', async () => {
		const coordinator = new MigrationAuthorityCoordinator(new InMemoryMigrationCoordinatorStore())
		const snapshot = initial()
		await coordinator.initialize(snapshot)
		const planned = createMigrationItem({ id: 'item-cas', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		await coordinator.initializeItem(snapshot.walletKey, planned)
		const prepared = await coordinator.transitionItem(snapshot.walletKey, planned.id, planned, 'prepared', {
			cocoOperationId: 'receive-op:cas',
		})
		expect(prepared).toMatchObject({ state: 'prepared', revision: 1 })
		await expect(
			coordinator.transitionItem(snapshot.walletKey, planned.id, planned, 'prepared', {
				cocoOperationId: 'receive-op:cas',
			}),
		).rejects.toMatchObject({ code: 'STALE_REVISION' })
	})
})

describe('migration item identity and quarantine', () => {
	test('creates a sanitized stable item record with no bearer fields', () => {
		const item = createMigrationItem({
			id: 'legacy-item:42',
			migrationEpoch: 'epoch-1',
			sourceBucket: ordinary,
			proof: 'must-not-survive',
			secret: 'must-not-survive',
			token: 'must-not-survive',
			witness: 'must-not-survive',
			refundPrivateKey: 'must-not-survive',
		})
		expect(Object.keys(item).sort()).toEqual(['id', 'migrationEpoch', 'mint', 'revision', 'sourceBucketKey', 'state', 'unit', 'user'])
		expect(JSON.stringify(item)).not.toContain('must-not-survive')
	})

	test('valid lifecycle binds a future Coco operation before execution', () => {
		const planned = createMigrationItem({ id: 'item-1', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		const prepared = transitionMigrationItem(planned, 0, 'prepared', { cocoOperationId: 'receive-op:1' })
		const executing = transitionMigrationItem(prepared, 1, 'executing')
		const verified = transitionMigrationItem(executing, 2, 'verified')
		expect(verified).toMatchObject({ state: 'verified', revision: 3, cocoOperationId: 'receive-op:1' })
	})

	test('a bound Coco operation identity cannot be replaced during migration', () => {
		const planned = createMigrationItem({ id: 'item-op-binding', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		const prepared = transitionMigrationItem(planned, 0, 'prepared', { cocoOperationId: 'receive-op:original' })
		expectCode(
			() => transitionMigrationItem(prepared, 1, 'executing', { cocoOperationId: 'receive-op:replacement' }),
			'INVALID_QUARANTINE_TRANSITION',
		)
	})

	test('migration transition options reject undeclared bearer-shaped fields', () => {
		const planned = createMigrationItem({ id: 'item-options', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		expectCode(
			() => transitionMigrationItem(planned, 0, 'prepared', { secret: 'must-not-survive' } as never),
			'INVALID_QUARANTINE_TRANSITION',
		)
	})

	test('invalid or reversible quarantine transitions fail deterministically', () => {
		const planned = createMigrationItem({ id: 'item-2', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		expectCode(() => transitionMigrationItem(planned, 0, 'quarantined'), 'INVALID_QUARANTINE_TRANSITION')
		const quarantined = transitionMigrationItem(planned, 0, 'quarantined', {
			quarantineReason: 'mint-state-unresolved',
		})
		expectCode(() => transitionMigrationItem(quarantined, 1, 'planned'), 'INVALID_QUARANTINE_TRANSITION')
	})

	test('rejects undeclared fields from a migration item before returning a public record', () => {
		const planned = createMigrationItem({ id: 'item-3', migrationEpoch: 'epoch-1', sourceBucket: ordinary })
		expectCode(
			() => transitionMigrationItem({ ...planned, secret: 'must-not-survive' } as never, 0, 'prepared'),
			'INVALID_QUARANTINE_TRANSITION',
		)
	})

	test('26: malformed public runtime containers produce domain failures, not TypeError', () => {
		for (const value of [null, [], 'bad']) {
			expectCode(() => createMigrationItem(value), 'INVALID_QUARANTINE_TRANSITION')
			expectCode(() => assertAuthorityInvariant(value), 'INVALID_TRANSITION')
		}
	})
})
