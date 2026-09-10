import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../errors'
import { COCO_G9A_NAMESPACE_PREFIX, buildCocoWalletNamespace, isCocoG9aNamespace, parseCocoEnvironment } from '../namespace'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

function expectCode(fn: () => unknown, code: CocoHostError['code']): void {
	try {
		fn()
		throw new Error('expected domain failure')
	} catch (error) {
		expect(error).toBeInstanceOf(CocoHostError)
		expect((error as CocoHostError).code).toBe(code)
	}
}

describe('Coco G9A namespace contract', () => {
	test('namespace is deterministic and binds the full normalized identity', () => {
		const upper = buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A.toUpperCase() })
		const lower = buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A })
		expect(upper).toBe(lower)
		expect(upper).toBe(`${COCO_G9A_NAMESPACE_PREFIX}:production:nostr:${PUBKEY_A}`)
		expect(isCocoG9aNamespace(upper)).toBe(true)
	})

	test('full pubkeys and environments cannot collide', () => {
		const samePrefix = `aaaaaaaa${'c'.repeat(56)}`
		const values = new Set([
			buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_A }),
			buildCocoWalletNamespace({ environment: 'production', pubkey: PUBKEY_B }),
			buildCocoWalletNamespace({ environment: 'production', pubkey: samePrefix }),
			buildCocoWalletNamespace({ environment: 'staging', pubkey: PUBKEY_A }),
		])
		expect(values.size).toBe(4)
	})

	test('legacy and Coco default names cannot collide', () => {
		const namespace = buildCocoWalletNamespace({ environment: 'test', pubkey: PUBKEY_A })
		expect(namespace).not.toBe(`cashu_wallet_${PUBKEY_A.slice(0, 8)}`)
		expect(namespace).not.toBe('coco_cashu')
	})

	test('8: unknown environment rejects through a closed parser', () => {
		expectCode(() => parseCocoEnvironment('preview'), 'INVALID_NAMESPACE_IDENTITY')
	})

	test('namespace accessors are rejected and throwing getters are sanitized', () => {
		const input = {
			environment: 'test',
			get pubkey() {
				return PUBKEY_A
			},
		}
		expectCode(() => buildCocoWalletNamespace(input), 'INVALID_NAMESPACE_IDENTITY')

		const hostile = Object.defineProperty({ environment: 'test' }, 'pubkey', {
			get: () => {
				throw new Error('KNOWN_RAW_GETTER_SECRET')
			},
			enumerable: true,
		})
		try {
			buildCocoWalletNamespace(hostile)
			throw new Error('expected getter rejection')
		} catch (error) {
			expect(error).toBeInstanceOf(CocoHostError)
			expect((error as Error).message).not.toContain('KNOWN_RAW_GETTER_SECRET')
		}
	})

	test.each([
		[null],
		[{}],
		[{ environment: 'production', pubkey: 'a'.repeat(63) }],
		[{ environment: 'production', pubkey: `${'a'.repeat(63)}z` }],
		[{ environment: 'production', pubkey: PUBKEY_A, extra: true }],
	])('malformed namespace input fails deterministically', (input) => {
		expectCode(() => buildCocoWalletNamespace(input), 'INVALID_NAMESPACE_IDENTITY')
	})
})
