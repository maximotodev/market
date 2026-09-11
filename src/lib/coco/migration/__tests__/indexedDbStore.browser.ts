import { buildCocoWalletNamespace } from '../../namespace'
import {
	IndexedDbMigrationCoordinatorStore,
	deleteIndexedDbMigrationControlTestDatabase,
	type IndexedDbMigrationCoordinatorStoreConfig,
} from '../indexedDbStore'
import { createMonetaryBucketIdentity, monetaryBucketKey } from '../types'
import { STORE_CONTRACT_EPOCH, STORE_CONTRACT_USER, migrationCoordinatorStoreContractCases } from './storeContract.shared'

const USER = STORE_CONTRACT_USER
const EPOCH = STORE_CONTRACT_EPOCH
const WALLET = buildCocoWalletNamespace({ environment: 'test', pubkey: USER })
const SOURCE = createMonetaryBucketIdentity({
	user: USER,
	mint: 'https://mint.example/tenant/cashu',
	unit: 'sat',
	kind: 'legacy-ready',
})

interface BrowserTestResult {
	name: string
	assertions: number
	status: 'passed' | 'failed'
	error?: string
}

interface BrowserTestReport {
	status: 'passed' | 'failed'
	tests: number
	assertions: number
	results: BrowserTestResult[]
	databaseNames: string[]
}

const configurations: IndexedDbMigrationCoordinatorStoreConfig[] = []
const openStores = new Set<IndexedDbMigrationCoordinatorStore>()
let runIdentity = ''

function check(condition: unknown, message: string): number {
	if (!condition) throw new Error(message)
	return 1
}

async function rejectsCode(promise: Promise<unknown>, code: string, context = ''): Promise<number> {
	try {
		await promise
	} catch (error) {
		return check(
			typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code,
			`${context ? `${context}: ` : ''}Expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
		)
	}
	throw new Error(`${context ? `${context}: ` : ''}Expected rejection with ${code}`)
}

function oneRejectedWithCode(results: readonly PromiseSettledResult<unknown>[], code: string): number {
	const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
	return check(
		rejected.length === 1 &&
			typeof rejected[0].reason === 'object' &&
			rejected[0].reason !== null &&
			(rejected[0].reason as { code?: unknown }).code === code,
		`race must have one ${code} loser`,
	)
}

function config(label: string, migrationEpoch = EPOCH): IndexedDbMigrationCoordinatorStoreConfig {
	const value: IndexedDbMigrationCoordinatorStoreConfig = {
		walletIdentity: USER,
		environment: 'test',
		migrationEpoch,
		testInstanceId: `${runIdentity}-${label}`,
	}
	configurations.push(value)
	return value
}

function store(configuration: IndexedDbMigrationCoordinatorStoreConfig): IndexedDbMigrationCoordinatorStore {
	const value = new IndexedDbMigrationCoordinatorStore(configuration)
	openStores.add(value)
	return value
}

function configurationToDatabaseName(configuration: IndexedDbMigrationCoordinatorStoreConfig): string {
	return new IndexedDbMigrationCoordinatorStore(configuration).databaseName
}

async function close(...stores: IndexedDbMigrationCoordinatorStore[]): Promise<void> {
	await Promise.all(stores.map(async (value) => value.close()))
	for (const value of stores) openStores.delete(value)
}

function openRawDatabase(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

function transactionFinished(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onabort = () => reject(transaction.error)
		transaction.onerror = () => reject(transaction.error)
	})
}

async function rawRecord(databaseName: string, storeName: string, key: IDBValidKey): Promise<Record<string, unknown>> {
	const database = await openRawDatabase(databaseName)
	try {
		const transaction = database.transaction(storeName, 'readonly')
		const value = await requestValue(transaction.objectStore(storeName).get(key))
		await transactionFinished(transaction)
		return value as Record<string, unknown>
	} finally {
		database.close()
	}
}

async function rawPut(databaseName: string, storeName: string, value: Record<string, unknown>): Promise<void> {
	const database = await openRawDatabase(databaseName)
	try {
		const transaction = database.transaction(storeName, 'readwrite')
		const complete = transactionFinished(transaction)
		await requestValue(transaction.objectStore(storeName).put(value))
		await complete
	} finally {
		database.close()
	}
}

async function initialize(value: IndexedDbMigrationCoordinatorStore) {
	return (await value.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH })).value
}

function authorityQuery() {
	return { walletKey: WALLET, migrationEpoch: EPOCH }
}

async function planned(value: IndexedDbMigrationCoordinatorStore, itemId = 'item-1') {
	return (
		await value.createPlannedMigrationItem({
			...authorityQuery(),
			itemId,
			sourceBucket: SOURCE,
		})
	).value
}

async function runTest(name: string, body: () => Promise<number>): Promise<BrowserTestResult> {
	try {
		return { name, assertions: await body(), status: 'passed' }
	} catch (error) {
		return { name, assertions: 0, status: 'failed', error: error instanceof Error ? error.message : String(error) }
	}
}

async function runContract(): Promise<BrowserTestResult[]> {
	const results: BrowserTestResult[] = []
	for (const [index, contractCase] of migrationCoordinatorStoreContractCases.entries()) {
		results.push(
			await runTest(`IndexedDB contract: ${contractCase.name}`, async () => {
				const configuration = config(`contract-${index}`)
				let adapter: IndexedDbMigrationCoordinatorStore | undefined
				try {
					return await contractCase.run(() => {
						adapter = store(configuration)
						return adapter
					})
				} finally {
					if (adapter) await close(adapter)
				}
			}),
		)
	}
	return results
}

function dispatchFenceCommand(item: Record<string, unknown>, authorityRevision = 0, authorityPhase = 'legacy-active') {
	return {
		...authorityQuery(),
		expectedAuthorityRevision: authorityRevision,
		expectedEnvironment: 'test',
		expectedPhase: authorityPhase,
		workflow: 'legacy-ready-to-coco-receive',
		bucketKey: monetaryBucketKey(SOURCE),
		itemId: item.id ?? 'item-1',
		expectedItemRevision: 0,
		expectedItemState: 'planned',
		expectedCocoOperationId: typeof item.cocoOperationId === 'string' ? item.cocoOperationId : 'operation-for-corruption-check',
	}
}

async function assertCorruptAuthorityConsumersFail(
	adapter: IndexedDbMigrationCoordinatorStore,
	authority: Record<string, unknown>,
): Promise<number> {
	let assertions = await rejectsCode(adapter.loadAuthority(authorityQuery()), 'COORDINATOR_STORAGE_FAILURE')
	assertions += await rejectsCode(
		adapter.permissionsFor({ ...authorityQuery(), bucketKey: monetaryBucketKey(SOURCE) }),
		'COORDINATOR_STORAGE_FAILURE',
	)
	assertions += await rejectsCode(adapter.nip60Policy(authorityQuery()), 'COORDINATOR_STORAGE_FAILURE')
	assertions += await rejectsCode(
		adapter.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH }),
		'COORDINATOR_STORAGE_FAILURE',
	)
	assertions += await rejectsCode(
		adapter.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: authority.revision, nextPhase: 'migration-snapshot-frozen' }),
		'COORDINATOR_STORAGE_FAILURE',
	)
	assertions += await rejectsCode(
		adapter.createPlannedMigrationItem({ ...authorityQuery(), itemId: 'corrupt-authority-item', sourceBucket: SOURCE }),
		'COORDINATOR_STORAGE_FAILURE',
	)
	assertions += await rejectsCode(
		adapter.revalidateDispatchFence(dispatchFenceCommand({}, Number(authority.revision), String(authority.phase))),
		'COORDINATOR_STORAGE_FAILURE',
	)
	return assertions
}

async function assertCorruptItemConsumersFail(adapter: IndexedDbMigrationCoordinatorStore, item: Record<string, unknown>): Promise<number> {
	const itemId = String(item.id)
	const expectedRevision =
		typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : 0
	let assertions = await rejectsCode(
		adapter.loadMigrationItem({ ...authorityQuery(), itemId }),
		'COORDINATOR_STORAGE_FAILURE',
		'loadMigrationItem',
	)
	assertions += await rejectsCode(adapter.listMigrationItems(authorityQuery()), 'COORDINATOR_STORAGE_FAILURE', 'listMigrationItems')
	assertions += await rejectsCode(
		adapter.permissionsFor({ ...authorityQuery(), bucketKey: monetaryBucketKey(SOURCE) }),
		'COORDINATOR_STORAGE_FAILURE',
		'permissionsFor',
	)
	assertions += await rejectsCode(
		adapter.revalidateDispatchFence(dispatchFenceCommand(item)),
		'COORDINATOR_STORAGE_FAILURE',
		'revalidateDispatchFence',
	)
	assertions += await rejectsCode(
		adapter.createPlannedMigrationItem({ ...authorityQuery(), itemId, sourceBucket: SOURCE }),
		'COORDINATOR_STORAGE_FAILURE',
		'createPlannedMigrationItem',
	)
	assertions += await rejectsCode(
		adapter.bindCocoOperationOnce({ ...authorityQuery(), itemId, expectedRevision, operationId: 'replacement-operation' }),
		'COORDINATOR_STORAGE_FAILURE',
		'bindCocoOperationOnce',
	)
	assertions += await rejectsCode(
		adapter.advanceMigrationItem({ ...authorityQuery(), itemId, expectedRevision, action: { type: 'prepare' } }),
		'COORDINATOR_STORAGE_FAILURE',
		'advanceMigrationItem',
	)
	assertions += await rejectsCode(
		adapter.quarantineMigrationItem({ ...authorityQuery(), itemId, expectedRevision, reason: 'malformed-source' }),
		'COORDINATOR_STORAGE_FAILURE',
		'quarantineMigrationItem',
	)
	return assertions
}

async function runFocusedBrowserTests(): Promise<BrowserTestResult[]> {
	return [
		await runTest('restart and close/reopen preserve exact state', async () => {
			const configuration = config('restart')
			const first = store(configuration)
			await initialize(first)
			await first.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
			const item = await planned(first)
			const prepared = await first.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: item.revision,
				action: { type: 'prepare' },
			})
			const bound = await first.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: prepared.revision,
				operationId: 'receive-op:restart',
			})
			await close(first)
			const reopened = store(configuration)
			const authority = await reopened.loadAuthority(authorityQuery())
			const recovered = await reopened.loadMigrationItem({ ...authorityQuery(), itemId: item.id })
			let assertions = check(
				authority.phase === 'migration-snapshot-frozen' && authority.revision === 1,
				'authority did not survive reopen',
			)
			assertions += check(
				recovered.revision === bound.revision && recovered.cocoOperationId === bound.cocoOperationId,
				'item did not survive reopen',
			)
			assertions += check(Object.isFrozen(authority) && Object.isFrozen(recovered), 'reloaded snapshots must be frozen')
			assertions += check(reopened.databaseName.includes(WALLET), 'database name must bind full wallet namespace')
			await close(reopened)
			return assertions
		}),
		await runTest('every legal authority state survives a fresh adapter reopen', async () => {
			const configuration = config('valid-authority-lifecycle')
			let adapter = store(configuration)
			let authority = await initialize(adapter)
			const expected = [
				['legacy-active', 0],
				['migration-snapshot-frozen', 1],
				['importing', 2],
				['verifying', 3],
				['coco-ready', 4],
				['cutover-committed', 5],
			] as const
			let assertions = 0
			for (let index = 0; index < expected.length; index += 1) {
				await close(adapter)
				adapter = store(configuration)
				const loaded = await adapter.loadAuthority(authorityQuery())
				assertions += check(
					loaded.phase === expected[index][0] && loaded.revision === expected[index][1],
					`legal authority ${expected[index][0]}@${expected[index][1]} did not survive reopen`,
				)
				if (index + 1 < expected.length) {
					authority = await adapter.advanceAuthorityPhase({
						...authorityQuery(),
						expectedRevision: authority.revision,
						nextPhase: expected[index + 1][0],
					})
				}
			}
			await close(adapter)
			return assertions
		}),
		await runTest('impossible authority phase and revision pairs fail every authority read path', async () => {
			const invalidPairs = [
				['legacy-active', 1],
				['legacy-active', 5],
				['migration-snapshot-frozen', 0],
				['importing', 0],
				['importing', 1],
				['verifying', 1],
				['coco-ready', 0],
				['cutover-committed', 0],
				['cutover-committed', 4],
				['cutover-committed', 6],
			] as const
			let assertions = 0
			for (const [index, [phase, revision]] of invalidPairs.entries()) {
				const configuration = config(`corrupt-authority-${index}`)
				const creator = store(configuration)
				await initialize(creator)
				await close(creator)
				const record = await rawRecord(configurationToDatabaseName(configuration), 'authority', WALLET)
				const corrupt = { ...record, phase, revision }
				await rawPut(configurationToDatabaseName(configuration), 'authority', corrupt)
				const reader = store(configuration)
				assertions += await assertCorruptAuthorityConsumersFail(reader, corrupt)
				await close(reader)
			}
			return assertions
		}),
		await runTest('every legal item state and binding tuple survives a fresh adapter reopen', async () => {
			const configuration = config('valid-item-lifecycle')
			let adapter = store(configuration)
			await initialize(adapter)
			const expected: Array<readonly [string, string, number, boolean]> = []
			const create = async (id: string) => planned(adapter, id)
			const keep = (id: string, state: string, revision: number, bound: boolean) => expected.push([id, state, revision, bound])

			await create('valid-planned-0')
			keep('valid-planned-0', 'planned', 0, false)
			let item = await create('valid-planned-1-bound')
			item = await adapter.bindCocoOperationOnce({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, operationId: 'op-planned' })
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-prepared-1')
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, action: { type: 'prepare' } })
			keep(item.id, item.state, item.revision, false)
			item = await create('valid-prepared-2-bound')
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, action: { type: 'prepare' } })
			item = await adapter.bindCocoOperationOnce({ ...authorityQuery(), itemId: item.id, expectedRevision: 1, operationId: 'op-prepared' })
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-executing-3')
			item = await adapter.bindCocoOperationOnce({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, operationId: 'op-executing' })
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 1, action: { type: 'prepare' } })
			item = await adapter.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 2,
				action: { type: 'begin-execution' },
			})
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-verified-4')
			item = await adapter.bindCocoOperationOnce({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, operationId: 'op-verified' })
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 1, action: { type: 'prepare' } })
			item = await adapter.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 2,
				action: { type: 'begin-execution' },
			})
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 3, action: { type: 'verify' } })
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-quarantined-1')
			item = await adapter.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				reason: 'malformed-source',
			})
			keep(item.id, item.state, item.revision, false)
			item = await create('valid-quarantined-2-unbound')
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 0, action: { type: 'prepare' } })
			item = await adapter.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 1,
				reason: 'malformed-source',
			})
			keep(item.id, item.state, item.revision, false)
			item = await create('valid-quarantined-2-bound')
			item = await adapter.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				operationId: 'op-quarantine-2',
			})
			item = await adapter.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 1,
				reason: 'malformed-source',
			})
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-quarantined-3')
			item = await adapter.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				operationId: 'op-quarantine-3',
			})
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 1, action: { type: 'prepare' } })
			item = await adapter.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 2,
				reason: 'malformed-source',
			})
			keep(item.id, item.state, item.revision, true)
			item = await create('valid-quarantined-4')
			item = await adapter.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				operationId: 'op-quarantine-4',
			})
			item = await adapter.advanceMigrationItem({ ...authorityQuery(), itemId: item.id, expectedRevision: 1, action: { type: 'prepare' } })
			item = await adapter.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 2,
				action: { type: 'begin-execution' },
			})
			item = await adapter.quarantineMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 3,
				reason: 'malformed-source',
			})
			keep(item.id, item.state, item.revision, true)

			await close(adapter)
			adapter = store(configuration)
			const listed = await adapter.listMigrationItems(authorityQuery())
			let assertions = check(listed.length === expected.length, 'valid item matrix did not survive reopen')
			for (const [id, state, revision, bound] of expected) {
				const loaded = await adapter.loadMigrationItem({ ...authorityQuery(), itemId: id })
				assertions += check(
					loaded.state === state && loaded.revision === revision && Boolean(loaded.cocoOperationId) === bound,
					`legal item tuple ${state}@${revision}/${bound ? 'bound' : 'unbound'} did not survive reopen`,
				)
			}
			await close(adapter)
			return assertions
		}),
		await runTest('semantically corrupt item rows fail every item read and mutation path', async () => {
			const cocoOrdinary = monetaryBucketKey({ ...SOURCE, kind: 'coco-ordinary' })
			const invalidWorkflowKey = monetaryBucketKey({
				...SOURCE,
				kind: 'pending-outbound',
				workflowId: 'workflow-a',
			}).replace(/workflow-a$/, '')
			const cases: Array<readonly [string, (record: Record<string, unknown>) => Record<string, unknown>]> = [
				['verified-zero-unbound', (record) => ({ ...record, state: 'verified', revision: 0 })],
				['executing-unbound', (record) => ({ ...record, state: 'executing', revision: 3 })],
				['verified-unbound', (record) => ({ ...record, state: 'verified', revision: 4 })],
				['planned-zero-bound', (record) => ({ ...record, cocoOperationId: 'impossible-operation' })],
				['coco-ordinary-source', (record) => ({ ...record, sourceBucketKey: cocoOrdinary })],
				['bucket-mint-mismatch', (record) => ({ ...record, mint: 'https://other-mint.example' })],
				['bucket-unit-mismatch', (record) => ({ ...record, unit: 'usd' })],
				['bucket-workflow-mismatch', (record) => ({ ...record, sourceBucketKey: invalidWorkflowKey })],
				['skipped-verified', (record) => ({ ...record, state: 'verified', revision: 2, cocoOperationId: 'skipped-operation' })],
				['impossible-prepared-revision', (record) => ({ ...record, state: 'prepared', revision: 7, cocoOperationId: 'late-operation' })],
				[
					'quarantined-successor',
					(record) => ({
						...record,
						state: 'quarantined',
						revision: 5,
						cocoOperationId: 'post-terminal',
						quarantineReason: 'malformed-source',
					}),
				],
				['unknown-state', (record) => ({ ...record, state: 'completed' })],
				['negative-revision', (record) => ({ ...record, revision: -1 })],
				['fractional-revision', (record) => ({ ...record, revision: 0.5 })],
				['string-revision', (record) => ({ ...record, revision: '0' })],
			]
			let assertions = 0
			for (const [index, [label, mutate]] of cases.entries()) {
				const configuration = config(`corrupt-item-${index}-${label}`)
				const creator = store(configuration)
				await initialize(creator)
				await planned(creator)
				await close(creator)
				const databaseName = configurationToDatabaseName(configuration)
				const record = await rawRecord(databaseName, 'migrationItems', [WALLET, 'item-1'])
				const corrupt = mutate(record)
				await rawPut(databaseName, 'migrationItems', corrupt)
				const reader = store(configuration)
				assertions += await assertCorruptItemConsumersFail(reader, corrupt)
				await close(reader)
			}
			return assertions
		}),
		await runTest('two adapters create one initial authority', async () => {
			const configuration = config('create-race')
			const first = store(configuration)
			const second = store(configuration)
			const results = await Promise.all([
				first.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH }),
				second.createInitialAuthority({ walletIdentity: USER, environment: 'test', migrationEpoch: EPOCH }),
			])
			let assertions = check(results.filter((result) => result.created).length === 1, 'initial authority must have exactly one creator')
			assertions += check(results.filter((result) => !result.created).length === 1, 'duplicate authority create must be idempotent')
			await close(first, second)
			return assertions
		}),
		await runTest('two adapters advancing one authority revision have one winner', async () => {
			const configuration = config('authority-race')
			const first = store(configuration)
			const second = store(configuration)
			await initialize(first)
			const command = { ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' }
			const results = await Promise.allSettled([first.advanceAuthorityPhase(command), second.advanceAuthorityPhase(command)])
			let assertions = check(results.filter((result) => result.status === 'fulfilled').length === 1, 'authority race must have one winner')
			assertions += check(results.filter((result) => result.status === 'rejected').length === 1, 'authority race must have one loser')
			assertions += oneRejectedWithCode(results, 'STALE_REVISION')
			assertions += check((await second.loadAuthority(authorityQuery())).revision === 1, 'authority race committed wrong revision')
			await close(first, second)
			return assertions
		}),
		await runTest('two adapters mutating one item revision have one winner', async () => {
			const configuration = config('item-race')
			const first = store(configuration)
			const second = store(configuration)
			await initialize(first)
			await planned(first)
			const version = { ...authorityQuery(), itemId: 'item-1', expectedRevision: 0 }
			const results = await Promise.allSettled([
				first.advanceMigrationItem({ ...version, action: { type: 'prepare' } }),
				second.quarantineMigrationItem({ ...version, reason: 'mint-state-unresolved' }),
			])
			let assertions = check(results.filter((result) => result.status === 'fulfilled').length === 1, 'item race must have one winner')
			assertions += check(results.filter((result) => result.status === 'rejected').length === 1, 'item race must have one loser')
			assertions += oneRejectedWithCode(results, 'STALE_REVISION')
			assertions += check(
				(await first.loadMigrationItem({ ...authorityQuery(), itemId: 'item-1' })).revision === 1,
				'item race committed wrong revision',
			)
			await close(first, second)
			return assertions
		}),
		await runTest('operation A versus B binding has one winner', async () => {
			const configuration = config('bind-race')
			const first = store(configuration)
			const second = store(configuration)
			await initialize(first)
			await planned(first)
			const version = { ...authorityQuery(), itemId: 'item-1', expectedRevision: 0 }
			const results = await Promise.allSettled([
				first.bindCocoOperationOnce({ ...version, operationId: 'operation-A' }),
				second.bindCocoOperationOnce({ ...version, operationId: 'operation-B' }),
			])
			let assertions = check(results.filter((result) => result.status === 'fulfilled').length === 1, 'binding race must have one winner')
			assertions += check(results.filter((result) => result.status === 'rejected').length === 1, 'binding race must have one loser')
			assertions += oneRejectedWithCode(results, 'STALE_REVISION')
			const item = await first.loadMigrationItem({ ...authorityQuery(), itemId: 'item-1' })
			assertions += check(item.cocoOperationId === 'operation-A' || item.cocoOperationId === 'operation-B', 'unknown operation won')
			await close(first, second)
			return assertions
		}),
		await runTest('quarantine versus normal transition has one winner', async () => {
			const configuration = config('quarantine-race')
			const first = store(configuration)
			const second = store(configuration)
			await initialize(first)
			await planned(first)
			const version = { ...authorityQuery(), itemId: 'item-1', expectedRevision: 0 }
			const results = await Promise.allSettled([
				first.quarantineMigrationItem({ ...version, reason: 'mint-state-unresolved' }),
				second.advanceMigrationItem({ ...version, action: { type: 'prepare' } }),
			])
			let assertions = check(results.filter((result) => result.status === 'fulfilled').length === 1, 'quarantine race must have one winner')
			assertions += check(results.filter((result) => result.status === 'rejected').length === 1, 'quarantine race must have one loser')
			assertions += oneRejectedWithCode(results, 'STALE_REVISION')
			await close(first, second)
			return assertions
		}),
		await runTest('stale prior epoch adapter fails closed', async () => {
			const currentConfig = config('epoch')
			const current = store(currentConfig)
			await initialize(current)
			await current.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
			const staleConfig = { ...currentConfig, migrationEpoch: 'epoch-prior' }
			const stale = store(staleConfig)
			let assertions = await rejectsCode(
				stale.advanceAuthorityPhase({
					walletKey: WALLET,
					migrationEpoch: 'epoch-prior',
					expectedRevision: 0,
					nextPhase: 'migration-snapshot-frozen',
				}),
				'WRONG_EPOCH',
			)
			assertions += check((await current.loadAuthority(authorityQuery())).revision === 1, 'stale epoch changed authority')
			await close(current, stale)
			return assertions
		}),
		await runTest('stale snapshot cannot mutate after close and reopen', async () => {
			const configuration = config('stale-reopen')
			const oldRuntime = store(configuration)
			await initialize(oldRuntime)
			const stale = await oldRuntime.loadAuthority(authorityQuery())
			await close(oldRuntime)
			const winner = store(configuration)
			await winner.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: stale.revision, nextPhase: 'migration-snapshot-frozen' })
			await close(winner)
			const reopened = store(configuration)
			let assertions = await rejectsCode(
				reopened.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: stale.revision, nextPhase: 'migration-snapshot-frozen' }),
				'STALE_REVISION',
			)
			assertions += check(Object.isFrozen(stale), 'stale object must remain immutable')
			assertions += check((await reopened.loadAuthority(authorityQuery())).revision === 1, 'reopen state was changed by stale object')
			await close(reopened)
			return assertions
		}),
		await runTest('old runtime cannot mutate after another runtime advances', async () => {
			const configuration = config('old-runtime')
			const oldRuntime = store(configuration)
			const currentRuntime = store(configuration)
			await initialize(oldRuntime)
			const stale = await oldRuntime.loadAuthority(authorityQuery())
			await currentRuntime.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
			const assertions = await rejectsCode(
				oldRuntime.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: stale.revision, nextPhase: 'migration-snapshot-frozen' }),
				'STALE_REVISION',
			)
			await close(oldRuntime, currentRuntime)
			return assertions
		}),
		await runTest('dispatch fence atomically revalidates authority, workflow, bucket, item, and operation', async () => {
			const configuration = config('dispatch-fence')
			const first = store(configuration)
			const second = store(configuration)
			await initialize(first)
			await first.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 0, nextPhase: 'migration-snapshot-frozen' })
			await first.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 1, nextPhase: 'importing' })
			const item = await planned(first)
			const prepared = await first.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: 0,
				action: { type: 'prepare' },
			})
			const bound = await first.bindCocoOperationOnce({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: prepared.revision,
				operationId: 'receive-op:fenced',
			})
			const command = {
				...authorityQuery(),
				expectedAuthorityRevision: 2,
				expectedEnvironment: 'test',
				expectedPhase: 'importing',
				workflow: 'legacy-ready-to-coco-receive',
				bucketKey: monetaryBucketKey(SOURCE),
				itemId: item.id,
				expectedItemRevision: bound.revision,
				expectedItemState: 'prepared',
				expectedCocoOperationId: 'receive-op:fenced',
			}
			const snapshot = await first.revalidateDispatchFence(command)
			let assertions = check(
				Object.isFrozen(snapshot) &&
					Object.isFrozen(snapshot.authority) &&
					Object.isFrozen(snapshot.item) &&
					Object.isFrozen(snapshot.bucket),
				'dispatch snapshot must be immutable',
			)
			assertions += check(snapshot.workflow === 'legacy-ready-to-coco-receive', 'dispatch workflow was not revalidated')
			await second.advanceAuthorityPhase({ ...authorityQuery(), expectedRevision: 2, nextPhase: 'verifying' })
			assertions += await rejectsCode(first.revalidateDispatchFence(command), 'STALE_REVISION')
			await second.advanceMigrationItem({
				...authorityQuery(),
				itemId: item.id,
				expectedRevision: bound.revision,
				action: { type: 'begin-execution' },
			})
			assertions += await rejectsCode(
				first.revalidateDispatchFence({
					...command,
					expectedAuthorityRevision: 3,
					expectedPhase: 'verifying',
				}),
				'STALE_REVISION',
			)
			await close(first, second)
			return assertions
		}),
		await runTest('schema contains only authority and migration item control records', async () => {
			const configuration = config('schema')
			const adapter = store(configuration)
			await initialize(adapter)
			await planned(adapter)
			const databaseName = adapter.databaseName
			await close(adapter)
			const database = await openRawDatabase(databaseName)
			const storeNames = [...database.objectStoreNames]
			let assertions = check(
				JSON.stringify(storeNames.sort()) === JSON.stringify(['authority', 'migrationItems']),
				'IndexedDB schema contains unexpected object stores',
			)
			const transaction = database.transaction(storeNames, 'readonly')
			const authorityRows = await requestValue(transaction.objectStore('authority').getAll())
			const itemRows = await requestValue(transaction.objectStore('migrationItems').getAll())
			const serialized = JSON.stringify([authorityRows, itemRows])
			for (const forbidden of ['proof', 'token', 'secret', 'witness', 'privateKey', 'refundKey', 'outputData']) {
				assertions += check(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `schema persisted forbidden ${forbidden} material`)
			}
			assertions += check(authorityRows.length === 1 && itemRows.length === 1, 'schema record count is incorrect')
			database.close()
			return assertions
		}),
		await runTest('storage failures are sanitized and fail closed', async () => {
			const failingFactory = {
				open() {
					throw new DOMException('KNOWN_RAW_IDB_SENTINEL', 'UnknownError')
				},
			} as unknown as IDBFactory
			const failing = new IndexedDbMigrationCoordinatorStore({
				walletIdentity: USER,
				environment: 'test',
				migrationEpoch: EPOCH,
				testInstanceId: `${runIdentity}-failure`,
				indexedDB: failingFactory,
			})
			try {
				await failing.loadAuthority(authorityQuery())
			} catch (error) {
				let assertions = check(
					typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'COORDINATOR_STORAGE_FAILURE',
					'storage failure code was not normalized',
				)
				assertions += check(error instanceof Error && !error.message.includes('KNOWN_RAW_IDB_SENTINEL'), 'raw DOMException message escaped')
				assertions += check(!(error instanceof DOMException), 'raw DOMException escaped')
				return assertions
			}
			throw new Error('failing IndexedDB factory unexpectedly succeeded')
		}),
	]
}

export async function runIndexedDbMigrationAuthorityBrowserTests(identity = crypto.randomUUID()): Promise<BrowserTestReport> {
	if (runIdentity) throw new Error('Browser authority test runner may execute only once per page')
	runIdentity = identity.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 64)
	const results = [...(await runContract()), ...(await runFocusedBrowserTests())]
	const report: BrowserTestReport = {
		status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
		tests: results.length,
		assertions: results.reduce((total, result) => total + result.assertions, 0),
		results,
		databaseNames: [...new Set(configurations.map((value) => new IndexedDbMigrationCoordinatorStore(value).databaseName))],
	}
	return report
}

export async function cleanupIndexedDbMigrationAuthorityBrowserTests(): Promise<number> {
	await Promise.all([...openStores].map(async (value) => value.close()))
	openStores.clear()
	const unique = new Map(configurations.map((value) => [new IndexedDbMigrationCoordinatorStore(value).databaseName, value]))
	for (const configuration of unique.values()) await deleteIndexedDbMigrationControlTestDatabase(configuration)
	return unique.size
}

Object.assign(globalThis, {
	runIndexedDbMigrationAuthorityBrowserTests,
	cleanupIndexedDbMigrationAuthorityBrowserTests,
})
