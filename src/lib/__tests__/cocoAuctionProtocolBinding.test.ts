import { describe, expect, test } from 'bun:test'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { buildAuctionEventTags } from '@/lib/auction/tagBuilders'
import type { ParsedAuctionEvent, ParsedBidEvent } from '@/lib/auction/events'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { buildAuctionConditionFingerprint } from '@/lib/coco/auctionDemo/cocoPort'
import {
	assertExactWinningOperationBinding,
	assertSellerPathBinding,
	releaseExactlyBoundWinningBid,
} from '@/lib/coco/auctionDemo/protocolBinding'
import type { CocoAuctionBidCommitments, CocoAuctionLegRecord } from '@/lib/coco/auctionDemo/types'

const secret = new Uint8Array(32).fill(9)
const bidRaw = finalizeEvent({ kind: 1023, created_at: 101, content: '', tags: [] }, new Uint8Array(32).fill(8))
const auditor = 'a'.repeat(64)
const mintUrl = 'http://localhost:3338'
const REAL_XPUB = 'xpub6CHGS91EATnrt7a3wBLqCeJ13KvVXQp3m39ufe1TYiFxHHmAK1TiwfrT1N89CAHNLa9YQgbJAyysBZTiRRH38wTvYeBiYvgRrqxALmvghTH'
const CHILD = '02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0'
const REFUND = '0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5'
const PROOF_Y = '023d5fb1f71aa08f907ce34a0cdebea8c52d35648756dd6392254b1cbf897944bc'
const LOCK_SECRET =
	'["P2PK",{"nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]'

const canonicalAuctionEvent = () =>
	finalizeEvent(
		{
			kind: 30408,
			created_at: 100,
			content: '',
			tags: buildAuctionEventTags({
				dTag: 'canonical',
				title: 'Canonical Auction',
				startAt: 100,
				endAt: 140,
				maxEndAt: 140,
				settlementGrace: 10,
				reserve: 0,
				startingBid: 16,
				bidIncrement: 16,
				mints: [mintUrl],
				p2pkXpub: REAL_XPUB,
				auditors: [auditor],
				auditorQuorum: 1,
			}),
		},
		secret,
	)

const sellerEvent = canonicalAuctionEvent()

const auction = (): ParsedAuctionEvent => {
	const parsed = parseAuctionEvent(canonicalAuctionEvent())
	if (!parsed.ok) throw new Error('fixture parse failed')
	return parsed.value
}

const fingerprint = buildAuctionConditionFingerprint({
	mintUrl,
	amount: 16,
	recipientPublicKey: CHILD,
	refundPublicKey: REFUND,
	locktime: 150,
})

const bid = (overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent => ({
	rawEvent: bidRaw,
	id: bidRaw.id,
	bidderPubkey: bidRaw.pubkey,
	createdAt: 101,
	auctionRootEventId: sellerEvent.id,
	auctionCoordinate: `30408:${sellerEvent.pubkey}:canonical`,
	sellerPubkey: sellerEvent.pubkey,
	amount: 16,
	legLockedAmount: 16,
	currency: 'SAT',
	mint: mintUrl,
	locktime: 150,
	refundPubkey: REFUND,
	childPubkey: CHILD,
	lockSecrets: [LOCK_SECRET],
	proofYs: [PROOF_Y],
	createdForEndAt: 140,
	bidNonce: 'nonce',
	keyScheme: 'hd_p2pk',
	status: 'locked',
	...overrides,
})

const leg = (overrides: Partial<CocoAuctionLegRecord> = {}): CocoAuctionLegRecord => ({
	version: 2,
	runId: 'run',
	state: 'BID_PUBLISHED',
	role: 'bidder-b',
	accountId: 'run:bidder-b',
	bidderPubkey: bidRaw.pubkey,
	auctionId: sellerEvent.id,
	auctionCoordinate: `30408:${sellerEvent.pubkey}:canonical`,
	bidderLegId: 'run:bidder-b',
	mintUrl,
	unit: 'sat',
	amount: 16,
	locktime: 150,
	derivationPath: 'm/0',
	recipientPublicKey: CHILD,
	refundPublicKey: REFUND,
	conditionFingerprint: fingerprint,
	operationId: 'send-winner',
	lockSecrets: [LOCK_SECRET],
	proofYs: [PROOF_Y],
	revision: 4,
	signedBidEvent: bidRaw,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
})

const commitments = (overrides: Partial<CocoAuctionBidCommitments> = {}): CocoAuctionBidCommitments => ({
	operationId: 'send-winner',
	mintUrl,
	unit: 'sat',
	amount: 16,
	locktime: 150,
	recipientPublicKey: CHILD,
	refundPublicKey: REFUND,
	conditionFingerprint: fingerprint,
	lockSecrets: [LOCK_SECRET],
	proofYs: [PROOF_Y],
	...overrides,
})

describe('canonical Auction construction', () => {
	test('P1 generated Auction passes the canonical parser', () => {
		const event = canonicalAuctionEvent()
		expect(verifyEvent(event)).toBe(true)
		expect(parseAuctionEvent(event).ok).toBe(true)
	})

	test('A1 tampering with a mandatory tag after signing invalidates the event', () => {
		const event = JSON.parse(JSON.stringify(canonicalAuctionEvent())) as ReturnType<typeof canonicalAuctionEvent>
		event.tags = event.tags.map((tag) => (tag[0] === 'settlement_policy' ? ['settlement_policy', 'tampered'] : tag))
		expect(verifyEvent(event)).toBe(false)
	})

	test('P2 obsolete settlement policy is rejected', () => {
		const event = canonicalAuctionEvent()
		event.tags = event.tags.map((tag) => (tag[0] === 'settlement_policy' ? ['settlement_policy', 'cashu_p2pk_path_oracle_v1'] : tag))
		expect(parseAuctionEvent(event).ok).toBe(false)
	})

	test('P3 missing required auditor is rejected', () => {
		const event = canonicalAuctionEvent()
		event.tags = event.tags.filter((tag) => tag[0] !== 'auditors')
		expect(parseAuctionEvent(event).ok).toBe(false)
	})
})

describe('winner-to-Coco exact binding', () => {
	test('W1 rejects sibling Coco operation substitution', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid(), commitments({ operationId: 'send-sibling' }))).toThrow(
			'exact Coco operation',
		)
	})

	test('W2 rejects amount and mint mismatches', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid(), commitments({ amount: 17 }))).toThrow('amount mismatch')
		expect(() => assertExactWinningOperationBinding(leg(), bid(), commitments({ mintUrl: 'http://localhost:9999' }))).toThrow(
			'mint mismatch',
		)
	})

	test('W3 rejects lock commitment mismatch', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid({ lockSecrets: ['different'] }), commitments())).toThrow('lock-secret')
	})

	test('W4 rejects proof-Y mismatch', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid({ proofYs: [`02${'0'.repeat(64)}`] }), commitments())).toThrow('proof-Y')
	})

	test('W5 rejects refund, recipient, and locktime mismatch', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid({ refundPubkey: `03${'3'.repeat(64)}` }), commitments())).toThrow('refund')
		expect(() => assertExactWinningOperationBinding(leg(), bid({ childPubkey: `03${'4'.repeat(64)}` }), commitments())).toThrow('recipient')
		expect(() => assertExactWinningOperationBinding(leg(), bid({ locktime: 151 }), commitments())).toThrow('locktime')
	})

	test('W6 accepts the exact winning operation', () => {
		expect(() => assertExactWinningOperationBinding(leg(), bid(), commitments())).not.toThrow()
	})

	test('W2 rejects a sibling actual operation before bearer release is called', async () => {
		let tokenAccessed = false
		const wallet = {
			inspectAuctionBid: async () => commitments({ operationId: 'send-sibling' }),
			releaseWinningBid: async () => {
				tokenAccessed = true
				return { operationId: 'send-winner', token: 'forbidden-token' }
			},
		}
		await expect(releaseExactlyBoundWinningBid(wallet, leg(), bid())).rejects.toThrow('exact Coco operation')
		expect(tokenAccessed).toBe(false)
	})
})

describe('seller derivation-path binding', () => {
	test('S1/S2 reject wrong and cross-Auction paths', () => {
		expect(() => assertSellerPathBinding(auction(), bid(), 'm/1')).toThrow('does not derive')
		expect(() => assertSellerPathBinding(auction(), bid({ auctionCoordinate: '30408:other:auction' }), 'm/0')).toThrow('Auction identity')
	})

	test('S3 correct path derives the exact committed recipient key', () => {
		expect(assertSellerPathBinding(auction(), bid(), 'm/0')).toBe(CHILD)
	})

	test('S4 Market leg stores no child private key', () => {
		expect(JSON.stringify(leg())).not.toMatch(/privateKey|childPrivate|refundPrivate/i)
	})
})
