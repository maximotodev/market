import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../errors'
import { COCO_G9A_ENVIRONMENTS, COCO_G9A_NAMESPACE_PREFIX, buildCocoWalletNamespace, isCocoG9aNamespace } from '../namespace'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)
const PUBKEY_SAME_PREFIX_A = `12345678${'a'.repeat(56)}`
const PUBKEY_SAME_PREFIX_B = `12345678${'b'.repeat(56)}`

describe('Coco G9A namespace contract', () => {
	test('1: is deterministic and normalizes a full public key', () => {
		const first = buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A.toUpperCase() })
		const second = buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A })

		expect(first).toBe(second)
		expect(first).toBe(`${COCO_G9A_NAMESPACE_PREFIX}:production:nostr:${PUBKEY_A}`)
		expect(isCocoG9aNamespace(first)).toBe(true)
	})

	test('2: different full public keys cannot collide', () => {
		expect(buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A })).not.toBe(
			buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_B }),
		)
	})

	test('3: identities differing only after the first eight characters cannot collide', () => {
		expect(buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_SAME_PREFIX_A })).not.toBe(
			buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_SAME_PREFIX_B }),
		)
	})

	test('4: every supported environment has a distinct namespace', () => {
		const values = COCO_G9A_ENVIRONMENTS.map((environment) => buildCocoWalletNamespace({ environment, pubkey: PUBKEY_A }))
		expect(new Set(values).size).toBe(COCO_G9A_ENVIRONMENTS.length)
	})

	test('5: cannot collide with legacy or Coco default database names', () => {
		const namespace = buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A })
		expect(namespace).not.toBe(`cashu_wallet_${PUBKEY_A.slice(0, 8)}`)
		expect(namespace).not.toBe('coco_cashu')
		expect(namespace.startsWith('cashu_wallet_')).toBe(false)
	})

	test.each([
		[null],
		[{}],
		[{ environment: 'production', pubkey: 'a'.repeat(63) }],
		[{ environment: 'preview', pubkey: PUBKEY_A }],
		[{ environment: 'production', pubkey: `${'a'.repeat(63)}z` }],
	])('invalid namespace input fails with a deterministic domain error', (input) => {
		try {
			buildCocoWalletNamespace(input)
			throw new Error('expected namespace construction to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(CocoHostError)
			expect((error as CocoHostError).code).toBe('INVALID_NAMESPACE_IDENTITY')
		}
	})
})
