import { captureArray, captureObject, fail } from '../errors'
import { normalizeNostrPubkey } from '../namespace'
import {
	assertInventoryEntriesCoherent,
	sourceCategoryForInventoryEntry,
	type MigrationDestinationDisposition,
	type MigrationInventoryEntry,
	type MigrationInventoryHeader,
	type MigrationSourceCategory,
} from './inventory'
import { canonicalizeMintUrl, normalizeUnit, type CanonicalMintUrl } from './types'

export type { MigrationDestinationDisposition, MigrationSourceCategory } from './inventory'

/**
 * Arithmetic input only. A claim ID is not proof-of-value authority. Future
 * authoritative decisions must use the durable sealed-inventory projection
 * rather than accept independently supplied claims.
 */
export interface MigrationAccountingClaim {
	claimId: string
	migrationEpoch: string
	user: string
	mint: CanonicalMintUrl
	unit: string
	sourceAmount: bigint
	sourceCategory: MigrationSourceCategory
	destinationDisposition: MigrationDestinationDisposition
	destinationAmount: bigint
	verifiedProtocolFee: bigint
}

export interface CocoOpeningBaseline {
	baselineId: string
	migrationEpoch: string
	user: string
	mint: CanonicalMintUrl
	unit: string
	amount: bigint
}

export interface MigrationAccountingMismatch {
	claimId: string
	sourceAmount: bigint
	destinationAmount: bigint
	verifiedProtocolFee: bigint
	delta: bigint
}

export type MigrationAccountingReport =
	| {
			ok: true
			migrationEpoch: string
			user: string
			mint: CanonicalMintUrl
			unit: string
			openingCocoAmount: bigint
			migrationSourceTotal: bigint
			destinationTotal: bigint
			verifiedProtocolFeeTotal: bigint
			claimCount: number
	  }
	| {
			ok: false
			code: 'ACCOUNTING_MISMATCH'
			migrationEpoch: string
			user: string
			mint: CanonicalMintUrl
			unit: string
			openingCocoAmount: bigint
			migrationSourceTotal: bigint
			destinationTotal: bigint
			verifiedProtocolFeeTotal: bigint
			claimCount: number
			mismatches: readonly Readonly<MigrationAccountingMismatch>[]
	  }

interface CapturedInventory {
	migrationEpoch: string
	user: string
	mint: CanonicalMintUrl
	unit: string
	openingCocoBaseline: Readonly<CocoOpeningBaseline> | null
	claims: readonly Readonly<MigrationAccountingClaim>[]
}

function requireEpoch(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
		fail('ACCOUNTING_INPUT_INVALID', 'Accounting migration epoch is invalid')
	}
	return value
}

function requireAccountingId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
		fail('ACCOUNTING_INPUT_INVALID', `${field} must be a non-empty sanitized identifier`)
	}
	return value
}

function requireAmount(value: unknown, field: string): bigint {
	if (typeof value !== 'bigint' || value < 0n) fail('ACCOUNTING_INPUT_INVALID', `${field} must be a non-negative bigint`)
	return value
}

function parseSourceCategory(value: unknown): MigrationSourceCategory {
	switch (value) {
		case 'legacy-ready':
		case 'legacy-locked':
		case 'legacy-unresolved':
		case 'legacy-pending-outbound':
			return value
		default:
			fail('ACCOUNTING_INPUT_INVALID', 'Migration source category is invalid')
	}
}

function parseDestinationDisposition(value: unknown): MigrationDestinationDisposition {
	switch (value) {
		case 'coco-ready':
		case 'coco-reserved':
		case 'retained-legacy-workflow':
		case 'quarantined':
		case 'verified-consumed-external':
			return value
		default:
			fail('ACCOUNTING_INPUT_INVALID', 'Migration destination disposition is invalid')
	}
}

function captureClaim(value: unknown): Readonly<MigrationAccountingClaim> {
	const captured = captureObject(
		value,
		[
			'claimId',
			'migrationEpoch',
			'user',
			'mint',
			'unit',
			'sourceAmount',
			'sourceCategory',
			'destinationDisposition',
			'destinationAmount',
			'verifiedProtocolFee',
		],
		'ACCOUNTING_INPUT_INVALID',
		'Migration claim',
	)
	const claim = Object.freeze({
		claimId: requireAccountingId(captured.claimId, 'claimId'),
		migrationEpoch: requireEpoch(captured.migrationEpoch),
		user: normalizeNostrPubkey(captured.user),
		mint: canonicalizeMintUrl(captured.mint),
		unit: normalizeUnit(captured.unit),
		sourceAmount: requireAmount(captured.sourceAmount, 'sourceAmount'),
		sourceCategory: parseSourceCategory(captured.sourceCategory),
		destinationDisposition: parseDestinationDisposition(captured.destinationDisposition),
		destinationAmount: requireAmount(captured.destinationAmount, 'destinationAmount'),
		verifiedProtocolFee: requireAmount(captured.verifiedProtocolFee, 'verifiedProtocolFee'),
	})
	if (
		(claim.destinationDisposition === 'retained-legacy-workflow' || claim.destinationDisposition === 'quarantined') &&
		claim.verifiedProtocolFee !== 0n
	) {
		fail('ACCOUNTING_INPUT_INVALID', 'Retained and quarantined claims cannot charge a protocol fee')
	}
	return claim
}

function captureOpeningBaseline(value: unknown): Readonly<CocoOpeningBaseline> | null {
	if (value === null) return null
	const captured = captureObject(
		value,
		['baselineId', 'migrationEpoch', 'user', 'mint', 'unit', 'amount'],
		'ACCOUNTING_INPUT_INVALID',
		'Coco opening baseline',
	)
	return Object.freeze({
		baselineId: requireAccountingId(captured.baselineId, 'baselineId'),
		migrationEpoch: requireEpoch(captured.migrationEpoch),
		user: normalizeNostrPubkey(captured.user),
		mint: canonicalizeMintUrl(captured.mint),
		unit: normalizeUnit(captured.unit),
		amount: requireAmount(captured.amount, 'opening baseline amount'),
	})
}

function captureInventory(value: unknown): CapturedInventory {
	const captured = captureObject(
		value,
		['migrationEpoch', 'user', 'mint', 'unit', 'openingCocoBaseline', 'claims'],
		'ACCOUNTING_INPUT_INVALID',
		'Migration accounting inventory',
	)
	const migrationEpoch = requireEpoch(captured.migrationEpoch)
	const user = normalizeNostrPubkey(captured.user)
	const mint = canonicalizeMintUrl(captured.mint)
	const unit = normalizeUnit(captured.unit)
	const openingCocoBaseline = captureOpeningBaseline(captured.openingCocoBaseline)
	const claims = captureArray(captured.claims, 'ACCOUNTING_INPUT_INVALID', 'Migration claims').map(captureClaim)
	const seen = new Set<string>()

	if (
		openingCocoBaseline &&
		(openingCocoBaseline.migrationEpoch !== migrationEpoch ||
			openingCocoBaseline.user !== user ||
			openingCocoBaseline.mint !== mint ||
			openingCocoBaseline.unit !== unit)
	) {
		fail('ACCOUNTING_INPUT_INVALID', 'Coco opening baseline does not match its inventory binding')
	}

	for (const claim of claims) {
		if (seen.has(claim.claimId)) fail('ACCOUNTING_INPUT_INVALID', 'Duplicate migration claim ID')
		seen.add(claim.claimId)
		if (openingCocoBaseline?.baselineId === claim.claimId) {
			fail('ACCOUNTING_INPUT_INVALID', 'Coco opening baseline cannot duplicate a migration claim')
		}
		if (claim.migrationEpoch !== migrationEpoch || claim.user !== user || claim.mint !== mint || claim.unit !== unit) {
			fail('ACCOUNTING_INPUT_INVALID', 'Migration claim does not match its inventory binding')
		}
	}

	return { migrationEpoch, user, mint, unit, openingCocoBaseline, claims: Object.freeze(claims) }
}

function reportForInventory(inventory: CapturedInventory): Readonly<MigrationAccountingReport> {
	let migrationSourceTotal = 0n
	let destinationTotal = 0n
	let verifiedProtocolFeeTotal = 0n
	const mismatches: Readonly<MigrationAccountingMismatch>[] = []
	for (const claim of inventory.claims) {
		migrationSourceTotal += claim.sourceAmount
		destinationTotal += claim.destinationAmount
		verifiedProtocolFeeTotal += claim.verifiedProtocolFee
		if (claim.sourceAmount !== claim.destinationAmount + claim.verifiedProtocolFee) {
			mismatches.push(
				Object.freeze({
					claimId: claim.claimId,
					sourceAmount: claim.sourceAmount,
					destinationAmount: claim.destinationAmount,
					verifiedProtocolFee: claim.verifiedProtocolFee,
					delta: claim.destinationAmount + claim.verifiedProtocolFee - claim.sourceAmount,
				}),
			)
		}
	}
	const common = {
		migrationEpoch: inventory.migrationEpoch,
		user: inventory.user,
		mint: inventory.mint,
		unit: inventory.unit,
		openingCocoAmount: inventory.openingCocoBaseline?.amount ?? 0n,
		migrationSourceTotal,
		destinationTotal,
		verifiedProtocolFeeTotal,
		claimCount: inventory.claims.length,
	}
	return mismatches.length === 0
		? Object.freeze({ ok: true, ...common })
		: Object.freeze({ ok: false, code: 'ACCOUNTING_MISMATCH', ...common, mismatches: Object.freeze(mismatches) })
}

export function checkMigrationInventory(value: unknown): Readonly<MigrationAccountingReport> {
	return reportForInventory(captureInventory(value))
}

export function checkIndependentMigrationAccounting(value: unknown): readonly Readonly<MigrationAccountingReport>[] {
	const inventories = captureArray(value, 'ACCOUNTING_INPUT_INVALID', 'Migration accounting inventories').map(captureInventory)
	const inventoryKeys = new Set<string>()
	const globalClaimIds = new Set<string>()
	const globalBaselineIds = new Set<string>()
	for (const inventory of inventories) {
		const inventoryKey = JSON.stringify([inventory.migrationEpoch, inventory.user, inventory.mint, inventory.unit])
		if (inventoryKeys.has(inventoryKey)) fail('ACCOUNTING_INPUT_INVALID', 'Duplicate accounting inventory binding')
		inventoryKeys.add(inventoryKey)
		if (inventory.openingCocoBaseline) {
			const baselineKey = JSON.stringify([inventory.migrationEpoch, inventory.openingCocoBaseline.baselineId])
			if (globalBaselineIds.has(baselineKey) || globalClaimIds.has(baselineKey)) {
				fail('ACCOUNTING_INPUT_INVALID', 'Coco opening baseline identity is duplicated across inventories')
			}
			globalBaselineIds.add(baselineKey)
		}
		for (const claim of inventory.claims) {
			const claimKey = JSON.stringify([inventory.migrationEpoch, claim.claimId])
			if (globalClaimIds.has(claimKey) || globalBaselineIds.has(claimKey)) {
				fail('ACCOUNTING_INPUT_INVALID', 'Migration claim ID is duplicated across inventories')
			}
			globalClaimIds.add(claimKey)
		}
	}
	return Object.freeze(inventories.map(reportForInventory))
}

/**
 * Projects arithmetic only from a sealed durable inventory. Disposition labels
 * remain accounting classifications and do not prove an executable owner or
 * authorize cutover.
 */
export function projectSealedMigrationInventoryAccounting(
	header: Readonly<MigrationInventoryHeader>,
	entries: readonly Readonly<MigrationInventoryEntry>[],
): readonly Readonly<MigrationAccountingReport>[] {
	if (header.status !== 'sealed' || header.sealedEntryCount !== entries.length) {
		fail('ACCOUNTING_INPUT_INVALID', 'Accounting requires one complete sealed migration inventory')
	}
	assertInventoryEntriesCoherent(header, entries)
	const grouped = new Map<
		string,
		{
			migrationEpoch: string
			user: string
			mint: CanonicalMintUrl
			unit: string
			openingCocoBaseline: CocoOpeningBaseline | null
			claims: MigrationAccountingClaim[]
		}
	>()
	for (const entry of entries) {
		const key = JSON.stringify([entry.mint, entry.unit])
		const inventory = grouped.get(key) ?? {
			migrationEpoch: header.migrationEpoch,
			user: header.user,
			mint: entry.mint,
			unit: entry.unit,
			openingCocoBaseline: null,
			claims: [],
		}
		if (entry.kind === 'coco-opening-baseline') {
			if (inventory.openingCocoBaseline) fail('ACCOUNTING_INPUT_INVALID', 'Inventory has duplicate Coco opening baselines')
			inventory.openingCocoBaseline = {
				baselineId: entry.id,
				migrationEpoch: entry.migrationEpoch,
				user: entry.user,
				mint: entry.mint,
				unit: entry.unit,
				amount: entry.amount,
			}
		} else {
			inventory.claims.push({
				claimId: entry.id,
				migrationEpoch: entry.migrationEpoch,
				user: entry.user,
				mint: entry.mint,
				unit: entry.unit,
				sourceAmount: entry.amount,
				sourceCategory: sourceCategoryForInventoryEntry(entry),
				destinationDisposition: entry.disposition.destinationDisposition,
				destinationAmount: entry.disposition.destinationAmount,
				verifiedProtocolFee: entry.disposition.verifiedProtocolFee,
			})
		}
		grouped.set(key, inventory)
	}
	return checkIndependentMigrationAccounting([...grouped.values()])
}
