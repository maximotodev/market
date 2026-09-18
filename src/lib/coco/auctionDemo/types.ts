import type { NostrEvent } from 'nostr-tools/pure'

export const FROZEN_COCO_REFUND_COMMIT = '190b25b0c16eb6ebbb42e1d67a0d28399c641ae1' as const

export type CocoAuctionOperationState = 'init' | 'prepared' | 'executing' | 'pending' | 'finalized' | 'rolling_back' | 'rolled_back'
export type CocoAuctionLegState = 'INTENT' | 'PREPARING' | 'OPERATION_BOUND' | 'LOCKED' | 'BID_SIGNED' | 'BID_PUBLISHED'
export type CocoAuctionRunState = 'DISCOVERABLE' | 'AUCTION_PUBLISHED' | 'FUNDED' | 'BIDS_PUBLISHED' | 'WINNER_VALIDATED' | 'COMPLETE'
export type CocoAuctionSellerReceivePhase =
	| 'RECEIVE_INTENT'
	| 'RECEIVE_OPERATION_BOUND'
	| 'RECEIVE_EXECUTING'
	| 'RECEIVE_FINALIZED'
	| 'SETTLEMENT_SIGNED'
	| 'SETTLEMENT_PUBLISHED'

export interface CocoAuctionAuthority {
	publicExtendedKey: string
}

export interface CocoAuctionRefundAuthority {
	publicKey: string
}

export interface CocoAuctionBidIntent {
	runId: string
	accountId: string
	auctionId: string
	auctionCoordinate: string
	bidderLegId: string
	mintUrl: string
	unit: 'sat'
	amount: number
	locktime: number
	derivationPath: string
	recipientPublicKey: string
	refundPublicKey: string
	conditionFingerprint: string
	revision: number
}

export interface CocoAuctionBidCommitments {
	operationId: string
	mintUrl: string
	unit: 'sat'
	amount: number
	locktime: number
	recipientPublicKey: string
	refundPublicKey: string
	conditionFingerprint: string
	lockSecrets: readonly string[]
	proofYs: readonly string[]
}

export interface CocoAuctionPrepareAuthority {
	claimId: string
	ownerControllerId: string
	ownerControllerGeneration: number
	claimEpoch: number
}

export interface CocoAuctionControllerIdentity {
	controllerId: string
	controllerGeneration: number
}

export interface CocoAuctionSellerReceiveRecord {
	schemaVersion: 1
	runId: string
	auctionId: string
	auctionCoordinate: string
	winningBidEventId: string
	winnerBidderAccountId: string
	winnerSendOperationId: string
	sellerAccountId: string
	mintUrl: string
	unit: 'sat'
	amount: number
	expectedRecipientPublicKey: string
	derivationPath: string
	conditionFingerprint: string
	lockCommitmentFingerprint: string
	tokenFingerprint: string
	pathReleaseEventId: string
	pathReleaseCreatedAt: number
	phase: CocoAuctionSellerReceivePhase
	claimId: string
	ownerControllerId: string
	ownerControllerGeneration: number
	claimEpoch: number
	highestOwnerGeneration: number
	receiveAttemptCount: number
	receiveOperationId?: string
	receiveOperationState?: string
	receiveFinalizedAt?: number
	settlementEvent?: NostrEvent
	settlementPublishedAt?: number
	revision: number
	createdAt: number
	updatedAt: number
}

export interface CocoAuctionLegRecord extends CocoAuctionBidIntent {
	version: 2
	role: 'bidder-a' | 'bidder-b' | 'late-attacker'
	bidderPubkey: string
	state: CocoAuctionLegState
	prepareClaimId?: string
	prepareClaimStatus?: 'claimed' | 'recovered' | 'bound'
	prepareClaimOwnerControllerId?: string
	prepareClaimOwnerControllerGeneration?: number
	prepareClaimEpoch?: number
	prepareHighestOwnerGeneration?: number
	prepareClaimedAt?: number
	prepareAttemptCount?: number
	operationId?: string
	lockSecrets?: readonly string[]
	proofYs?: readonly string[]
	signedBidEvent?: NostrEvent
	bidPublishedAt?: number
	bidObservedAt?: number
	createdAt: number
	updatedAt: number
}

export interface CocoAuctionRunRecord {
	version: 2
	runId: string
	startedPageInstanceId: string
	state: CocoAuctionRunState
	mintUrl: string
	relayUrl: string
	auctionEventId: string
	auctionCoordinate: string
	signedAuctionEvent: NostrEvent
	sellerAccountId: string
	sellerPubkey: string
	auditorPubkey: string
	bidderAAccountId: string
	bidderBAccountId: string
	lateAttackerAccountId: string
	closeAt: number
	locktime: number
	revision: number
	bidObservations: Readonly<Record<string, number>>
	winnerBidEventId?: string
	createdAt: number
	updatedAt: number
}

export interface CocoAuctionBalance {
	spendable: number
	reserved: number
	total: number
}

export interface CocoAuctionFundingResult {
	operationId: string
	state: string
	amount: number
	quoteId: string
	quotePaymentState: string
	finalQuoteState: string
	lastObservedSafeState: string
}

export interface CocoAuctionWinnerRelease {
	operationId: string
	token: string
}

export interface CocoAuctionSendDiagnostic {
	operationId: string
	state: CocoAuctionOperationState
	method: string
	mintUrl: string
	unit: string
	amount: number
	conditionFingerprint: string | null
	fee: number | null
}

export interface CocoAuctionReceiveResult {
	operationId: string
	state: 'finalized'
}

export interface CocoAuctionReceiveDescriptor {
	mintUrl: string
	unit: 'sat'
	amount: number
	tokenFingerprint: string
	proofYs: readonly string[]
}

export interface CocoAuctionReceiveDiagnostic extends CocoAuctionReceiveDescriptor {
	operationId: string
	state: 'init' | 'prepared' | 'executing' | 'finalized' | 'rolled_back'
	fee: number | null
}

export interface CocoAuctionWalletPort {
	readonly accountId: string
	boot(): Promise<void>
	dispose(): Promise<void>
	fundDemoWallet(mintUrl: string, amount: number): Promise<CocoAuctionFundingResult>
	createAuctionAuthority(): Promise<CocoAuctionAuthority>
	createRefundAuthority(): Promise<CocoAuctionRefundAuthority>
	prepareAuctionBid(intent: CocoAuctionBidIntent): Promise<string>
	reconcilePreparedAuctionBid(intent: CocoAuctionBidIntent): Promise<string | null>
	executeAuctionBid(intent: CocoAuctionBidIntent, operationId: string): Promise<CocoAuctionBidCommitments>
	inspectAuctionBid(intent: CocoAuctionBidIntent, operationId: string): Promise<CocoAuctionBidCommitments>
	resumeAuctionBid(operationId: string): Promise<CocoAuctionOperationState>
	releaseWinningBid(operationId: string): Promise<CocoAuctionWinnerRelease>
	inspectWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
	}): Promise<CocoAuctionReceiveDescriptor>
	reconcileWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
		tokenFingerprint: string
	}): Promise<CocoAuctionReceiveDiagnostic | null>
	prepareWinningReceive(input: {
		token: string
		derivationPath: string
		mintUrl: string
		expectedRecipientPublicKey: string
		tokenFingerprint: string
	}): Promise<CocoAuctionReceiveDiagnostic>
	resumeWinningReceive(operationId: string, tokenFingerprint: string): Promise<CocoAuctionReceiveDiagnostic>
	listReceiveDiagnostics(): Promise<readonly CocoAuctionReceiveDiagnostic[]>
	readReceiveEffectCounts(): Promise<{ originated: number; remoteEffects: number }>
	refundLosingBid(operationId: string): Promise<CocoAuctionOperationState>
	getOperationState(operationId: string): Promise<CocoAuctionOperationState>
	getSendFee(operationId: string): Promise<number>
	listSendDiagnostics(): Promise<readonly CocoAuctionSendDiagnostic[]>
	getBalance(mintUrl: string): Promise<CocoAuctionBalance>
}
