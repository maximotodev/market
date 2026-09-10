import { captureObject, fail } from './errors'

export const COCO_G9A_NAMESPACE_PREFIX = 'plebeian-market:coco:g9a:v1'

export type CocoG9aEnvironment = 'test' | 'development' | 'staging' | 'production'

export interface CocoWalletNamespaceInput {
	environment: CocoG9aEnvironment
	pubkey: string
}

export interface ParsedCocoWalletNamespace extends CocoWalletNamespaceInput {
	namespace: string
}

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/

export function normalizeNostrPubkey(value: unknown): string {
	if (typeof value !== 'string') {
		fail('INVALID_NAMESPACE_IDENTITY', 'Nostr public key must be a 64-character hexadecimal string')
	}
	const normalized = value.toLowerCase()
	if (!PUBKEY_PATTERN.test(normalized)) {
		fail('INVALID_NAMESPACE_IDENTITY', 'Nostr public key must be a 64-character hexadecimal string')
	}
	return normalized
}

export function parseCocoEnvironment(value: unknown): CocoG9aEnvironment {
	switch (value) {
		case 'test':
		case 'development':
		case 'staging':
		case 'production':
			return value
		default:
			fail('INVALID_NAMESPACE_IDENTITY', 'Coco environment must be explicitly supported')
	}
}

export function buildCocoWalletNamespace(input: unknown): string {
	const captured = captureObject(input, ['environment', 'pubkey'], 'INVALID_NAMESPACE_IDENTITY', 'Coco namespace input')
	const environment = parseCocoEnvironment(captured.environment)
	const pubkey = normalizeNostrPubkey(captured.pubkey)
	return `${COCO_G9A_NAMESPACE_PREFIX}:${environment}:nostr:${pubkey}`
}

export function parseCocoWalletNamespace(value: unknown): Readonly<ParsedCocoWalletNamespace> {
	if (typeof value !== 'string') fail('INVALID_NAMESPACE_IDENTITY', 'Coco wallet namespace must be a string')
	const parts = value.split(':')
	if (parts.length !== 7 || parts.slice(0, 4).join(':') !== COCO_G9A_NAMESPACE_PREFIX || parts[5] !== 'nostr') {
		fail('INVALID_NAMESPACE_IDENTITY', 'Coco wallet namespace is invalid')
	}
	const environment = parseCocoEnvironment(parts[4])
	const pubkey = normalizeNostrPubkey(parts[6])
	const namespace = buildCocoWalletNamespace({ environment, pubkey })
	if (namespace !== value) fail('INVALID_NAMESPACE_IDENTITY', 'Coco wallet namespace is not canonical')
	return Object.freeze({ namespace, environment, pubkey })
}

export function isCocoG9aNamespace(value: unknown): value is string {
	try {
		parseCocoWalletNamespace(value)
		return true
	} catch {
		return false
	}
}
