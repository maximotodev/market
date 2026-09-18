import { An as QuoteIdentity, At as PaymentRequestReceiveAttemptState, C as HistoryEntry, Dr as Keypair, E as LegacyHistoryRowInput, Hr as SendMethod, Ii as ProofState, Ir as SendOperation, J as operationHistoryId, Jn as MintMethodData, Kn as MintMethod, Lr as SendOperationState, Mn as MeltQuote, Nt as PaymentRequestReceiveState, Oi as BalanceQuery, On as MeltQuoteRef, Or as KeypairPurpose, Pi as CoreProof, Pt as PaymentRequestReceiveTransport, Qn as MintMethodRemoteState, Ri as AuthSession, S as RepositoryTransactionConflictError, Si as stringifyJson, Sr as MintOperationState, T as LegacyHistoryEntry, Ur as SendMethodData, Ut as ReceiveOperationState, Vt as ReceiveOperation, W as compareHistoryEntries, Wr as DEFAULT_UNIT, X as projectLegacyHistoryRow, Xr as normalizeUnit, Y as parseHistoryEntryId, _ as ReceiveOperationRepository, _i as normalizeMintUrl, a as KeyRingRepository, ar as applyBolt11MintQuoteStateFallback, b as SendOperationRepository, bi as serializeOutput, br as MintOperation, c as MeltOperationRepository, ci as SerializedOutputData, ct as MeltOperationState, d as MintQuoteRepository, di as deserializeAmount, dr as isStatefulMintQuote, f as MintRepository, fi as deserializeBlindedSignatures, g as ProofUnitFilter, gi as getSecretsFromSerializedOutputData, gt as MeltMethodInputData, h as ProofRepository, hi as deserializeToken, ht as MeltMethodData, i as HistoryRepository, jt as PaymentRequestReceiveOperation, kn as MintQuoteRef, kt as PaymentRequestReceiveAttempt, l as MeltQuoteRepository, li as StoredBlindedMessage, lr as getMintQuoteRemoteState, m as PaymentRequestReceiveOperationRepository, mi as deserializeOutputData, mt as MeltMethod, n as CounterRepository, nr as MintQuote, o as KeysetRepository, oi as Counter, on as DerivationIndexExhaustedError, or as deriveBolt11MintQuoteState, p as PaymentRequestReceiveAttemptRepository, pi as deserializeOutput, r as HistoryProjectionRepository, ri as Mint, s as LegacyMintQuoteRepository, si as SerializedOutput, sr as getMintQuoteAmount, st as MeltOperation, t as AuthSessionRepository, ti as Keyset, u as MintOperationRepository, ui as StoredBlindedSignature, ur as isMintQuotePending, v as Repositories, vi as serializeAmount, vn as QuoteIdentityConflictError, vt as MeltMethodRemoteState, w as HistoryType, xi as serializeOutputData, y as RepositoryTransactionScope, yi as serializeBlindedSignatures, yt as normalizeMeltMethodData } from "./index-CbuugzL4.js";
import { f as MintSwapOperation, p as MintSwapOperationState, t as parseMintSwapOperation } from "./parseMintSwapOperation-tfoIBeTU.js";

//#region operations/mintSwap/MintSwapOperationRepository.d.ts
/**
 * Feature-owned persistence; ordinary Coco repository bags do not require this capability.
 * #417 binds this same contract to the active Wallet transaction's physical handle and lifetime.
 * A scoped handle must share parent/child/proof commit and rollback, including parent revisions.
 */
interface MintSwapPersistence {
  operationRepository: MintSwapOperationRepository;
}
interface MintSwapOperationRepository {
  /** Parse and create at revision zero; all five identities stay unique for all time. */
  create(operation: MintSwapOperation): Promise<void>;
  /** Hydrate through the parser and return an independent snapshot. */
  getById(id: string): Promise<MintSwapOperation | null>;
  /**
   * Atomically match ID/state/revision. A missing row or stale guard returns false without mutation.
   * On a match, assign expectedRevision + 1 regardless of next.revision, then parse and validate
   * immutable facts and the transition. Invalid candidates throw without mutation.
   */
  transition(command: {
    operationId: string;
    expectedState: MintSwapOperationState;
    expectedRevision: number;
    next: MintSwapOperation;
  }): Promise<boolean>;
  /** All nonterminal records, including prepared and needs_attention; order by createdAt, then ID. */
  listActive(): Promise<MintSwapOperation[]>;
  /** Automatic states due at/before now; order by nextAttemptAt, createdAt, then ID. Limit 0 is a no-op. */
  listDue(now: number, limit: number): Promise<MintSwapOperation[]>;
}
//#endregion
//#region operations/mintSwap/validateMintSwapTransition.d.ts
/**
 * Validate one persistence-stamped Mint Swap state change or same-state metadata write.
 *
 * Both records first cross the parser boundary. The transition then preserves immutable intent and
 * established economic facts, enforces legal state movement, monotonic timestamps and evidence,
 * write-once cancellation intent, and retry reset or progression rules. Terminal and attention
 * states are quiescent and cannot be updated.
 *
 * The repository must first match the current state/revision and assign current revision + 1.
 * Local timestamps must be clamped by the writer against the previous persisted update time.
 *
 * @throws {TypeError} When either record is invalid or the transition violates a parent invariant.
 */
declare function validateMintSwapTransition(previous: MintSwapOperation, next: MintSwapOperation): void;
//#endregion
export { type AuthSession, type AuthSessionRepository, type BalanceQuery, type CoreProof, type Counter, type CounterRepository, DEFAULT_UNIT, DerivationIndexExhaustedError, type HistoryEntry, type HistoryProjectionRepository, type HistoryRepository, type HistoryType, type KeyRingRepository, type Keypair, type KeypairPurpose, type Keyset, type KeysetRepository, type LegacyHistoryEntry, type LegacyHistoryRowInput, type LegacyMintQuoteRepository, type MeltMethod, type MeltMethodData, type MeltMethodInputData, type MeltMethodRemoteState, type MeltOperation, type MeltOperationRepository, type MeltOperationState, type MeltQuote, type MeltQuoteRef, type MeltQuoteRepository, type Mint, type MintMethod, type MintMethodData, type MintMethodRemoteState, type MintOperation, type MintOperationRepository, type MintOperationState, type MintQuote, type MintQuoteRef, type MintQuoteRepository, type MintRepository, type MintSwapOperation, type MintSwapOperationRepository, type MintSwapOperationState, type MintSwapPersistence, type PaymentRequestReceiveAttempt, type PaymentRequestReceiveAttemptRepository, type PaymentRequestReceiveAttemptState, type PaymentRequestReceiveOperation, type PaymentRequestReceiveOperationRepository, type PaymentRequestReceiveState, type PaymentRequestReceiveTransport, type ProofRepository, type ProofState, type ProofUnitFilter, type QuoteIdentity, QuoteIdentityConflictError, type ReceiveOperation, type ReceiveOperationRepository, type ReceiveOperationState, type Repositories, RepositoryTransactionConflictError, type RepositoryTransactionScope, type SendMethod, type SendMethodData, type SendOperation, type SendOperationRepository, type SendOperationState, type SerializedOutput, type SerializedOutputData, type StoredBlindedMessage, type StoredBlindedSignature, applyBolt11MintQuoteStateFallback, compareHistoryEntries, deriveBolt11MintQuoteState, deserializeAmount, deserializeBlindedSignatures, deserializeOutput, deserializeOutputData, deserializeToken, getMintQuoteAmount, getMintQuoteRemoteState, getSecretsFromSerializedOutputData, isMintQuotePending, isStatefulMintQuote, normalizeMeltMethodData, normalizeMintUrl, normalizeUnit, operationHistoryId, parseHistoryEntryId, parseMintSwapOperation, projectLegacyHistoryRow, serializeAmount, serializeBlindedSignatures, serializeOutput, serializeOutputData, stringifyJson, validateMintSwapTransition };