export const COCO_AUCTION_DEMO_MODE = 'coco-auction-demo' as const

export const isCocoAuctionDemoMode = (): boolean =>
	(process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE ?? process.env.APP_AUCTION_MONETARY_MODE) === COCO_AUCTION_DEMO_MODE

export const assertLegacyAuctionMoneyDisabled = (action: string): void => {
	if (isCocoAuctionDemoMode()) {
		throw new Error(`Legacy Auction monetary action "${action}" is disabled in ${COCO_AUCTION_DEMO_MODE}`)
	}
}
