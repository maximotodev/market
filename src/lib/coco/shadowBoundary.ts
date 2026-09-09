import { fail } from './errors'
import { isCocoG9aNamespace } from './namespace'

export interface CocoShadowStatus {
	namespace: string
	authorityGeneration: number | null
	proofCount: number
	operationCount: number
	lifecycle: 'initialized' | 'disposed'
}

export interface CocoShadowBoundary {
	status(): Promise<CocoShadowStatus>
	dispose(): Promise<void>
}

export interface CocoShadowLifecyclePort {
	readStatus(): Promise<CocoShadowStatus>
	dispose(): Promise<void>
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		fail('SHADOW_BOUNDARY_INVALID', `${field} must be a non-negative safe integer`)
	}
}

function validateStatus(value: unknown): CocoShadowStatus {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow status must be an object')
	}
	const status = value as Partial<CocoShadowStatus>
	if (!isCocoG9aNamespace(status.namespace)) {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow status contains an invalid namespace')
	}
	if (status.authorityGeneration !== null) {
		assertNonNegativeInteger(status.authorityGeneration, 'authorityGeneration')
	}
	assertNonNegativeInteger(status.proofCount, 'proofCount')
	assertNonNegativeInteger(status.operationCount, 'operationCount')
	if (status.lifecycle !== 'initialized' && status.lifecycle !== 'disposed') {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow lifecycle is invalid')
	}
	return Object.freeze({
		namespace: status.namespace,
		authorityGeneration: status.authorityGeneration,
		proofCount: status.proofCount,
		operationCount: status.operationCount,
		lifecycle: status.lifecycle,
	}) as CocoShadowStatus
}

export function createCocoShadowBoundary(port: CocoShadowLifecyclePort): CocoShadowBoundary {
	if (!port || typeof port !== 'object' || typeof port.readStatus !== 'function' || typeof port.dispose !== 'function') {
		fail('SHADOW_BOUNDARY_INVALID', 'Shadow lifecycle port is invalid')
	}
	let disposed = false
	let disposePromise: Promise<void> | null = null
	return Object.freeze({
		status: async (): Promise<CocoShadowStatus> => {
			if (disposed) fail('SHADOW_DISPOSED', 'Coco shadow boundary has been disposed')
			return validateStatus(await port.readStatus())
		},
		dispose: async (): Promise<void> => {
			if (disposed) return
			if (!disposePromise) {
				disposePromise = port
					.dispose()
					.then(() => {
						disposed = true
					})
					.finally(() => {
						if (!disposed) disposePromise = null
					})
			}
			await disposePromise
		},
	})
}
