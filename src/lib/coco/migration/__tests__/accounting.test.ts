import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../../errors'
import { checkIndependentMigrationAccounting, checkMigrationInventory } from '../accounting'

const USER_A = 'a'.repeat(64)
const USER_B = 'b'.repeat(64)
const EPOCH = 'epoch-1'
const MINT_A = 'https://mint-a.example'

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		claimId: 'claim-1',
		migrationEpoch: EPOCH,
		user: USER_A,
		mint: MINT_A,
		unit: 'sat',
		sourceAmount: 10n,
		sourceCategory: 'legacy-ready',
		destinationDisposition: 'coco-ready',
		destinationAmount: 10n,
		verifiedProtocolFee: 0n,
		...overrides,
	}
}

function inventory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		migrationEpoch: EPOCH,
		user: USER_A,
		mint: MINT_A,
		unit: 'sat',
		openingCocoBaseline: null,
		claims: [claim()],
		...overrides,
	}
}

function expectAccountingError(fn: () => unknown): void {
	try {
		fn()
		throw new Error('expected accounting failure')
	} catch (error) {
		expect(error).toBeInstanceOf(CocoHostError)
	}
}

describe('claim-based migration accounting', () => {
	test('32: one authoritative claim conserves exactly', () => {
		expect(checkMigrationInventory(inventory())).toMatchObject({
			ok: true,
			openingCocoAmount: 0n,
			migrationSourceTotal: 10n,
			destinationTotal: 10n,
			verifiedProtocolFeeTotal: 0n,
			claimCount: 1,
		})
	})

	test('33: an explicit verified protocol fee conserves exactly', () => {
		const report = checkMigrationInventory(
			inventory({ claims: [claim({ sourceAmount: 10n, destinationAmount: 9n, verifiedProtocolFee: 1n })] }),
		)
		expect(report).toMatchObject({ ok: true, destinationTotal: 9n, verifiedProtocolFeeTotal: 1n })
	})

	test('mismatched claim returns a typed immutable mismatch', () => {
		const report = checkMigrationInventory(inventory({ claims: [claim({ destinationAmount: 9n })] }))
		expect(report).toMatchObject({ ok: false, code: 'ACCOUNTING_MISMATCH', migrationSourceTotal: 10n })
		if (!report.ok) {
			expect(report.mismatches).toEqual([
				{ claimId: 'claim-1', sourceAmount: 10n, destinationAmount: 9n, verifiedProtocolFee: 0n, delta: -1n },
			])
			expect(Object.isFrozen(report.mismatches)).toBe(true)
		}
	})

	test('34: duplicate claim ID rejects', () => {
		expectAccountingError(() => checkMigrationInventory(inventory({ claims: [claim(), claim()] })))
	})

	test('35-36: a claim cannot declare multiple source categories or destinations', () => {
		expectAccountingError(() =>
			checkMigrationInventory(inventory({ claims: [{ ...claim(), sourceCategories: ['legacy-ready', 'legacy-locked'] }] })),
		)
		expectAccountingError(() =>
			checkMigrationInventory(inventory({ claims: [{ ...claim(), destinationDispositions: ['coco-ready', 'quarantined'] }] })),
		)
	})

	test('37: Coco opening baseline cannot duplicate a migration claim', () => {
		expectAccountingError(() =>
			checkMigrationInventory(
				inventory({
					openingCocoBaseline: {
						baselineId: 'claim-1',
						migrationEpoch: EPOCH,
						user: USER_A,
						mint: MINT_A,
						unit: 'sat',
						amount: 5n,
					},
				}),
			),
		)
		expectAccountingError(() => checkMigrationInventory(inventory({ claims: [claim({ sourceCategory: 'already-coco-owned' as never })] })))
	})

	test('opening baseline identity cannot duplicate a claim across inventory rows', () => {
		expectAccountingError(() =>
			checkIndependentMigrationAccounting([
				inventory({
					openingCocoBaseline: {
						baselineId: 'shared-economic-id',
						migrationEpoch: EPOCH,
						user: USER_A,
						mint: MINT_A,
						unit: 'sat',
						amount: 5n,
					},
					claims: [],
				}),
				inventory({
					mint: 'https://mint-b.example',
					claims: [claim({ claimId: 'shared-economic-id', mint: 'https://mint-b.example' })],
				}),
			]),
		)
	})

	test('38: accounting getter substitution is rejected before producing a report', () => {
		let reads = 0
		const hostile = { ...claim() }
		Object.defineProperty(hostile, 'sourceAmount', {
			enumerable: true,
			get: () => {
				reads += 1
				return reads === 1 ? 10n : -1n
			},
		})
		expectAccountingError(() => checkMigrationInventory(inventory({ claims: [hostile] })))
		expect(reads).toBe(0)
	})

	test('39: accounting outputs and nested results are immutable', () => {
		const reports = checkIndependentMigrationAccounting([inventory()])
		expect(Object.isFrozen(reports)).toBe(true)
		expect(Object.isFrozen(reports[0])).toBe(true)
	})

	test('40-42: mint, unit, and user inventories never cross-balance', () => {
		const reports = checkIndependentMigrationAccounting([
			inventory({ claims: [claim({ destinationAmount: 9n })] }),
			inventory({ mint: 'https://mint-b.example', claims: [claim({ claimId: 'claim-2', mint: 'https://mint-b.example' })] }),
			inventory({ unit: 'usd', claims: [claim({ claimId: 'claim-3', unit: 'usd' })] }),
			inventory({ user: USER_B, claims: [claim({ claimId: 'claim-4', user: USER_B })] }),
		])
		expect(reports).toHaveLength(4)
		expect(reports.map((report) => report.ok)).toEqual([false, true, true, true])
	})

	test('43: bigint precision is exact beyond Number.MAX_SAFE_INTEGER', () => {
		const large = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n
		const report = checkMigrationInventory(inventory({ claims: [claim({ sourceAmount: large, destinationAmount: large })] }))
		expect(report).toMatchObject({ ok: true, migrationSourceTotal: large, destinationTotal: large })
	})

	test('44: malformed, cross-boundary, and non-bigint inputs fail deterministically', () => {
		for (const value of [
			null,
			[],
			inventory({ claims: [claim({ sourceAmount: 1 as never })] }),
			inventory({ claims: [claim({ migrationEpoch: 'epoch-2' })] }),
			inventory({ claims: [claim({ user: USER_B })] }),
			inventory({ claims: [claim({ unit: 'usd' })] }),
			inventory({ claims: [claim({ mint: 'https://mint-b.example' })] }),
		]) {
			expectAccountingError(() => checkMigrationInventory(value))
		}
	})

	test('retained/quarantined claims cannot hide a protocol fee', () => {
		for (const destinationDisposition of ['retained-legacy-workflow', 'quarantined'] as const) {
			expectAccountingError(() =>
				checkMigrationInventory(inventory({ claims: [claim({ destinationDisposition, destinationAmount: 9n, verifiedProtocolFee: 1n })] })),
			)
		}
	})
})
