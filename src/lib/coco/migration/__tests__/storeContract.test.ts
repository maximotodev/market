import { describe, expect, test } from 'bun:test'
import { InMemoryMigrationCoordinatorStore } from '../coordinator'
import { migrationCoordinatorStoreContractCases } from './storeContract.shared'

describe('domain-authoritative migration store contract', () => {
	for (const contractCase of migrationCoordinatorStoreContractCases) {
		test(contractCase.name, async () => {
			const assertionCount = await contractCase.run(() => new InMemoryMigrationCoordinatorStore())
			expect(assertionCount).toBeGreaterThan(0)
		})
	}
})
