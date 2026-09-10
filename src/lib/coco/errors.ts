export type CocoHostErrorCode =
	| 'INVALID_NAMESPACE_IDENTITY'
	| 'INVALID_BUCKET_IDENTITY'
	| 'INVALID_TRANSITION'
	| 'STALE_REVISION'
	| 'WRONG_EPOCH'
	| 'BUCKET_OWNERSHIP_MISMATCH'
	| 'ACCOUNTING_INPUT_INVALID'
	| 'INVALID_QUARANTINE_TRANSITION'
	| 'COORDINATOR_RECORD_EXISTS'
	| 'COORDINATOR_RECORD_NOT_FOUND'
	| 'COORDINATOR_STORAGE_FAILURE'
	| 'SHADOW_BOUNDARY_INVALID'
	| 'SHADOW_DISPOSING'
	| 'SHADOW_DISPOSED'
	| 'SHADOW_DISPOSE_FAILED'

export class CocoHostError extends Error {
	constructor(
		readonly code: CocoHostErrorCode,
		message: string,
	) {
		super(message)
		this.name = 'CocoHostError'
	}
}

export function fail(code: CocoHostErrorCode, message: string): never {
	throw new CocoHostError(code, message)
}

export function captureObject(
	value: unknown,
	allowedFields: readonly string[],
	code: CocoHostErrorCode,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} must be an object`)

	try {
		const keys = Reflect.ownKeys(value)
		if (keys.some((key) => typeof key !== 'string' || !allowedFields.includes(key))) {
			fail(code, `${label} contains undeclared fields`)
		}
		const captured: Record<string, unknown> = Object.create(null)
		for (const field of allowedFields) {
			const descriptor = Reflect.getOwnPropertyDescriptor(value, field)
			if (!descriptor) {
				captured[field] = undefined
				continue
			}
			if ('get' in descriptor || 'set' in descriptor) fail(code, `${label} accessor fields are not accepted`)
			captured[field] = descriptor.value
		}
		return Object.freeze(captured)
	} catch (error) {
		if (error instanceof CocoHostError) throw error
		fail(code, `${label} could not be read safely`)
	}
}

export function captureArray(value: unknown, code: CocoHostErrorCode, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(code, `${label} must be an array`)
	try {
		const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length')
		const rawLength = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined
		if (typeof rawLength !== 'number' || !Number.isSafeInteger(rawLength) || rawLength < 0 || rawLength > 100_000) {
			fail(code, `${label} length is invalid`)
		}
		const length = rawLength
		const captured: unknown[] = []
		for (let index = 0; index < length; index += 1) {
			const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index))
			if (!descriptor || !('value' in descriptor)) fail(code, `${label} must contain only owned data elements`)
			captured.push(descriptor.value)
		}
		return Object.freeze(captured)
	} catch (error) {
		if (error instanceof CocoHostError) throw error
		fail(code, `${label} could not be read safely`)
	}
}
