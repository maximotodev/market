import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import type { ParsedAuctionEvent, ParsedBidEvent } from '@/lib/auction/events'
import type { CocoAuctionBidCommitments, CocoAuctionLegRecord, CocoAuctionWalletPort, CocoAuctionWinnerRelease } from './types'

const sameMultiset = (left: readonly string[], right: readonly string[]): boolean => {
	if (left.length !== right.length) return false
	const counts = new Map<string, number>()
	for (const value of left) counts.set(value.toLowerCase(), (counts.get(value.toLowerCase()) ?? 0) + 1)
	for (const value of right) {
		const key = value.toLowerCase()
		const count = counts.get(key) ?? 0
		if (count === 0) return false
		if (count === 1) counts.delete(key)
		else counts.set(key, count - 1)
	}
	return counts.size === 0
}

export const assertExactWinningOperationBinding = (
	leg: CocoAuctionLegRecord,
	bid: ParsedBidEvent,
	commitments: CocoAuctionBidCommitments,
): void => {
	if (!leg.operationId || commitments.operationId !== leg.operationId)
		throw new Error('Winning bid is not bound to the exact Coco operation')
	if (leg.signedBidEvent?.id !== bid.id) throw new Error('Winning bid event does not match the persisted signed event')
	if (bid.auctionRootEventId !== leg.auctionId || bid.auctionCoordinate !== leg.auctionCoordinate)
		throw new Error('Winning bid Auction identity mismatch')
	if (bid.bidderPubkey.toLowerCase() !== leg.bidderPubkey.toLowerCase()) throw new Error('Winning bid signer mismatch')
	if (bid.amount !== leg.amount || commitments.amount !== leg.amount) throw new Error('Winning bid amount mismatch')
	if (bid.currency !== 'SAT' || leg.unit !== 'sat' || commitments.unit !== leg.unit) throw new Error('Winning bid unit mismatch')
	if (bid.mint !== leg.mintUrl || commitments.mintUrl !== leg.mintUrl) throw new Error('Winning bid mint mismatch')
	if (bid.locktime !== leg.locktime || commitments.locktime !== leg.locktime) throw new Error('Winning bid locktime mismatch')
	if (bid.childPubkey.toLowerCase() !== leg.recipientPublicKey.toLowerCase() || commitments.recipientPublicKey !== leg.recipientPublicKey) {
		throw new Error('Winning bid recipient mismatch')
	}
	if (bid.refundPubkey.toLowerCase() !== leg.refundPublicKey.toLowerCase() || commitments.refundPublicKey !== leg.refundPublicKey) {
		throw new Error('Winning bid refund authority mismatch')
	}
	if (commitments.conditionFingerprint !== leg.conditionFingerprint) throw new Error('Winning bid condition fingerprint mismatch')
	if (
		!leg.lockSecrets ||
		!leg.proofYs ||
		!sameMultiset(commitments.lockSecrets, leg.lockSecrets) ||
		!sameMultiset(bid.lockSecrets, leg.lockSecrets)
	) {
		throw new Error('Winning bid lock-secret commitments mismatch')
	}
	if (!sameMultiset(commitments.proofYs, leg.proofYs) || !sameMultiset(bid.proofYs, leg.proofYs)) {
		throw new Error('Winning bid proof-Y commitments mismatch')
	}
}

export const releaseExactlyBoundWinningBid = async (
	wallet: Pick<CocoAuctionWalletPort, 'inspectAuctionBid' | 'releaseWinningBid'>,
	leg: CocoAuctionLegRecord,
	bid: ParsedBidEvent,
): Promise<CocoAuctionWinnerRelease> => {
	if (!leg.operationId) throw new Error('Winning leg has no Coco operation binding')
	const actualCommitments = await wallet.inspectAuctionBid(leg, leg.operationId)
	assertExactWinningOperationBinding(leg, bid, actualCommitments)
	return wallet.releaseWinningBid(leg.operationId)
}

export const assertSellerPathBinding = (auction: ParsedAuctionEvent, bid: ParsedBidEvent, derivationPath: string): string => {
	if (bid.auctionRootEventId !== auction.rootEventId || bid.auctionCoordinate !== auction.coordinate) {
		throw new Error('Seller path release Auction identity does not match the winning bid')
	}
	const derived = deriveAuctionChildP2pkPubkeyFromXpub(auction.p2pkXpub, derivationPath)
	if (derived.toLowerCase() !== bid.childPubkey.toLowerCase()) throw new Error('Seller path does not derive the winning bid recipient key')
	return derived
}
