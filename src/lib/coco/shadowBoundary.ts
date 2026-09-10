import { captureObject, fail } from './errors'
import { parseCocoWalletNamespace } from './namespace'

export interface CocoShadowStatus {
	namespace: string
	authorityGeneration: number | null
	proofCount: number
	operationCount: number
	lifecycle: 'initialized' | 'disposed'
}

export interface CocoShadowBoundary {
	status(): Promise<Readonly<CocoShadowStatus>>
	dispose(): Promise<void>
}

export interface CocoShadowLifecyclePort {
	readStatus(): Promise<unknown>
	dispose(): Promise<void>
}

function requireCount(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		fail('SHADOW_BOUNDARY_INVALID', `${field} must be a non-negative safe integer`)
	}
	return value as number
}

function snapshotStatus(value: unknown): Readonly<CocoShadowStatus> {
	const captured = captureObject(
		value,
		['namespace', 'authorityGeneration', 'proofCount', 'operationCount', 'lifecycle'],
		'SHADOW_BOUNDARY_INVALID',
		'Shadow status',
	)
	const authorityGeneration =
		captured.authorityGeneration === null ? null : requireCount(captured.authorityGeneration, 'authorityGeneration')
	if (captured.lifecycle !== 'initialized' && captured.lifecycle !== 'disposed') {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow lifecycle is invalid')
	}
	return Object.freeze({
		namespace: parseCocoWalletNamespace(captured.namespace).namespace,
		authorityGeneration,
		proofCount: requireCount(captured.proofCount, 'proofCount'),
		operationCount: requireCount(captured.operationCount, 'operationCount'),
		lifecycle: captured.lifecycle,
	})
}

export function createCocoShadowBoundary(port: CocoShadowLifecyclePort): CocoShadowBoundary {
	const capturedPort = captureObject(port, ['readStatus', 'dispose'], 'SHADOW_BOUNDARY_INVALID', 'Shadow lifecycle port')
	if (typeof capturedPort.readStatus !== 'function' || typeof capturedPort.dispose !== 'function') {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow lifecycle port is invalid')
	}
	const readStatus = capturedPort.readStatus as () => Promise<unknown>
	const disposePort = capturedPort.dispose as () => Promise<void>
	let state: 'active' | 'disposing' | 'disposed' = 'active'
	let disposePromise: Promise<void> | null = null

	return Object.freeze({
		status: async (): Promise<Readonly<CocoShadowStatus>> => {
			if (state === 'disposing') fail('SHADOW_DISPOSING', 'Coco shadow boundary is disposing')
			if (state === 'disposed') fail('SHADOW_DISPOSED', 'Coco shadow boundary has been disposed')
			let backingStatus: unknown
			try {
				backingStatus = await readStatus.call(port)
			} catch {
				fail('SHADOW_BOUNDARY_INVALID', 'Shadow status read failed')
			}
			return snapshotStatus(backingStatus)
		},
		dispose: async (): Promise<void> => {
			if (state === 'disposed') return
			if (!disposePromise) {
				state = 'disposing'
				disposePromise = Promise.resolve()
					.then(() => disposePort.call(port))
					.then(() => {
						state = 'disposed'
					})
					.catch(() => {
						state = 'active'
						fail('SHADOW_DISPOSE_FAILED', 'Coco shadow disposal failed')
					})
					.finally(() => {
						disposePromise = null
					})
			}
			await disposePromise
		},
	})
}
