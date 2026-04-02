import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { zapKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { decode } from 'light-bolt11-decoder'
import { getCoordinates } from '@/lib/nostr/coordinates'
import { isAddressableKind } from 'nostr-tools/kinds'

// --- Constants & Kinds ---
const LIGHTNING_ZAP_RECEIPT_KIND = 9735
const NUTZAP_KIND = 9321
const DELETION_KIND = 5

// --- Interfaces ---

export interface LightningZap {
	id: string
	amountMillisats: number
	message: string
	senderPubkey: string
	recipientPubkey: string
	providerPubkey?: string // nostr-pubkey of provider e.g. CoinOS, Alby
	targetEventId?: string
	targetEventKind?: number
	bolt11: string
	descriptionHash: string // SHA256 of the zap request
	createdAt: number
	rawEvent: NDKEvent
}

export interface Nutzap {
	id: string
	amountSats: number
	message: string
	senderPubkey: string
	recipientPubkey: string
	targetEventId?: string
	targetEventKind?: number
	mintUrl: string
	unit: string
	proofRaw: string // The raw JSON string from the 'proof' tag
	createdAt: number
	rawEvent: NDKEvent
}

// --- Helper Functions ---

/**
 * Parses the Cashu proof JSON string to extract amount.
 */
const parseCashuProofAmount = (proofString: string): number => {
	try {
		const proof = JSON.parse(proofString)
		return proof.amount || 0
	} catch (e) {
		console.error('Failed to parse Cashu proof:', e)
		return 0
	}
}

// --- Lightning Zap Logic (NIP-57) ---

const transformLightningZap = (event: NDKEvent): LightningZap | null => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw Error('NDK must be initialized.')

	// Extract Tags
	const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')?.[1]
	const descriptionTag = event.tags.find((t) => t[0] === 'description')?.[1]
	const pTag = event.tags.find((t) => t[0] === 'p')?.[1]
	const eTag = event.tags.find((t) => t[0] === 'e')?.[1]
	const kTag = event.tags.find((t) => t[0] === 'k')?.[1]

	if (!bolt11Tag || !descriptionTag || !pTag) {
		return null // Invalid zap receipt
	}

	const amountMillisatsRaw = decode(bolt11Tag).sections.find((s) => s.name == 'amount')?.value
	if (!amountMillisatsRaw) {
		console.error('No valid payment amount found for lightning zap.')
		return null
	}

	const amount = parseInt(amountMillisatsRaw) / 1000

	let zapRequest: any
	try {
		zapRequest = JSON.parse(descriptionTag)
	} catch (e) {
		console.error('Invalid JSON in zap receipt description', e)
		return null
	}

	return {
		id: event.id,
		amountMillisats: amount,
		message: zapRequest.content || '',
		senderPubkey: zapRequest.pubkey, // Sender is inside the description
		recipientPubkey: pTag,
		targetEventId: eTag,
		targetEventKind: kTag ? parseInt(kTag, 10) : undefined,
		bolt11: bolt11Tag,
		descriptionHash: event.tags.find((t) => t[0] === 'bolt11')?.[2] || '', // Often implicit, but sometimes explicit
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		rawEvent: event,
	}
}

const fetchLightningZaps = async (targetEvent: NDKEvent): Promise<LightningZap[]> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [LIGHTNING_ZAP_RECEIPT_KIND],
		limit: 100, // Adjust as needed
	}

	// Filter by target event (if zapping a specific note)
	if (targetEvent.kind === 1 || !isAddressableKind(targetEvent.kind)) {
		filter['#e'] = [targetEvent.id]
	} else {
		// For addressable kinds (long form, etc.), use #a
		filter['#a'] = [getCoordinates(targetEvent)]
	}

	// Also filter by recipient pubkey to ensure we only get zaps intended for this user/event
	filter['#p'] = [targetEvent.pubkey]

	console.log(filter)

	const events = await ndk.fetchEvents(filter)

	console.log('Found ' + events.size + ' lightning zaps.')

	const zaps: LightningZap[] = []
	for (const event of Array.from(events)) {
		const zap = transformLightningZap(event)
		if (zap) zaps.push(zap)
	}

	// Filter out deleted receipts (optional but recommended)
	// Similar to your reaction code, fetch deletions for these event IDs
	const idsToDelete = zaps.map((z) => z.id)
	if (idsToDelete.length > 0) {
		const delFilter: NDKFilter = {
			kinds: [DELETION_KIND],
			'#e': idsToDelete,
		}
		const delEvents = await ndk.fetchEvents(delFilter)
		const deletedIds = new Set<string>()
		delEvents.forEach((e) => {
			e.tags.filter((t) => t[0] === 'e').forEach((t) => t[1] && deletedIds.add(t[1]))
		})
		return zaps.filter((z) => !deletedIds.has(z.id))
	}

	return zaps.sort((a, b) => b.createdAt - a.createdAt)
}

// --- Nutzap Logic (NIP-61) ---

const transformNutzap = (event: NDKEvent): Nutzap | null => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw Error('NDK must be initialized.')

	const proofTag = event.tags.find((t) => t[0] === 'proof')?.[1]
	const pTag = event.tags.find((t) => t[0] === 'p')?.[1]
	const uTag = event.tags.find((t) => t[0] === 'u')?.[1]
	const eTag = event.tags.find((t) => t[0] === 'e')?.[1]
	const kTag = event.tags.find((t) => t[0] === 'k')?.[1]
	const unitTag = event.tags.find((t) => t[0] === 'unit')?.[1] || 'sat'

	if (!proofTag || !pTag || !uTag) {
		return null // Invalid nutzap
	}

	return {
		id: event.id,
		amountSats: parseCashuProofAmount(proofTag),
		message: event.content || '',
		senderPubkey: event.pubkey, // Sender is the event author
		recipientPubkey: pTag,
		targetEventId: eTag,
		targetEventKind: kTag ? parseInt(kTag, 10) : undefined,
		mintUrl: uTag,
		unit: unitTag,
		proofRaw: proofTag,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		rawEvent: event,
	}
}

const fetchNutzaps = async (targetEvent: NDKEvent): Promise<Nutzap[]> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [NUTZAP_KIND],
		limit: 100,
	}

	// Filter by target event
	if (targetEvent.kind === 1 || !isAddressableKind(targetEvent.kind)) {
		filter['#e'] = [targetEvent.id]
	} else {
		filter['#a'] = [getCoordinates(targetEvent)]
	}

	filter['#p'] = [targetEvent.pubkey]

	console.log(filter)

	const events = await ndk.fetchEvents(filter)

	console.log('Found ' + events.size + ' nut zaps.')

	const zaps: Nutzap[] = []
	for (const event of Array.from(events)) {
		const zap = transformNutzap(event)
		if (zap) zaps.push(zap)
	}

	// Filter deletions
	const idsToDelete = zaps.map((z) => z.id)
	if (idsToDelete.length > 0) {
		const delFilter: NDKFilter = {
			kinds: [DELETION_KIND],
			'#e': idsToDelete,
		}
		const delEvents = await ndk.fetchEvents(delFilter)
		const deletedIds = new Set<string>()
		delEvents.forEach((e) => {
			e.tags.filter((t) => t[0] === 'e').forEach((t) => t[1] && deletedIds.add(t[1]))
		})
		return zaps.filter((z) => !deletedIds.has(z.id))
	}

	return zaps.sort((a, b) => b.createdAt - a.createdAt)
}

// --- Unified Hook ---

export interface UnifiedZap {
	type: 'lightning' | 'nutzap'
	data: LightningZap | Nutzap
}

export const useEventZaps = (event: NDKEvent) => {
	return useQuery({
		queryKey: zapKeys.byEvent(event.id, event.pubkey),
		queryFn: async () => {
			const [lightningZaps, nutzaps] = await Promise.all([fetchLightningZaps(event), fetchNutzaps(event)])

			const unified: UnifiedZap[] = [
				...lightningZaps.map((z) => ({ type: 'lightning' as const, data: z })),
				...nutzaps.map((z) => ({ type: 'nutzap' as const, data: z })),
			]

			return unified.sort((a, b) => b.data.createdAt - a.data.createdAt)
		},
		enabled: !!event,
	})
}

interface LnurlResponse {
	allowsNostr: boolean
	nostrPubkey: string
	callback: string
	minSendable: number
	maxSendable: number
	metadata: string
	tag: string
}

/**
 * Step 1: Fetch User Profile to get lud16
 */
const getUserLud16 = async (userPubkey: string): Promise<string | null> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	const profileEvents = await ndk.fetchEvents({
		kinds: [0],
		authors: [userPubkey],
		limit: 1,
	})

	const profile = Array.from(profileEvents)[0]
	if (!profile) return null

	try {
		const content = JSON.parse(profile.content)
		return content.lud16 || null
	} catch (e) {
		console.error('Failed to parse profile content', e)
		return null
	}
}

/**
 * Step 2: Resolve LNURL to get Provider Info
 */
const resolveLnurl = async (lud16: string): Promise<LnurlResponse> => {
	const [username, domain] = lud16.split('@')
	if (!username || !domain) throw new Error('Invalid lud16 format')

	const url = `https://${domain}/.well-known/lnurlp/${username}`
	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`LNURL resolution failed for ${lud16}: ${response.statusText}`)
	}

	const data = await response.json()

	if (!data.allowsNostr || !data.nostrPubkey) {
		throw new Error(`LNURL for ${lud16} does not support Nostr zaps`)
	}

	return data
}

/**
 * Step 3 & 4: Fetch Zaps from Provider and Filter for User
 */
export const fetchZapsForUserViaProvider = async (userPubkey: string, targetEventId?: string): Promise<LightningZap[]> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	console.log('Fetching zaps via provider...')

	// 1. Get lud16
	const lud16 = await getUserLud16(userPubkey)
	if (!lud16) {
		console.warn(`No lud16 found for user ${userPubkey}`)
		return []
	}

	console.log('Found lud16: ' + lud16)

	console.log('Fetching lnurl data...')

	// 2. Resolve LNURL to get Provider's Pubkey
	let providerPubkey: string
	try {
		const lnurlData = await resolveLnurl(lud16)
		providerPubkey = lnurlData.nostrPubkey
	} catch (e) {
		console.error('Failed to resolve LNURL', e)
		return []
	}

	console.log('Found provider pubkey through lnurl data: ' + providerPubkey)

	// 3. Fetch zaps signed by the Provider
	const filter: NDKFilter = {
		kinds: [9735],
		authors: [providerPubkey], // Fetch events SIGNED by the provider
		limit: 100, // Adjust based on expected volume
	}

	// We add the target pubkey as a #p tag:
	filter['#p'] = [userPubkey]

	// Optionally, we can add the target event id if provided.
	if (targetEventId) {
		filter['#e'] = [targetEventId]
	}

	const events = await ndk.fetchEvents(filter)
	const validZaps: LightningZap[] = []

	for (const event of Array.from(events)) {
		try {
			const senderPubkey = event.tags.find((t: any[]) => t[0] === 'P')?.[1] ?? ''
			const comment = event.content
			const bolt11Tag = event.tags.find((t: any[]) => t[0] === 'bolt11')?.[1] ?? ''
			const eventCoordinates = event.tags.find((t: any[]) => t[0] === 'a')?.[1]
			const eventId = event.tags.find((t: any[]) => t[0] === 'e')?.[1] ?? targetEventId

			const amountMillisatsRaw = decode(bolt11Tag).sections.find((s) => s.name == 'amount')?.value
			if (!amountMillisatsRaw) {
				console.error('No valid payment amount found for lightning zap.')
				continue
			}

			validZaps.push({
				id: event.id,
				amountMillisats: parseInt(amountMillisatsRaw),
				message: comment,
				senderPubkey,
				recipientPubkey: userPubkey,
				targetEventId: eventId,
				bolt11: bolt11Tag || '',
				createdAt: event.created_at || 0,
				rawEvent: event,
				providerPubkey: event.pubkey, // The signer (Coinos),
				descriptionHash: event.tags.find((t) => t[0] === 'bolt11')?.[2] || '',
			})
		} catch (e) {
			console.error('Failed to parse zap description for event', event.id, e)
		}
	}

	return validZaps.sort((a, b) => b.createdAt - a.createdAt)
}

export const useZapsViaProvider = (event: NDKEvent) => {
	return useQuery({
		queryKey: zapKeys.byProvider(event.pubkey, event.id), // You'll need to add this key
		queryFn: () => fetchZapsForUserViaProvider(event.pubkey, event.id),
		enabled: !!event.pubkey,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
