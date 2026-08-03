import { mutationOptions, useMutation } from '@tanstack/react-query'
import * as orderChatRelayPublish from '@/lib/orders/nip17OrderChatRelayPublish'
import type { PublishOrderChatRelayParams } from '@/lib/orders/nip17OrderChatRelayPublish'

export function createPublishOrderChatMutationOptions() {
	return mutationOptions({
		mutationFn: (params: PublishOrderChatRelayParams) => orderChatRelayPublish.publishOrderChatToRelays(params),
		retry: false,
	})
}

export function usePublishOrderChatMutation() {
	return useMutation(createPublishOrderChatMutationOptions())
}
