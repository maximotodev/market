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

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<number> {
	try {
		await promise
	} catch (error) {
		return check(
			typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code,
			`Expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
		)
	}
	throw new Error(`Expected rejection with ${code}`)
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
