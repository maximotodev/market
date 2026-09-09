import { fail } from '../errors'
import { normalizeMintUrl, normalizeUnit } from './types'
import { normalizeNostrPubkey } from '../namespace'

export interface MigrationValueAccounting {
	user: string
	mint: string
	unit: string
	legacyReady: bigint
	legacyLocked: bigint
	legacyUnresolved: bigint
	legacyPendingOutbound: bigint
	alreadyCocoOwned: bigint
	cocoReady: bigint
	cocoReserved: bigint
	retainedLegacyWorkflow: bigint
	quarantined: bigint
	verifiedConsumedExternal: bigint
}

export type MigrationAccountingResult =
	| { ok: true; sourceTotal: bigint; destinationTotal: bigint }
	| {
			ok: false
			code: 'ACCOUNTING_MISMATCH'
			sourceTotal: bigint
			destinationTotal: bigint
			delta: bigint
	  }

const AMOUNT_FIELDS = [
	'legacyReady',
	'legacyLocked',
	'legacyUnresolved',
	'legacyPendingOutbound',
	'alreadyCocoOwned',
	'cocoReady',
	'cocoReserved',
	'retainedLegacyWorkflow',
	'quarantined',
	'verifiedConsumedExternal',
] as const satisfies readonly (keyof MigrationValueAccounting)[]

function accountingKey(value: Pick<MigrationValueAccounting, 'user' | 'mint' | 'unit'>): string {
	return `${value.user}|${value.mint}|${value.unit}`
}

export function validateMigrationAccounting(value: unknown): MigrationValueAccounting {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail('ACCOUNTING_INPUT_INVALID', 'Migration accounting must be an object')
	}
	const candidate = value as Partial<MigrationValueAccounting>
	for (const field of AMOUNT_FIELDS) {
		const amount = candidate[field]
		if (typeof amount !== 'bigint' || amount < 0n) {
			fail('ACCOUNTING_INPUT_INVALID', `${field} must be a non-negative bigint`)
		}
	}
	return Object.freeze({
		user: normalizeNostrPubkey(candidate.user),
		mint: normalizeMintUrl(candidate.mint),
		unit: normalizeUnit(candidate.unit),
		legacyReady: candidate.legacyReady,
		legacyLocked: candidate.legacyLocked,
		legacyUnresolved: candidate.legacyUnresolved,
		legacyPendingOutbound: candidate.legacyPendingOutbound,
		alreadyCocoOwned: candidate.alreadyCocoOwned,
		cocoReady: candidate.cocoReady,
		cocoReserved: candidate.cocoReserved,
		retainedLegacyWorkflow: candidate.retainedLegacyWorkflow,
		quarantined: candidate.quarantined,
		verifiedConsumedExternal: candidate.verifiedConsumedExternal,
	}) as MigrationValueAccounting
}

export function checkValueConservation(value: unknown): MigrationAccountingResult {
	const row = validateMigrationAccounting(value)
	const sourceTotal = row.legacyReady + row.legacyLocked + row.legacyUnresolved + row.legacyPendingOutbound + row.alreadyCocoOwned
	const destinationTotal = row.cocoReady + row.cocoReserved + row.retainedLegacyWorkflow + row.quarantined + row.verifiedConsumedExternal
	if (sourceTotal !== destinationTotal) {
		return Object.freeze({
			ok: false,
			code: 'ACCOUNTING_MISMATCH',
			sourceTotal,
			destinationTotal,
			delta: destinationTotal - sourceTotal,
		})
	}
	return Object.freeze({ ok: true, sourceTotal, destinationTotal })
}

export function checkIndependentValueConservation(values: unknown): Map<string, MigrationAccountingResult> {
	if (!Array.isArray(values)) fail('ACCOUNTING_INPUT_INVALID', 'Migration accounting rows must be an array')
	const results = new Map<string, MigrationAccountingResult>()
	for (const value of values) {
		const row = validateMigrationAccounting(value)
		const key = accountingKey(row)
		if (results.has(key)) {
			fail('ACCOUNTING_INPUT_INVALID', 'Duplicate user, mint, and unit accounting row')
		}
		results.set(key, checkValueConservation(row))
	}
	return results
}
