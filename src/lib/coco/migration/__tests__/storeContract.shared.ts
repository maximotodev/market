import { buildCocoWalletNamespace } from '../../namespace'
import type { MigrationCoordinatorStore } from '../coordinator'
import { REQUIRED_MIGRATION_SOURCE_DOMAINS, type MigrationInventoryHeader } from '../inventory'
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

function inventoryEntryForItem(item: { id: string; mint: string; unit: string; revision: number }) {
	return {
		entryId: `entry:${item.id}`,
		kind: 'migration-claim',
		sourceDomain: 'legacy-proof-store',
		sourceLocator: `source:${item.id}`,
		mint: item.mint,
		unit: item.unit,
		amount: 1n,
		sourceBucket: ordinary,
		disposition: {
			destinationDisposition: 'retained-legacy-workflow',
			destinationAmount: 1n,
			verifiedProtocolFee: 0n,
			revision: 0,
			migrationItemId: item.id,
			migrationItemRevision: item.revision,
		},
	}
}

async function completeInventory(store: MigrationCoordinatorStore): Promise<Readonly<MigrationInventoryHeader>> {
	let inventory = (await store.createMigrationInventory(authorityQuery())).value
	for (const item of await store.listMigrationItems(authorityQuery())) {
		const discovery = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: inventory.revision,
			entry: inventoryEntryForItem(item),
		})
		if (discovery.outcome !== 'recorded') throw new Error('test inventory unexpectedly invalidated')
		inventory = discovery.inventory
	}
	for (const sourceDomain of REQUIRED_MIGRATION_SOURCE_DOMAINS) {
		inventory = await store.completeMigrationInventorySource({
			...authorityQuery(),
			expectedInventoryRevision: inventory.revision,
			completion: { sourceDomain, evidenceKind: 'test-fixture-snapshot', snapshotId: `snapshot:${sourceDomain}` },
		})
	}
	return inventory
}

async function freezeSnapshot(store: MigrationCoordinatorStore) {
	const inventory = await completeInventory(store)
	return store.sealInventoryAndFreezeSnapshot({
		...authorityQuery(),
		expectedAuthorityRevision: 0,
		expectedInventoryRevision: inventory.revision,
	})
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
	contractCase('5: concurrent same-revision inventory seal/freeze transitions have exactly one winner', async (store, assertion) => {
		await initialize(store)
		const inventory = await completeInventory(store)
		const command = { ...authorityQuery(), expectedAuthorityRevision: 0, expectedInventoryRevision: inventory.revision }
		const results = await Promise.allSettled([store.sealInventoryAndFreezeSnapshot(command), store.sealInventoryAndFreezeSnapshot(command)])
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
	contractCase('quarantine creates one immutable, discoverable reconciliation handoff', async (store, assertion) => {
		await initialize(store)
		const item = await plannedItem(store)
		const quarantined = await store.quarantineMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			reason: 'mint-state-unresolved',
		})
		const handoffs = await store.listQuarantineRecoveryHandoffs(authorityQuery())
		assertion.check(Object.isFrozen(handoffs) && Object.isFrozen(handoffs[0]), 'handoff query must return immutable snapshots')
		assertion.match(handoffs, {
			0: {
				walletKey: STORE_CONTRACT_WALLET,
				user: STORE_CONTRACT_USER,
				environment: 'test',
				migrationEpoch: STORE_CONTRACT_EPOCH,
				sourceItemId: item.id,
				sourceItemRevision: quarantined.revision,
				sourceBucketKey: item.sourceBucketKey,
				status: 'authoritative-reconciliation-required',
				quarantineReason: 'mint-state-unresolved',
			},
		})
		assertion.check(handoffs.length === 1, 'quarantine must create exactly one handoff')
		assertion.check(
			JSON.stringify(Object.keys(handoffs[0]).sort()) ===
				JSON.stringify([
					'environment',
					'migrationEpoch',
					'quarantineReason',
					'sourceBucketKey',
					'sourceItemId',
					'sourceItemRevision',
					'status',
					'user',
					'walletKey',
				]),
			'handoff must expose only the minimum control-plane provenance',
		)
		const serialized = JSON.stringify(handoffs)
		for (const forbidden of ['proof', 'token', 'secret', 'witness', 'privateKey', 'refundKey', 'outputData', 'nwc']) {
			assertion.check(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `handoff must not contain ${forbidden} material`)
		}
	}),
	contractCase('repeated quarantine cannot duplicate a recovery handoff or release the source item', async (store, assertion) => {
		await initialize(store)
		const item = await plannedItem(store)
		const quarantined = await store.quarantineMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			reason: 'malformed-source',
		})
		await assertion.rejectsCode(
			store.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: quarantined.revision,
				reason: 'malformed-source',
			}),
			'INVALID_QUARANTINE_TRANSITION',
		)
		assertion.match(await store.loadMigrationItem({ ...authorityQuery(), itemId: item.id }), {
			state: 'quarantined',
			revision: quarantined.revision,
			quarantineReason: 'malformed-source',
		})
		assertion.check((await store.listQuarantineRecoveryHandoffs(authorityQuery())).length === 1, 'repeat must not duplicate handoff')
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
	contractCase('inventory sealing and snapshot freeze are atomic and the generic bypass is closed', async (store, assertion) => {
		await initialize(store)
		const inventory = await completeInventory(store)
		await assertion.rejectsCode(
			store.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' }),
			'INVALID_TRANSITION',
		)
		await assertion.rejectsCode(
			store.sealInventoryAndFreezeSnapshot({
				...authorityQuery(),
				expectedAuthorityRevision: 1,
				expectedInventoryRevision: inventory.revision,
			}),
			'STALE_REVISION',
		)
		assertion.match(await store.loadAuthority(authorityQuery()), { phase: 'legacy-active', revision: 0 })
		assertion.match(await store.loadMigrationInventory(authorityQuery()), { status: 'building', revision: inventory.revision })
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		assertion.match(sealed, {
			authority: { phase: 'migration-snapshot-frozen', revision: 1 },
			inventory: { status: 'sealed', sealedAuthorityRevision: 1 },
		})
	}),
	contractCase('sealed inventory disposition CAS preserves source facts and projects accounting', async (store, assertion) => {
		await initialize(store)
		let item = await plannedItem(store)
		const inventory = await completeInventory(store)
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		const before = (await store.listMigrationInventoryEntries(authorityQuery()))[0]
		item = await store.bindCocoOperationOnce({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			operationId: 'accounting-operation',
		})
		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'prepare' },
		})
		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'begin-execution' },
		})
		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'verify' },
		})
		const updated = await store.updateMigrationInventoryDisposition({
			...authorityQuery(),
			expectedInventoryRevision: sealed.inventory.revision,
			entryId: before.id,
			expectedDispositionRevision: 0,
			disposition: {
				destinationDisposition: 'retained-legacy-workflow',
				destinationAmount: 1n,
				verifiedProtocolFee: 0n,
				revision: 1,
				migrationItemId: item.id,
				migrationItemRevision: item.revision,
			},
		})
		assertion.match(updated, {
			id: before.id,
			sourceBucketKey: before.kind === 'migration-claim' ? before.sourceBucketKey : undefined,
			amount: 1n,
			disposition: { destinationDisposition: 'retained-legacy-workflow', revision: 1 },
		})
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: before.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 1,
				},
			}),
			'STALE_REVISION',
		)
		assertion.match(await store.migrationInventoryAccounting(authorityQuery()), { 0: { ok: true, claimCount: 1 } })
	}),
	contractCase('sealed observation collisions invalidate while exact re-observation is idempotent', async (store, assertion) => {
		await initialize(store)
		const item = await plannedItem(store)
		const inventory = await completeInventory(store)
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		const exact = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: inventoryEntryForItem(item),
		})
		assertion.match(exact, { outcome: 'already-recorded', inventory: { status: 'sealed' } })
		const conflict = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: { ...inventoryEntryForItem(item), entryId: 'alternate-entry' },
		})
		assertion.match(conflict, { outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
		assertion.match(await store.loadMigrationInventory(authorityQuery()), { status: 'invalidated' })
		assertion.check((await store.listMigrationInventoryEntries(authorityQuery())).length === 1, 'collision amended sealed membership')
	}),
	contractCase('only associated malformed sealed observations invalidate', async (store, assertion) => {
		await initialize(store)
		const item = await plannedItem(store)
		const inventory = await completeInventory(store)
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		await assertion.rejectsCode(
			store.discoverMigrationInventoryEntry({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entry: { entryId: ' unsafe id', sourceLocator: ' unsafe locator', unexpected: true },
			}),
			'INVALID_TRANSITION',
		)
		assertion.match(await store.loadMigrationInventory(authorityQuery()), { status: 'sealed', revision: sealed.inventory.revision })
		const malformed = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: { ...inventoryEntryForItem(item), unexpected: true },
		})
		assertion.match(malformed, { outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
		assertion.match(await store.loadMigrationInventory(authorityQuery()), { status: 'invalidated' })
		assertion.check((await store.listMigrationInventoryEntries(authorityQuery())).length === 1, 'malformed observation amended membership')
	}),
	contractCase('internal disposition references exist, match, and cannot rebind revisions', async (store, assertion) => {
		await initialize(store)
		let inventory = (await store.createMigrationInventory(authorityQuery())).value
		await assertion.rejectsCode(
			store.discoverMigrationInventoryEntry({
				...authorityQuery(),
				expectedInventoryRevision: inventory.revision,
				entry: inventoryEntryForItem({ id: 'missing-item', mint: STORE_CONTRACT_MINT, unit: 'sat', revision: 0 }),
			}),
			'INVALID_TRANSITION',
		)
		const item = await plannedItem(store)
		const discovery = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: inventory.revision,
			entry: inventoryEntryForItem(item),
		})
		if (discovery.outcome !== 'recorded') throw new Error('reference contract discovery was not recorded')
		inventory = discovery.inventory
		for (const sourceDomain of REQUIRED_MIGRATION_SOURCE_DOMAINS) {
			inventory = await store.completeMigrationInventorySource({
				...authorityQuery(),
				expectedInventoryRevision: inventory.revision,
				completion: { sourceDomain, evidenceKind: 'test-fixture-snapshot', snapshotId: `reference:${sourceDomain}` },
			})
		}
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'coco-ready',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: item.id,
					migrationItemRevision: item.revision + 1,
				},
			}),
			'INVALID_TRANSITION',
		)
	}),
	contractCase('live migration item bindings refresh only to the exact compatible durable revision', async (store, assertion) => {
		await initialize(store)
		let item = await plannedItem(store, 'live-item')
		const otherItem = await plannedItem(store, 'other-item')
		const inventory = await completeInventory(store)
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		const entry = (await store.listMigrationInventoryEntries(authorityQuery())).find(
			(candidate) => candidate.kind === 'migration-claim' && candidate.disposition.migrationItemId === item.id,
		)
		if (!entry || entry.kind !== 'migration-claim') throw new Error('live migration inventory entry was not found')

		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'prepare' },
		})
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'coco-ready',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
				},
			}),
			'INVALID_TRANSITION',
		)
		await store.updateMigrationInventoryDisposition({
			...authorityQuery(),
			expectedInventoryRevision: sealed.inventory.revision,
			entryId: entry.id,
			expectedDispositionRevision: 0,
			disposition: {
				destinationDisposition: 'retained-legacy-workflow',
				destinationAmount: 1n,
				verifiedProtocolFee: 0n,
				revision: 1,
				migrationItemId: item.id,
				migrationItemRevision: item.revision,
			},
		})
		let currentInventory = await store.loadMigrationInventory(authorityQuery())
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: currentInventory.revision,
				entryId: entry.id,
				expectedDispositionRevision: 1,
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 2,
					migrationItemId: item.id,
					migrationItemRevision: item.revision + 1,
				},
			}),
			'INVALID_TRANSITION',
		)

		item = await store.bindCocoOperationOnce({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			operationId: 'live-successor-operation',
		})
		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'begin-execution' },
		})
		item = await store.advanceMigrationItem({
			...authorityQuery(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'verify' },
		})
		for (const destinationDisposition of ['coco-ready', 'coco-reserved', 'verified-consumed-external'] as const) {
			await assertion.rejectsCode(
				store.updateMigrationInventoryDisposition({
					...authorityQuery(),
					expectedInventoryRevision: currentInventory.revision,
					entryId: entry.id,
					expectedDispositionRevision: 1,
					disposition: {
						destinationDisposition,
						destinationAmount: 1n,
						verifiedProtocolFee: 0n,
						revision: 2,
						migrationItemId: item.id,
						migrationItemRevision: item.revision,
					},
				}),
				'INVALID_TRANSITION',
			)
		}
		assertion.match(await store.loadMigrationInventory(authorityQuery()), {
			revision: currentInventory.revision,
			status: 'sealed',
		})
		assertion.match(
			(await store.listMigrationInventoryEntries(authorityQuery())).find((candidate) => candidate.id === entry.id),
			{
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					revision: 1,
					migrationItemRevision: 1,
				},
			},
		)
		await store.updateMigrationInventoryDisposition({
			...authorityQuery(),
			expectedInventoryRevision: currentInventory.revision,
			entryId: entry.id,
			expectedDispositionRevision: 1,
			disposition: {
				destinationDisposition: 'retained-legacy-workflow',
				destinationAmount: 1n,
				verifiedProtocolFee: 0n,
				revision: 2,
				migrationItemId: item.id,
				migrationItemRevision: item.revision,
			},
		})
		currentInventory = await store.loadMigrationInventory(authorityQuery())
		for (const forged of [item.revision - 1, item.revision + 1]) {
			await assertion.rejectsCode(
				store.updateMigrationInventoryDisposition({
					...authorityQuery(),
					expectedInventoryRevision: currentInventory.revision,
					entryId: entry.id,
					expectedDispositionRevision: 2,
					disposition: {
						destinationDisposition: 'retained-legacy-workflow',
						destinationAmount: 1n,
						verifiedProtocolFee: 0n,
						revision: 3,
						migrationItemId: item.id,
						migrationItemRevision: forged,
					},
				}),
				'INVALID_TRANSITION',
			)
		}
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: currentInventory.revision,
				entryId: entry.id,
				expectedDispositionRevision: 2,
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 3,
					migrationItemId: otherItem.id,
					migrationItemRevision: otherItem.revision,
				},
			}),
			'INVALID_TRANSITION',
		)
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: currentInventory.revision,
				entryId: entry.id,
				expectedDispositionRevision: 1,
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 3,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
				},
			}),
			'STALE_REVISION',
		)
	}),
	contractCase('quarantine disposition references require the exact durable handoff', async (store, assertion) => {
		await initialize(store)
		const planned = await plannedItem(store)
		const item = await store.quarantineMigrationItem({
			...authorityQuery(),
			itemId: planned.id,
			expectedRevision: planned.revision,
			reason: 'mint-state-unresolved',
		})
		let inventory = (await store.createMigrationInventory(authorityQuery())).value
		const baseEntry = inventoryEntryForItem(item)
		await assertion.rejectsCode(
			store.discoverMigrationInventoryEntry({
				...authorityQuery(),
				expectedInventoryRevision: inventory.revision,
				entry: {
					...baseEntry,
					disposition: {
						destinationDisposition: 'quarantined',
						destinationAmount: 1n,
						verifiedProtocolFee: 0n,
						revision: 0,
						quarantineHandoffItemId: 'missing-handoff',
						quarantineHandoffItemRevision: item.revision,
					},
				},
			}),
			'INVALID_TRANSITION',
		)
		const discovery = await store.discoverMigrationInventoryEntry({
			...authorityQuery(),
			expectedInventoryRevision: inventory.revision,
			entry: {
				...baseEntry,
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 0,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
					quarantineHandoffItemId: item.id,
					quarantineHandoffItemRevision: item.revision,
				},
			},
		})
		if (discovery.outcome !== 'recorded') throw new Error('quarantine reference discovery was not recorded')
		inventory = discovery.inventory
		for (const sourceDomain of REQUIRED_MIGRATION_SOURCE_DOMAINS) {
			inventory = await store.completeMigrationInventorySource({
				...authorityQuery(),
				expectedInventoryRevision: inventory.revision,
				completion: { sourceDomain, evidenceKind: 'test-fixture-snapshot', snapshotId: `handoff:${sourceDomain}` },
			})
		}
		const sealed = await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
					quarantineHandoffItemId: item.id,
					quarantineHandoffItemRevision: item.revision + 1,
				},
			}),
			'INVALID_TRANSITION',
		)
		await assertion.rejectsCode(
			store.updateMigrationInventoryDisposition({
				...authorityQuery(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 1n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: item.id,
					migrationItemRevision: item.revision + 1,
					quarantineHandoffItemId: item.id,
					quarantineHandoffItemRevision: item.revision,
				},
			}),
			'INVALID_TRANSITION',
		)
	}),
	contractCase('late unaccounted item invalidates sealed membership without appending value', async (store, assertion) => {
		await initialize(store)
		const inventory = await completeInventory(store)
		await store.sealInventoryAndFreezeSnapshot({
			...authorityQuery(),
			expectedAuthorityRevision: 0,
			expectedInventoryRevision: inventory.revision,
		})
		await plannedItem(store, 'late-item')
		assertion.match(await store.loadMigrationInventory(authorityQuery()), {
			status: 'invalidated',
			invalidation: { reason: 'late-monetary-discovery', sourceLocator: 'migration-item:late-item' },
		})
		assertion.check((await store.listMigrationInventoryEntries(authorityQuery())).length === 0, 'late discovery appended value')
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
		await freezeSnapshot(store)
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
