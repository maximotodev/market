import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../../errors'
import { checkIndependentValueConservation, checkValueConservation, type MigrationValueAccounting } from '../accounting'

const USER = 'a'.repeat(64)

function row(overrides: Partial<MigrationValueAccounting> = {}): MigrationValueAccounting {
	return {
		user: USER,
		mint: 'https://mint-a.example',
		unit: 'sat',
		legacyReady: 5n,
		legacyLocked: 3n,
		legacyUnresolved: 2n,
		legacyPendingOutbound: 7n,
		alreadyCocoOwned: 11n,
		cocoReady: 13n,
		cocoReserved: 2n,
		retainedLegacyWorkflow: 8n,
		quarantined: 3n,
		verifiedConsumedExternal: 2n,
		...overrides,
	}
}

describe('migration value conservation', () => {
	test('20: proves exact conservation for one user, mint, and unit', () => {
		expect(checkValueConservation(row())).toEqual({ ok: true, sourceTotal: 28n, destinationTotal: 28n })
	})

	test('21: keeps two mints in independent accounting rows', () => {
		const results = checkIndependentValueConservation([
			row(),
			row({
				mint: 'https://mint-b.example',
				legacyReady: 1n,
				cocoReady: 1n,
				legacyLocked: 0n,
				legacyUnresolved: 0n,
				legacyPendingOutbound: 0n,
				alreadyCocoOwned: 0n,
				cocoReserved: 0n,
				retainedLegacyWorkflow: 0n,
				quarantined: 0n,
				verifiedConsumedExternal: 0n,
			}),
		])
		expect(results.size).toBe(2)
		expect([...results.values()].every((result) => result.ok)).toBe(true)
	})

	test('22: keeps two units in independent accounting rows', () => {
		const results = checkIndependentValueConservation([
			row(),
			row({
				unit: 'usd',
				legacyReady: 1n,
				cocoReady: 1n,
				legacyLocked: 0n,
				legacyUnresolved: 0n,
				legacyPendingOutbound: 0n,
				alreadyCocoOwned: 0n,
				cocoReserved: 0n,
				retainedLegacyWorkflow: 0n,
				quarantined: 0n,
				verifiedConsumedExternal: 0n,
			}),
		])
		expect(results.size).toBe(2)
	})

	test('23: conserves a one-sat bigint boundary exactly', () => {
		const result = checkValueConservation(
			row({
				legacyReady: 1n,
				cocoReady: 1n,
				legacyLocked: 0n,
				legacyUnresolved: 0n,
				legacyPendingOutbound: 0n,
				alreadyCocoOwned: 0n,
				cocoReserved: 0n,
				retainedLegacyWorkflow: 0n,
				quarantined: 0n,
				verifiedConsumedExternal: 0n,
			}),
		)
		expect(result).toEqual({ ok: true, sourceTotal: 1n, destinationTotal: 1n })
	})

	test('24: conserves values beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
		const large = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n
		const result = checkValueConservation(
			row({
				legacyReady: large,
				cocoReady: large,
				legacyLocked: 0n,
				legacyUnresolved: 0n,
				legacyPendingOutbound: 0n,
				alreadyCocoOwned: 0n,
				cocoReserved: 0n,
				retainedLegacyWorkflow: 0n,
				quarantined: 0n,
				verifiedConsumedExternal: 0n,
			}),
		)
		expect(result).toEqual({ ok: true, sourceTotal: large, destinationTotal: large })
	})

	test('25: returns a typed accounting mismatch', () => {
		expect(checkValueConservation(row({ cocoReady: 12n }))).toEqual({
			ok: false,
			code: 'ACCOUNTING_MISMATCH',
			sourceTotal: 28n,
			destinationTotal: 27n,
			delta: -1n,
		})
	})

	test('sanitized accounting output strips undeclared bearer-shaped fields', () => {
		const result = checkValueConservation({ ...row(), token: 'must-not-survive', secret: 'must-not-survive' })
		expect(result.ok).toBe(true)
		expect('token' in result).toBe(false)
		expect('secret' in result).toBe(false)
	})

	test('26: malformed containers and non-bigint amounts fail deterministically', () => {
		for (const value of [null, [], { ...row(), legacyReady: 1 }, { ...row(), legacyReady: -1n }]) {
			try {
				checkValueConservation(value)
				throw new Error('expected accounting validation to fail')
			} catch (error) {
				expect(error).toBeInstanceOf(CocoHostError)
				expect((error as CocoHostError).code).toBe('ACCOUNTING_INPUT_INVALID')
			}
		}
	})
})
