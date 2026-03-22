import { describe, expect, test } from 'bun:test'
import { decryptSecretWithPassword, encryptSecretWithPassword, parsePasswordSecretEnvelope } from '@/lib/security/clientSecretStorage'

describe('clientSecretStorage', () => {
	test('password mode round-trips without exposing raw private key material', async () => {
		const envelope = await encryptSecretWithPassword('nsec1exampleprivatekey', 'correct horse battery staple', {
			pubkey: 'f'.repeat(64),
		})

		expect(envelope.ciphertext).not.toContain('nsec1exampleprivatekey')
		expect(await decryptSecretWithPassword(envelope, 'correct horse battery staple')).toBe('nsec1exampleprivatekey')
	})

	test('malformed envelope parse is rejected', () => {
		expect(parsePasswordSecretEnvelope('{"mode":"password"}')).toBeNull()
		expect(parsePasswordSecretEnvelope('not-json')).toBeNull()
	})
})
