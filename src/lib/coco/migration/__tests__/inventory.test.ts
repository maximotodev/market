import { describe, expect, test } from 'bun:test'
import { buildCocoWalletNamespace, type CocoG9aEnvironment } from '../../namespace'
import { InMemoryMigrationCoordinatorStore, MigrationCoordinator } from '../coordinator'
import {
	assertInventoryDispositionReferences,
	PRODUCTION_MIGRATION_INVENTORY_SEAL_SUPPORTED,
	REQUIRED_MIGRATION_SOURCE_DOMAINS,
	type MigrationInventoryHeader,
} from '../inventory'

const USER = 'a'.repeat(64)
const OTHER_USER = 'b'.repeat(64)
const EPOCH = 'inventory-epoch-1'
const MINT = 'https://mint.example/tenant/cashu'

function query(user = USER, epoch = EPOCH, environment: CocoG9aEnvironment = 'test') {
	return { walletKey: buildCocoWalletNamespace({ environment, pubkey: user }), migrationEpoch: epoch }
}

function sourceBucket(user = USER, kind = 'legacy-ready') {
	return {
		user,
		mint: MINT,
		unit: 'sat',
		kind,
		...(kind === 'legacy-inflight' || kind === 'pending-outbound' || kind === 'auction-p2pk-recovery' ? { workflowId: 'workflow:1' } : {}),
	}
}

function claimEntry(overrides: Record<string, unknown> = {}) {
	return {
		entryId: 'claim-1',
		kind: 'migration-claim',
		sourceDomain: 'legacy-proof-store',
		sourceLocator: 'legacy-proof:1',
		mint: MINT,
		unit: 'sat',
		amount: 10n,
		sourceBucket: sourceBucket(),
		disposition: {
			destinationDisposition: 'retained-legacy-workflow',
			destinationAmount: 10n,
			verifiedProtocolFee: 0n,
			revision: 0,
		},
		...overrides,
	}
}

async function setup(environment: CocoG9aEnvironment = 'test', user = USER, epoch = EPOCH) {
	const store = new InMemoryMigrationCoordinatorStore()
	const coordinator = new MigrationCoordinator(store)
	await coordinator.initialize({ walletIdentity: user, environment, migrationEpoch: epoch })
	return { store, coordinator, query: query(user, epoch, environment) }
}

async function createInventory(coordinator: MigrationCoordinator, inventoryQuery = query()) {
	return (await coordinator.createInventory(inventoryQuery)).value
}

async function addClaim(
	coordinator: MigrationCoordinator,
	inventory: Readonly<MigrationInventoryHeader>,
	inventoryQuery = query(),
	entry = claimEntry(),
) {
	const result = await coordinator.discoverInventoryEntry({
		...inventoryQuery,
		expectedInventoryRevision: inventory.revision,
		entry,
	})
	if (result.outcome !== 'recorded') throw new Error('inventory unexpectedly invalidated')
	return result
}

async function completeAll(coordinator: MigrationCoordinator, inventory: Readonly<MigrationInventoryHeader>, inventoryQuery = query()) {
	let current = inventory
	for (const sourceDomain of REQUIRED_MIGRATION_SOURCE_DOMAINS) {
		current = await coordinator.completeInventorySource({
			...inventoryQuery,
			expectedInventoryRevision: current.revision,
			completion: { sourceDomain, evidenceKind: 'test-fixture-snapshot', snapshotId: `snapshot:${sourceDomain}` },
		})
	}
	return current
}

async function seal(coordinator: MigrationCoordinator, inventory: Readonly<MigrationInventoryHeader>, inventoryQuery = query()) {
	return coordinator.sealInventoryAndFreezeSnapshot({
		...inventoryQuery,
		expectedAuthorityRevision: 0,
		expectedInventoryRevision: inventory.revision,
	})
}

async function sealedClaim() {
	const context = await setup()
	let inventory = await createInventory(context.coordinator)
	inventory = (await addClaim(context.coordinator, inventory)).inventory
	inventory = await completeAll(context.coordinator, inventory)
	const sealed = await seal(context.coordinator, inventory)
	return { ...context, sealed }
}

describe('I1A.1 sealed epoch-bound migration inventory', () => {
	test('I1: one canonical building inventory exists per wallet and epoch without aliasing', async () => {
		const store = new InMemoryMigrationCoordinatorStore()
		const first = new MigrationCoordinator(store)
		await first.initialize({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })
		const created = await first.createInventory(query())
		const duplicate = await first.createInventory(query())
		expect(created).toMatchObject({ created: true, value: { status: 'building', revision: 0, migrationEpoch: EPOCH } })
		expect(duplicate).toMatchObject({ created: false, value: { walletKey: query().walletKey, migrationEpoch: EPOCH } })
		expect(Object.isFrozen(created.value.requiredSources)).toBe(true)

		await first.initialize({ walletIdentity: OTHER_USER, environment: 'test', migrationEpoch: 'other-epoch' })
		const other = await first.createInventory(query(OTHER_USER, 'other-epoch'))
		expect(other.value.walletKey).not.toBe(created.value.walletKey)
		await expect(first.inventory({ ...query(), migrationEpoch: 'wrong-epoch' })).rejects.toMatchObject({ code: 'WRONG_EPOCH' })
	})

	test('I2: duplicate entry and source identities reject instead of double-counting', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		await expect(
			coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: inventory.revision,
				entry: claimEntry({ sourceLocator: 'legacy-proof:2' }),
			}),
		).rejects.toMatchObject({ code: 'COORDINATOR_RECORD_EXISTS' })
		await expect(
			coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: inventory.revision,
				entry: claimEntry({ entryId: 'claim-2' }),
			}),
		).rejects.toMatchObject({ code: 'COORDINATOR_RECORD_EXISTS' })
		expect(await coordinator.inventoryEntries(query())).toHaveLength(1)
	})

	test('I3: stale header and disposition revisions cannot overwrite newer state', async () => {
		const { coordinator } = await setup()
		const inventory = await createInventory(coordinator)
		const discovery = await addClaim(coordinator, inventory)
		await expect(
			coordinator.completeInventorySource({
				...query(),
				expectedInventoryRevision: inventory.revision,
				completion: {
					sourceDomain: 'legacy-proof-store',
					evidenceKind: 'test-fixture-snapshot',
					snapshotId: 'stale',
				},
			}),
		).rejects.toMatchObject({ code: 'STALE_REVISION' })
		const complete = await completeAll(coordinator, discovery.inventory)
		const sealed = await seal(coordinator, complete)
		const disposition = {
			destinationDisposition: 'coco-ready',
			destinationAmount: 10n,
			verifiedProtocolFee: 0n,
			revision: 1,
		}
		await coordinator.updateInventoryDisposition({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entryId: discovery.entry.id,
			expectedDispositionRevision: 0,
			disposition,
		})
		await expect(
			coordinator.updateInventoryDisposition({
				...query(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition,
			}),
		).rejects.toMatchObject({ code: 'STALE_REVISION' })
	})

	test('I4: every fixed source requires same-epoch trusted completion evidence', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		await expect(seal(coordinator, inventory)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		await expect(
			coordinator.completeInventorySource({
				...query(),
				expectedInventoryRevision: inventory.revision,
				completion: { sourceDomain: 'legacy-proof-store', evidenceKind: 'caller-boolean', snapshotId: 'untrusted' },
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		await expect(
			coordinator.completeInventorySource({
				...query(),
				migrationEpoch: 'wrong-epoch',
				expectedInventoryRevision: inventory.revision,
				completion: {
					sourceDomain: 'legacy-proof-store',
					evidenceKind: 'test-fixture-snapshot',
					snapshotId: 'wrong',
				},
			}),
		).rejects.toMatchObject({ code: 'WRONG_EPOCH' })
		const production = await setup('production')
		const productionInventory = await createInventory(production.coordinator, production.query)
		await expect(
			production.coordinator.completeInventorySource({
				...production.query,
				expectedInventoryRevision: productionInventory.revision,
				completion: {
					sourceDomain: 'legacy-proof-store',
					evidenceKind: 'test-fixture-snapshot',
					snapshotId: 'not-production-evidence',
				},
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		expect(PRODUCTION_MIGRATION_INVENTORY_SEAL_SUPPORTED).toBe(false)
	})

	test('I4: adding source membership invalidates that source completion marker', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = await coordinator.completeInventorySource({
			...query(),
			expectedInventoryRevision: inventory.revision,
			completion: {
				sourceDomain: 'legacy-proof-store',
				evidenceKind: 'test-fixture-snapshot',
				snapshotId: 'before-late-membership',
			},
		})
		expect(inventory.completedSources).toHaveLength(1)

		inventory = (await addClaim(coordinator, inventory)).inventory
		expect(inventory.completedSources).toHaveLength(0)
		await expect(seal(coordinator, inventory)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
	})

	test('I5-I7: seal and snapshot freeze are one CAS transition and generic bypass is closed', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		inventory = await completeAll(coordinator, inventory)
		await expect(
			coordinator.advanceAuthority({ ...query(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' }),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		const result = await seal(coordinator, inventory)
		expect(result.authority).toMatchObject({ phase: 'migration-snapshot-frozen', revision: 1 })
		expect(result.inventory).toMatchObject({
			status: 'sealed',
			sealedEntryCount: 1,
			sealedAuthorityRevision: 1,
		})
	})

	test('I6: failed seal leaves both authority and inventory unchanged', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = await completeAll(coordinator, inventory)
		await expect(
			coordinator.sealInventoryAndFreezeSnapshot({
				...query(),
				expectedAuthorityRevision: 1,
				expectedInventoryRevision: inventory.revision,
			}),
		).rejects.toMatchObject({ code: 'STALE_REVISION' })
		expect(await coordinator.status(query())).toMatchObject({ phase: 'legacy-active', revision: 0 })
		expect(await coordinator.inventory(query())).toMatchObject({ status: 'building', revision: inventory.revision })
	})

	test('I8 and I10-I11: sealed membership is immutable and late discovery irreversibly invalidates the epoch', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		inventory = await completeAll(coordinator, inventory)
		const sealed = await seal(coordinator, inventory)
		const result = await coordinator.discoverInventoryEntry({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: claimEntry({ entryId: 'late-claim', sourceLocator: 'legacy-proof:late' }),
		})
		expect(result).toMatchObject({ outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
		expect(await coordinator.inventoryEntries(query())).toHaveLength(1)
		await expect(
			coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: result.inventory.revision,
				entry: claimEntry({ entryId: 'another', sourceLocator: 'legacy-proof:another' }),
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		await expect(
			coordinator.sealInventoryAndFreezeSnapshot({
				...query(),
				expectedAuthorityRevision: 1,
				expectedInventoryRevision: result.inventory.revision,
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
	})

	test('MH1: a new entry ID reusing a sealed source locator durably invalidates the epoch', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		inventory = await completeAll(coordinator, inventory)
		const sealed = await seal(coordinator, inventory)
		const result = await coordinator.discoverInventoryEntry({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: claimEntry({ entryId: 'alternate-id' }),
		})
		expect(result).toMatchObject({ outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
		expect(await coordinator.inventory(query())).toMatchObject({
			status: 'invalidated',
			invalidation: { reason: 'late-monetary-discovery', sourceLocator: 'legacy-proof:1' },
		})
		expect(await coordinator.inventoryEntries(query())).toHaveLength(1)
	})

	test('MH2: an existing sealed ID with conflicting immutable value invalidates the epoch', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		inventory = await completeAll(coordinator, inventory)
		const sealed = await seal(coordinator, inventory)
		const result = await coordinator.discoverInventoryEntry({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: claimEntry({ amount: 11n }),
		})
		expect(result).toMatchObject({ outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
		expect(await coordinator.inventoryEntries(query())).toMatchObject([{ id: 'claim-1', amount: 10n }])
	})

	test('MH3: exact sealed source re-observation is idempotent and cannot amend membership', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = (await addClaim(coordinator, inventory)).inventory
		inventory = await completeAll(coordinator, inventory)
		const sealed = await seal(coordinator, inventory)
		const result = await coordinator.discoverInventoryEntry({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entry: claimEntry(),
		})
		expect(result).toMatchObject({
			outcome: 'already-recorded',
			inventory: { status: 'sealed', revision: sealed.inventory.revision },
			entry: { id: 'claim-1', amount: 10n, sourceLocator: 'legacy-proof:1' },
		})
		expect(await coordinator.inventoryEntries(query())).toHaveLength(1)
	})

	test('R1C-R1G: every identifiable malformed or conflicting sealed observation invalidates', async () => {
		const cases: Array<readonly [string, () => Record<string, unknown>]> = [
			['existing ID with new valid locator', () => claimEntry({ sourceLocator: 'legacy-proof:new-locator' })],
			['known ID with malformed locator', () => claimEntry({ sourceLocator: ' unsafe locator' })],
			['malformed ID with known locator', () => claimEntry({ entryId: ' unsafe id' })],
			['known identity with extra field', () => ({ ...claimEntry(), unexpected: true })],
			['changed amount', () => claimEntry({ amount: 11n })],
			[
				'changed mint provenance',
				() =>
					claimEntry({
						mint: 'https://other-mint.example',
						sourceBucket: { ...sourceBucket(), mint: 'https://other-mint.example' },
					}),
			],
			['changed unit provenance', () => claimEntry({ unit: 'usd', sourceBucket: { ...sourceBucket(), unit: 'usd' } })],
			[
				'changed source classification',
				() =>
					claimEntry({
						sourceDomain: 'legacy-reservations',
						sourceBucket: sourceBucket(USER, 'legacy-inflight'),
					}),
			],
		]
		for (const [label, entry] of cases) {
			const { coordinator, sealed } = await sealedClaim()
			const result = await coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: sealed.inventory.revision,
				entry: entry(),
			})
			expect(result, label).toMatchObject({ outcome: 'late-discovery-invalidated', inventory: { status: 'invalidated' } })
			expect(await coordinator.inventory(query()), label).toMatchObject({ status: 'invalidated' })
			expect(await coordinator.inventoryEntries(query()), label).toHaveLength(1)
		}
	})

	test('R1H: fully malformed unassociated input rejects without invalidating the sealed inventory', async () => {
		const { coordinator, sealed } = await sealedClaim()
		await expect(
			coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: sealed.inventory.revision,
				entry: { entryId: ' unsafe id', sourceLocator: ' unsafe locator', unexpected: true },
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		expect(await coordinator.inventory(query())).toMatchObject({ status: 'sealed', revision: sealed.inventory.revision })
		expect(await coordinator.inventoryEntries(query())).toHaveLength(1)
	})

	test('MH4 and MH6: quarantine handoff references must exist and bound revisions cannot change', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		await expect(
			addClaim(
				coordinator,
				inventory,
				query(),
				claimEntry({
					disposition: {
						destinationDisposition: 'quarantined',
						destinationAmount: 10n,
						verifiedProtocolFee: 0n,
						revision: 0,
						quarantineHandoffItemId: 'missing-handoff',
						quarantineHandoffItemRevision: 1,
					},
				}),
			),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })

		const item = (await coordinator.createPlannedItem({ ...query(), itemId: 'item-1', sourceBucket: sourceBucket() })).value
		const quarantined = await coordinator.quarantineItem({
			...query(),
			itemId: item.id,
			expectedRevision: item.revision,
			reason: 'mint-state-unresolved',
		})
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
					migrationItemId: quarantined.id,
					migrationItemRevision: quarantined.revision,
					quarantineHandoffItemId: quarantined.id,
					quarantineHandoffItemRevision: quarantined.revision,
				},
			}),
		)
		inventory = await completeAll(coordinator, discovery.inventory)
		const sealed = await seal(coordinator, inventory)
		await expect(
			coordinator.updateInventoryDisposition({
				...query(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: quarantined.id,
					migrationItemRevision: quarantined.revision,
					quarantineHandoffItemId: quarantined.id,
					quarantineHandoffItemRevision: quarantined.revision + 1,
				},
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
	})

	test('MH5 and MH7: migration item references must exist and forged successor revisions reject', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		await expect(
			addClaim(
				coordinator,
				inventory,
				query(),
				claimEntry({
					disposition: {
						destinationDisposition: 'retained-legacy-workflow',
						destinationAmount: 10n,
						verifiedProtocolFee: 0n,
						revision: 0,
						migrationItemId: 'missing-item',
						migrationItemRevision: 0,
					},
				}),
			),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })

		const item = (await coordinator.createPlannedItem({ ...query(), itemId: 'item-1', sourceBucket: sourceBucket() })).value
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
				},
			}),
		)
		inventory = await completeAll(coordinator, discovery.inventory)
		const sealed = await seal(coordinator, inventory)
		await expect(
			coordinator.updateInventoryDisposition({
				...query(),
				expectedInventoryRevision: sealed.inventory.revision,
				entryId: discovery.entry.id,
				expectedDispositionRevision: 0,
				disposition: {
					destinationDisposition: 'coco-ready',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 1,
					migrationItemId: item.id,
					migrationItemRevision: item.revision + 1,
				},
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
	})

	test('R2F: migration item references cannot cross wallet, epoch, or source bucket', async () => {
		const { coordinator } = await setup()
		const item = (await coordinator.createPlannedItem({ ...query(), itemId: 'item-1', sourceBucket: sourceBucket() })).value
		const otherBucketItem = (
			await coordinator.createPlannedItem({
				...query(),
				itemId: 'other-bucket-item',
				sourceBucket: sourceBucket(USER, 'legacy-inflight'),
			})
		).value
		const inventory = await createInventory(coordinator)
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
				},
			}),
		)
		const mismatches = [
			{ ...item, walletKey: buildCocoWalletNamespace({ environment: 'test', pubkey: OTHER_USER }) },
			{ ...item, migrationEpoch: 'other-epoch' },
			{ ...item, sourceBucketKey: otherBucketItem.sourceBucketKey },
		]
		for (const mismatch of mismatches) {
			expect(() => assertInventoryDispositionReferences(discovery.entry, [mismatch], [])).toThrow()
		}
	})

	test('MH8: Coco operation IDs remain opaque non-authorizing references', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
					cocoOperationId: 'opaque-operation-reference',
				},
			}),
		)
		inventory = await completeAll(coordinator, discovery.inventory)
		await seal(coordinator, inventory)
		const [entry] = await coordinator.inventoryEntries(query())
		expect(entry.kind === 'migration-claim' && entry.disposition.cocoOperationId).toBe('opaque-operation-reference')
		expect('executableOwner' in entry).toBe(false)
		expect('cutoverReady' in entry).toBe(false)
	})

	test('I9: disposition CAS preserves every immutable source field', async () => {
		const { coordinator } = await setup()
		let item = (await coordinator.createPlannedItem({ ...query(), itemId: 'item-1', sourceBucket: sourceBucket() })).value
		let inventory = await createInventory(coordinator)
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				disposition: {
					destinationDisposition: 'retained-legacy-workflow',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
					migrationItemId: item.id,
					migrationItemRevision: item.revision,
				},
			}),
		)
		inventory = await completeAll(coordinator, discovery.inventory)
		const sealed = await seal(coordinator, inventory)
		item = await coordinator.bindCocoOperation({
			...query(),
			itemId: item.id,
			expectedRevision: item.revision,
			operationId: 'receive-op:1',
		})
		item = await coordinator.advanceItem({
			...query(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'prepare' },
		})
		item = await coordinator.advanceItem({
			...query(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'begin-execution' },
		})
		item = await coordinator.advanceItem({
			...query(),
			itemId: item.id,
			expectedRevision: item.revision,
			action: { type: 'verify' },
		})
		const before = discovery.entry
		const after = await coordinator.updateInventoryDisposition({
			...query(),
			expectedInventoryRevision: sealed.inventory.revision,
			entryId: before.id,
			expectedDispositionRevision: 0,
			disposition: {
				destinationDisposition: 'retained-legacy-workflow',
				destinationAmount: 10n,
				verifiedProtocolFee: 0n,
				revision: 1,
				migrationItemId: item.id,
				migrationItemRevision: item.revision,
				cocoOperationId: 'receive-op:1',
			},
		})
		for (const field of [
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
		] as const) {
			expect(after[field]).toEqual(before[field])
		}
		expect(after.kind === 'migration-claim' && after.disposition).toMatchObject({
			destinationDisposition: 'retained-legacy-workflow',
			destinationAmount: 10n,
			verifiedProtocolFee: 0n,
			revision: 1,
		})
	})

	test('I10: a new unaccounted migration item invalidates a sealed inventory centrally', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		inventory = await completeAll(coordinator, inventory)
		await seal(coordinator, inventory)
		await coordinator.createPlannedItem({ ...query(), itemId: 'late-item', sourceBucket: sourceBucket() })
		expect(await coordinator.inventory(query())).toMatchObject({
			status: 'invalidated',
			invalidation: { reason: 'late-monetary-discovery', sourceLocator: 'migration-item:late-item' },
		})
	})

	test('I12-I13: sealed records alone project exact accounting and unresolved value may still conserve', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		const discovery = await addClaim(
			coordinator,
			inventory,
			query(),
			claimEntry({
				sourceBucket: sourceBucket(USER, 'unresolved'),
				disposition: {
					destinationDisposition: 'quarantined',
					destinationAmount: 10n,
					verifiedProtocolFee: 0n,
					revision: 0,
				},
			}),
		)
		inventory = await completeAll(coordinator, discovery.inventory)
		await seal(coordinator, inventory)
		const reports = await coordinator.inventoryAccounting(query())
		expect(reports).toHaveLength(1)
		expect(reports[0]).toMatchObject({ ok: true, migrationSourceTotal: 10n, destinationTotal: 10n, claimCount: 1 })
		await expect(coordinator.inventoryAccounting({ ...query(), sourceAmount: 1_000_000n })).rejects.toMatchObject({
			code: 'INVALID_TRANSITION',
		})
		expect('cutoverReady' in reports[0]).toBe(false)
	})

	test('I14: inventory records reject and expose no bearer, credential, or executable-owner material', async () => {
		const { coordinator } = await setup()
		let inventory = await createInventory(coordinator)
		await expect(
			coordinator.discoverInventoryEntry({
				...query(),
				expectedInventoryRevision: inventory.revision,
				entry: { ...claimEntry(), secret: 'KNOWN_FAKE_BEARER_SECRET_DO_NOT_STORE' },
			}),
		).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
		inventory = (await addClaim(coordinator, inventory)).inventory
		const persisted = { inventory: await coordinator.inventory(query()), entries: await coordinator.inventoryEntries(query()) }
		const serialized = JSON.stringify(persisted, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
		const keys: string[] = []
		const collectKeys = (value: unknown): void => {
			if (!value || typeof value !== 'object') return
			for (const [key, child] of Object.entries(value)) {
				keys.push(key.toLowerCase())
				collectKeys(child)
			}
		}
		collectKeys(persisted)
		for (const forbidden of [
			'proof',
			'secret',
			'token',
			'outputData',
			'blindSignature',
			'witness',
			'seed',
			'privateKey',
			'refundKey',
			'nwc',
			'executableOwner',
			'executorCommitment',
			'cutoverReady',
		]) {
			expect(keys).not.toContain(forbidden.toLowerCase())
		}
		expect(serialized).not.toContain('KNOWN_FAKE_BEARER_SECRET_DO_NOT_STORE')
	})
})
