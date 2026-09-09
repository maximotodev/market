import { fail } from './errors'

export const COCO_G9A_NAMESPACE_PREFIX = 'plebeian-market:coco:g9a:v1'

export const COCO_G9A_ENVIRONMENTS = ['test', 'development', 'staging', 'production'] as const

export type CocoG9aEnvironment = (typeof COCO_G9A_ENVIRONMENTS)[number]

export interface CocoWalletNamespaceInput {
	environment: CocoG9aEnvironment
	pubkey: string
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

export function normalizeCocoEnvironment(value: unknown): CocoG9aEnvironment {
	if (typeof value !== 'string' || !COCO_G9A_ENVIRONMENTS.includes(value as CocoG9aEnvironment)) {
		fail('INVALID_NAMESPACE_IDENTITY', 'Coco environment must be explicitly supported')
	}
	return value as CocoG9aEnvironment
}

export function buildCocoWalletNamespace(input: unknown): string {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		fail('INVALID_NAMESPACE_IDENTITY', 'Coco namespace input must be an object')
	}

	const candidate = input as Partial<CocoWalletNamespaceInput>
	const environment = normalizeCocoEnvironment(candidate.environment)
	const pubkey = normalizeNostrPubkey(candidate.pubkey)
	return `${COCO_G9A_NAMESPACE_PREFIX}:${environment}:nostr:${pubkey}`
}

export function isCocoG9aNamespace(value: unknown): value is string {
	if (typeof value !== 'string') return false
	const [prefix, product, phase, version, environment, identityType, pubkey, ...rest] = value.split(':')
	if (rest.length > 0) return false
	if (`${prefix}:${product}:${phase}:${version}` !== COCO_G9A_NAMESPACE_PREFIX) return false
	if (identityType !== 'nostr') return false
	try {
		normalizeCocoEnvironment(environment)
		normalizeNostrPubkey(pubkey)
		return true
	} catch {
		return false
	}
}
