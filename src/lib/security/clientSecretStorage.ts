import { z } from 'zod'

const SECRET_STORAGE_VERSION = 1
const PBKDF2_ITERATIONS = 250_000
const AES_GCM_KEY_LENGTH = 256
const AES_GCM_IV_BYTES = 12
const PBKDF2_SALT_BYTES = 16

const passwordEnvelopeSchema = z.object({
	version: z.literal(SECRET_STORAGE_VERSION),
	mode: z.literal('password'),
	kdf: z.literal('PBKDF2-SHA256'),
	iterations: z.number().int().positive(),
	salt: z.string().min(1),
	iv: z.string().min(1),
	ciphertext: z.string().min(1),
	pubkey: z.string().min(1).optional(),
})

export type PasswordSecretEnvelope = z.infer<typeof passwordEnvelopeSchema>

const memorySessionSecrets = new Map<string, string>()

function getCrypto(): Crypto {
	if (!globalThis.crypto?.subtle) {
		throw new Error('Web Crypto is unavailable')
	}

	return globalThis.crypto
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

function utf8Encode(value: string): Uint8Array {
	return new TextEncoder().encode(value)
}

function utf8Decode(bytes: BufferSource): string {
	return new TextDecoder().decode(bytes)
}

function randomBytes(length: number): Uint8Array {
	return getCrypto().getRandomValues(new Uint8Array(length))
}

async function derivePasswordKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
	const cryptoApi = getCrypto()
	const passwordKey = await cryptoApi.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, ['deriveKey'])

	return cryptoApi.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt,
			iterations: PBKDF2_ITERATIONS,
		},
		passwordKey,
		{
			name: 'AES-GCM',
			length: AES_GCM_KEY_LENGTH,
		},
		false,
		usages,
	)
}

export function parsePasswordSecretEnvelope(rawValue: string | null | undefined): PasswordSecretEnvelope | null {
	if (!rawValue) return null

	try {
		return passwordEnvelopeSchema.parse(JSON.parse(rawValue))
	} catch {
		return null
	}
}

export async function encryptSecretWithPassword(
	plaintext: string,
	password: string,
	options?: { pubkey?: string },
): Promise<PasswordSecretEnvelope> {
	const cryptoApi = getCrypto()
	const salt = randomBytes(PBKDF2_SALT_BYTES)
	const iv = randomBytes(AES_GCM_IV_BYTES)
	const key = await derivePasswordKey(password, salt, ['encrypt'])
	const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8Encode(plaintext))

	return {
		version: SECRET_STORAGE_VERSION,
		mode: 'password',
		kdf: 'PBKDF2-SHA256',
		iterations: PBKDF2_ITERATIONS,
		salt: bytesToBase64(salt),
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		...(options?.pubkey ? { pubkey: options.pubkey } : {}),
	}
}

export async function decryptSecretWithPassword(envelope: PasswordSecretEnvelope, password: string): Promise<string> {
	const cryptoApi = getCrypto()

	try {
		const key = await derivePasswordKey(password, base64ToBytes(envelope.salt), ['decrypt'])
		const plaintext = await cryptoApi.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: base64ToBytes(envelope.iv),
			},
			key,
			base64ToBytes(envelope.ciphertext),
		)

		return utf8Decode(plaintext)
	} catch {
		throw new Error('Incorrect password or corrupted key material')
	}
}

export async function savePasswordProtectedSecret(
	storage: Storage,
	storageKey: string,
	plaintext: string,
	password: string,
	options?: { pubkey?: string },
): Promise<void> {
	const envelope = await encryptSecretWithPassword(plaintext, password, options)
	storage.setItem(storageKey, JSON.stringify(envelope))
}

export async function loadPasswordProtectedSecret(storage: Storage, storageKey: string, password: string): Promise<string | null> {
	const envelope = parsePasswordSecretEnvelope(storage.getItem(storageKey))
	if (!envelope) return null

	return decryptSecretWithPassword(envelope, password)
}

export function storeMemorySessionSecret(slot: string, secret: string): void {
	memorySessionSecrets.set(slot, secret)
}

export function loadMemorySessionSecret(slot: string): string | null {
	return memorySessionSecrets.get(slot) ?? null
}

export function clearMemorySessionSecret(slot: string): void {
	memorySessionSecrets.delete(slot)
}

export function clearAllMemorySessionSecrets(): void {
	memorySessionSecrets.clear()
}
