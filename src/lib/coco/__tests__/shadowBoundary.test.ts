import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../errors'
import { buildCocoWalletNamespace } from '../namespace'
import { createCocoShadowBoundary, type CocoShadowStatus } from '../shadowBoundary'

const namespace = buildCocoWalletNamespace({ environment: 'test', pubkey: 'a'.repeat(64) })

function status(overrides: Record<string, unknown> = {}): CocoShadowStatus & Record<string, unknown> {
	return {
		namespace,
		authorityGeneration: 3,
		proofCount: 0,
		operationCount: 0,
		lifecycle: 'initialized',
		...overrides,
	}
}

describe('Coco shadow boundary', () => {
	test('exposes only status and dispose with immutable sanitized diagnostics', async () => {
		const boundary = createCocoShadowBoundary({ readStatus: async () => status(), dispose: async () => undefined })
		expect(Object.keys(boundary).sort()).toEqual(['dispose', 'status'])
		for (const method of ['send', 'receive', 'mint', 'melt', 'wallet', 'keyring', 'saveProofs', 'deleteProofs']) {
			expect(method in boundary).toBe(false)
		}
		const projection = await boundary.status()
		expect(Object.isFrozen(boundary)).toBe(true)
		expect(Object.isFrozen(projection)).toBe(true)
		expect(projection).toEqual(status())
	})

	test('28: scalar getter substitution is captured once and cannot leak a capability', async () => {
		let reads = 0
		const raw = status()
		Object.defineProperty(raw, 'proofCount', {
			enumerable: true,
			get: () => {
				reads += 1
				return reads === 1 ? 0 : { execute: () => 'escaped' }
			},
		})
		const boundary = createCocoShadowBoundary({ readStatus: async () => raw, dispose: async () => undefined })
		await expect(boundary.status()).rejects.toMatchObject({ code: 'SHADOW_BOUNDARY_INVALID' })
		expect(reads).toBe(0)
	})

	test('29: throwing diagnostic getter becomes a sanitized domain failure', async () => {
		const raw = status()
		Object.defineProperty(raw, 'operationCount', {
			enumerable: true,
			get: () => {
				throw new Error('KNOWN_RAW_SHADOW_SECRET')
			},
		})
		const boundary = createCocoShadowBoundary({ readStatus: async () => raw, dispose: async () => undefined })
		try {
			await boundary.status()
			throw new Error('expected shadow failure')
		} catch (error) {
			expect(error).toBeInstanceOf(CocoHostError)
			expect((error as CocoHostError).code).toBe('SHADOW_BOUNDARY_INVALID')
			expect((error as Error).message).not.toContain('KNOWN_RAW_SHADOW_SECRET')
		}
	})

	test('30: status while dispose is pending rejects with SHADOW_DISPOSING', async () => {
		let release!: () => void
		const pending = new Promise<void>((resolve) => {
			release = resolve
		})
		const boundary = createCocoShadowBoundary({ readStatus: async () => status(), dispose: async () => pending })
		const disposing = boundary.dispose()
		await expect(boundary.status()).rejects.toMatchObject({ code: 'SHADOW_DISPOSING' })
		release()
		await disposing
		await expect(boundary.status()).rejects.toMatchObject({ code: 'SHADOW_DISPOSED' })
	})

	test('31: raw disposal exception is sanitized and retry remains possible', async () => {
		let attempts = 0
		const boundary = createCocoShadowBoundary({
			readStatus: async () => status(),
			dispose: async () => {
				attempts += 1
				if (attempts === 1) throw new Error('KNOWN_RAW_DISPOSE_SECRET')
			},
		})
		try {
			await boundary.dispose()
			throw new Error('expected disposal failure')
		} catch (error) {
			expect(error).toMatchObject({ code: 'SHADOW_DISPOSE_FAILED' })
			expect((error as Error).message).not.toContain('KNOWN_RAW_DISPOSE_SECRET')
		}
		expect((await boundary.status()).lifecycle).toBe('initialized')
		await boundary.dispose()
		await boundary.dispose()
		expect(attempts).toBe(2)
	})

	test('object/function scalar values and undeclared diagnostic fields reject', async () => {
		for (const raw of [status({ proofCount: { execute() {} } }), status({ token: 'not-public' })]) {
			const boundary = createCocoShadowBoundary({ readStatus: async () => raw, dispose: async () => undefined })
			await expect(boundary.status()).rejects.toMatchObject({ code: 'SHADOW_BOUNDARY_INVALID' })
		}
	})
})
