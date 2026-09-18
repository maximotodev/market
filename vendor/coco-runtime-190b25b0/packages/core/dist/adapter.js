import { C as operationHistoryId, F as deserializeBlindedSignatures, G as serializeBlindedSignatures, I as deserializeOutput, J as stringifyJson, K as serializeOutput, L as deserializeOutputData, P as deserializeAmount, R as deserializeToken, T as projectLegacyHistoryRow, U as normalizeMintUrl, V as getSecretsFromSerializedOutputData, W as serializeAmount, Z as DEFAULT_UNIT, a as deriveBolt11MintQuoteState, bt as QuoteIdentityConflictError, c as getMintQuoteRemoteState, ct as DerivationIndexExhaustedError, i as applyBolt11MintQuoteStateFallback, l as isMintQuotePending, n as RepositoryTransactionConflictError, o as getMintQuoteAmount, q as serializeOutputData, r as normalizeMeltMethodData, t as parseMintSwapOperation, tt as normalizeUnit, u as isStatefulMintQuote, w as parseHistoryEntryId, y as compareHistoryEntries } from "./parseMintSwapOperation-D_P2P6Z6.js";

//#region operations/mintSwap/validateMintSwapTransition.ts
/** Legal state changes; same-state metadata writes are validated separately. */
const TRANSITIONS = {
	preparing: [
		"prepared",
		"cancelled",
		"failed",
		"needs_attention"
	],
	prepared: [
		"source_pending",
		"cancelled",
		"failed",
		"needs_attention"
	],
	source_pending: [
		"destination_funded",
		"cancelled",
		"failed",
		"needs_attention"
	],
	destination_funded: ["destination_pending", "needs_attention"],
	destination_pending: ["completed", "needs_attention"],
	completed: [],
	cancelled: [],
	failed: [],
	needs_attention: []
};
/** Parent identity and caller intent that no transition may replace or remove. */
const IMMUTABLE_FIELDS = [
	"schemaVersion",
	"id",
	"sourceMintUrl",
	"destinationMintUrl",
	"unit",
	"destinationAmount",
	"sourceDebitCap",
	"sourceQuote",
	"destinationQuote",
	"sourceOperationId",
	"destinationOperationId",
	"paymentRequestHash",
	"createdAt"
];
/** Economic progress facts that remain fixed after their first persisted state. */
const PROGRESS_FIELDS = [
	"sourceDebitBounds",
	"sourceStartedAt",
	"sourceSettlement",
	"destinationStartedAt"
];
/** Reject a transition invariant without including persisted values in the diagnostic. */
function check(condition, field) {
	if (!condition) throw new TypeError(`Invalid Mint Swap transition: ${field}`);
}
/** Compare canonical parser output, including nested Amount values and quote references. */
function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** Return whether caller cancellation intent may still be recorded in this state. */
function canRequestCancellation(state) {
	return state === "preparing" || state === "prepared" || state === "source_pending";
}
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
function validateMintSwapTransition(previous, next) {
	const before = parseMintSwapOperation(previous);
	const after = parseMintSwapOperation(next);
	check(TRANSITIONS[before.state].length > 0, "quiescent state");
	const sameState = before.state === after.state;
	check(sameState || TRANSITIONS[before.state].includes(after.state), "state progression");
	check(after.revision === before.revision + 1, "revision progression");
	check(after.updatedAt >= before.updatedAt, "update time");
	check(after.stateEnteredAt === (sameState ? before.stateEnteredAt : after.updatedAt), "state entry time");
	for (const field of IMMUTABLE_FIELDS) check(same(before[field], after[field]), "immutable identity or intent");
	const progress = after.lastSafe ?? after;
	for (const field of PROGRESS_FIELDS) if (before[field] !== void 0) check(same(before[field], progress[field]), "established facts");
	if (after.lastSafe !== void 0) {
		check(after.lastSafe.state === before.state, "last safe state");
		check(after.lastSafe.stateEnteredAt === before.stateEnteredAt, "last safe entry time");
	}
	if (before.cancellationRequestedAt !== void 0) check(after.cancellationRequestedAt === before.cancellationRequestedAt, "write-once cancellation");
	else if (after.cancellationRequestedAt !== void 0) {
		check(canRequestCancellation(before.state) && canRequestCancellation(after.state), "cancellation state");
		check(after.cancellationRequestedAt >= before.updatedAt, "cancellation request time");
	}
	if (sameState) if (after.retry.attemptCount === before.retry.attemptCount) {
		check(after.retry.lastAttemptAt === before.retry.lastAttemptAt, "retry attempt without count");
		check(same(after.retry.lastError, before.retry.lastError), "retry evidence without count");
	} else {
		check(after.retry.attemptCount === before.retry.attemptCount + 1, "retry count progression");
		check(after.retry.lastAttemptAt !== null && after.retry.lastAttemptAt >= before.updatedAt && (before.retry.lastAttemptAt === null || after.retry.lastAttemptAt > before.retry.lastAttemptAt), "new retry attempt time");
		check(after.retry.lastError !== null && after.retry.lastError.at >= before.updatedAt && (before.retry.lastError === null || after.retry.lastError.at > before.retry.lastError.at), "new retry evidence");
	}
	else check(after.retry.attemptCount === 0, "retry reset");
	const observation = after.sourceSettlement?.sourcePaidObservedAt;
	if (before.sourceSettlement === void 0 && observation !== void 0) check(observation >= before.updatedAt, "new settlement observation time");
	const verifiedAt = after.destinationCompletion?.proofsVerifiedAt ?? after.valueNeutral?.verifiedAt;
	if (verifiedAt !== void 0) check(verifiedAt >= before.updatedAt, "new verification time");
	if (after.attention !== void 0) check(after.attention.evidence.observedAt >= before.updatedAt, "new attention observation time");
}

//#endregion
export { DEFAULT_UNIT, DerivationIndexExhaustedError, QuoteIdentityConflictError, RepositoryTransactionConflictError, applyBolt11MintQuoteStateFallback, compareHistoryEntries, deriveBolt11MintQuoteState, deserializeAmount, deserializeBlindedSignatures, deserializeOutput, deserializeOutputData, deserializeToken, getMintQuoteAmount, getMintQuoteRemoteState, getSecretsFromSerializedOutputData, isMintQuotePending, isStatefulMintQuote, normalizeMeltMethodData, normalizeMintUrl, normalizeUnit, operationHistoryId, parseHistoryEntryId, parseMintSwapOperation, projectLegacyHistoryRow, serializeAmount, serializeBlindedSignatures, serializeOutput, serializeOutputData, stringifyJson, validateMintSwapTransition };