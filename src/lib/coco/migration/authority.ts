import type { CocoG9aEnvironment } from '../namespace'
import type { MigrationPhase, MonetaryOwner } from './types'

export interface AuthorityVersion {
	migrationEpoch: string
	revision: number
}

export interface AuthorityStatus extends AuthorityVersion {
	walletKey: string
	user: string
	environment: CocoG9aEnvironment
	phase: MigrationPhase
}

export interface MonetaryPermissionProjection extends AuthorityStatus {
	bucketKey: string
	owner: MonetaryOwner
	capabilities: Readonly<{
		legacyOrdinary: boolean
		legacyRecovery: boolean
		cocoMigration: boolean
		cocoOrdinary: boolean
		shadowDiagnostics: boolean
	}>
}
