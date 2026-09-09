export type CocoHostErrorCode =
	| 'INVALID_NAMESPACE_IDENTITY'
	| 'INVALID_BUCKET_IDENTITY'
	| 'INVALID_TRANSITION'
	| 'STALE_REVISION'
	| 'WRONG_EPOCH'
	| 'DUAL_WRITER_ATTEMPT'
	| 'BUCKET_OWNERSHIP_MISMATCH'
	| 'ACCOUNTING_INPUT_INVALID'
	| 'INVALID_QUARANTINE_TRANSITION'
	| 'COORDINATOR_RECORD_EXISTS'
	| 'COORDINATOR_RECORD_NOT_FOUND'
	| 'SHADOW_BOUNDARY_INVALID'
	| 'SHADOW_DISPOSED'

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
