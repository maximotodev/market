import { Amount, HttpResponseError, MintOperationError, NetworkError, OutputData, hashToCurve } from "@cashu/cashu-ts";
import { bytesToHex } from "@noble/hashes/utils.js";

//#region models/Error.ts
var UnknownMintError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "UnknownMintError";
	}
};
var MintFetchError = class extends Error {
	mintUrl;
	constructor(mintUrl, message, cause) {
		super(message ?? `Failed to fetch mint ${mintUrl}`);
		this.name = "MintFetchError";
		this.mintUrl = mintUrl;
		this.cause = cause;
	}
};
var KeysetSyncError = class extends Error {
	mintUrl;
	keysetId;
	constructor(mintUrl, keysetId, message, cause) {
		super(message ?? `Failed to sync keyset ${keysetId} for mint ${mintUrl}`);
		this.name = "KeysetSyncError";
		this.mintUrl = mintUrl;
		this.keysetId = keysetId;
		this.cause = cause;
	}
};
var ProofValidationError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ProofValidationError";
	}
};
var MintQuoteValidationError = class extends Error {
	constructor(message, cause) {
		super(message);
		this.name = "MintQuoteValidationError";
		this.cause = cause;
	}
};
var MintQuoteKeyError = class extends Error {
	constructor(message, cause) {
		super(message);
		this.name = "MintQuoteKeyError";
		this.cause = cause;
	}
};
var DerivationIndexExhaustedError = class extends Error {
	purpose;
	constructor(purpose) {
		super(`No derivation indexes remain for keypair purpose ${purpose}`);
		this.name = "DerivationIndexExhaustedError";
		this.purpose = purpose;
	}
};
var UnitValidationError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "UnitValidationError";
	}
};
var UnitMismatchError = class extends UnitValidationError {
	constructor(message) {
		super(message);
		this.name = "UnitMismatchError";
	}
};
var TokenValidationError = class extends Error {
	constructor(message, cause) {
		super(message);
		this.name = "TokenValidationError";
		this.cause = cause;
	}
};
var ProofOperationError = class extends Error {
	mintUrl;
	keysetId;
	constructor(mintUrl, message, keysetId, cause) {
		super(message ?? `Proof operation failed for mint ${mintUrl}${keysetId ? ` keyset ${keysetId}` : ""}`);
		this.name = "ProofOperationError";
		this.mintUrl = mintUrl;
		this.keysetId = keysetId;
		this.cause = cause;
	}
};
/**
* This error is thrown when a payment request is invalid or cannot be processed.
*/
var PaymentRequestError = class extends Error {
	constructor(message, cause) {
		super(message);
		this.name = "PaymentRequestError";
		this.cause = cause;
	}
};
/**
* This error is thrown when attempting to modify an operation that is already in progress.
*/
var OperationInProgressError = class extends Error {
	operationId;
	constructor(operationId) {
		super(`Operation ${operationId} is already in progress`);
		this.name = "OperationInProgressError";
		this.operationId = operationId;
	}
};
var SendOperationConflictError = class extends Error {
	operationId;
	constructor(operationId, message) {
		super(message ?? `Send operation ${operationId} changed concurrently`);
		this.name = "SendOperationConflictError";
		this.operationId = operationId;
	}
};
var AuthSessionError = class extends Error {
	mintUrl;
	constructor(mintUrl, message, cause) {
		super(message ?? `Auth session error for mint ${mintUrl}`);
		this.name = "AuthSessionError";
		this.mintUrl = mintUrl;
		this.cause = cause;
	}
};
var AuthSessionExpiredError = class extends AuthSessionError {
	constructor(mintUrl) {
		super(mintUrl, `Auth session expired for mint ${mintUrl}`);
		this.name = `AuthSessionExpiredError`;
	}
};
var QuoteIdentityConflictError = class extends Error {
	kind;
	mintUrl;
	quoteId;
	methods;
	constructor(kind, mintUrl, quoteId, methods, message) {
		super(message ?? `${kind} quote identity conflict for quote ${quoteId} at ${mintUrl}: methods ${methods.join(", ")}`);
		this.name = "QuoteIdentityConflictError";
		this.kind = kind;
		this.mintUrl = mintUrl;
		this.quoteId = quoteId;
		this.methods = [...methods];
	}
};

//#endregion
//#region amounts.ts
const DEFAULT_UNIT = "sat";
function isUnitAmountLikeObject(input) {
	return typeof input === "object" && input !== null && "amount" in input && "unit" in input;
}
function normalizeUnit(unit, options) {
	const rawUnit = unit === void 0 ? options?.defaultUnit : unit;
	if (typeof rawUnit !== "string") throw new UnitValidationError("Unit is required");
	const normalized = rawUnit.trim().toLowerCase();
	if (!normalized) throw new UnitValidationError("Unit cannot be empty");
	return normalized;
}
function normalizeUnitList(units) {
	if (units === void 0) return void 0;
	return Array.from(new Set(units.map((unit) => normalizeUnit(unit))));
}
function assertSameUnit(actual, expected, context) {
	const normalizedActual = normalizeUnit(actual);
	const normalizedExpected = normalizeUnit(expected);
	if (normalizedActual !== normalizedExpected) throw new UnitMismatchError(`${context ? `${context}: ` : ""}Unit mismatch: expected ${normalizedExpected}, received ${normalizedActual}`);
}
/**
* Parse ergonomic public-boundary amount input into canonical `UnitAmount`.
*
* Use this at API and hook boundaries only. Internal services, operations, and
* handlers should accept `UnitAmount` directly so amount+unit cannot be split or
* accidentally defaulted.
*/
function parseUnitAmount(input, options) {
	const isObjectInput = isUnitAmountLikeObject(input);
	const amountInput = isObjectInput ? input.amount : input;
	const unit = normalizeUnit(isObjectInput ? input.unit : options?.explicitUnit ?? options?.defaultUnit ?? DEFAULT_UNIT);
	if (options?.explicitUnit !== void 0) assertSameUnit(unit, options.explicitUnit, "Amount input");
	return {
		amount: Amount.from(amountInput),
		unit
	};
}
/**
* Normalize an already-coupled amount/unit value for internal service use.
*
* `parseUnitAmount()` is the public-boundary parser for ergonomic inputs. Internal
* service and operation layers should accept `UnitAmount` and use this helper only
* to canonicalize the `Amount` instance and lower-case the unit.
*/
function normalizeUnitAmount(value) {
	return {
		amount: Amount.from(value.amount),
		unit: normalizeUnit(value.unit)
	};
}
function assertUnitAmount(value, context = "Unit amount") {
	if (!value || typeof value !== "object") throw new UnitValidationError(`${context} is required`);
	if (!("amount" in value)) throw new UnitValidationError(`${context} amount is required`);
	if (!("unit" in value)) throw new UnitValidationError(`${context} unit is required`);
	return normalizeUnitAmount(value);
}
function sameUnitAmount(amount, expectedUnit, context) {
	const normalized = assertUnitAmount(amount, context ?? "Unit amount");
	assertSameUnit(normalized.unit, expectedUnit, context);
	return normalized;
}

//#endregion
//#region utils.ts
/**
* Convert a Uint8Array to hex string
*/
function uint8ArrayToHex(arr) {
	return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Convert a hex string to Uint8Array
*/
function hexToUint8Array(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	return bytes;
}
/**
* Serialize a single OutputData to JSON-safe format
*/
function serializeOutput(output) {
	return {
		blindedMessage: {
			amount: serializeAmount(output.blindedMessage.amount),
			id: output.blindedMessage.id,
			B_: output.blindedMessage.B_
		},
		blindingFactor: output.blindingFactor.toString(16),
		secret: uint8ArrayToHex(output.secret),
		...output.ephemeralE === void 0 ? {} : { ephemeralE: output.ephemeralE }
	};
}
/**
* Deserialize a single SerializedOutput back to OutputData
*/
function deserializeOutput(serialized) {
	return new OutputData({
		amount: deserializeAmount(serialized.blindedMessage.amount),
		id: serialized.blindedMessage.id,
		B_: serialized.blindedMessage.B_
	}, BigInt("0x" + serialized.blindingFactor), hexToUint8Array(serialized.secret), serialized.ephemeralE);
}
/**
* Serialize OutputData arrays for keep and send to JSON-safe format
*/
function serializeOutputData(data) {
	return {
		keep: data.keep.map(serializeOutput),
		send: data.send.map(serializeOutput)
	};
}
/**
* Deserialize SerializedOutputData back to OutputData arrays
*/
function deserializeOutputData(serialized) {
	return {
		keep: serialized.keep.map(deserializeOutput),
		send: serialized.send.map(deserializeOutput)
	};
}
/**
* Decode a hex-encoded secret to its string representation (matching proof.secret)
*/
function decodeSecretHex(hexSecret) {
	const bytes = hexToUint8Array(hexSecret);
	return new TextDecoder().decode(bytes);
}
/**
* Extract secrets from serialized output data.
* Returns the string form of secrets (matching proof.secret in Proof objects).
*/
function getSecretsFromSerializedOutputData(serialized) {
	return {
		keepSecrets: serialized.keep.map((o) => decodeSecretHex(o.secret)),
		sendSecrets: serialized.send.map((o) => decodeSecretHex(o.secret))
	};
}
function getProofStateInputsFromSerializedOutputs(outputs) {
	return outputs.map((output) => ({
		id: output.blindedMessage.id,
		secret: decodeSecretHex(output.secret)
	}));
}
function mapProofToCoreProof(mintUrl, state, proofs, options) {
	const unit = normalizeUnit(options.unit);
	return proofs.map((p) => ({
		...p,
		mintUrl,
		unit,
		state,
		createdByOperationId: options?.createdByOperationId
	}));
}
function toAmount(value) {
	return Amount.from(value);
}
function sumAmounts(values) {
	return Amount.sum(values);
}
function serializeAmount(value) {
	return Amount.from(value).toString();
}
function stringifyJson(value) {
	const json = JSON.stringify(value, (_key, value) => typeof value === "bigint" ? value.toString() : value);
	if (json === void 0) throw new TypeError("Value cannot be serialized to JSON");
	return json;
}
function deserializeAmount(value) {
	return Amount.from(value);
}
function deserializeStoredAmount(value) {
	if (value instanceof Amount || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return deserializeAmount(value);
	if (value && typeof value === "object" && "value" in value) {
		const legacyValue = value.value;
		if (typeof legacyValue === "string" || typeof legacyValue === "number" || typeof legacyValue === "bigint") return deserializeAmount(legacyValue);
	}
	throw new TypeError("Stored amount is invalid");
}
/**
* Convert blinded signatures to a repository-safe form.
*/
function serializeBlindedSignatures(signatures) {
	return signatures?.map((signature) => ({
		...signature,
		amount: serializeAmount(signature.amount)
	}));
}
/**
* Restore blinded signature Amount instances after repository hydration.
*/
function deserializeBlindedSignatures(value) {
	if (value === void 0 || value === null) return;
	if (!Array.isArray(value)) throw new TypeError("Stored blinded signatures must be an array");
	return value.map((signature, index) => {
		if (!signature || typeof signature !== "object" || !("amount" in signature)) throw new TypeError(`Stored blinded signature ${index} is invalid`);
		return {
			...signature,
			amount: deserializeStoredAmount(signature.amount)
		};
	});
}
function deserializeToken(value) {
	if (!value || typeof value !== "object") return void 0;
	const token = value;
	return {
		...token,
		proofs: Array.isArray(token.proofs) ? token.proofs.map((proof) => ({
			...proof,
			amount: deserializeAmount(proof.amount)
		})) : []
	};
}
function assertNonNegativeInteger(paramName, value, logger) {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		logger?.warn("Invalid numeric value", { [paramName]: value });
		throw new Error(`${paramName} must be a non-negative integer`);
	}
}
function toBase64Url(bytes) {
	let base64;
	const Buf = globalThis.Buffer;
	if (typeof Buf !== "undefined") base64 = Buf.from(bytes).toString("base64");
	else if (typeof btoa !== "undefined") {
		let bin = "";
		for (const b of bytes) bin += String.fromCharCode(b);
		base64 = btoa(bin);
	}
	if (!base64) return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateSubId() {
	const length = 16;
	const bytes = new Uint8Array(length);
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.getRandomValues === "function") cryptoObj.getRandomValues(bytes);
	else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return toBase64Url(bytes);
}
/**
* Compute the Y point (hex, compressed) for a single secret using hash-to-curve.
*/
function computeYHexForSecrets(secrets) {
	const encoder = new TextEncoder();
	return secrets.map((secret) => hashToCurve(encoder.encode(secret)).toHex(true));
}
/**
* Build bidirectional maps between secrets and their Y points (hex) using hash-to-curve.
* - yHexBySecret: secret -> Y hex
* - secretByYHex: Y hex -> secret
*/
function buildYHexMapsForSecrets(secrets) {
	const yHexBySecret = /* @__PURE__ */ new Map();
	const secretByYHex = /* @__PURE__ */ new Map();
	const yHexes = computeYHexForSecrets(secrets);
	for (let i = 0; i < secrets.length; i++) {
		const secret = secrets[i];
		const yHex = yHexes[i];
		if (!secret || !yHex) continue;
		yHexBySecret.set(secret, yHex);
		secretByYHex.set(yHex, secret);
	}
	return {
		yHexBySecret,
		secretByYHex
	};
}
/**
* Normalize a mint URL to prevent duplicates from variations like:
* - Trailing slashes: https://mint.com/ -> https://mint.com
* - Case differences in hostname: https://MINT.com -> https://mint.com
* - Default ports: https://mint.com:443 -> https://mint.com
* - Redundant path segments: https://mint.com/./path -> https://mint.com/path
*/
function normalizeMintUrl(mintUrl) {
	const url = new URL(mintUrl);
	if (url.protocol === "https:" && url.port === "443" || url.protocol === "http:" && url.port === "80") url.port = "";
	let normalized = `${url.protocol}//${url.host}${url.pathname}`;
	if (normalized.endsWith("/") && url.pathname !== "/") normalized = normalized.slice(0, -1);
	else if (url.pathname === "/") normalized = `${url.protocol}//${url.host}`;
	return normalized;
}

//#endregion
//#region models/History.ts
function isOperationHistoryEntry(entry) {
	return entry.source === "operation";
}
function isLegacyHistoryEntry(entry) {
	return entry.source === "legacy";
}
function operationHistoryId(type, operationId) {
	return `${type}:${operationId}`;
}
function legacyHistoryId(legacyId) {
	return `legacy:${legacyId}`;
}
function parseHistoryEntryId(id) {
	if (id.startsWith("legacy:")) {
		const legacyId = id.slice(7);
		return legacyId ? {
			source: "legacy",
			legacyHistoryId: legacyId
		} : null;
	}
	const separator = id.indexOf(":");
	if (separator === -1) return null;
	const type = id.slice(0, separator);
	const operationId = id.slice(separator + 1);
	if (!operationId || !isHistoryType(type)) return null;
	return {
		source: "operation",
		type,
		operationId
	};
}
function compareHistoryEntries(a, b) {
	if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
	return b.id.localeCompare(a.id);
}
function projectSendOperation(operation) {
	if (operation.state === "init") return null;
	const prepared = operation;
	const token = "token" in prepared ? prepared.token : void 0;
	return {
		id: operationHistoryId("send", prepared.id),
		source: "operation",
		type: "send",
		createdAt: prepared.createdAt,
		updatedAt: prepared.updatedAt,
		mintUrl: prepared.mintUrl,
		unit: prepared.unit,
		operationId: prepared.id,
		amount: prepared.amount,
		state: prepared.state,
		...prepared.error ? { error: prepared.error } : {},
		...token ? { token } : {}
	};
}
function projectMeltOperation(operation) {
	if (operation.state === "init" || operation.state === "failed") return null;
	const prepared = operation;
	return {
		id: operationHistoryId("melt", prepared.id),
		source: "operation",
		type: "melt",
		createdAt: prepared.createdAt,
		updatedAt: prepared.updatedAt,
		mintUrl: prepared.mintUrl,
		unit: prepared.unit || "sat",
		operationId: prepared.id,
		quoteId: prepared.quoteId,
		amount: prepared.amount,
		state: prepared.state,
		...prepared.error ? { error: prepared.error } : {}
	};
}
function projectMintOperation(operation) {
	if (operation.state === "init") return null;
	const pending = operation;
	return {
		id: operationHistoryId("mint", pending.id),
		source: "operation",
		type: "mint",
		createdAt: pending.createdAt,
		updatedAt: pending.updatedAt,
		mintUrl: pending.mintUrl,
		unit: pending.unit,
		operationId: pending.id,
		quoteId: pending.quoteId,
		paymentRequest: pending.request,
		amount: pending.amount,
		state: pending.state,
		...pending.error ? { error: pending.error } : {}
	};
}
function projectReceiveOperation(operation) {
	if (operation.state !== "finalized" && operation.state !== "rolled_back") return null;
	const metadata = getReceiveOperationMetadata(operation);
	const token = operation.state === "finalized" ? {
		mint: operation.mintUrl,
		proofs: operation.inputProofs,
		unit: operation.unit || "sat"
	} : void 0;
	return {
		id: operationHistoryId("receive", operation.id),
		source: "operation",
		type: "receive",
		createdAt: operation.createdAt,
		updatedAt: operation.updatedAt,
		mintUrl: operation.mintUrl,
		unit: operation.unit || "sat",
		operationId: operation.id,
		amount: operation.amount,
		state: operation.state,
		...metadata ? { metadata } : {},
		...operation.error ? { error: operation.error } : {},
		...token ? { token } : {}
	};
}
function getReceiveOperationMetadata(operation) {
	if (operation.source?.type !== "payment-request") return;
	return {
		source: "payment-request",
		requestOperationId: operation.source.requestOperationId,
		attemptId: operation.source.attemptId,
		...operation.source.requestId ? { requestId: operation.source.requestId } : {},
		transport: operation.source.transport,
		...operation.source.transportMessageId ? { transportMessageId: operation.source.transportMessageId } : {},
		...operation.source.senderPubkey ? { senderPubkey: operation.source.senderPubkey } : {},
		...operation.source.memo ? { memo: operation.source.memo } : {}
	};
}
function projectOperationToHistoryEntry(type, operation) {
	switch (type) {
		case "send": return projectSendOperation(operation);
		case "melt": return projectMeltOperation(operation);
		case "mint": return projectMintOperation(operation);
		case "receive": return projectReceiveOperation(operation);
	}
}
function projectLegacyHistoryRow(row) {
	const base = {
		id: legacyHistoryId(row.legacyHistoryId),
		source: "legacy",
		legacyHistoryId: String(row.legacyHistoryId),
		type: row.type,
		createdAt: row.createdAt,
		updatedAt: row.createdAt,
		mintUrl: row.mintUrl,
		unit: row.unit,
		amount: row.amount,
		...row.metadata ? { metadata: row.metadata } : {},
		...row.operationId ? { operationId: row.operationId } : {}
	};
	switch (row.type) {
		case "mint": return {
			...base,
			type: "mint",
			quoteId: row.quoteId ?? "",
			paymentRequest: row.paymentRequest ?? "",
			state: row.state ?? "UNPAID"
		};
		case "melt": return {
			...base,
			type: "melt",
			quoteId: row.quoteId ?? "",
			state: row.state ?? "UNPAID"
		};
		case "send": return {
			...base,
			type: "send",
			state: row.state ?? "pending",
			...row.token ? { token: row.token } : {}
		};
		case "receive": return {
			...base,
			type: "receive",
			state: row.state ?? "finalized",
			...row.token ? { token: row.token } : {}
		};
	}
}
function isHistoryType(value) {
	return value === "mint" || value === "melt" || value === "send" || value === "receive";
}

//#endregion
//#region models/MintQuoteObservationFactory.ts
/** Maps a normalized BOLT11 response without enforcing canonical accounting invariants. */
function mintQuoteObservationFromBolt11Response(mintUrl, quote, options) {
	const now = options?.now ?? Date.now();
	const amount = Amount.from(quote.amount);
	return {
		mintUrl,
		method: "bolt11",
		quoteId: quote.quote,
		quote: quote.quote,
		request: quote.request,
		unit: quote.unit,
		amount,
		expiry: quote.expiry,
		pubkey: quote.pubkey,
		state: quote.state,
		reusable: false,
		amountPaid: Amount.from(quote.amount_paid),
		amountIssued: Amount.from(quote.amount_issued),
		remoteUpdatedAt: quote.updated_at ?? null,
		quoteData: { amount },
		createdAt: now,
		updatedAt: now
	};
}
/** Maps a normalized on-chain response without enforcing canonical accounting invariants. */
function mintQuoteObservationFromOnchainResponse(mintUrl, quote, options) {
	const now = options?.now ?? Date.now();
	return {
		mintUrl,
		method: "onchain",
		quoteId: quote.quote,
		quote: quote.quote,
		request: quote.request,
		unit: quote.unit,
		expiry: quote.expiry,
		pubkey: quote.pubkey,
		reusable: true,
		amountPaid: Amount.from(quote.amount_paid),
		amountIssued: Amount.from(quote.amount_issued),
		remoteUpdatedAt: quote.updated_at ?? null,
		quoteData: { pubkey: quote.pubkey },
		createdAt: now,
		updatedAt: now
	};
}
/** Maps a normalized BOLT12 response without enforcing canonical accounting invariants. */
function mintQuoteObservationFromBolt12Response(mintUrl, quote, options) {
	const now = options?.now ?? Date.now();
	const amount = quote.amount ? Amount.from(quote.amount) : void 0;
	return {
		mintUrl,
		method: "bolt12",
		quoteId: quote.quote,
		quote: quote.quote,
		request: quote.request,
		unit: quote.unit,
		amount,
		expiry: quote.expiry,
		pubkey: quote.pubkey,
		reusable: true,
		amountPaid: Amount.from(quote.amount_paid),
		amountIssued: Amount.from(quote.amount_issued),
		remoteUpdatedAt: quote.updated_at ?? null,
		quoteData: {
			pubkey: quote.pubkey,
			amount
		},
		createdAt: now,
		updatedAt: now
	};
}

//#endregion
//#region models/MintQuoteClaimability.ts
function invalid(remoteAvailable) {
	return {
		status: "invalid",
		remoteAvailable
	};
}
function waiting(remoteAvailable) {
	return {
		status: "waiting",
		remoteAvailable
	};
}
function assessAtomicClaimability(quote, facts, remoteAvailable) {
	if (!quote.amountIssued.isZero() && !quote.amountIssued.equals(quote.amount) || facts.requestedAmount !== void 0 && !facts.requestedAmount.equals(quote.amount)) return invalid(remoteAvailable);
	if (quote.amountIssued.equals(quote.amount) || facts.finalizedAmount?.greaterThanOrEqual(quote.amount)) return {
		status: "complete",
		remoteAvailable
	};
	if (quote.amountPaid.lessThan(quote.amount)) return waiting(remoteAvailable);
	return {
		status: "claimable",
		remoteAvailable,
		claimAmount: quote.amount
	};
}
function assessBalanceClaimability(quote, facts, remoteAvailable) {
	const finalizedAmount = facts.finalizedAmount ?? Amount.zero();
	const effectiveIssued = finalizedAmount.greaterThan(quote.amountIssued) ? finalizedAmount : quote.amountIssued;
	const availableAfterFinalized = quote.amountPaid.lessThan(effectiveIssued) ? Amount.zero() : quote.amountPaid.subtract(effectiveIssued);
	const reservedAmount = facts.reservedAmount ?? Amount.zero();
	const locallyAvailable = availableAfterFinalized.lessThan(reservedAmount) ? Amount.zero() : availableAfterFinalized.subtract(reservedAmount);
	const claimAmount = facts.requestedAmount ?? locallyAvailable;
	if (claimAmount.isZero() || claimAmount.greaterThan(locallyAvailable)) return waiting(remoteAvailable);
	return {
		status: "claimable",
		remoteAvailable,
		claimAmount
	};
}
/**
* Assesses canonical Mint Quote Accounting for one local claim.
*
* Quote expiry and deprecated BOLT11 compatibility state are deliberately absent from the facts
* consumed by this module. Atomic-versus-balance policy is private to this implementation.
*/
function assessMintQuoteClaimability(quote, facts = {}) {
	if (quote.amountIssued.greaterThan(quote.amountPaid)) return invalid(Amount.zero());
	const remoteAvailable = quote.amountPaid.subtract(quote.amountIssued);
	if (facts.requestedAmount?.isZero()) return invalid(remoteAvailable);
	if (quote.method === "bolt11") return assessAtomicClaimability(quote, facts, remoteAvailable);
	return assessBalanceClaimability(quote, facts, remoteAvailable);
}

//#endregion
//#region models/MintQuote.ts
function isStatefulMintQuote(quote) {
	return quote.method === "bolt11";
}
/** Derives the deprecated BOLT11 state projection from canonical quote accounting. */
function deriveBolt11MintQuoteState(amountPaid, amountIssued) {
	return amountPaid.isZero() && amountIssued.isZero() ? "UNPAID" : amountPaid.greaterThan(amountIssued) ? "PAID" : "ISSUED";
}
/**
* Applies a legacy BOLT11 state observation without allowing it to reduce canonical accounting.
*
* @deprecated Legacy state is a fallback for snapshots that do not carry Mint Quote Accounting.
*/
function applyBolt11MintQuoteStateFallback(quote, state, observedAt = Date.now()) {
	const hasLegacyProjectionShape = quote.amountPaid.isZero() && quote.amountIssued.isZero() || quote.amountPaid.equals(quote.amount) && quote.amountIssued.isZero() || quote.amountPaid.equals(quote.amount) && quote.amountIssued.equals(quote.amount);
	if (quote.remoteUpdatedAt !== null || !hasLegacyProjectionShape) return {
		...quote,
		state: deriveBolt11MintQuoteState(quote.amountPaid, quote.amountIssued)
	};
	const paidFallback = state === "UNPAID" ? Amount.zero() : quote.amount;
	const issuedFallback = state === "ISSUED" ? quote.amount : Amount.zero();
	const amountPaid = quote.amountPaid.greaterThan(paidFallback) ? quote.amountPaid : paidFallback;
	const amountIssued = quote.amountIssued.greaterThan(issuedFallback) ? quote.amountIssued : issuedFallback;
	return {
		...quote,
		state: deriveBolt11MintQuoteState(amountPaid, amountIssued),
		amountPaid,
		amountIssued,
		updatedAt: Math.max(quote.updatedAt, observedAt)
	};
}
/**
* Returns the deprecated BOLT11 state projection for compatibility consumers.
*
* @deprecated Use `amountPaid` and `amountIssued`, or the common Claimability assessment.
*/
function getMintQuoteRemoteState(quote) {
	return isStatefulMintQuote(quote) ? deriveBolt11MintQuoteState(quote.amountPaid, quote.amountIssued) : void 0;
}
/**
* Returns the fixed mint operation amount for stateful quotes.
*
* Reusable quote metadata may include a payment amount, such as a fixed BOLT12
* offer amount, but that does not constrain the later mint operation amount.
*/
function getMintQuoteAmount(quote) {
	if (isStatefulMintQuote(quote)) return quote.amount;
}
/** Returns mint-reported availability without local issuance or reservation facts. */
function getMintQuoteAvailableAmount(quote) {
	return assessMintQuoteClaimability(quote).remoteAvailable;
}
function isMintQuotePending(quote) {
	const { status } = assessMintQuoteClaimability(quote);
	return status === "waiting" || status === "claimable";
}
function assertValidMintQuoteAccounting(quoteId, amountPaid, amountIssued) {
	if (amountIssued.greaterThan(amountPaid)) throw new MintQuoteValidationError(`Mint quote ${quoteId} has amount_issued greater than amount_paid`);
}
function mintQuoteFromBolt11Response(mintUrl, quote, options) {
	const observation = mintQuoteObservationFromBolt11Response(mintUrl, quote, options);
	const canonicalQuote = {
		...observation,
		state: deriveBolt11MintQuoteState(observation.amountPaid, observation.amountIssued)
	};
	assertValidMintQuoteAccounting(canonicalQuote.quoteId, canonicalQuote.amountPaid, canonicalQuote.amountIssued);
	return canonicalQuote;
}
function mintQuoteFromOnchainResponse(mintUrl, quote, options) {
	const canonicalQuote = mintQuoteObservationFromOnchainResponse(mintUrl, quote, options);
	assertValidMintQuoteAccounting(canonicalQuote.quoteId, canonicalQuote.amountPaid, canonicalQuote.amountIssued);
	return canonicalQuote;
}
function mintQuoteFromBolt12Response(mintUrl, quote, options) {
	const canonicalQuote = mintQuoteObservationFromBolt12Response(mintUrl, quote, options);
	assertValidMintQuoteAccounting(canonicalQuote.quoteId, canonicalQuote.amountPaid, canonicalQuote.amountIssued);
	return canonicalQuote;
}
function mintQuoteToMethodSnapshot(quote) {
	if (quote.method === "bolt11") return {
		quote: quote.quoteId,
		request: quote.request,
		method: "bolt11",
		amount: quote.amount,
		unit: quote.unit,
		expiry: quote.expiry,
		pubkey: quote.pubkey,
		state: deriveBolt11MintQuoteState(quote.amountPaid, quote.amountIssued),
		amount_paid: quote.amountPaid,
		amount_issued: quote.amountIssued,
		updated_at: quote.remoteUpdatedAt
	};
	if (quote.method === "onchain") return {
		quote: quote.quoteId,
		request: quote.request,
		method: "onchain",
		unit: quote.unit,
		expiry: quote.expiry,
		pubkey: quote.quoteData.pubkey,
		amount_paid: quote.amountPaid,
		amount_issued: quote.amountIssued,
		updated_at: quote.remoteUpdatedAt
	};
	return {
		quote: quote.quoteId,
		request: quote.request,
		method: "bolt12",
		amount: quote.amount,
		unit: quote.unit,
		expiry: quote.expiry,
		pubkey: quote.quoteData.pubkey,
		amount_paid: quote.amountPaid,
		amount_issued: quote.amountIssued,
		updated_at: quote.remoteUpdatedAt
	};
}

//#endregion
//#region operations/melt/MeltMethodHandler.ts
function normalizeMeltMethodData(methodData) {
	if (typeof methodData !== "object" || methodData === null || !("amountSats" in methodData) || methodData.amountSats === void 0) return methodData;
	return {
		...methodData,
		amountSats: Amount.from(methodData.amountSats)
	};
}

//#endregion
//#region repositories/RepositoryTransactionError.ts
/**
* Reports transient adapter contention while acquiring or committing a Wallet transaction.
* Callers may apply a bounded retry policy to this error; domain and invariant errors must pass
* through unchanged.
*/
var RepositoryTransactionConflictError = class extends Error {
	transient = true;
	constructor(message = "Wallet repository transaction conflicted", cause) {
		super(message);
		this.name = "RepositoryTransactionConflictError";
		this.cause = cause;
	}
};

//#endregion
//#region operations/mintSwap/MintSwapOperation.ts
/** These states have durable automatic work; prepared requires explicit execution. */
function isMintSwapAutomaticState(state) {
	return state === "preparing" || state === "source_pending" || state === "destination_funded" || state === "destination_pending";
}

//#endregion
//#region operations/mintSwap/parseMintSwapOperation.ts
const STATES = [
	"preparing",
	"prepared",
	"source_pending",
	"destination_funded",
	"destination_pending",
	"completed",
	"cancelled",
	"failed",
	"needs_attention"
];
const PREPARED_FIELDS = ["sourceDebitBounds"];
const SOURCE_FIELDS = [...PREPARED_FIELDS, "sourceStartedAt"];
const FUNDED_FIELDS = [...SOURCE_FIELDS, "sourceSettlement"];
const DESTINATION_FIELDS = [...FUNDED_FIELDS, "destinationStartedAt"];
const STATE_FIELDS = {
	preparing: [],
	prepared: PREPARED_FIELDS,
	source_pending: SOURCE_FIELDS,
	destination_funded: FUNDED_FIELDS,
	destination_pending: DESTINATION_FIELDS,
	completed: [
		...DESTINATION_FIELDS,
		"destinationCompletion",
		"completedAt"
	],
	cancelled: [
		"lastSafe",
		"valueNeutral",
		"cancelledAt"
	],
	failed: [
		"lastSafe",
		"valueNeutral",
		"failure",
		"failedAt"
	],
	needs_attention: [
		"lastSafe",
		"attention",
		"attentionAt"
	]
};
/** Reject an invalid persisted fact without copying its potentially sensitive value into the error. */
function check(condition, field) {
	if (!condition) throw new TypeError(`Invalid Mint Swap ${field}`);
}
/** Narrow persisted input to a plain record before reading any domain fields from it. */
function object(value) {
	check(typeof value === "object" && value !== null && !Array.isArray(value), "record");
	check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "record");
	return value;
}
/** Require the exact persisted keys for a state so stale or foreign data cannot be ignored. */
function fields(value, required, optional = []) {
	check(required.every((key) => Object.hasOwn(value, key)), "required fields");
	check(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "fields");
}
/** Narrow a persisted string to one member of a closed domain vocabulary. */
function choice(value, choices, field) {
	const result = choices.find((item) => item === value);
	check(result !== void 0, field);
	return result;
}
/** Parse persistence metadata that must be a nonnegative safe integer. */
function integer(value, field) {
	check(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, field);
	return value;
}
/** Parse a local Unix-millisecond timestamp within its established lifecycle bounds. */
function time(value, minimum, maximum, field) {
	const result = integer(value, field);
	check(minimum <= result && result <= maximum, field);
	return result;
}
/** Parse an opaque, nonempty identity without silently trimming it. */
function id(value) {
	check(typeof value === "string" && value.length > 0 && value.trim() === value, "identity");
	return value;
}
/** Normalize an unknown mint URL through Coco's shared URL identity boundary. */
function mintUrl(value) {
	try {
		return normalizeMintUrl(id(value));
	} catch {
		throw new TypeError("Invalid Mint Swap mint URL");
	}
}
/** Reconstruct a defensive Amount and optionally require a value greater than zero. */
function amount(value, positive = false) {
	let result;
	try {
		result = deserializeAmount(value instanceof Amount ? value.toBigInt() : value);
	} catch {
		throw new TypeError("Invalid Mint Swap amount");
	}
	check(!positive || !result.isZero(), "positive amount");
	return result;
}
/**
* Parse a SHA-256 payment-request digest into its canonical lowercase hex representation.
* A string must contain exactly 64 lowercase hexadecimal characters (32 bytes); adapters may also
* hydrate the same digest as a 32-byte Uint8Array or integer array.
*/
function paymentRequestHash(value) {
	if (typeof value === "string") {
		check(/^[0-9a-f]{64}$/.test(value), "payment request hash");
		return value;
	}
	check(value instanceof Uint8Array || Array.isArray(value), "payment request hash");
	check(value.length === 32, "payment request hash");
	const bytes = Array.from(value);
	check(bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255), "digest bytes");
	return bytesToHex(Uint8Array.from(bytes));
}
/** Parse a BOLT11 quote reference and bind its normalized mint URL to the expected leg. */
function quote(value, expectedMintUrl) {
	const record = object(value);
	fields(record, [
		"mintUrl",
		"method",
		"quoteId"
	]);
	const url = mintUrl(record.mintUrl);
	check(url === expectedMintUrl, "quote role");
	return {
		mintUrl: url,
		method: choice(record.method, ["bolt11"], "quote method"),
		quoteId: id(record.quoteId)
	};
}
/** Parse bounded retry diagnostics without retaining raw remote errors or protocol data. */
function retryError(value, lastAttemptAt, updatedAt) {
	const record = object(value);
	fields(record, [
		"category",
		"code",
		"at"
	]);
	const category = choice(record.category, [
		"waiting",
		"transient",
		"ambiguous"
	], "retry category");
	const at = time(record.at, lastAttemptAt, updatedAt, "retry error time");
	switch (category) {
		case "waiting": return {
			category,
			at,
			code: choice(record.code, [
				"child_pending",
				"source_pending",
				"destination_pending"
			], "retry code")
		};
		case "transient": return {
			category,
			at,
			code: choice(record.code, ["remote_unavailable", "local_unavailable"], "retry code")
		};
		case "ambiguous": return {
			category,
			at,
			code: choice(record.code, ["source_outcome_unknown", "destination_outcome_unknown"], "retry code")
		};
	}
}
/** Parse retry scheduling and enforce automatic versus quiescent state semantics. */
function retry(value, state, enteredAt, updatedAt) {
	const record = object(value);
	fields(record, [
		"attemptCount",
		"lastAttemptAt",
		"nextAttemptAt",
		"lastError"
	]);
	const attemptCount = integer(record.attemptCount, "retry attempt count");
	const nextAttemptAt = record.nextAttemptAt === null ? null : integer(record.nextAttemptAt, "next attempt time");
	if (!isMintSwapAutomaticState(state)) check(nextAttemptAt === null && attemptCount === 0, "quiescent retry");
	else check(nextAttemptAt !== null && nextAttemptAt >= enteredAt, "automatic retry");
	if (attemptCount === 0) {
		check(record.lastAttemptAt === null && record.lastError === null, "initial retry");
		check(nextAttemptAt === null || nextAttemptAt === enteredAt, "initial due time");
		return {
			attemptCount,
			lastAttemptAt: null,
			nextAttemptAt,
			lastError: null
		};
	}
	const lastAttemptAt = time(record.lastAttemptAt, enteredAt, updatedAt, "last attempt time");
	const lastError = retryError(record.lastError, lastAttemptAt, updatedAt);
	check(nextAttemptAt !== null && nextAttemptAt >= lastError.at, "retry schedule");
	return {
		attemptCount,
		lastAttemptAt,
		nextAttemptAt,
		lastError
	};
}
/** Parse and validate the source debit bounds established by successful preparation. */
function prepared(record, context) {
	const bounds = object(record.sourceDebitBounds);
	fields(bounds, [
		"minimum",
		"maximum",
		"reserved"
	]);
	const sourceDebitBounds = {
		minimum: amount(bounds.minimum),
		maximum: amount(bounds.maximum),
		reserved: amount(bounds.reserved)
	};
	const { minimum, maximum, reserved } = sourceDebitBounds;
	check(context.destinationAmount.lessThanOrEqual(minimum), "minimum debit");
	check(minimum.lessThanOrEqual(maximum), "maximum debit");
	check(maximum.lessThanOrEqual(reserved), "reserved debit");
	check(!context.sourceDebitCap || maximum.lessThanOrEqual(context.sourceDebitCap), "source debit cap");
	return { sourceDebitBounds };
}
/** Parse prepared facts plus the timestamp committed before source execution. */
function sourcePending(record, context) {
	return {
		...prepared(record, context),
		sourceStartedAt: time(record.sourceStartedAt, context.createdAt, context.stateEnteredAt, "source start")
	};
}
/** Parse paid-source evidence and verify the exact debit and fee equations. */
function funded(record, context) {
	const source = sourcePending(record, context);
	const settlement = object(record.sourceSettlement);
	fields(settlement, [
		"reserved",
		"returned",
		"finalDebit",
		"totalFee",
		"sourcePaidObservedAt"
	]);
	const sourceSettlement = {
		reserved: amount(settlement.reserved),
		returned: amount(settlement.returned),
		finalDebit: amount(settlement.finalDebit),
		totalFee: amount(settlement.totalFee),
		sourcePaidObservedAt: time(settlement.sourcePaidObservedAt, source.sourceStartedAt, context.stateEnteredAt, "source payment observation")
	};
	const { reserved, returned, finalDebit, totalFee } = sourceSettlement;
	check(reserved.equals(source.sourceDebitBounds.reserved), "settlement reservation");
	check(returned.lessThanOrEqual(reserved), "settlement return");
	check(reserved.subtract(returned).equals(finalDebit), "net source debit");
	check(context.destinationAmount.add(totalFee).equals(finalDebit), "total source fee");
	check(finalDebit.inRange(source.sourceDebitBounds.minimum, source.sourceDebitBounds.maximum), "final debit bounds");
	return {
		...source,
		sourceSettlement
	};
}
/** Parse funded facts plus the timestamp committed before destination issuance. */
function destinationPending(record, context) {
	const source = funded(record, context);
	return {
		...source,
		destinationStartedAt: time(record.destinationStartedAt, source.sourceSettlement.sourcePaidObservedAt, context.stateEnteredAt, "destination start")
	};
}
/** Reconstruct a non-recursive snapshot of the last automatic state and its established facts. */
function checkpoint(value, context) {
	const record = object(value);
	const state = choice(record.state, [
		"preparing",
		"prepared",
		"source_pending",
		"destination_funded",
		"destination_pending"
	], "last safe state");
	fields(record, [
		"state",
		"stateEnteredAt",
		...STATE_FIELDS[state]
	]);
	const stateEnteredAt = time(record.stateEnteredAt, context.createdAt, context.stateEnteredAt, "checkpoint time");
	const priorContext = {
		...context,
		stateEnteredAt
	};
	switch (state) {
		case "preparing":
			check(stateEnteredAt === context.createdAt, "preparing entry time");
			return {
				state,
				stateEnteredAt
			};
		case "prepared": return {
			state,
			stateEnteredAt,
			...prepared(record, priorContext)
		};
		case "source_pending": {
			const facts = sourcePending(record, priorContext);
			check(facts.sourceStartedAt === stateEnteredAt, "source authorization time");
			return {
				state,
				stateEnteredAt,
				...facts
			};
		}
		case "destination_funded": return {
			state,
			stateEnteredAt,
			...funded(record, priorContext)
		};
		case "destination_pending": {
			const facts = destinationPending(record, priorContext);
			check(facts.destinationStartedAt === stateEnteredAt, "destination authorization time");
			return {
				state,
				stateEnteredAt,
				...facts
			};
		}
	}
}
/** Parse evidence proving that cancellation or failure did not transfer source value. */
function valueNeutral(value, lastSafe, enteredAt) {
	const record = object(value);
	fields(record, [
		"sourcePayment",
		"sourceProofs",
		"verifiedAt"
	]);
	const sourcePayment = choice(record.sourcePayment, ["not_authorized", "confirmed_unpaid"], "value-neutral payment");
	const sourceProofs = choice(record.sourceProofs, ["not_reserved", "released"], "value-neutral proofs");
	check(lastSafe.state !== "prepared" || sourceProofs === "released", "prepared proof release");
	check(lastSafe.state !== "source_pending" || sourcePayment === "confirmed_unpaid" && sourceProofs === "released", "pending source exit");
	return {
		sourcePayment,
		sourceProofs,
		verifiedAt: time(record.verifiedAt, lastSafe.stateEnteredAt, enteredAt, "exit evidence time")
	};
}
/** Parse a deterministic failure from the bounded V1 failure vocabulary. */
function failure(value) {
	const record = object(value);
	fields(record, ["code"]);
	return { code: choice(record.code, [
		"preparation_rejected",
		"source_payment_rejected",
		"source_debit_cap_exceeded"
	], "failure code") };
}
/** Parse bounded evidence explaining why automatic economic recovery must stop. */
function attention(value, lastSafe, enteredAt) {
	const record = object(value);
	fields(record, [
		"reason",
		"invariant",
		"evidence"
	]);
	const evidence = object(record.evidence);
	fields(evidence, [
		"code",
		"leg",
		"observedAt"
	]);
	return {
		reason: choice(record.reason, ["contradictory_evidence", "missing_recovery_material"], "attention reason"),
		invariant: choice(record.invariant, [
			"child_identity",
			"quote_identity",
			"payment_request",
			"source_debit",
			"source_settlement",
			"destination_completion",
			"recovery_material"
		], "attention invariant"),
		evidence: {
			code: choice(evidence.code, [
				"child_missing",
				"child_conflict",
				"quote_missing",
				"quote_conflict",
				"invoice_mismatch",
				"debit_bounds_mismatch",
				"settlement_mismatch",
				"proof_total_mismatch",
				"key_missing",
				"outputs_missing",
				"proofs_missing"
			], "attention evidence"),
			leg: choice(evidence.leg, ["source", "destination"], "attention leg"),
			observedAt: time(evidence.observedAt, lastSafe.stateEnteredAt, enteredAt, "attention evidence time")
		}
	};
}
/**
* Hydrate V1 persisted data into a validated, independent parent snapshot.
* Validates only parent-local facts; the coordinator must verify canonical child/quote/proof records.
* Unknown fields are rejected, including child recovery material and unbounded diagnostics.
*/
function parseMintSwapOperation(value) {
	const record = object(value);
	const state = choice(record.state, STATES, "state");
	fields(record, [
		"schemaVersion",
		"id",
		"revision",
		"state",
		"sourceMintUrl",
		"destinationMintUrl",
		"unit",
		"destinationAmount",
		"sourceQuote",
		"destinationQuote",
		"sourceOperationId",
		"destinationOperationId",
		"paymentRequestHash",
		"createdAt",
		"updatedAt",
		"stateEnteredAt",
		"retry",
		...STATE_FIELDS[state]
	], ["sourceDebitCap", "cancellationRequestedAt"]);
	check(record.schemaVersion === 1, "schema version");
	const sourceMintUrl = mintUrl(record.sourceMintUrl);
	const destinationMintUrl = mintUrl(record.destinationMintUrl);
	check(sourceMintUrl !== destinationMintUrl, "distinct mints");
	const createdAt = integer(record.createdAt, "creation time");
	const updatedAt = integer(record.updatedAt, "update time");
	const stateEnteredAt = time(record.stateEnteredAt, createdAt, updatedAt, "state entry time");
	const destinationAmount = amount(record.destinationAmount, true);
	const sourceDebitCap = record.sourceDebitCap === void 0 ? void 0 : amount(record.sourceDebitCap, true);
	check(!sourceDebitCap || destinationAmount.lessThanOrEqual(sourceDebitCap), "intent debit cap");
	const cancellationRequestedAt = record.cancellationRequestedAt === void 0 ? void 0 : time(record.cancellationRequestedAt, createdAt, updatedAt, "cancellation request time");
	const base = {
		schemaVersion: 1,
		id: id(record.id),
		revision: integer(record.revision, "revision"),
		sourceMintUrl,
		destinationMintUrl,
		unit: choice(record.unit, ["sat"], "unit"),
		destinationAmount,
		...sourceDebitCap === void 0 ? {} : { sourceDebitCap },
		sourceQuote: quote(record.sourceQuote, sourceMintUrl),
		destinationQuote: quote(record.destinationQuote, destinationMintUrl),
		sourceOperationId: id(record.sourceOperationId),
		destinationOperationId: id(record.destinationOperationId),
		paymentRequestHash: paymentRequestHash(record.paymentRequestHash),
		createdAt,
		updatedAt,
		stateEnteredAt,
		retry: retry(record.retry, state, stateEnteredAt, updatedAt),
		...cancellationRequestedAt === void 0 ? {} : { cancellationRequestedAt }
	};
	let result;
	switch (state) {
		case "preparing":
			check(stateEnteredAt === createdAt, "preparing entry time");
			result = {
				...base,
				state
			};
			break;
		case "prepared":
			result = {
				...base,
				state,
				...prepared(record, base)
			};
			break;
		case "source_pending": {
			const facts = sourcePending(record, base);
			check(facts.sourceStartedAt === stateEnteredAt, "source authorization time");
			result = {
				...base,
				state,
				...facts
			};
			break;
		}
		case "destination_funded":
			result = {
				...base,
				state,
				...funded(record, base)
			};
			break;
		case "destination_pending": {
			const facts = destinationPending(record, base);
			check(facts.destinationStartedAt === stateEnteredAt, "destination authorization time");
			result = {
				...base,
				state,
				...facts
			};
			break;
		}
		case "completed": {
			const facts = destinationPending(record, base);
			const completion = object(record.destinationCompletion);
			fields(completion, [
				"quoteAmountIssued",
				"storedProofAmount",
				"proofsVerifiedAt"
			]);
			const destinationCompletion = {
				quoteAmountIssued: amount(completion.quoteAmountIssued),
				storedProofAmount: amount(completion.storedProofAmount),
				proofsVerifiedAt: time(completion.proofsVerifiedAt, facts.destinationStartedAt, stateEnteredAt, "proof verification time")
			};
			check(destinationCompletion.quoteAmountIssued.equals(destinationAmount), "quote issued total");
			check(destinationCompletion.storedProofAmount.equals(destinationAmount), "stored proof total");
			result = {
				...base,
				state,
				...facts,
				destinationCompletion,
				completedAt: time(record.completedAt, stateEnteredAt, stateEnteredAt, "completion time")
			};
			break;
		}
		case "cancelled":
		case "failed": {
			const lastSafe = checkpoint(record.lastSafe, base);
			check(lastSafe.state === "preparing" || lastSafe.state === "prepared" || lastSafe.state === "source_pending", "value-neutral checkpoint");
			const evidence = valueNeutral(record.valueNeutral, lastSafe, stateEnteredAt);
			if (state === "cancelled") {
				check(cancellationRequestedAt !== void 0 && cancellationRequestedAt <= stateEnteredAt, "cancellation intent");
				result = {
					...base,
					state,
					lastSafe,
					valueNeutral: evidence,
					cancellationRequestedAt,
					cancelledAt: time(record.cancelledAt, stateEnteredAt, stateEnteredAt, "cancellation time")
				};
			} else result = {
				...base,
				state,
				lastSafe,
				valueNeutral: evidence,
				failure: failure(record.failure),
				failedAt: time(record.failedAt, stateEnteredAt, stateEnteredAt, "failure time")
			};
			break;
		}
		case "needs_attention": {
			const lastSafe = checkpoint(record.lastSafe, base);
			result = {
				...base,
				state,
				lastSafe,
				attention: attention(record.attention, lastSafe, stateEnteredAt),
				attentionAt: time(record.attentionAt, stateEnteredAt, stateEnteredAt, "attention time")
			};
			break;
		}
	}
	const progress = result.lastSafe ?? result;
	if (cancellationRequestedAt !== void 0 && result.lastSafe !== void 0) check(cancellationRequestedAt <= stateEnteredAt, "quiescent cancellation request");
	if (cancellationRequestedAt !== void 0 && progress.sourceSettlement !== void 0) check(cancellationRequestedAt <= progress.sourceSettlement.sourcePaidObservedAt, "post-payment cancellation request");
	return result;
}

//#endregion
export { assertUnitAmount as $, projectSendOperation as A, getProofStateInputsFromSerializedOutputs as B, operationHistoryId as C, UnitMismatchError as Ct, projectMintOperation as D, projectMeltOperation as E, deserializeBlindedSignatures as F, serializeBlindedSignatures as G, mapProofToCoreProof as H, deserializeOutput as I, stringifyJson as J, serializeOutput as K, deserializeOutputData as L, buildYHexMapsForSecrets as M, computeYHexForSecrets as N, projectOperationToHistoryEntry as O, deserializeAmount as P, assertSameUnit as Q, deserializeToken as R, legacyHistoryId as S, TokenValidationError as St, projectLegacyHistoryRow as T, UnknownMintError as Tt, normalizeMintUrl as U, getSecretsFromSerializedOutputData as V, serializeAmount as W, toAmount as X, sumAmounts as Y, DEFAULT_UNIT as Z, mintQuoteObservationFromBolt12Response as _, PaymentRequestError as _t, deriveBolt11MintQuoteState as a, sameUnitAmount as at, isLegacyHistoryEntry as b, QuoteIdentityConflictError as bt, getMintQuoteRemoteState as c, DerivationIndexExhaustedError as ct, mintQuoteFromBolt11Response as d, MintFetchError as dt, isUnitAmountLikeObject as et, mintQuoteFromBolt12Response as f, MintOperationError as ft, mintQuoteObservationFromBolt11Response as g, OperationInProgressError as gt, assessMintQuoteClaimability as h, NetworkError as ht, applyBolt11MintQuoteStateFallback as i, parseUnitAmount as it, assertNonNegativeInteger as j, projectReceiveOperation as k, isMintQuotePending as l, HttpResponseError as lt, mintQuoteToMethodSnapshot as m, MintQuoteValidationError as mt, RepositoryTransactionConflictError as n, normalizeUnitAmount as nt, getMintQuoteAmount as o, AuthSessionError as ot, mintQuoteFromOnchainResponse as p, MintQuoteKeyError as pt, serializeOutputData as q, normalizeMeltMethodData as r, normalizeUnitList as rt, getMintQuoteAvailableAmount as s, AuthSessionExpiredError as st, parseMintSwapOperation as t, normalizeUnit as tt, isStatefulMintQuote as u, KeysetSyncError as ut, mintQuoteObservationFromOnchainResponse as v, ProofOperationError as vt, parseHistoryEntryId as w, UnitValidationError as wt, isOperationHistoryEntry as x, SendOperationConflictError as xt, compareHistoryEntries as y, ProofValidationError as yt, generateSubId as z };