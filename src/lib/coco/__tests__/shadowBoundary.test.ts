import { describe, expect, test } from 'bun:test'
import { CocoHostError } from '../errors'
import { buildCocoWalletNamespace } from '../namespace'
import { createCocoShadowBoundary, type CocoShadowStatus } from '../shadowBoundary'

const namespace = buildCocoWalletNamespace({ environment: 'test', pubkey: 'a'.repeat(64) })

describe('Coco shadow boundary', () => {
	test('27: exposes only lifecycle and non-monetary diagnostics', async () => {
		let disposed = false
		const boundary = createCocoShadowBoundary({
			readStatus: async () => ({
				namespace,
				authorityGeneration: 3,
				proofCount: 0,
				operationCount: 0,
				lifecycle: 'initialized',
			}),
			dispose: async () => {
				disposed = true
			},
		})

		expect(Object.keys(boundary).sort()).toEqual(['dispose', 'status'])
		for (const monetaryMethod of ['send', 'receive', 'mint', 'melt', 'wallet', 'keyring', 'saveProofs', 'deleteProofs']) {
			expect(monetaryMethod in boundary).toBe(false)
		}
		expect(await boundary.status()).toEqual({
			namespace,
			authorityGeneration: 3,
			proofCount: 0,
			operationCount: 0,
			lifecycle: 'initialized',
		})

		await boundary.dispose()
		await boundary.dispose()
		expect(disposed).toBe(true)
		await expect(boundary.status()).rejects.toMatchObject({ code: 'SHADOW_DISPOSED' })
	})

	test('28: strips undeclared diagnostic fields instead of exposing bearer-shaped data', async () => {
		const raw = {
			namespace,
			authorityGeneration: null,
			proofCount: 0,
			operationCount: 0,
			lifecycle: 'initialized' as const,
			proof: 'not-public',
			token: 'not-public',
			secret: 'not-public',
			witness: 'not-public',
			privateKey: 'not-public',
		}
		const boundary = createCocoShadowBoundary({
			readStatus: async () => raw as CocoShadowStatus,
			dispose: async () => undefined,
		})
		const status = await boundary.status()
		expect(Object.keys(status).sort()).toEqual(['authorityGeneration', 'lifecycle', 'namespace', 'operationCount', 'proofCount'])
		expect(JSON.stringify(status)).not.toContain('not-public')
	})

	test('malformed diagnostics fail with a deterministic domain error', async () => {
		const boundary = createCocoShadowBoundary({
			readStatus: async () => ({ namespace, proofCount: -1 }) as unknown as CocoShadowStatus,
			dispose: async () => undefined,
		})
		try {
			await boundary.status()
			throw new Error('expected status to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(CocoHostError)
			expect((error as CocoHostError).code).toBe('SHADOW_BOUNDARY_INVALID')
		}
	})

	test('a failed dispose remains retryable and does not falsely report disposal', async () => {
		let attempts = 0
		const boundary = createCocoShadowBoundary({
			readStatus: async () => ({
				namespace,
				authorityGeneration: 1,
				proofCount: 0,
				operationCount: 0,
				lifecycle: 'initialized',
			}),
			dispose: async () => {
				attempts += 1
				if (attempts === 1) throw new Error('controlled dispose failure')
			},
		})

		await expect(boundary.dispose()).rejects.toThrow('controlled dispose failure')
		expect((await boundary.status()).lifecycle).toBe('initialized')
		await boundary.dispose()
		expect(attempts).toBe(2)
	})
})
