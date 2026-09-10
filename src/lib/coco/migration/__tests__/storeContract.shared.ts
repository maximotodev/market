import { buildCocoWalletNamespace } from '../../namespace'
import type { MigrationCoordinatorStore } from '../coordinator'
import { createMonetaryBucketIdentity } from '../types'

export const STORE_CONTRACT_USER = 'a'.repeat(64)
export const STORE_CONTRACT_OTHER_USER = 'b'.repeat(64)
export const STORE_CONTRACT_EPOCH = 'epoch-1'
export const STORE_CONTRACT_WALLET = buildCocoWalletNamespace({ environment: 'test', pubkey: STORE_CONTRACT_USER })
export const STORE_CONTRACT_MINT = 'https://mint.example/tenant/cashu'

const ordinary = createMonetaryBucketIdentity({
	user: STORE_CONTRACT_USER,
	mint: STORE_CONTRACT_MINT,
	unit: 'sat',
	kind: 'legacy-ready',
})

export type MigrationStoreContractFactory = () => MigrationCoordinatorStore

export interface MigrationCoordinatorStoreContractCase {
	readonly name: string
	run(factory: MigrationStoreContractFactory): Promise<number>
}

function authorityQuery() {
	return { walletKey: STORE_CONTRACT_WALLET, migrationEpoch: STORE_CONTRACT_EPOCH }
}

async function initialize(store: MigrationCoordinatorStore) {
	return (
		await store.createInitialAuthority({
			walletIdentity: STORE_CONTRACT_USER,
			environment: 'test',
			migrationEpoch: STORE_CONTRACT_EPOCH,
		})
	).value
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

function createAssertions() {
	let count = 0
	const check = (condition: unknown, message: string): void => {
		count += 1
		if (!condition) throw new Error(`Store contract assertion failed: ${message}`)
	}
	const match = (actual: unknown, expected: unknown, path = 'value'): void => {
		if (expected !== null && typeof expected === 'object') {
			check(actual !== null && typeof actual === 'object', `${path} must be an object`)
			for (const [key, value] of Object.entries(expected)) match((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
			return
		}
		check(Object.is(actual, expected), `${path} must equal ${String(expected)}, received ${String(actual)}`)
	}
	const rejectsCode = async (promise: Promise<unknown>, code?: string): Promise<void> => {
		try {
			await promise
		} catch (error) {
			if (code) match(error, { code }, 'error')
			else check(error !== undefined, 'promise must reject with an error')
			return
		}
		check(false, `promise must reject${code ? ` with ${code}` : ''}`)
	}
	return { check, match, rejectsCode, count: () => count }
}

function contractCase(
	name: string,
	run: (store: MigrationCoordinatorStore, assertions: ReturnType<typeof createAssertions>) => Promise<void>,
): MigrationCoordinatorStoreContractCase {
	return {
		name,
		async run(factory) {
			const assertions = createAssertions()
			await run(factory(), assertions)
			return assertions.count()
		},
	}
}

export const migrationCoordinatorStoreContractCases: readonly MigrationCoordinatorStoreContractCase[] = Object.freeze([
	contractCase('1-2: only canonical legacy-active revision-zero initialization exists', async (store, assertion) => {
		const created = await store.createInitialAuthority({
			walletIdentity: STORE_CONTRACT_USER,
			environment: 'test',
			migrationEpoch: STORE_CONTRACT_EPOCH,
		})
		assertion.match(created, { created: true, value: { walletKey: STORE_CONTRACT_WALLET, phase: 'legacy-active', revision: 0 } })
		assertion.check(Object.isFrozen(created.value), 'created authority must be frozen')
		const duplicate = await store.createInitialAuthority({
			walletIdentity: STORE_CONTRACT_USER,
			environment: 'test',
			migrationEpoch: STORE_CONTRACT_EPOCH,
		})
		assertion.match(duplicate, { created: false, value: { phase: 'legacy-active', revision: 0 } })
		await assertion.rejectsCode(
			store.createInitialAuthority({
				walletIdentity: STORE_CONTRACT_USER,
				environment: 'test',
				migrationEpoch: STORE_CONTRACT_EPOCH,
				phase: 'cutover-committed',
				revision: 0,
			}),
			'INVALID_TRANSITION',
		)
	}),
	contractCase('3: generic arbitrary record replacement APIs are absent', async (store, assertion) => {
		const exposed = store as MigrationCoordinatorStore & Record<string, unknown>
		for (const escape of ['put', 'save', 'set', 'rawCompareAndSwap', 'create', 'compareAndSwap', 'setAuthority', 'setItem', 'repository']) {
			assertion.check(!(escape in exposed), `${escape} must not be exposed`)
		}
	}),
	contractCase('4: direct store use cannot perform an illegal authority edge', async (store, assertion) => {
		await initialize(store)
		await assertion.rejectsCode(
			store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'cutover-committed' }),
			'INVALID_TRANSITION',
		)
		assertion.match(await store.loadAuthority(authorityQuery()), { phase: 'legacy-active' })
	}),
	contractCase('5: concurrent same-revision authority transitions have exactly one winner', async (store, assertion) => {
		await initialize(store)
		const command = { ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' }
		const results = await Promise.allSettled([store.advanceAuthorityPhase(command), store.advanceAuthorityPhase(command)])
		assertion.check(results.filter((result) => result.status === 'fulfilled').length === 1, 'authority race must have one winner')
		assertion.check(results.filter((result) => result.status === 'rejected').length === 1, 'authority race must have one loser')
		assertion.match(await store.loadAuthority(authorityQuery()), { phase: 'migration-snapshot-frozen', revision: 1 })
	}),
	contractCase('6: concurrent same-revision item transitions have exactly one winner', async (store, assertion) => {
		await initialize(store)
		await plannedItem(store)
		const version = { ...authorityQuery(), itemId: 'item-1', expectedRevision: 0 }
		const results = await Promise.allSettled([
			store.advanceMigrationItem({ ...version, action: { type: 'prepare' } }),
			store.quarantineMigrationItem({ ...version, reason: 'mint-state-unresolved' }),
		])
		assertion.check(results.filter((result) => result.status === 'fulfilled').length === 1, 'item race must have one winner')
		assertion.check(results.filter((result) => result.status === 'rejected').length === 1, 'item race must have one loser')
		assertion.match(await store.loadMigrationItem({ ...authorityQuery(), itemId: 'item-1' }), { revision: 1 })
	}),
	contractCase('16-17: wallet binding is enforced and item creation is only planned revision zero', async (store, assertion) => {
		await initialize(store)
		await assertion.rejectsCode(
			store.createPlannedMigrationItem({
				...authorityQuery(),
				itemId: 'wrong-wallet',
				sourceBucket: { ...ordinary, user: STORE_CONTRACT_OTHER_USER },
			}),
			'BUCKET_OWNERSHIP_MISMATCH',
		)
		await assertion.rejectsCode(
			store.createPlannedMigrationItem({
				...authorityQuery(),
				itemId: 'forged',
				sourceBucket: ordinary,
				state: 'verified',
				revision: 99,
			}),
		)
		assertion.match(await plannedItem(store, 'legal'), { id: 'legal', walletKey: STORE_CONTRACT_WALLET, state: 'planned', revision: 0 })
	}),
	contractCase(
		'18-20: persistence keeps identity immutable, binds operation once, and rejects illegal item edges',
		async (store, assertion) => {
			await initialize(store)
			const item = await plannedItem(store)
			await assertion.rejectsCode(
				store.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, action: { type: 'verify' } }),
				'INVALID_QUARANTINE_TRANSITION',
			)
			await assertion.rejectsCode(
				store.advanceMigrationItem({
					...authorityQuery(),
					itemId: item.id,
					expectedRevision: 0,
					action: { type: 'prepare' },
					mint: 'https://attacker.example',
				}),
			)
			const bound = await store.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				operationId: 'receive-op:1',
			})
			assertion.match(bound, { cocoOperationId: 'receive-op:1', revision: 1 })
			await assertion.rejectsCode(
				store.bindCocoOperationOnce({
					...authorityQuery(),
					itemId: item.id,
					expectedRevision: 1,
					operationId: 'receive-op:2',
				}),
				'INVALID_QUARANTINE_TRANSITION',
			)
			assertion.match(await store.loadMigrationItem({ ...authorityQuery(), itemId: item.id }), {
				sourceBucketKey: item.sourceBucketKey,
				mint: item.mint,
				unit: item.unit,
			})
		},
	),
	contractCase('21: quarantine is terminal at the persistence layer', async (store, assertion) => {
		await initialize(store)
		await plannedItem(store)
		const quarantined = await store.quarantineMigrationItem({
			...authorityQuery(),
			itemId: 'item-1',
			expectedRevision: 0,
			reason: 'mint-state-unresolved',
		})
		await assertion.rejectsCode(
			store.advanceMigrationItem({
				...authorityQuery(),
				itemId: quarantined.id,
				expectedRevision: quarantined.revision,
				action: { type: 'prepare' },
			}),
			'INVALID_QUARANTINE_TRANSITION',
		)
	}),
	contractCase('declared item commands derive the only legal complete successor chain', async (store, assertion) => {
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
		assertion.match(verified, { state: 'verified', revision: 4, cocoOperationId: 'receive-op:complete' })
	}),
	contractCase('direct store rejects stale revisions and wrong epochs', async (store, assertion) => {
		await initialize(store)
		await plannedItem(store)
		await assertion.rejectsCode(
			store.loadMigrationItem({ ...authorityQuery(), migrationEpoch: 'epoch-wrong', itemId: 'item-1' }),
			'WRONG_EPOCH',
		)
		await assertion.rejectsCode(
			store.advanceAuthorityPhase({
				...authorityQuery(),
				migrationEpoch: 'epoch-wrong',
				expectedRevision: 0,
				nextPhase: 'migration-snapshot-frozen',
			}),
			'WRONG_EPOCH',
		)
		await store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
		await assertion.rejectsCode(
			store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'importing' }),
			'STALE_REVISION',
		)
		await store.advanceMigrationItem({ ...authorityQuery(), itemId: 'item-1', expectedRevision: 0, action: { type: 'prepare' } })
		await assertion.rejectsCode(
			store.advanceMigrationItem({ ...authorityQuery(), itemId: 'item-1', expectedRevision: 0, action: { type: 'prepare' } }),
			'STALE_REVISION',
		)
	}),
])
