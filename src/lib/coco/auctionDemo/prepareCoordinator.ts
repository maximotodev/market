export interface CocoAuctionPrepareCoordinator {
	runExclusive<T>(lockName: string, task: () => Promise<T>): Promise<T>
}

export interface CocoAuctionOwnerPresenceLease {
	readonly lockName: string
	release(): void
}

export const auctionPrepareLockName = (runId: string, bidderLegId: string): string => {
	if (!runId || !bidderLegId || !bidderLegId.startsWith(`${runId}:`)) {
		throw new Error('Coco Auction prepare lock requires an exact run/leg identity')
	}
	return `coco-auction-demo:${runId}:${bidderLegId}:prepare`
}

export const auctionOwnerPresenceLockName = (runId: string, bidderLegId: string): string => {
	if (!runId || !bidderLegId || !bidderLegId.startsWith(`${runId}:`)) {
		throw new Error('Coco Auction owner lock requires an exact run/leg identity')
	}
	return `coco-auction-demo:${runId}:${bidderLegId}:owner`
}

export const browserPrepareCoordinator = (): CocoAuctionPrepareCoordinator => {
	const lockManager = globalThis.navigator?.locks
	if (!lockManager?.request) {
		throw new Error('Web Locks API is required for cross-page Coco Auction prepare exclusivity')
	}
	return {
		runExclusive: <T>(lockName: string, task: () => Promise<T>): Promise<T> => lockManager.request(lockName, { mode: 'exclusive' }, task),
	}
}

export const tryAcquireOwnerPresence = async (lockName: string): Promise<CocoAuctionOwnerPresenceLease | null> => {
	const lockManager = globalThis.navigator?.locks
	if (!lockManager?.request) throw new Error('Web Locks API is required for Coco Auction owner presence')
	let release!: () => void
	let settled = false
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	return await new Promise<CocoAuctionOwnerPresenceLease | null>((resolve, reject) => {
		void lockManager
			.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
				if (!lock) {
					settled = true
					resolve(null)
					return
				}
				let released = false
				settled = true
				resolve({
					lockName,
					release: () => {
						if (released) return
						released = true
						release()
					},
				})
				await held
			})
			.catch((error) => {
				if (!settled) reject(error)
			})
	})
}
