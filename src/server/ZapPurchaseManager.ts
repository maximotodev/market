import type { NostrEvent } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import type { EventSigner } from './EventSigner'

/**
 * Pricing tier for a purchasable item.
 */
export interface PricingTier {
	sats: number
	days: number
	seconds?: number
	label: string
}

/**
 * Base interface for any zap-purchased registry entry.
 * All purchase types track the buyer's pubkey and expiration.
 */
export interface ZapPurchaseEntry {
	pubkey: string
	validUntil: number // Unix timestamp
}

/**
 * Configuration for a zap purchase manager instance.
 *
 * @example
 * // Vanity URL purchase config
 * {
 *   zapLabel: 'vanity-register',
 *   registryEventKind: 30000,
 *   registryDTag: 'vanity-urls',
 *   pricing: {
 *     '6mo': { sats: 10000, days: 180, label: '6 Months' },
 *     '1yr': { sats: 18000, days: 365, label: '1 Year' },
 *   },
 * }
 */
export interface ZapPurchaseConfig {
	/** L tag to identifying this purchase type (like: "vanity-register") */
	zapLabel: string
	/** Nostr event kind for the registry (e.g. 30000) */
	registryEventKind: number
	/** d-tag value for the registry event (e.g. "vanity-urls") */
	registryDTag: string
	/** Available pricing tiers */
	pricing: Record<string, PricingTier>
	/** Max age in seconds for processing zap receipts (default: 300) */
	maxReceiptAge?: number
}

/**
 *  Abstract base for all zap purchases:
 * - Subscribtion -> Payment Validation  -> Publishing the parameterized Nostr events
 *
 * Subclasses implement domain-specific logic: 
 *  - extract the registry and specific validation rules and serialization Nostr event tags
 *
 * @example
 * // Create a supporter badge purchase manager
 * class BadgePurchaseManager extends ZapPurchaseManager<BadgeEntry> {
 *   constructor(eventSigner: EventSigner) {
 *     super({
 *       zapLabel: 'badge-purchase',
 *       registryEventKind: 30000,
 *       registryDTag: 'supporter-badges',
 *       pricing: BADGE_PRICING,
 *     }, eventSigner)
 *   }
 *
 *   protected extractRegistryKey(zapRequest: NostrEvent): string | null {
 *     return zapRequest.pubkey // Badge is keyed by pubkey
 *   }
 *
 *   protected validateRegistration(key: string, pubkey: string): string | null {
 *     return null // No special validation needed
 *   }
 *
 *   // ... other implementable abstract methods
 * }
 */
export abstract class ZapPurchaseManager<TEntry extends ZapPurchaseEntry> {
	protected registry: Map<string, TEntry> = new Map()
	private processedReceipts: Set<string> = new Set()
	protected eventSigner: EventSigner
	protected ndk: NDK | null = null
	protected appPubkey: string = ''
	public readonly config: ZapPurchaseConfig

	constructor(config: ZapPurchaseConfig, eventSigner: EventSigner) {
		this.config = config
		this.eventSigner = eventSigner
	}

	// --- Abstract methods implemented in subclasses ---

	/** Extract the registry key from a zap request (vanity name from tags, or pubkey for badges) */
	protected abstract extractRegistryKey(zapRequest: NostrEvent): string | null

	/** Validate whether a registration is allowed. Return null if valid, or an error message string. */
	protected abstract validateRegistration(key: string, pubkey: string): string | null

	/** Parse entries from a Nostr registry event's tags */
	protected abstract extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: TEntry }>

	/** Build Nostr event tags from the current registry entries */
	protected abstract buildRegistryTags(entries: Map<string, TEntry>): string[][]

	/** Create a new entry instance for the given key, pubkey, and validity timestamp */
	protected abstract createEntry(key: string, pubkey: string, validUntil: number): TEntry

	// --- Optional hooks (override in subclass) ---

	/** Called after a new entry is registered. Use for secondary indexes (e.g. pubkey→key reverse lookup). */
	protected onEntryRegistered?(key: string, entry: TEntry): void

	/** Called after the registry is fully rebuilt from an event. Use to rebuild secondary indexes. */
	protected onRegistryRebuilt?(): void

	// --- Public API ---

	public setNDK(ndk: NDK): void {
		this.ndk = ndk
	}

	public setAppPubkey(pubkey: string): void {
		this.appPubkey = pubkey
	}

	/**
	 * Handle a registry event (rebuild in-memory state from a Nostr event).
	 * Called when a registry kind(kind 30000)) event is received.
	 */
	public async handleRegistryEvent(event: NostrEvent): Promise<void> {
		console.log(`[${this.config.registryDTag}] Processing registry event: ${event.id}`)

		const entries = this.extractEntriesFromEvent(event)

		this.registry.clear()
		const now = Math.floor(Date.now() / 1000)

		for (const { key, entry } of entries) {
			if (entry.validUntil >= now) {
				this.registry.set(key, entry)
			}
		}

		this.onRegistryRebuilt?.()
		console.log(`[${this.config.registryDTag}] Registry updated: ${this.registry.size} active entries`)
	}

	/**
	 * Handle a zap receipt (kind 9735) and register the purchase if valid.
	 * Validates - duplicity, recency, label tag, payment amount, and domain-specific rules.
	 * On success, creates/extends the registry entry and publishes the updated registry.
	 */
	public async handleZapReceipt(event: NostrEvent): Promise<void> {
		const eventId = event.id
		if (!eventId) return
		if (this.processedReceipts.has(eventId)) return
		this.processedReceipts.add(eventId)

		// Bound the dedup set to prevent unbounded memory growth
		if (this.processedReceipts.size > 2000) {
			this.processedReceipts.clear()
			this.processedReceipts.add(eventId)
		}

		// Skip old receipts (prevents re-processing on server restart)
		const maxAge = this.config.maxReceiptAge ?? 300
		const eventAge = Math.floor(Date.now() / 1000) - (event.created_at || 0)
		if (eventAge > maxAge) {
			console.log(`[${this.config.registryDTag}] Skipping old zap receipt (${eventAge}s old): ${eventId}`)
			return
		}

		// Parse zap request from the receipt's description tag
		const zapRequestTag = event.tags.find((t) => t[0] === 'description')
		if (!zapRequestTag?.[1]) return

		let zapRequest: NostrEvent
		try {
			zapRequest = JSON.parse(zapRequestTag[1])
		} catch {
			console.error(`[${this.config.registryDTag}] Failed to parse zap request from receipt`)
			return
		}

		// Check for matching purchase label
		const labelTag = zapRequest.tags.find((t) => t[0] === 'L' && t[1] === this.config.zapLabel)
		if (!labelTag) return // Not for this purchase type

		console.log(`[${this.config.registryDTag}] Processing purchase zap receipt: ${eventId}`)

		// Extract registry key from the zap request
		const key = this.extractRegistryKey(zapRequest)
		if (!key) {
			console.error(`[${this.config.registryDTag}] No registry key found in zap request`)
			return
		}

		const requesterPubkey = zapRequest.pubkey

		// Domain-specific validation
		const validationError = this.validateRegistration(key, requesterPubkey)
		if (validationError) {
			console.error(`[${this.config.registryDTag}] Validation failed: ${validationError}`)
			return
		}

		// Verify bolt11 invoice exists in receipt
		const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')
		if (!bolt11Tag) {
			console.error(`[${this.config.registryDTag}] No bolt11 found in zap receipt`)
			return
		}

		// Extract payment amount and match to pricing tier
		const amountTag = zapRequest.tags.find((t) => t[0] === 'amount')
		const amountMsats = amountTag ? parseInt(amountTag[1]) : 0
		const amountSats = Math.floor(amountMsats / 1000)
		console.log(`[${this.config.registryDTag}] Zap amount: ${amountSats} sats`)

		const validitySeconds = this.matchPricingTier(amountSats)
		if (validitySeconds === null) {
			console.error(`[${this.config.registryDTag}] Insufficient amount: ${amountSats} sats`)
			return
		}

		// Calculate validity, extending if same owner renews
		const now = Math.floor(Date.now() / 1000)
		let validUntil = now + validitySeconds

		const existing = this.registry.get(key)
		if (existing && existing.pubkey === requesterPubkey && existing.validUntil > now) {
			validUntil = existing.validUntil + validitySeconds
		}

		console.log(`[${this.config.registryDTag}] Registration valid until: ${new Date(validUntil * 1000).toISOString()}`)

		// Create and store the entry
		const entry = this.createEntry(key, requesterPubkey, validUntil)
		this.registry.set(key, entry)
		this.onEntryRegistered?.(key, entry)

		// Publish updated registry to relays
		await this.publishRegistry()

		console.log(
			`[${this.config.registryDTag}] Registered: ${key} -> ${requesterPubkey} (valid until ${new Date(validUntil * 1000).toISOString()})`,
		)
	}

	/**
	 * Load existing registry state from the relay on startup.
	 */
	public async loadExistingRegistry(appPubkey: string): Promise<void> {
		if (!this.ndk) {
			console.warn(`[${this.config.registryDTag}] NDK not available, cannot load existing registry`)
			return
		}

		this.appPubkey = appPubkey

		try {
			const events = await this.ndk.fetchEvents({
				kinds: [this.config.registryEventKind],
				authors: [appPubkey],
				'#d': [this.config.registryDTag],
				limit: 1,
			})

			if (events.size > 0) {
				const latestEvent = Array.from(events)[0]
				await this.handleRegistryEvent(latestEvent.rawEvent())
				console.log(`[${this.config.registryDTag}] Loaded existing registry`)
			} else {
				console.log(`[${this.config.registryDTag}] No existing registry found`)
			}
		} catch (error) {
			console.error(`[${this.config.registryDTag}] Error loading existing registry:`, error)
		}
	}

	/**
	 * Get all active (non-expired) entries.
	 */
	public getAllEntries(): TEntry[] {
		const now = Math.floor(Date.now() / 1000)
		return Array.from(this.registry.values()).filter((e) => e.validUntil > now)
	}

	/**
	 * Get an entry by registry key, or null if not found or expired.
	 */
	public getEntry(key: string): TEntry | null {
		const entry = this.registry.get(key)
		if (!entry) return null
		if (entry.validUntil < Math.floor(Date.now() / 1000)) return null
		return entry
	}

	/**
	 * Find the first active entry for a given pubkey.
	 */
	public getEntryForPubkey(pubkey: string): TEntry | null {
		const now = Math.floor(Date.now() / 1000)
		for (const entry of Array.from(this.registry.values())) {
			if (entry.pubkey === pubkey && entry.validUntil > now) {
				return entry
			}
		}
		return null
	}

	// --- Protected helpers ---

	/**
	 * Match a payment amount to the best (highest) qualifying pricing tier.
	 * Returns validity in seconds, or null if no tier matches.
	 *
	 * Tiers are sorted by sats descending so the highest qualifying tier wins.
	 * Tiers with `seconds` (dev/test tiers) use that value directly;
	 * tiers with `days` are converted to seconds.
	 */
	protected matchPricingTier(amountSats: number): number | null {
		const entries = Object.entries(this.config.pricing)
		// Sort descending by sats so we match the highest qualifying tier first
		entries.sort(([, a], [, b]) => b.sats - a.sats)

		for (const [, tier] of entries) {
			if (amountSats >= tier.sats) {
				if (tier.seconds !== undefined) {
					return tier.seconds
				}
				return tier.days * 24 * 60 * 60
			}
		}

		return null
	}

	/**
	 * Publish the current registry as a signed Nostr event to connected relays.
	 */
	protected async publishRegistry(): Promise<void> {
		if (!this.ndk) {
			console.error(`[${this.config.registryDTag}] NDK not available, cannot publish registry`)
			return
		}

		const event = new NDKEvent(this.ndk)
		event.kind = this.config.registryEventKind
		event.content = ''
		event.created_at = Math.floor(Date.now() / 1000)

		const tags: string[][] = [['d', this.config.registryDTag]]
		tags.push(...this.buildRegistryTags(this.registry))
		event.tags = tags

		try {
			const signedEvent = this.eventSigner.signEvent(event.rawEvent())
			if (signedEvent) {
				const ndkEvent = new NDKEvent(this.ndk, signedEvent)
				await ndkEvent.publish()
				console.log(`[${this.config.registryDTag}] Registry published: ${signedEvent.id}`)
			}
		} catch (error) {
			console.error(`[${this.config.registryDTag}] Failed to publish registry:`, error)
		}
	}
}
