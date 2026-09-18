import { deserializeAmount, serializeAmount } from '@cashu/coco-core/adapter'
import { Amount as CoreResolvedAmount } from '@cashu/coco-core/runtime-probe'
import { Amount as IndexedDbResolvedAmount } from '@cashu/coco-indexeddb/runtime-probe'

export const inspectCocoRuntime = () => {
	const coreAmount = CoreResolvedAmount.from(7)
	const indexedDbAmount = IndexedDbResolvedAmount.from(7)
	const coreRoundTrip = deserializeAmount(serializeAmount(indexedDbAmount))
	const indexedDbRoundTrip = IndexedDbResolvedAmount.from(coreAmount)

	return Object.freeze({
		commit: '190b25b0c16eb6ebbb42e1d67a0d28399c641ae1' as const,
		cashuTsVersion: '5.0.0-rc.4' as const,
		sameAmountConstructor: CoreResolvedAmount === IndexedDbResolvedAmount,
		coreAcceptsIndexedDbAmount: coreRoundTrip.toNumber() === 7 && coreRoundTrip.constructor === CoreResolvedAmount,
		indexedDbAcceptsCoreAmount: indexedDbRoundTrip.toNumber() === 7 && indexedDbRoundTrip.constructor === IndexedDbResolvedAmount,
	})
}
