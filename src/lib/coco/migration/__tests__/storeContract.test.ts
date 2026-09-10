import { describe, expect, test } from 'bun:test'
import { buildCocoWalletNamespace } from '../../namespace'
import { InMemoryMigrationCoordinatorStore, type MigrationCoordinatorStore } from '../coordinator'
import { createMonetaryBucketIdentity } from '../types'

const USER = 'a'.repeat(64)
const OTHER_USER = 'b'.repeat(64)
const EPOCH = 'epoch-1'
const WALLET = buildCocoWalletNamespace({ environment: 'test', pubkey: USER })
const MINT = 'https://mint.example/tenant/cashu'

const ordinary = createMonetaryBucketIdentity({ user: USER, mint: MINT, unit: 'sat', kind: 'legacy-ready' })

function authorityQuery() {
	return { walletKey: WALLET, migrationEpoch: EPOCH }
}

async function initialize(store: MigrationCoordinatorStore) {
	return (await store.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })).value
}

async function plannedItem(store: MigrationCoordinatorStore, itemId = 'item-1') {
	return (
		await store.createPlannedMigrationItem({
			...authorityQuery(),
			itemId,
			sourceBucket: ordinary,
		})
	).value
}

export function runMigrationCoordinatorStoreContract(factory: () => MigrationCoordinatorStore): void {
	describe('domain-authoritative migration store contract', () => {
		test('1-2: only canonical legacy-active revision-zero initialization exists', async () => {
			const store = factory()
			const created = await store.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })
			expect(created).toMatchObject({ created: true, value: { walletKey: WALLET, phase: 'legacy-active', revision: 0 } })
			expect(Object.isFrozen(created.value)).toBe(true)

			const duplicate = await store.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })
			expect(duplicate).toMatchObject({ created: false, value: { phase: 'legacy-active', revision: 0 } })

			await expect(
				store.createInitialAuthority({
					walletIdentity: USER,
					environment: 'test',
					migrationEpoch: EPOCH,
					phase: 'cutover-committed',
					revision: 0,
				}),
			).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		})

		test('3: generic arbitrary record replacement APIs are absent', () => {
			const store = factory() as MigrationCoordinatorStore & Record<string, unknown>
			for (const escape of ['create', 'save', 'compareAndSwap', 'setAuthority', 'setItem', 'repository']) {
				expect(escape in store).toBe(false)
			}
		})

		test('4: direct store use cannot perform an illegal authority edge', async () => {
			const store = factory()
			await initialize(store)
			await expect(
				store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'cutover-committed' }),
			).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
			expect((await store.loadAuthority(authorityQuery())).phase).toBe('legacy-active')
		})

		test('5: concurrent same-revision authority transitions have exactly one winner', async () => {
			const store = factory()
			await initialize(store)
			const command = { ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' }
			const results = await Promise.allSettled([store.advanceAuthorityPhase(command), store.advanceAuthorityPhase(command)])
			expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
			expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
			expect(await store.loadAuthority(authorityQuery())).toMatchObject({ phase: 'migration-snapshot-frozen', revision: 1 })
		})

		test('6: concurrent same-revision item transitions have exactly one winner', async () => {
			const store = factory()
			await initialize(store)
			await plannedItem(store)
			const version = { ...authorityQuery(), itemId: 'item-1', expectedRevision: 0 }
			const results = await Promise.allSettled([
				store.advanceMigrationItem({ ...version, action: { type: 'prepare' } }),
				store.quarantineMigrationItem({ ...version, reason: 'mint-state-unresolved' }),
			])
			expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
			expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
			expect((await store.loadMigrationItem({ ...authorityQuery(), itemId: 'item-1' })).revision).toBe(1)
		})

		test('16-17: wallet binding is enforced and item creation is only planned revision zero', async () => {
			const store = factory()
			await initialize(store)
			await expect(
				store.createPlannedMigrationItem({
					...authorityQuery(),
					itemId: 'wrong-wallet',
					sourceBucket: { ...ordinary, user: OTHER_USER },
				}),
			).rejects.toMatchObject({ code: 'BUCKET_OWNERSHIP_MISMATCH' })
			await expect(
				store.createPlannedMigrationItem({
					...authorityQuery(),
					itemId: 'forged',
					sourceBucket: ordinary,
					state: 'verified',
					revision: 99,
				}),
			).rejects.toBeDefined()
			const item = await plannedItem(store, 'legal')
			expect(item).toMatchObject({ id: 'legal', walletKey: WALLET, state: 'planned', revision: 0 })
		})

		test('18-20: persistence keeps identity immutable, binds operation once, and rejects illegal item edges', async () => {
			const store = factory()
			await initialize(store)
			const item = await plannedItem(store)
			await expect(
				store.advanceMigrationItem({
					...authorityQuery(),
					itemId: item.id,
					expectedRevision: 0,
					action: { type: 'verify' },
				}),
			).rejects.toMatchObject({ code: 'INVALID_QUARANTINE_TRANSITION' })
			await expect(
				store.advanceMigrationItem({
					...authorityQuery(),
					itemId: item.id,
					expectedRevision: 0,
					action: { type: 'prepare' },
					mint: 'https://attacker.example',
				}),
			).rejects.toBeDefined()

			const bound = await store.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				operationId: 'receive-op:1',
			})
			expect(bound).toMatchObject({ cocoOperationId: 'receive-op:1', revision: 1 })
			await expect(
				store.bindCocoOperationOnce({
					...authorityQuery(),
					itemId: item.id,
					expectedRevision: 1,
					operationId: 'receive-op:2',
				}),
			).rejects.toMatchObject({ code: 'INVALID_QUARANTINE_TRANSITION' })
			const reloaded = await store.loadMigrationItem({ ...authorityQuery(), itemId: item.id })
			expect(reloaded).toMatchObject({ sourceBucketKey: item.sourceBucketKey, mint: item.mint, unit: item.unit })
		})

		test('21: quarantine is terminal at the persistence layer', async () => {
			const store = factory()
			await initialize(store)
			await plannedItem(store)
			const quarantined = await store.quarantineMigrationItem({
				...authorityQuery(),
				itemId: 'item-1',
				expectedRevision: 0,
				reason: 'mint-state-unresolved',
			})
			await expect(
				store.advanceMigrationItem({
					...authorityQuery(),
					itemId: quarantined.id,
					expectedRevision: quarantined.revision,
					action: { type: 'prepare' },
				}),
			).rejects.toMatchObject({ code: 'INVALID_QUARANTINE_TRANSITION' })
		})

		test('declared item commands derive the only legal complete successor chain', async () => {
			const store = factory()
			await initialize(store)
			await plannedItem(store)
			const prepared = await store.advanceMigrationItem({
				...authorityQuery(),
				itemId: 'item-1',
				expectedRevision: 0,
				action: { type: 'prepare' },
			})
			const bound = await store.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: 'item-1',
				expectedRevision: prepared.revision,
				operationId: 'receive-op:complete',
			})
			const executing = await store.advanceMigrationItem({
				...authorityQuery(),
				itemId: 'item-1',
				expectedRevision: bound.revision,
				action: { type: 'begin-execution' },
			})
			const verified = await store.advanceMigrationItem({
				...authorityQuery(),
				itemId: 'item-1',
				expectedRevision: executing.revision,
				action: { type: 'verify' },
			})
			expect(verified).toMatchObject({ state: 'verified', revision: 4, cocoOperationId: 'receive-op:complete' })
		})

		test('direct store rejects stale revisions and wrong epochs', async () => {
			const store = factory()
			await initialize(store)
			await plannedItem(store)
			await expect(store.loadMigrationItem({ ...authorityQuery(), migrationEpoch: 'epoch-wrong', itemId: 'item-1' })).rejects.toMatchObject(
				{ code: 'WRONG_EPOCH' },
			)
			await expect(
				store.advanceAuthorityPhase({
					...authorityQuery(),
					migrationEpoch: 'epoch-wrong',
					expectedRevision: 0,
					nextPhase: 'migration-snapshot-frozen',
				}),
			).rejects.toMatchObject({ code: 'WRONG_EPOCH' })
			await store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
			await expect(store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'importing' })).rejects.toMatchObject(
				{ code: 'STALE_REVISION' },
			)
			await store.advanceMigrationItem({ ...authorityQuery(), itemId: 'item-1', expectedRevision: 0, action: { type: 'prepare' } })
			await expect(
				store.advanceMigrationItem({ ...authorityQuery(), itemId: 'item-1', expectedRevision: 0, action: { type: 'prepare' } }),
			).rejects.toMatchObject({ code: 'STALE_REVISION' })
		})
	})
}

runMigrationCoordinatorStoreContract(() => new InMemoryMigrationCoordinatorStore())
