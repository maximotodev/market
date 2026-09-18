import { isCocoAuctionDemoMode } from './mode'

export type LegacyAuctionMonetaryAction = 'nip60-initialize' | 'nip60-lock' | 'nip60-receive' | 'nip60-refund' | 'coco-rc11'

const calls: Record<LegacyAuctionMonetaryAction, number> = {
	'nip60-initialize': 0,
	'nip60-lock': 0,
	'nip60-receive': 0,
	'nip60-refund': 0,
	'coco-rc11': 0,
}

export const recordLegacyAuctionMonetaryCall = (action: LegacyAuctionMonetaryAction): void => {
	calls[action] += 1
	if (isCocoAuctionDemoMode()) {
		throw new Error(`Legacy Auction monetary action "${action}" is disabled in coco-auction-demo mode`)
	}
}

export const getLegacyAuctionMonetaryAudit = (): Readonly<Record<LegacyAuctionMonetaryAction, number>> => Object.freeze({ ...calls })

export const resetLegacyAuctionMonetaryAuditForTests = (): void => {
	for (const action of Object.keys(calls) as LegacyAuctionMonetaryAction[]) calls[action] = 0
}
