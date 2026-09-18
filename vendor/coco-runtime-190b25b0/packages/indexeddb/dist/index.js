import Dexie from "dexie";
import { DEFAULT_UNIT, QuoteIdentityConflictError, applyBolt11MintQuoteStateFallback, compareHistoryEntries, deriveBolt11MintQuoteState, deserializeAmount, deserializeBlindedSignatures, deserializeToken, getMintQuoteAmount, getMintQuoteRemoteState, isMintQuotePending, isStatefulMintQuote, normalizeMeltMethodData, normalizeMintUrl, normalizeUnit, operationHistoryId, parseHistoryEntryId, projectLegacyHistoryRow, serializeAmount, serializeBlindedSignatures, stringifyJson } from "@cashu/coco-core/adapter";
import { Amount } from "@cashu/cashu-ts";

//#region src/lib/db.ts
/**
* Wrapper around Dexie providing transaction management for IndexedDB.
*
* Transaction behavior:
* - Nested transactions within the same Dexie transaction context are reused
* - Concurrent transactions are queued and executed serially
* - Dexie handles automatic commit/rollback based on promise resolution/rejection
*/
var IdbDb = class extends Dexie {
	/** Promise chain used to serialize concurrent transactions */
	transactionQueue = Promise.resolve();
	/** Currently active Dexie transaction (null if no transaction) */
	activeTransaction = null;
	constructor(options = {}) {
		super(options.name ?? "coco_cashu");
	}
	/**
	* Execute a function within a database transaction.
	*
	* Transaction Semantics:
	*
	* 1. NESTED TRANSACTIONS (same Dexie context):
	*    When runTransaction() is called from within an active transaction,
	*    Dexie.currentTransaction will be set. The inner call reuses this transaction.
	*    No new transaction is created.
	*
	* 2. CONCURRENT TRANSACTIONS (different contexts):
	*    When runTransaction() is called while another transaction is active but from
	*    a different context, the new transaction waits in a queue. This prevents
	*    conflicts and ensures serialization of operations.
	*
	* 3. ERROR HANDLING:
	*    Dexie automatically rolls back the transaction if the promise is rejected.
	*    The transaction queue is properly released even on error, allowing subsequent
	*    transactions to proceed.
	*
	* @param mode - Transaction mode: 'r' (readonly) or 'rw' (readwrite)
	* @param stores - Array of store names to include in the transaction
	* @param fn - Function to execute within the transaction, receives a Dexie transaction
	* @returns Promise that resolves with the return value of fn
	* @throws Re-throws any error from fn after Dexie rolls back the transaction
	*/
	async runTransaction(mode, stores, fn) {
		const currentTx = Dexie.currentTransaction;
		if (currentTx && !currentTx.active) return Dexie.ignoreTransaction(() => this.runTransaction(mode, stores, fn));
		if (currentTx && currentTx === this.activeTransaction && currentTx.active) return fn(currentTx);
		const previousTransaction = this.transactionQueue;
		let resolver;
		this.transactionQueue = new Promise((resolve) => {
			resolver = resolve;
		});
		try {
			await previousTransaction;
			return await this.transaction(mode, stores, async (tx) => {
				const previousActive = this.activeTransaction;
				this.activeTransaction = tx;
				try {
					return await fn(tx);
				} finally {
					this.activeTransaction = previousActive;
				}
			});
		} finally {
			resolver();
		}
	}
	get currentTransaction() {
		return Dexie.currentTransaction ?? this.activeTransaction;
	}
	/** Whether this call context already belongs to this logical IndexedDB database. */
	get hasAmbientTransaction() {
		const transaction = Dexie.currentTransaction;
		return Boolean(transaction?.active && transaction.db.name === this.name);
	}
};
function getUnixTimeSeconds() {
	return Math.floor(Date.now() / 1e3);
}

//#endregion
//#region src/lib/schema.ts
function normalizeStoredAmount(value) {
	if (value === null || value === void 0) return value;
	return String(value);
}
function parseStoredJsonObject(value) {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
function normalizeStoredUnit(value) {
	if (typeof value !== "string" || value.trim().length === 0) return "sat";
	return value.trim().toLowerCase();
}
function removeNullOptionalPaymentRequestAttemptIndexValues(row) {
	if (row.transportMessageId == null) delete row.transportMessageId;
	if (row.receiveOperationId == null) delete row.receiveOperationId;
}
async function ensureSchema(db) {
	db.version(1).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]"
	});
	db.version(2).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]"
	}).upgrade(async (tx) => {
		const mints = await tx.table("coco_cashu_mints").toArray();
		for (const mint of mints) await tx.table("coco_cashu_mints").update(mint.mintUrl, { trusted: true });
	});
	db.version(3).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]"
	});
	db.version(4).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex"
	});
	db.version(5).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex"
	}).upgrade(async (tx) => {
		const mints = await tx.table("coco_cashu_mints").toArray();
		const urlMapping = /* @__PURE__ */ new Map();
		for (const mint of mints) {
			const normalized = normalizeMintUrl(mint.mintUrl);
			urlMapping.set(mint.mintUrl, normalized);
		}
		const normalizedToOriginal = /* @__PURE__ */ new Map();
		for (const [original, normalized] of urlMapping) {
			const existing = normalizedToOriginal.get(normalized);
			if (existing && existing !== original) throw new Error(`Mint URL normalization conflict: "${existing}" and "${original}" both normalize to "${normalized}". Please manually resolve this conflict before running the migration.`);
			normalizedToOriginal.set(normalized, original);
		}
		for (const [original, normalized] of urlMapping) {
			if (original === normalized) continue;
			const mint = await tx.table("coco_cashu_mints").get(original);
			if (mint) {
				await tx.table("coco_cashu_mints").delete(original);
				await tx.table("coco_cashu_mints").add({
					...mint,
					mintUrl: normalized
				});
			}
			const keysets = await tx.table("coco_cashu_keysets").where("mintUrl").equals(original).toArray();
			for (const keyset of keysets) {
				await tx.table("coco_cashu_keysets").delete([original, keyset.id]);
				await tx.table("coco_cashu_keysets").add({
					...keyset,
					mintUrl: normalized
				});
			}
			const counters = await tx.table("coco_cashu_counters").where("[mintUrl+keysetId]").between([original, ""], [original, "￿"]).toArray();
			for (const counter of counters) {
				await tx.table("coco_cashu_counters").delete([original, counter.keysetId]);
				await tx.table("coco_cashu_counters").add({
					...counter,
					mintUrl: normalized
				});
			}
			const proofs = await tx.table("coco_cashu_proofs").where("mintUrl").equals(original).toArray();
			for (const proof of proofs) {
				await tx.table("coco_cashu_proofs").delete([original, proof.secret]);
				await tx.table("coco_cashu_proofs").add({
					...proof,
					mintUrl: normalized
				});
			}
			const mintQuotes = await tx.table("coco_cashu_mint_quotes").where("mintUrl").equals(original).toArray();
			for (const quote of mintQuotes) {
				await tx.table("coco_cashu_mint_quotes").delete([original, quote.quote]);
				await tx.table("coco_cashu_mint_quotes").add({
					...quote,
					mintUrl: normalized
				});
			}
			const meltQuotes = await tx.table("coco_cashu_melt_quotes").where("mintUrl").equals(original).toArray();
			for (const quote of meltQuotes) {
				await tx.table("coco_cashu_melt_quotes").delete([original, quote.quote]);
				await tx.table("coco_cashu_melt_quotes").add({
					...quote,
					mintUrl: normalized
				});
			}
			await tx.table("coco_cashu_history").where("mintUrl").equals(original).modify({ mintUrl: normalized });
		}
	});
	db.version(6).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl"
	});
	db.version(7).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl"
	});
	db.version(8).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").where("state").equals("completed").modify({ state: "finalized" });
		await tx.table("coco_cashu_history").where("type").equals("send").filter((entry) => entry.state === "completed").modify({ state: "finalized" });
	});
	db.version(9).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	});
	db.version(10).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").toCollection().modify((op) => {
			if (!op.method) op.method = "default";
			if (!op.methodDataJson) op.methodDataJson = stringifyJson(op.methodData ?? {});
			if ("methodData" in op) delete op.methodData;
		});
	});
	db.version(11).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl"
	});
	db.version(12).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").toCollection().modify((op) => {
			if (!op.method) op.method = "default";
			if (!op.methodDataJson) op.methodDataJson = stringifyJson(op.methodData ?? {});
			if ("methodData" in op) delete op.methodData;
		});
	});
	db.version(13).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").toCollection().modify((op) => {
			if (!("tokenJson" in op)) op.tokenJson = null;
		});
	});
	db.version(14).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_keysets").clear();
		await tx.table("coco_cashu_mints").toCollection().modify((mint) => {
			mint.updatedAt = 0;
		});
	});
	db.version(15).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl"
	});
	db.version(16).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	});
	db.version(17).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_receive_operations").toCollection().modify((op) => {
			if (!op.unit) op.unit = "sat";
		});
	});
	db.version(18).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+id+state], state, mintUrl, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_proofs").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
		});
		await tx.table("coco_cashu_mint_quotes").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
		});
		await tx.table("coco_cashu_melt_quotes").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
			row.fee_reserve = normalizeStoredAmount(row.fee_reserve);
		});
		await tx.table("coco_cashu_history").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
		});
		await tx.table("coco_cashu_send_operations").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
			row.fee = normalizeStoredAmount(row.fee);
			row.inputAmount = normalizeStoredAmount(row.inputAmount);
		});
		await tx.table("coco_cashu_melt_operations").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
			row.fee_reserve = normalizeStoredAmount(row.fee_reserve);
			row.swap_fee = normalizeStoredAmount(row.swap_fee);
			row.inputAmount = normalizeStoredAmount(row.inputAmount);
			row.changeAmount = normalizeStoredAmount(row.changeAmount);
			row.effectiveFee = normalizeStoredAmount(row.effectiveFee);
		});
		await tx.table("coco_cashu_receive_operations").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
			row.fee = normalizeStoredAmount(row.fee);
		});
		await tx.table("coco_cashu_mint_operations").toCollection().modify((row) => {
			row.amount = normalizeStoredAmount(row.amount);
		});
	});
	db.version(19).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	}).upgrade(async (tx) => {
		const keysets = await tx.table("coco_cashu_keysets").toArray();
		const unitByKeyset = /* @__PURE__ */ new Map();
		for (const keyset of keysets) {
			if (typeof keyset.mintUrl !== "string" || typeof keyset.id !== "string") continue;
			unitByKeyset.set(`${keyset.mintUrl}\0${keyset.id}`, normalizeStoredUnit(keyset.unit));
		}
		await tx.table("coco_cashu_proofs").toCollection().modify((row) => {
			const keysetKey = typeof row.mintUrl === "string" && typeof row.id === "string" ? `${row.mintUrl}\0${row.id}` : void 0;
			row.unit = normalizeStoredUnit((keysetKey ? unitByKeyset.get(keysetKey) : void 0) ?? row.unit);
		});
	});
	db.version(20).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").toCollection().modify((row) => {
			row.unit = normalizeStoredUnit(row.unit);
		});
	});
	db.version(21).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]"
	});
	db.version(22).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, state, payloadHash, transportMessageId, receiveOperationId"
	});
	db.version(23).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], transportMessageId, receiveOperationId"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_payment_request_receive_attempts").toCollection().modify(removeNullOptionalPaymentRequestAttemptIndexValues);
	});
	db.version(24).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl",
		coco_cashu_melt_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, [mintUrl+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	});
	db.version(25).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	});
	db.version(26).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		const legacyRows = await tx.table("coco_cashu_history").where("type").equals("send").toArray();
		legacyRows.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
		const legacyTokens = /* @__PURE__ */ new Map();
		for (const row of legacyRows) {
			if (!row.operationId || !row.tokenJson) continue;
			const key = `${row.mintUrl}\0${row.operationId}`;
			if (!legacyTokens.has(key)) legacyTokens.set(key, row.tokenJson);
		}
		await tx.table("coco_cashu_send_operations").toCollection().modify((op) => {
			if (op.tokenJson != null) return;
			const tokenJson = legacyTokens.get(`${op.mintUrl}\0${op.id}`);
			if (tokenJson) op.tokenJson = tokenJson;
		});
	});
	db.version(27).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		const now = Date.now();
		const operations = await tx.table("coco_cashu_mint_operations").toArray();
		for (const op of operations) {
			if (!op.mintUrl || !op.method || !op.quoteId || !op.request || op.amount == null) continue;
			const existing = await tx.table("coco_cashu_canonical_mint_quotes").get([
				op.mintUrl,
				op.method,
				op.quoteId
			]);
			const observedState = op.lastObservedRemoteState === "UNPAID" || op.lastObservedRemoteState === "PAID" || op.lastObservedRemoteState === "ISSUED" ? op.lastObservedRemoteState : op.state === "finalized" ? "ISSUED" : "UNPAID";
			const createdAt = (op.createdAt ?? Math.floor(now / 1e3)) * 1e3;
			const updatedAt = (op.updatedAt ?? Math.floor(now / 1e3)) * 1e3;
			await tx.table("coco_cashu_canonical_mint_quotes").put({
				...existing,
				mintUrl: op.mintUrl,
				method: op.method,
				quoteId: op.quoteId,
				state: observedState,
				request: op.request,
				amount: normalizeStoredAmount(op.amount) ?? "0",
				unit: normalizeStoredUnit(op.unit),
				expiry: op.expiry ?? null,
				pubkey: op.pubkey ?? null,
				lastObservedRemoteState: observedState,
				lastObservedRemoteStateAt: op.lastObservedRemoteStateAt ?? updatedAt,
				reusable: 0,
				createdAt: existing?.createdAt ?? createdAt,
				updatedAt
			});
		}
	});
	db.version(28).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		const now = Date.now();
		await tx.table("coco_cashu_melt_quotes").toCollection().modify((row) => {
			row.method = row.method ?? "bolt11";
			row.quoteId = row.quoteId ?? row.quote ?? "";
			row.lastObservedRemoteState = row.lastObservedRemoteState ?? row.state;
			row.lastObservedRemoteStateAt = row.lastObservedRemoteStateAt ?? now;
			row.createdAt = row.createdAt ?? now;
			row.updatedAt = row.updatedAt ?? now;
		});
		const operations = await tx.table("coco_cashu_melt_operations").toArray();
		for (const op of operations) {
			if (!op.mintUrl || !op.method || !op.quoteId || op.amount == null || op.fee_reserve == null) continue;
			const methodData = op.methodData ?? (op.methodDataJson ? JSON.parse(op.methodDataJson) : {});
			const finalizedData = op.finalizedData ?? (op.finalizedDataJson ? JSON.parse(op.finalizedDataJson) : {});
			const existing = await tx.table("coco_cashu_melt_quotes").get([
				op.mintUrl,
				op.method,
				op.quoteId
			]);
			const observedState = op.state === "finalized" ? "PAID" : op.state === "pending" || op.state === "executing" ? "PENDING" : "UNPAID";
			const createdAt = (op.createdAt ?? Math.floor(now / 1e3)) * 1e3;
			const updatedAt = (op.updatedAt ?? Math.floor(now / 1e3)) * 1e3;
			await tx.table("coco_cashu_melt_quotes").put({
				...existing,
				mintUrl: op.mintUrl,
				method: op.method,
				quoteId: op.quoteId,
				quote: op.quoteId,
				state: observedState,
				request: methodData.invoice ?? op.quoteId,
				amount: normalizeStoredAmount(op.amount) ?? "0",
				unit: normalizeStoredUnit(op.unit),
				fee_reserve: normalizeStoredAmount(op.fee_reserve) ?? "0",
				expiry: existing?.expiry ?? 0,
				payment_preimage: finalizedData.preimage ?? null,
				lastObservedRemoteState: observedState,
				lastObservedRemoteStateAt: updatedAt,
				createdAt: existing?.createdAt ?? createdAt,
				updatedAt
			});
		}
	});
	db.version(29).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_mint_operations").toCollection().filter((row) => !row.quoteId || row.quoteId.trim() === "").delete();
	});
	db.version(30).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	});
	db.version(31).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	});
	db.version(32).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_canonical_mint_quotes").toCollection().modify((row) => {
			const quoteData = parseStoredJsonObject(row.quoteDataJson);
			const amount = normalizeStoredAmount(row.amount) ?? "0";
			if (row.reusable === 1) {
				row.amountPaid = normalizeStoredAmount(quoteData.amountPaid) ?? "0";
				row.amountIssued = normalizeStoredAmount(quoteData.amountIssued) ?? "0";
				delete quoteData.amountPaid;
				delete quoteData.amountIssued;
			} else {
				row.amountPaid = row.state === "PAID" || row.state === "ISSUED" ? amount : "0";
				row.amountIssued = row.state === "ISSUED" ? amount : "0";
			}
			row.quoteDataJson = stringifyJson(quoteData);
			row.remoteUpdatedAt = null;
		});
	});
	db.version(33).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex, [purpose+derivationIndex]",
		coco_cashu_keypair_derivation_allocations: "&purpose",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		const keypairTable = tx.table("coco_cashu_keypairs");
		await keypairTable.toCollection().modify((row) => {
			row.purpose ??= "p2pk";
		});
		const greatestByPurpose = /* @__PURE__ */ new Map();
		const keypairs = await keypairTable.toArray();
		for (const keypair of keypairs) {
			if (keypair.derivationIndex == null) continue;
			const purpose = keypair.purpose ?? "p2pk";
			greatestByPurpose.set(purpose, Math.max(greatestByPurpose.get(purpose) ?? -1, keypair.derivationIndex));
		}
		const allocationTable = tx.table("coco_cashu_keypair_derivation_allocations");
		for (const [purpose, greatestStoredIndex] of greatestByPurpose) {
			const existing = await allocationTable.get(purpose);
			await allocationTable.put({
				purpose,
				lastAllocatedIndex: Math.max(existing?.lastAllocatedIndex ?? -1, greatestStoredIndex)
			});
		}
	});
	db.version(34).stores({
		coco_cashu_mints: "&mintUrl, name, updatedAt, trusted",
		coco_cashu_keysets: "&[mintUrl+id], mintUrl, id, updatedAt, unit",
		coco_cashu_counters: "&[mintUrl+keysetId]",
		coco_cashu_proofs: "&[mintUrl+secret], [mintUrl+state], [mintUrl+unit+state], [mintUrl+id+state], [mintUrl+id+unit+state], [mintUrl+unit+id+state], [unit+state], state, mintUrl, unit, id, usedByOperationId, createdByOperationId",
		coco_cashu_mint_quotes: "&[mintUrl+quote], state, mintUrl",
		coco_cashu_canonical_mint_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_melt_quotes: "&[mintUrl+method+quoteId], &[mintUrl+quoteId], state, mintUrl, method",
		coco_cashu_history: "++id, mintUrl, type, createdAt, [mintUrl+quoteId+type], [mintUrl+operationId]",
		coco_cashu_keypairs: "&publicKey, createdAt, derivationIndex, [purpose+derivationIndex]",
		coco_cashu_keypair_derivation_allocations: "&purpose",
		coco_cashu_send_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_melt_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId]",
		coco_cashu_receive_operations: "&id, state, mintUrl, createdAt",
		coco_cashu_auth_sessions: "&mintUrl",
		coco_cashu_mint_operations: "&id, state, mintUrl, createdAt, [mintUrl+quoteId], [mintUrl+method+quoteId]",
		coco_cashu_payment_request_receive_operations: "&id, state, requestId",
		coco_cashu_payment_request_receive_attempts: "&id, requestOperationId, requestId, state, &[requestOperationId+payloadHash], [requestId+payloadHash], &transportMessageId, &receiveOperationId"
	}).upgrade(async (tx) => {
		await tx.table("coco_cashu_send_operations").toCollection().modify((row) => {
			row.revision ??= 0;
		});
	});
}

//#endregion
//#region src/repositories/MintRepository.ts
var IdbMintRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async isTrustedMint(mintUrl) {
		return (await this.db.table("coco_cashu_mints").get(mintUrl))?.trusted ?? false;
	}
	async getMintByUrl(mintUrl) {
		const row = await this.db.table("coco_cashu_mints").get(mintUrl);
		if (!row) throw new Error(`Mint not found: ${mintUrl}`);
		return {
			mintUrl: row.mintUrl,
			name: row.name,
			mintInfo: JSON.parse(row.mintInfo),
			trusted: row.trusted ?? true,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}
	async getAllMints() {
		return (await this.db.table("coco_cashu_mints").toArray()).map((r) => ({
			mintUrl: r.mintUrl,
			name: r.name,
			mintInfo: JSON.parse(r.mintInfo),
			trusted: r.trusted ?? true,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt
		}));
	}
	async getAllTrustedMints() {
		return (await this.db.table("coco_cashu_mints").toArray()).filter((r) => r.trusted ?? true).map((r) => ({
			mintUrl: r.mintUrl,
			name: r.name,
			mintInfo: JSON.parse(r.mintInfo),
			trusted: r.trusted ?? true,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt
		}));
	}
	async addNewMint(mint) {
		const row = {
			mintUrl: mint.mintUrl,
			name: mint.name,
			mintInfo: JSON.stringify(mint.mintInfo),
			trusted: mint.trusted,
			createdAt: mint.createdAt,
			updatedAt: mint.updatedAt
		};
		await this.db.table("coco_cashu_mints").put(row);
	}
	async addOrUpdateMint(mint) {
		const existing = await this.db.table("coco_cashu_mints").get(mint.mintUrl);
		const row = {
			mintUrl: mint.mintUrl,
			name: mint.name,
			mintInfo: JSON.stringify(mint.mintInfo),
			trusted: mint.trusted,
			createdAt: existing?.createdAt ?? mint.createdAt,
			updatedAt: mint.updatedAt
		};
		await this.db.table("coco_cashu_mints").put(row);
	}
	async updateMint(mint) {
		await this.addNewMint(mint);
	}
	async setMintTrusted(mintUrl, trusted) {
		await this.db.table("coco_cashu_mints").update(mintUrl, { trusted });
	}
	async deleteMint(mintUrl) {
		await this.db.table("coco_cashu_mints").delete(mintUrl);
	}
};

//#endregion
//#region src/repositories/KeysetRepository.ts
var IdbKeysetRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getKeysetsByMintUrl(mintUrl) {
		return (await this.db.table("coco_cashu_keysets").where("mintUrl").equals(mintUrl).toArray()).map((r) => ({
			mintUrl: r.mintUrl,
			id: r.id,
			unit: r.unit ?? "",
			keypairs: JSON.parse(r.keypairs),
			active: !!r.active,
			feePpk: r.feePpk,
			updatedAt: r.updatedAt
		}));
	}
	async getKeysetById(mintUrl, id) {
		const row = await this.db.table("coco_cashu_keysets").get([mintUrl, id]);
		if (!row) return null;
		return {
			mintUrl: row.mintUrl,
			id: row.id,
			unit: row.unit ?? "",
			keypairs: JSON.parse(row.keypairs),
			active: !!row.active,
			feePpk: row.feePpk,
			updatedAt: row.updatedAt
		};
	}
	async updateKeyset(keyset) {
		const existing = await this.db.table("coco_cashu_keysets").get([keyset.mintUrl, keyset.id]);
		const now = Math.floor(Date.now() / 1e3);
		if (!existing) {
			await this.db.table("coco_cashu_keysets").put({
				mintUrl: keyset.mintUrl,
				id: keyset.id,
				unit: keyset.unit,
				keypairs: JSON.stringify({}),
				active: keyset.active ? 1 : 0,
				feePpk: keyset.feePpk,
				updatedAt: now
			});
			return;
		}
		await this.db.table("coco_cashu_keysets").put({
			...existing,
			unit: keyset.unit,
			active: keyset.active ? 1 : 0,
			feePpk: keyset.feePpk,
			updatedAt: now
		});
	}
	async addKeyset(keyset) {
		const now = Math.floor(Date.now() / 1e3);
		const row = {
			mintUrl: keyset.mintUrl,
			id: keyset.id,
			unit: keyset.unit,
			keypairs: JSON.stringify(keyset.keypairs ?? {}),
			active: keyset.active ? 1 : 0,
			feePpk: keyset.feePpk,
			updatedAt: now
		};
		await this.db.table("coco_cashu_keysets").put(row);
	}
	async deleteKeyset(mintUrl, keysetId) {
		await this.db.table("coco_cashu_keysets").delete([mintUrl, keysetId]);
	}
};

//#endregion
//#region src/utils.ts
/**
* Safely converts a hex string to Uint8Array with validation
* @throws Error if the hex string is invalid or malformed
*/
function hexToBytes(hexString) {
	if (!/^[0-9a-fA-F]+$/.test(hexString)) throw new Error(`Invalid hex string: contains non-hex characters`);
	if (hexString.length % 2 !== 0) throw new Error(`Invalid hex string: odd length (${hexString.length})`);
	const matches = hexString.match(/.{2}/g);
	if (!matches) throw new Error(`Failed to parse hex string`);
	return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}
/**
* Converts a Uint8Array to hex string
*/
function bytesToHex(bytes) {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function assertFieldPresent(value, field, operationId) {
	if (value == null) throw new Error(`Invalid operation row ${operationId}: missing required field "${field}"`);
	return value;
}

//#endregion
//#region src/repositories/KeyRingRepository.ts
const DEFAULT_KEYPAIR_PURPOSE = "p2pk";
const KEYPAIR_STORE = "coco_cashu_keypairs";
const ALLOCATION_STORE = "coco_cashu_keypair_derivation_allocations";
var IdbKeyRingRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getPersistedKeyPair(publicKey, purpose) {
		const row = await this.db.table(KEYPAIR_STORE).get(publicKey);
		if (!row) return null;
		const keypairRow = row;
		if (purpose && (keypairRow.purpose ?? DEFAULT_KEYPAIR_PURPOSE) !== purpose) return null;
		const secretKeyBytes = hexToBytes(keypairRow.secretKey);
		return {
			publicKeyHex: keypairRow.publicKey,
			secretKey: secretKeyBytes,
			derivationIndex: keypairRow.derivationIndex,
			purpose: keypairRow.purpose ?? DEFAULT_KEYPAIR_PURPOSE
		};
	}
	async setPersistedKeyPair(keyPair) {
		const table = this.db.table(KEYPAIR_STORE);
		const secretKeyHex = bytesToHex(keyPair.secretKey);
		let derivationIndex = keyPair.derivationIndex;
		const purpose = keyPair.purpose ?? DEFAULT_KEYPAIR_PURPOSE;
		if (derivationIndex == null) {
			const existing = await table.get(keyPair.publicKeyHex);
			if (existing?.derivationIndex != null) derivationIndex = existing.derivationIndex;
		}
		await table.put({
			publicKey: keyPair.publicKeyHex,
			secretKey: secretKeyHex,
			createdAt: Date.now(),
			derivationIndex,
			purpose
		});
	}
	async deletePersistedKeyPair(publicKey, purpose) {
		const table = this.db.table(KEYPAIR_STORE);
		if (purpose) {
			const existing = await table.get(publicKey);
			if (existing && (existing.purpose ?? DEFAULT_KEYPAIR_PURPOSE) !== purpose) return;
		}
		await table.delete(publicKey);
	}
	async getAllPersistedKeyPairs(purpose) {
		return (await this.db.table(KEYPAIR_STORE).toArray()).filter((row) => !purpose || (row.purpose ?? DEFAULT_KEYPAIR_PURPOSE) === purpose).map((row) => ({
			publicKeyHex: row.publicKey,
			secretKey: hexToBytes(row.secretKey),
			derivationIndex: row.derivationIndex,
			purpose: row.purpose ?? DEFAULT_KEYPAIR_PURPOSE
		}));
	}
	async getLatestKeyPair(purpose) {
		const row = (await this.db.table(KEYPAIR_STORE).orderBy("createdAt").reverse().toArray()).find((candidate) => !purpose || (candidate.purpose ?? DEFAULT_KEYPAIR_PURPOSE) === purpose);
		if (!row) return null;
		return {
			publicKeyHex: row.publicKey,
			secretKey: hexToBytes(row.secretKey),
			derivationIndex: row.derivationIndex,
			purpose: row.purpose ?? DEFAULT_KEYPAIR_PURPOSE
		};
	}
	async getLastAllocatedIndex(purpose) {
		return (await this.db.table(ALLOCATION_STORE).get(purpose))?.lastAllocatedIndex ?? null;
	}
	async getHighestStoredDerivationIndex(purpose) {
		return (await this.db.table(KEYPAIR_STORE).where("[purpose+derivationIndex]").between([purpose, Dexie.minKey], [purpose, Dexie.maxKey]).last())?.derivationIndex ?? null;
	}
	async setLastAllocatedIndex(purpose, derivationIndex) {
		await this.db.table(ALLOCATION_STORE).put({
			purpose,
			lastAllocatedIndex: derivationIndex
		});
	}
};

//#endregion
//#region src/repositories/CounterRepository.ts
var IdbCounterRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getCounter(mintUrl, keysetId) {
		const row = await this.db.table("coco_cashu_counters").get([mintUrl, keysetId]);
		if (!row) return null;
		return {
			mintUrl,
			keysetId,
			counter: row.counter
		};
	}
	async setCounter(mintUrl, keysetId, counter) {
		await this.db.table("coco_cashu_counters").put({
			mintUrl,
			keysetId,
			counter
		});
	}
};

//#endregion
//#region src/repositories/ProofRepository.ts
function normalizeProofUnit(proof) {
	return normalizeUnit(proof.unit);
}
function getUnitFilter(filter) {
	const units = [...filter?.units ?? [], ...filter?.unit ? [filter.unit] : []];
	if (units.length === 0) return void 0;
	return new Set(units.map((unit) => normalizeUnit(unit)));
}
function matchesUnit(row, unitFilter) {
	return !unitFilter || unitFilter.has(normalizeUnit(row.unit ?? void 0, { defaultUnit: DEFAULT_UNIT }));
}
function rowToProof(r) {
	return {
		id: r.id,
		amount: deserializeAmount(r.amount),
		secret: r.secret,
		C: r.C,
		...r.dleqJson ? { dleq: JSON.parse(r.dleqJson) } : {},
		...r.witness ? { witness: JSON.parse(r.witness) } : {},
		mintUrl: r.mintUrl,
		unit: normalizeUnit(r.unit ?? void 0, { defaultUnit: DEFAULT_UNIT }),
		state: r.state,
		...r.usedByOperationId ? { usedByOperationId: r.usedByOperationId } : {},
		...r.createdByOperationId ? { createdByOperationId: r.createdByOperationId } : {}
	};
}
var IdbProofRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async saveProofs(mintUrl, proofs) {
		if (!proofs || proofs.length === 0) return;
		const now = Math.floor(Date.now() / 1e3);
		const normalizedProofs = proofs.map((proof) => ({
			...proof,
			unit: normalizeProofUnit(proof)
		}));
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const p of normalizedProofs) if (await table.get([mintUrl, p.secret])) throw new Error(`Proof with secret already exists: ${p.secret}`);
			for (const p of normalizedProofs) {
				const row = {
					mintUrl,
					id: p.id,
					unit: p.unit,
					amount: serializeAmount(p.amount),
					secret: p.secret,
					C: p.C,
					dleqJson: p.dleq ? JSON.stringify(p.dleq) : null,
					witness: p.witness ? JSON.stringify(p.witness) : null,
					state: p.state,
					createdAt: now,
					usedByOperationId: p.usedByOperationId ?? null,
					createdByOperationId: p.createdByOperationId ?? null
				};
				await table.put(row);
			}
		});
	}
	async getReadyProofs(mintUrl, filter) {
		const unitFilter = getUnitFilter(filter);
		return (await this.db.table("coco_cashu_proofs").where("[mintUrl+state]").equals([mintUrl, "ready"]).toArray()).filter((row) => matchesUnit(row, unitFilter)).map(rowToProof);
	}
	async getInflightProofs(mintUrls, filter) {
		const unitFilter = getUnitFilter(filter);
		if (!mintUrls || mintUrls.length === 0) return (await this.db.table("coco_cashu_proofs").where("state").equals("inflight").toArray()).filter((row) => matchesUnit(row, unitFilter)).map(rowToProof);
		const mintUrlList = mintUrls.map((url) => url.trim()).filter((url) => url.length > 0);
		if (mintUrlList.length === 0) return [];
		const keys = Array.from(new Set(mintUrlList)).map((mintUrl) => [mintUrl, "inflight"]);
		return (await this.db.table("coco_cashu_proofs").where("[mintUrl+state]").anyOf(keys).toArray()).filter((row) => matchesUnit(row, unitFilter)).map(rowToProof);
	}
	async getAllReadyProofs(filter) {
		const unitFilter = getUnitFilter(filter);
		return (await this.db.table("coco_cashu_proofs").where("state").equals("ready").toArray()).filter((row) => matchesUnit(row, unitFilter)).map(rowToProof);
	}
	async getProofsByKeysetId(mintUrl, keysetId, filter) {
		const unitFilter = getUnitFilter(filter);
		return (await this.db.table("coco_cashu_proofs").where("[mintUrl+id+state]").equals([
			mintUrl,
			keysetId,
			"ready"
		]).toArray()).filter((row) => matchesUnit(row, unitFilter)).map(rowToProof);
	}
	async setProofState(mintUrl, secrets, state) {
		if (!secrets || secrets.length === 0) return;
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const s of secrets) {
				const existing = await table.get([mintUrl, s]);
				if (existing) await table.put({
					...existing,
					state
				});
			}
		});
	}
	async deleteProofs(mintUrl, secrets) {
		if (!secrets || secrets.length === 0) return;
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const s of secrets) await table.delete([mintUrl, s]);
		});
	}
	async wipeProofsByKeysetId(mintUrl, keysetId) {
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			const rows = await table.where("[mintUrl+id]").equals([mintUrl, keysetId]).toArray();
			for (const r of rows) await table.delete([mintUrl, r.secret]);
		});
	}
	async reserveProofs(mintUrl, secrets, operationId) {
		if (!secrets || secrets.length === 0) return;
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const secret of secrets) {
				const row = await table.get([mintUrl, secret]);
				if (!row) throw new Error(`Proof with secret not found: ${secret}`);
				if (row.state !== "ready") throw new Error(`Proof is not ready, cannot reserve: ${secret}`);
				if (row.usedByOperationId) throw new Error(`Proof already reserved by operation ${row.usedByOperationId}: ${secret}`);
			}
			for (const secret of secrets) {
				const existing = await table.get([mintUrl, secret]);
				await table.put({
					...existing,
					usedByOperationId: operationId
				});
			}
		});
	}
	async releaseProofs(mintUrl, secrets) {
		if (!secrets || secrets.length === 0) return;
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const secret of secrets) {
				const existing = await table.get([mintUrl, secret]);
				if (existing) {
					const { usedByOperationId: _, ...rest } = existing;
					await table.put({
						...rest,
						usedByOperationId: null
					});
				}
			}
		});
	}
	async setCreatedByOperation(mintUrl, secrets, operationId) {
		if (!secrets || secrets.length === 0) return;
		await this.db.runTransaction("rw", ["coco_cashu_proofs"], async (tx) => {
			const table = tx.table("coco_cashu_proofs");
			for (const secret of secrets) {
				const existing = await table.get([mintUrl, secret]);
				if (existing) await table.put({
					...existing,
					createdByOperationId: operationId
				});
			}
		});
	}
	async getProofBySecret(mintUrl, secret) {
		const row = await this.db.table("coco_cashu_proofs").get([mintUrl, secret]);
		return row ? rowToProof(row) : null;
	}
	async getProofsBySecrets(mintUrl, secrets) {
		if (!secrets || secrets.length === 0) return [];
		const keys = Array.from(new Set(secrets)).map((secret) => [mintUrl, secret]);
		return (await this.db.table("coco_cashu_proofs").bulkGet(keys)).filter((row) => row !== void 0).map(rowToProof);
	}
	async getProofsByOperationId(mintUrl, operationId) {
		const byUsed = await this.db.table("coco_cashu_proofs").where("usedByOperationId").equals(operationId).toArray();
		const byCreated = await this.db.table("coco_cashu_proofs").where("createdByOperationId").equals(operationId).toArray();
		const seen = /* @__PURE__ */ new Set();
		const results = [];
		for (const row of [...byUsed, ...byCreated]) {
			if (row.mintUrl !== mintUrl) continue;
			const key = `${row.mintUrl}::${row.secret}`;
			if (!seen.has(key)) {
				seen.add(key);
				results.push(rowToProof(row));
			}
		}
		return results;
	}
	async getAvailableProofs(mintUrl, filter) {
		const unitFilter = getUnitFilter(filter);
		return (await this.db.table("coco_cashu_proofs").where("[mintUrl+state]").equals([mintUrl, "ready"]).toArray()).filter((r) => !r.usedByOperationId && matchesUnit(r, unitFilter)).map(rowToProof);
	}
	async getReservedProofs() {
		return (await this.db.table("coco_cashu_proofs").where("state").equals("ready").toArray()).filter((r) => r.usedByOperationId).map(rowToProof);
	}
};

//#endregion
//#region src/repositories/MeltQuoteRepository.ts
function rowToQuote(row) {
	const base = {
		mintUrl: row.mintUrl,
		method: row.method,
		quoteId: row.quoteId,
		quote: row.quoteId,
		state: row.state,
		request: row.request,
		amount: deserializeAmount(row.amount),
		unit: row.unit,
		expiry: row.expiry,
		change: deserializeBlindedSignatures(row.change),
		lastObservedRemoteState: row.lastObservedRemoteState ?? void 0,
		lastObservedRemoteStateAt: row.lastObservedRemoteStateAt ?? void 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
	if (row.method === "onchain") {
		if (!row.fee_options || row.fee_options.length === 0) throw new Error(`Stored onchain melt quote ${row.quoteId} is missing fee_options`);
		return {
			...base,
			method: "onchain",
			fee_options: row.fee_options.map((option) => ({
				...option,
				fee_reserve: deserializeAmount(option.fee_reserve)
			})),
			outpoint: row.outpoint ?? void 0
		};
	}
	if (row.fee_reserve === null || row.fee_reserve === void 0) throw new Error(`Stored BOLT melt quote ${row.quoteId} is missing fee_reserve`);
	return {
		...base,
		method: row.method,
		fee_reserve: deserializeAmount(row.fee_reserve),
		payment_preimage: row.payment_preimage ?? void 0
	};
}
var IdbMeltQuoteRepository = class {
	constructor(db) {
		this.db = db;
	}
	async getMeltQuoteById(identity) {
		const normalizedMintUrl = normalizeMintUrl(identity.mintUrl);
		const rows = await this.db.table("coco_cashu_melt_quotes").where("[mintUrl+quoteId]").equals([normalizedMintUrl, identity.quoteId]).toArray();
		if (rows.length > 1) throw new QuoteIdentityConflictError("melt", normalizedMintUrl, identity.quoteId, rows.map((row) => row.method));
		return rows[0] ? rowToQuote(rows[0]) : null;
	}
	async getMeltQuote(mintUrl, method, quoteId) {
		const row = await this.db.table("coco_cashu_melt_quotes").get([
			normalizeMintUrl(mintUrl),
			method,
			quoteId
		]);
		return row ? rowToQuote(row) : null;
	}
	async upsertMeltQuote(quote) {
		const now = Date.now();
		const normalizedMintUrl = normalizeMintUrl(quote.mintUrl);
		const identityOwner = await this.getMeltQuoteById({
			mintUrl: normalizedMintUrl,
			quoteId: quote.quoteId
		});
		if (identityOwner && identityOwner.method !== quote.method) throw new QuoteIdentityConflictError("melt", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Melt quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
		const existing = await this.getMeltQuote(quote.mintUrl, quote.method, quote.quoteId);
		const row = {
			mintUrl: normalizedMintUrl,
			method: quote.method,
			quoteId: quote.quoteId,
			quote: quote.quoteId,
			state: quote.state,
			request: quote.request,
			amount: serializeAmount(quote.amount),
			unit: quote.unit,
			fee_reserve: quote.method === "onchain" ? null : serializeAmount(quote.fee_reserve),
			fee_options: quote.method === "onchain" ? quote.fee_options.map((option) => ({
				...option,
				fee_reserve: serializeAmount(option.fee_reserve)
			})) : void 0,
			outpoint: quote.method === "onchain" ? quote.outpoint ?? null : null,
			expiry: quote.expiry,
			payment_preimage: quote.method === "onchain" ? null : quote.payment_preimage ?? null,
			change: serializeBlindedSignatures(quote.change),
			lastObservedRemoteState: quote.lastObservedRemoteState ?? quote.state,
			lastObservedRemoteStateAt: quote.lastObservedRemoteStateAt ?? now,
			createdAt: existing?.createdAt ?? quote.createdAt,
			updatedAt: now
		};
		await this.db.table("coco_cashu_melt_quotes").put(row);
		return rowToQuote(row);
	}
	async getPendingMeltQuotes(method) {
		return (await this.db.table("coco_cashu_melt_quotes").toArray()).filter((row) => row.state !== "PAID" && (!method || row.method === method)).map(rowToQuote);
	}
};

//#endregion
//#region src/repositories/MintQuoteRepository.ts
function parseQuoteData(value) {
	if (!value) return {};
	const parsed = JSON.parse(value);
	return parsed && typeof parsed === "object" ? parsed : {};
}
function rowToMintQuote(row) {
	const quoteData = parseQuoteData(row.quoteDataJson);
	if (row.method === "onchain" || row.method === "bolt12") {
		const pubkey = quoteData.pubkey ?? row.pubkey ?? "";
		const amountValue = quoteData.amount ?? row.amount ?? void 0;
		const amount = row.method === "bolt12" && amountValue !== void 0 ? deserializeAmount(amountValue) : void 0;
		return {
			mintUrl: row.mintUrl,
			method: row.method,
			quoteId: row.quoteId,
			quote: row.quoteId,
			request: row.request,
			unit: row.unit,
			...amount !== void 0 ? { amount } : {},
			expiry: row.expiry,
			pubkey,
			reusable: true,
			amountPaid: deserializeAmount(row.amountPaid),
			amountIssued: deserializeAmount(row.amountIssued),
			remoteUpdatedAt: row.remoteUpdatedAt ?? null,
			quoteData: {
				pubkey,
				...amount !== void 0 ? { amount } : {}
			},
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}
	const amount = deserializeAmount(quoteData.amount ?? row.amount ?? 0);
	const amountPaid = deserializeAmount(row.amountPaid);
	const amountIssued = deserializeAmount(row.amountIssued);
	const state = deriveBolt11MintQuoteState(amountPaid, amountIssued);
	return {
		mintUrl: row.mintUrl,
		method: "bolt11",
		quoteId: row.quoteId,
		quote: row.quoteId,
		state,
		request: row.request,
		amount,
		unit: row.unit,
		expiry: row.expiry,
		pubkey: row.pubkey ?? void 0,
		reusable: false,
		amountPaid,
		amountIssued,
		remoteUpdatedAt: row.remoteUpdatedAt ?? null,
		quoteData: { amount },
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}
function serializeQuoteData(quote) {
	if (isStatefulMintQuote(quote)) return stringifyJson({ amount: serializeAmount(quote.quoteData.amount) });
	if (quote.method === "bolt12") {
		const amount = quote.quoteData.amount ?? quote.amount;
		return stringifyJson({
			pubkey: quote.quoteData.pubkey,
			...amount !== void 0 ? { amount: serializeAmount(amount) } : {}
		});
	}
	return stringifyJson({ pubkey: quote.quoteData.pubkey });
}
var IdbMintQuoteRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getMintQuoteById(identity) {
		const normalizedMintUrl = normalizeMintUrl(identity.mintUrl);
		const rows = await this.db.table("coco_cashu_canonical_mint_quotes").where("[mintUrl+quoteId]").equals([normalizedMintUrl, identity.quoteId]).toArray();
		if (rows.length > 1) throw new QuoteIdentityConflictError("mint", normalizedMintUrl, identity.quoteId, rows.map((row) => row.method));
		return rows[0] ? rowToMintQuote(rows[0]) : null;
	}
	async getMintQuote(mintUrl, method, quoteId) {
		const row = await this.db.table("coco_cashu_canonical_mint_quotes").get([
			normalizeMintUrl(mintUrl),
			method,
			quoteId
		]);
		return row ? rowToMintQuote(row) : null;
	}
	async upsertMintQuote(quote) {
		const now = Date.now();
		const normalizedMintUrl = normalizeMintUrl(quote.mintUrl);
		const identityOwner = await this.getMintQuoteById({
			mintUrl: normalizedMintUrl,
			quoteId: quote.quoteId
		});
		if (identityOwner && identityOwner.method !== quote.method) throw new QuoteIdentityConflictError("mint", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Mint quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
		const state = getMintQuoteRemoteState(quote) ?? null;
		const amount = getMintQuoteAmount(quote);
		const row = {
			mintUrl: normalizedMintUrl,
			method: quote.method,
			quoteId: quote.quoteId,
			state,
			request: quote.request,
			amount: amount ? serializeAmount(amount) : null,
			unit: quote.unit,
			expiry: quote.expiry,
			pubkey: quote.pubkey ?? null,
			quoteDataJson: serializeQuoteData(quote),
			amountPaid: serializeAmount(quote.amountPaid),
			amountIssued: serializeAmount(quote.amountIssued),
			remoteUpdatedAt: quote.remoteUpdatedAt,
			reusable: quote.reusable ? 1 : 0,
			createdAt: quote.createdAt,
			updatedAt: quote.updatedAt || now
		};
		await this.db.table("coco_cashu_canonical_mint_quotes").put(row);
	}
	async setMintQuoteState(mintUrl, method, quoteId, state, observedAt = Date.now()) {
		await this.db.runTransaction("rw", ["coco_cashu_canonical_mint_quotes"], async (tx) => {
			const table = tx.table("coco_cashu_canonical_mint_quotes");
			const existing = await table.get([
				normalizeMintUrl(mintUrl),
				method,
				quoteId
			]);
			if (!existing) return;
			const quote = rowToMintQuote(existing);
			if (!isStatefulMintQuote(quote)) return;
			const resolved = applyBolt11MintQuoteStateFallback(quote, state, observedAt);
			await table.put({
				...existing,
				state: resolved.state,
				amountPaid: serializeAmount(resolved.amountPaid),
				amountIssued: serializeAmount(resolved.amountIssued),
				updatedAt: resolved.updatedAt
			});
		});
	}
	async getPendingMintQuotes(method) {
		return (await this.db.table("coco_cashu_canonical_mint_quotes").toArray()).map(rowToMintQuote).filter((quote) => (!method || quote.method === method) && isMintQuotePending(quote));
	}
};

//#endregion
//#region src/repositories/LegacyMintQuoteRepository.ts
var IdbLegacyMintQuoteRepository = class {
	constructor(db) {
		this.db = db;
	}
	async getPendingLegacyMintQuotes(mintUrl) {
		const normalizedMintUrl = mintUrl ? normalizeMintUrl(mintUrl) : void 0;
		const rows = await this.db.table("coco_cashu_mint_quotes").toArray();
		const now = Date.now();
		return rows.filter((row) => row.state !== "ISSUED" && (!normalizedMintUrl || row.mintUrl === normalizedMintUrl)).map((row) => {
			const amount = deserializeAmount(row.amount);
			return {
				mintUrl: row.mintUrl,
				method: "bolt11",
				quoteId: row.quote,
				quote: row.quote,
				state: row.state,
				request: row.request,
				amount,
				unit: row.unit,
				expiry: row.expiry,
				pubkey: row.pubkey ?? void 0,
				reusable: false,
				amountPaid: row.state === "PAID" ? amount : Amount.zero(),
				amountIssued: Amount.zero(),
				remoteUpdatedAt: null,
				quoteData: { amount },
				createdAt: now,
				updatedAt: now
			};
		});
	}
};

//#endregion
//#region src/repositories/HistoryRepository.ts
const stores = [
	"coco_cashu_send_operations",
	"coco_cashu_melt_operations",
	"coco_cashu_mint_operations",
	"coco_cashu_canonical_mint_quotes",
	"coco_cashu_receive_operations",
	"coco_cashu_history"
];
const historyVisibleMeltStates = new Set([
	"prepared",
	"executing",
	"pending",
	"finalized",
	"rolling_back",
	"rolled_back"
]);
function isHistoryVisibleMeltState(state) {
	return historyVisibleMeltStates.has(state);
}
function parseToken$1(tokenJson) {
	return tokenJson ? deserializeToken(JSON.parse(tokenJson)) : void 0;
}
function parseReceiveProofs(inputProofsJson) {
	return (inputProofsJson ? JSON.parse(inputProofsJson) : []).map((proof) => ({
		...proof,
		amount: deserializeAmount(proof.amount)
	}));
}
function parseReceiveSourceMetadata(sourceJson) {
	if (!sourceJson) return void 0;
	const source = JSON.parse(sourceJson);
	if (source.type !== "payment-request" || typeof source.requestOperationId !== "string" || typeof source.attemptId !== "string" || typeof source.transport !== "string") return;
	return {
		source: "payment-request",
		requestOperationId: source.requestOperationId,
		attemptId: source.attemptId,
		...typeof source.requestId === "string" ? { requestId: source.requestId } : {},
		transport: source.transport,
		...typeof source.transportMessageId === "string" ? { transportMessageId: source.transportMessageId } : {},
		...typeof source.senderPubkey === "string" ? { senderPubkey: source.senderPubkey } : {},
		...typeof source.memo === "string" ? { memo: source.memo } : {}
	};
}
var IdbHistoryRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getPaginatedHistoryEntries(limit, offset) {
		const pageWindow = offset + limit;
		if (pageWindow <= 0) return [];
		return (await this.db.runTransaction("r", [...stores], async (tx) => {
			const [sendRows, meltRows, mintRows, receiveRows, legacyRows] = await Promise.all([
				this.readRecentOperationRows(tx.table("coco_cashu_send_operations"), pageWindow, "send"),
				this.readRecentOperationRows(tx.table("coco_cashu_melt_operations"), pageWindow, "melt"),
				this.readRecentOperationRows(tx.table("coco_cashu_mint_operations"), pageWindow, "mint"),
				this.readRecentOperationRows(tx.table("coco_cashu_receive_operations"), pageWindow, "receive"),
				this.readVisibleLegacyRows(tx, tx.table("coco_cashu_history"), pageWindow)
			]);
			const mintRemoteStateByOperationId = await this.readMintRemoteStateByOperationId(tx, mintRows);
			return [...[
				...sendRows.map((row) => this.sendRowToEntry(row)).filter(Boolean),
				...meltRows.map((row) => this.meltRowToEntry(row)).filter(Boolean),
				...mintRows.map((row) => this.mintRowToEntry(row, mintRemoteStateByOperationId.get(row.id))).filter(Boolean),
				...receiveRows.map((row) => this.receiveRowToEntry(row)).filter(Boolean)
			], ...legacyRows].sort(compareHistoryEntries);
		})).slice(offset, offset + limit);
	}
	async getHistoryEntryById(id) {
		const parsed = parseHistoryEntryId(id);
		if (!parsed) return null;
		return this.db.runTransaction("r", [...stores], async (tx) => {
			if (parsed.source === "legacy") {
				const row = await tx.table("coco_cashu_history").get(Number(parsed.legacyHistoryId));
				if (!row || await this.legacyIsDeduped(tx, row)) return null;
				return this.legacyRowToEntry(row);
			}
			switch (parsed.type) {
				case "send": {
					const row = await tx.table("coco_cashu_send_operations").get(parsed.operationId);
					return row ? this.sendRowToEntry(row) : null;
				}
				case "melt": {
					const row = await tx.table("coco_cashu_melt_operations").get(parsed.operationId);
					return row ? this.meltRowToEntry(row) : null;
				}
				case "mint": {
					const row = await tx.table("coco_cashu_mint_operations").get(parsed.operationId);
					if (!row) return null;
					const quote = await this.getMintQuoteRowForOperation(tx, row);
					return this.mintRowToEntry(row, quote?.method === "bolt11" ? quote.state ?? void 0 : void 0);
				}
				case "receive": {
					const row = await tx.table("coco_cashu_receive_operations").get(parsed.operationId);
					return row ? this.receiveRowToEntry(row) : null;
				}
			}
		});
	}
	async readRecentOperationRows(table, limit, type) {
		return await table.orderBy("createdAt").reverse().filter((row) => this.operationIsHistoryEligible(type, row)).limit(limit).toArray();
	}
	async readRecentRows(table, offset, limit) {
		return await table.orderBy("createdAt").reverse().offset(offset).limit(limit).toArray();
	}
	async readMintRemoteStateByOperationId(tx, rows) {
		const result = /* @__PURE__ */ new Map();
		await Promise.all(rows.map(async (row) => {
			const quote = await this.getMintQuoteRowForOperation(tx, row);
			if (quote?.method === "bolt11" && quote.state) result.set(row.id, quote.state);
		}));
		return result;
	}
	async getMintQuoteRowForOperation(tx, row) {
		if (!row.quoteId) return void 0;
		return await tx.table("coco_cashu_canonical_mint_quotes").get([
			row.mintUrl,
			row.method,
			row.quoteId
		]);
	}
	async readVisibleLegacyRows(tx, table, limit) {
		const entries = [];
		const batchSize = Math.max(limit, 50);
		let offset = 0;
		while (entries.length < limit) {
			const rows = await this.readRecentRows(table, offset, batchSize);
			if (rows.length === 0) break;
			for (const row of rows) {
				if (await this.legacyIsDeduped(tx, row)) continue;
				entries.push(this.legacyRowToEntry(row));
				if (entries.length >= limit) break;
			}
			if (rows.length < batchSize) break;
			offset += rows.length;
		}
		return entries;
	}
	sendRowToEntry(row) {
		if (row.state === "init") return null;
		const token = parseToken$1(row.tokenJson);
		return {
			id: operationHistoryId("send", row.id),
			source: "operation",
			type: "send",
			createdAt: row.createdAt * 1e3,
			updatedAt: row.updatedAt * 1e3,
			mintUrl: row.mintUrl,
			unit: row.unit ?? token?.unit ?? "sat",
			operationId: row.id,
			amount: deserializeAmount(row.amount),
			state: row.state,
			...row.error ? { error: row.error } : {},
			...token ? { token } : {}
		};
	}
	meltRowToEntry(row) {
		if (!isHistoryVisibleMeltState(row.state)) return null;
		return {
			id: operationHistoryId("melt", row.id),
			source: "operation",
			type: "melt",
			createdAt: row.createdAt * 1e3,
			updatedAt: row.updatedAt * 1e3,
			mintUrl: row.mintUrl,
			unit: row.unit ?? "sat",
			operationId: row.id,
			quoteId: row.quoteId ?? "",
			amount: deserializeAmount(row.amount ?? 0),
			state: row.state,
			...row.error ? { error: row.error } : {}
		};
	}
	mintRowToEntry(row, remoteState) {
		if (row.state === "init") return null;
		return {
			id: operationHistoryId("mint", row.id),
			source: "operation",
			type: "mint",
			createdAt: row.createdAt * 1e3,
			updatedAt: row.updatedAt * 1e3,
			mintUrl: row.mintUrl,
			unit: row.unit ?? "sat",
			operationId: row.id,
			quoteId: row.quoteId ?? "",
			paymentRequest: row.request ?? "",
			amount: deserializeAmount(row.amount ?? 0),
			state: row.state,
			...remoteState ? { remoteState } : {},
			...row.error ? { error: row.error } : {}
		};
	}
	receiveRowToEntry(row) {
		if (row.state !== "finalized" && row.state !== "rolled_back") return null;
		const metadata = parseReceiveSourceMetadata(row.sourceJson);
		return {
			id: operationHistoryId("receive", row.id),
			source: "operation",
			type: "receive",
			createdAt: row.createdAt * 1e3,
			updatedAt: row.updatedAt * 1e3,
			mintUrl: row.mintUrl,
			unit: row.unit ?? "sat",
			operationId: row.id,
			amount: deserializeAmount(row.amount),
			state: row.state,
			...metadata ? { metadata } : {},
			...row.error ? { error: row.error } : {},
			...row.state === "finalized" ? { token: {
				mint: row.mintUrl,
				proofs: parseReceiveProofs(row.inputProofsJson),
				unit: row.unit ?? "sat"
			} } : {}
		};
	}
	legacyRowToEntry(row) {
		return projectLegacyHistoryRow(this.legacyRowToInput(row));
	}
	legacyRowToInput(row) {
		return {
			legacyHistoryId: row.id,
			type: row.type,
			createdAt: row.createdAt,
			mintUrl: row.mintUrl,
			unit: row.unit,
			amount: deserializeAmount(row.amount),
			quoteId: row.quoteId,
			state: row.state,
			paymentRequest: row.paymentRequest,
			token: parseToken$1(row.tokenJson),
			metadata: row.metadata ?? void 0,
			operationId: row.operationId
		};
	}
	async legacyIsDeduped(tx, row) {
		if (row.operationId) {
			const operation = await this.getOperationRow(tx, row.type, row.operationId);
			if (operation && this.operationIsHistoryEligible(row.type, operation)) return true;
		}
		if ((row.type === "mint" || row.type === "melt") && row.quoteId && await this.hasOperationForQuote(tx, row.type, row.mintUrl, row.quoteId)) return true;
		return false;
	}
	async getOperationRow(tx, type, operationId) {
		switch (type) {
			case "send": return await tx.table("coco_cashu_send_operations").get(operationId);
			case "melt": return await tx.table("coco_cashu_melt_operations").get(operationId);
			case "mint": return await tx.table("coco_cashu_mint_operations").get(operationId);
			case "receive": return await tx.table("coco_cashu_receive_operations").get(operationId);
		}
	}
	operationIsHistoryEligible(type, row) {
		switch (type) {
			case "send":
			case "mint": return row.state !== "init";
			case "melt": return isHistoryVisibleMeltState(row.state);
			case "receive": return row.state === "finalized" || row.state === "rolled_back";
		}
	}
	async hasOperationForQuote(tx, type, mintUrl, quoteId) {
		const store = type === "mint" ? "coco_cashu_mint_operations" : "coco_cashu_melt_operations";
		const row = await tx.table(store).where("[mintUrl+quoteId]").equals([mintUrl, quoteId]).first();
		return row ? this.operationIsHistoryEligible(type, row) : false;
	}
};

//#endregion
//#region src/repositories/SendOperationRepository.ts
function parseToken(row) {
	return row.tokenJson ? deserializeToken(JSON.parse(row.tokenJson)) : void 0;
}
function serializeToken(operation) {
	const maybeTokenOperation = operation;
	return maybeTokenOperation.token ? JSON.stringify(maybeTokenOperation.token) : null;
}
function parseMethodData$1(row) {
	const legacyRow = row;
	if (typeof legacyRow.methodDataJson === "string") return JSON.parse(legacyRow.methodDataJson);
	return legacyRow.methodData ?? {};
}
function rowToOperation$4(row) {
	const base = {
		id: row.id,
		mintUrl: row.mintUrl,
		amount: deserializeAmount(row.amount),
		unit: normalizeUnit(row.unit ?? "sat"),
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3,
		revision: row.revision ?? 0,
		error: row.error ?? void 0,
		executionMemo: row.executionMemo ?? void 0,
		reclaimData: row.reclaimDataJson ? JSON.parse(row.reclaimDataJson) : void 0,
		method: row.method,
		methodData: parseMethodData$1(row)
	};
	if (row.state === "init") return {
		...base,
		state: "init"
	};
	const preparedData = {
		needsSwap: row.needsSwap === 1,
		fee: deserializeAmount(assertFieldPresent(row.fee, "fee", row.id)),
		inputAmount: deserializeAmount(assertFieldPresent(row.inputAmount, "inputAmount", row.id)),
		inputProofSecrets: row.inputProofSecretsJson ? JSON.parse(row.inputProofSecretsJson) : [],
		outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : void 0
	};
	switch (row.state) {
		case "prepared": return {
			...base,
			state: "prepared",
			...preparedData
		};
		case "executing": return {
			...base,
			state: "executing",
			...preparedData
		};
		case "pending": return {
			...base,
			state: "pending",
			...preparedData,
			token: parseToken(row)
		};
		case "finalized": return {
			...base,
			state: "finalized",
			...preparedData,
			token: parseToken(row)
		};
		case "rolling_back": return {
			...base,
			state: "rolling_back",
			...preparedData,
			token: parseToken(row)
		};
		case "rolled_back": return {
			...base,
			state: "rolled_back",
			...preparedData,
			token: parseToken(row)
		};
		default: throw new Error(`Unknown state: ${row.state}`);
	}
}
function operationToRow$4(op) {
	const createdAtSeconds = Math.floor(op.createdAt / 1e3);
	const updatedAtSeconds = Math.floor(op.updatedAt / 1e3);
	if (op.state === "init") return {
		id: op.id,
		mintUrl: op.mintUrl,
		amount: serializeAmount(op.amount),
		unit: op.unit,
		state: op.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		revision: op.revision ?? 0,
		error: op.error ?? null,
		executionMemo: op.executionMemo ?? null,
		reclaimDataJson: op.reclaimData ? stringifyJson(op.reclaimData) : null,
		method: op.method,
		methodDataJson: stringifyJson(op.methodData),
		needsSwap: null,
		fee: null,
		inputAmount: null,
		inputProofSecretsJson: null,
		outputDataJson: null,
		tokenJson: null
	};
	return {
		id: op.id,
		mintUrl: op.mintUrl,
		amount: serializeAmount(op.amount),
		unit: op.unit,
		state: op.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		revision: op.revision ?? 0,
		error: op.error ?? null,
		executionMemo: op.executionMemo ?? null,
		reclaimDataJson: op.reclaimData ? stringifyJson(op.reclaimData) : null,
		method: op.method,
		methodDataJson: stringifyJson(op.methodData),
		needsSwap: op.needsSwap ? 1 : 0,
		fee: serializeAmount(op.fee),
		inputAmount: serializeAmount(op.inputAmount),
		inputProofSecretsJson: JSON.stringify(op.inputProofSecrets),
		outputDataJson: op.outputData ? JSON.stringify(op.outputData) : null,
		tokenJson: serializeToken(op)
	};
}
var IdbSendOperationRepository = class {
	db;
	storeName = "coco_cashu_send_operations";
	constructor(db) {
		this.db = db;
	}
	async create(operation) {
		await this.db.runTransaction("rw", [this.storeName], async (tx) => {
			const table = tx.table(this.storeName);
			if (await table.get(operation.id)) throw new Error(`SendOperation with id ${operation.id} already exists`);
			await table.add(operationToRow$4(operation));
		});
	}
	async update(operation) {
		await this.db.runTransaction("rw", [this.storeName], async (tx) => {
			const table = tx.table(this.storeName);
			if (!await table.get(operation.id)) throw new Error(`SendOperation with id ${operation.id} not found`);
			const row = operationToRow$4(operation);
			row.updatedAt = getUnixTimeSeconds();
			await table.put(row);
		});
	}
	async transition(input) {
		return this.db.runTransaction("rw", [this.storeName], async (tx) => {
			const table = tx.table(this.storeName);
			const existing = await table.get(input.operationId);
			if (!existing || existing.state !== input.expectedState || (existing.revision ?? 0) !== input.expectedRevision) return false;
			if (input.next.id !== input.operationId) throw new Error("Send operation transition cannot change the operation id");
			await table.put(operationToRow$4({
				...input.next,
				revision: input.expectedRevision + 1
			}));
			return true;
		});
	}
	async getById(id) {
		const row = await this.db.runTransaction("r", [this.storeName], async (tx) => {
			return await tx.table(this.storeName).get(id);
		});
		return row ? rowToOperation$4(row) : null;
	}
	async getByState(state) {
		return (await this.db.runTransaction("r", [this.storeName], async (tx) => {
			return await tx.table(this.storeName).where("state").equals(state).toArray();
		})).map(rowToOperation$4);
	}
	async getPending() {
		return (await this.db.runTransaction("r", [this.storeName], async (tx) => {
			return await tx.table(this.storeName).where("state").anyOf([
				"executing",
				"pending",
				"rolling_back"
			]).toArray();
		})).map(rowToOperation$4);
	}
	async getByMintUrl(mintUrl) {
		return (await this.db.runTransaction("r", [this.storeName], async (tx) => {
			return await tx.table(this.storeName).where("mintUrl").equals(mintUrl).toArray();
		})).map(rowToOperation$4);
	}
	async delete(id) {
		await this.db.runTransaction("rw", [this.storeName], async (tx) => {
			await tx.table(this.storeName).delete(id);
		});
	}
};

//#endregion
//#region src/repositories/MeltOperationRepository.ts
const getOperationQuoteId = (operation) => "quoteId" in operation && operation.quoteId ? operation.quoteId : void 0;
const preparedStates = [
	"prepared",
	"executing",
	"pending",
	"finalized",
	"rolling_back",
	"rolled_back"
];
const isPreparedState = (state) => preparedStates.includes(state);
const parseMethodData = (row) => normalizeMeltMethodData(JSON.parse(row.methodDataJson));
const rowToOperation$3 = (row) => {
	const base = {
		id: row.id,
		mintUrl: row.mintUrl,
		method: row.method,
		methodData: parseMethodData(row),
		unit: normalizeUnit(row.unit ?? "sat"),
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3,
		error: row.error ?? void 0
	};
	if (!isPreparedState(row.state)) return {
		...base,
		state: "init",
		...row.quoteId ? { quoteId: row.quoteId } : {}
	};
	const preparedData = {
		quoteId: row.quoteId ?? "",
		amount: deserializeAmount(assertFieldPresent(row.amount, "amount", row.id)),
		fee_reserve: deserializeAmount(assertFieldPresent(row.fee_reserve, "fee_reserve", row.id)),
		swap_fee: deserializeAmount(assertFieldPresent(row.swap_fee, "swap_fee", row.id)),
		needsSwap: row.needsSwap === 1,
		inputAmount: deserializeAmount(assertFieldPresent(row.inputAmount, "inputAmount", row.id)),
		inputProofSecrets: row.inputProofSecretsJson ? JSON.parse(row.inputProofSecretsJson) : [],
		changeOutputData: row.changeOutputDataJson ? JSON.parse(row.changeOutputDataJson) : {
			keep: [],
			send: []
		},
		swapOutputData: row.swapOutputDataJson ? JSON.parse(row.swapOutputDataJson) : void 0
	};
	const operation = {
		...base,
		state: row.state,
		...preparedData
	};
	if (row.state === "finalized") return {
		...operation,
		changeAmount: row.changeAmount !== null && row.changeAmount !== void 0 ? deserializeAmount(row.changeAmount) : void 0,
		effectiveFee: row.effectiveFee !== null && row.effectiveFee !== void 0 ? deserializeAmount(row.effectiveFee) : void 0,
		finalizedData: row.finalizedDataJson ? JSON.parse(row.finalizedDataJson) : void 0
	};
	return operation;
};
const operationToRow$3 = (operation) => {
	if (operation.state === "failed") throw new Error("Cannot persist failed melt operation");
	const createdAtSeconds = Math.floor(operation.createdAt / 1e3);
	const updatedAtSeconds = Math.floor(operation.updatedAt / 1e3);
	const methodDataJson = stringifyJson(operation.methodData);
	if (operation.state === "init") return {
		id: operation.id,
		mintUrl: operation.mintUrl,
		state: operation.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: operation.error ?? null,
		method: operation.method,
		methodDataJson,
		unit: operation.unit,
		quoteId: operation.quoteId ?? null,
		amount: null,
		fee_reserve: null,
		swap_fee: null,
		needsSwap: null,
		inputAmount: null,
		inputProofSecretsJson: null,
		changeOutputDataJson: null,
		swapOutputDataJson: null,
		finalizedDataJson: null
	};
	const settlement = operation;
	return {
		id: operation.id,
		mintUrl: operation.mintUrl,
		state: operation.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: operation.error ?? null,
		method: operation.method,
		methodDataJson,
		quoteId: operation.quoteId,
		unit: operation.unit,
		amount: serializeAmount(operation.amount),
		fee_reserve: serializeAmount(operation.fee_reserve),
		swap_fee: serializeAmount(operation.swap_fee),
		needsSwap: operation.needsSwap ? 1 : 0,
		inputAmount: serializeAmount(operation.inputAmount),
		inputProofSecretsJson: JSON.stringify(operation.inputProofSecrets),
		changeOutputDataJson: JSON.stringify(operation.changeOutputData),
		swapOutputDataJson: operation.swapOutputData ? JSON.stringify(operation.swapOutputData) : null,
		changeAmount: operation.state === "finalized" && settlement.changeAmount !== void 0 ? serializeAmount(settlement.changeAmount) : null,
		effectiveFee: operation.state === "finalized" && settlement.effectiveFee !== void 0 ? serializeAmount(settlement.effectiveFee) : null,
		finalizedDataJson: operation.state === "finalized" && settlement.finalizedData !== void 0 ? JSON.stringify(settlement.finalizedData) : null
	};
};
var IdbMeltOperationRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async create(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_melt_operations"], async (tx) => {
			const table = tx.table("coco_cashu_melt_operations");
			if (await table.get(operation.id)) throw new Error(`MeltOperation with id ${operation.id} already exists`);
			const quoteId = getOperationQuoteId(operation);
			if (quoteId) {
				if (await table.where("[mintUrl+quoteId]").equals([operation.mintUrl, quoteId]).first()) throw new Error(`MeltOperation already exists for mint ${operation.mintUrl} and quote ${quoteId}`);
			}
			await table.add(operationToRow$3(operation));
		});
	}
	async update(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_melt_operations"], async (tx) => {
			const table = tx.table("coco_cashu_melt_operations");
			if (!await table.get(operation.id)) throw new Error(`MeltOperation with id ${operation.id} not found`);
			const quoteId = getOperationQuoteId(operation);
			if (quoteId) {
				const duplicate = await table.where("[mintUrl+quoteId]").equals([operation.mintUrl, quoteId]).first();
				if (duplicate && duplicate.id !== operation.id) throw new Error(`MeltOperation already exists for mint ${operation.mintUrl} and quote ${quoteId}`);
			}
			const row = operationToRow$3(operation);
			row.updatedAt = getUnixTimeSeconds();
			await table.put(row);
		});
	}
	async getById(id) {
		const row = await this.db.table("coco_cashu_melt_operations").get(id);
		return row ? rowToOperation$3(row) : null;
	}
	async getByState(state) {
		return (await this.db.table("coco_cashu_melt_operations").where("state").equals(state).toArray()).map(rowToOperation$3);
	}
	async getPending() {
		return (await this.db.table("coco_cashu_melt_operations").where("state").anyOf(["executing", "pending"]).toArray()).map(rowToOperation$3);
	}
	async getByMintUrl(mintUrl) {
		return (await this.db.table("coco_cashu_melt_operations").where("mintUrl").equals(mintUrl).toArray()).map(rowToOperation$3);
	}
	async getByQuoteId(mintUrl, quoteId) {
		return (await this.db.table("coco_cashu_melt_operations").where("[mintUrl+quoteId]").equals([mintUrl, quoteId]).toArray()).map(rowToOperation$3);
	}
	async delete(id) {
		await this.db.runTransaction("rw", ["coco_cashu_melt_operations"], async (tx) => {
			await tx.table("coco_cashu_melt_operations").delete(id);
		});
	}
};

//#endregion
//#region src/repositories/AuthSessionRepository.ts
function parseBatPool(batPoolJson) {
	if (!batPoolJson) return void 0;
	return JSON.parse(batPoolJson)?.map((proof) => ({
		...proof,
		amount: deserializeAmount(proof.amount)
	}));
}
function rowToSession(row) {
	return {
		mintUrl: row.mintUrl,
		accessToken: row.accessToken,
		refreshToken: row.refreshToken ?? void 0,
		expiresAt: row.expiresAt,
		scope: row.scope ?? void 0,
		batPool: parseBatPool(row.batPoolJson)
	};
}
var IdbAuthSessionRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async getSession(mintUrl) {
		const row = await this.db.table("coco_cashu_auth_sessions").get(mintUrl);
		if (!row) return null;
		return rowToSession(row);
	}
	async saveSession(session) {
		const row = {
			mintUrl: session.mintUrl,
			accessToken: session.accessToken,
			refreshToken: session.refreshToken ?? null,
			expiresAt: session.expiresAt,
			scope: session.scope ?? null,
			batPoolJson: session.batPool ? JSON.stringify(session.batPool) : null
		};
		await this.db.table("coco_cashu_auth_sessions").put(row);
	}
	async deleteSession(mintUrl) {
		await this.db.table("coco_cashu_auth_sessions").delete(mintUrl);
	}
	async getAllSessions() {
		return (await this.db.table("coco_cashu_auth_sessions").toArray()).map(rowToSession);
	}
};

//#endregion
//#region src/repositories/MintOperationRepository.ts
const persistedStates = [
	"pending",
	"executing",
	"finalized",
	"failed"
];
const isPersistedState = (state) => persistedStates.includes(state);
const normalizeState = (state) => {
	if (state === "pending" || state === "executing" || state === "finalized" || state === "failed") return state;
	return "init";
};
const requireQuoteId = (row) => {
	if (!row.quoteId || row.quoteId.trim() === "") throw new Error(`MintOperation ${row.id} is missing required quoteId`);
	return row.quoteId;
};
const rowToOperation$2 = (row) => {
	const quoteId = requireQuoteId(row);
	const base = {
		id: row.id,
		mintUrl: row.mintUrl,
		method: row.method,
		methodData: JSON.parse(row.methodDataJson),
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3,
		error: row.error ?? void 0,
		...row.terminalFailureJson ? { terminalFailure: JSON.parse(row.terminalFailureJson) } : {}
	};
	const intent = {
		amount: deserializeAmount(row.amount ?? 0),
		unit: row.unit ?? ""
	};
	if (!isPersistedState(row.state)) return {
		...base,
		...intent,
		state: "init",
		quoteId
	};
	return {
		...base,
		...intent,
		state: normalizeState(row.state),
		quoteId,
		request: row.request ?? "",
		expiry: row.expiry ?? null,
		pubkey: row.pubkey ?? void 0,
		outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : {
			keep: [],
			send: []
		}
	};
};
const operationToRow$2 = (operation) => {
	const createdAtSeconds = Math.floor(operation.createdAt / 1e3);
	const updatedAtSeconds = Math.floor(operation.updatedAt / 1e3);
	const methodDataJson = stringifyJson(operation.methodData);
	if (operation.state === "init") return {
		id: operation.id,
		mintUrl: operation.mintUrl,
		quoteId: operation.quoteId,
		state: operation.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: operation.error ?? null,
		method: operation.method,
		methodDataJson,
		amount: serializeAmount(operation.amount),
		unit: operation.unit,
		terminalFailureJson: operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
		outputDataJson: null
	};
	return {
		id: operation.id,
		mintUrl: operation.mintUrl,
		quoteId: operation.quoteId,
		state: operation.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: operation.error ?? null,
		method: operation.method,
		methodDataJson,
		amount: serializeAmount(operation.amount),
		unit: operation.unit,
		request: operation.request,
		expiry: operation.expiry,
		pubkey: operation.pubkey ?? null,
		lastObservedRemoteState: null,
		lastObservedRemoteStateAt: null,
		terminalFailureJson: operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
		outputDataJson: JSON.stringify(operation.outputData)
	};
};
var IdbMintOperationRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async create(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_mint_operations"], async (tx) => {
			const table = tx.table("coco_cashu_mint_operations");
			if (await table.get(operation.id)) throw new Error(`MintOperation with id ${operation.id} already exists`);
			await table.add(operationToRow$2(operation));
		});
	}
	async update(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_mint_operations"], async (tx) => {
			const table = tx.table("coco_cashu_mint_operations");
			if (!await table.get(operation.id)) throw new Error(`MintOperation with id ${operation.id} not found`);
			const row = operationToRow$2(operation);
			row.updatedAt = getUnixTimeSeconds();
			await table.put(row);
		});
	}
	async getById(id) {
		const row = await this.db.table("coco_cashu_mint_operations").get(id);
		return row ? rowToOperation$2(row) : null;
	}
	async getByState(state) {
		return (await this.db.table("coco_cashu_mint_operations").where("state").anyOf([state]).toArray()).map(rowToOperation$2);
	}
	async getPending() {
		return (await this.db.table("coco_cashu_mint_operations").where("state").anyOf(["pending", "executing"]).toArray()).map(rowToOperation$2);
	}
	async getByMintUrl(mintUrl) {
		return (await this.db.table("coco_cashu_mint_operations").where("mintUrl").equals(mintUrl).toArray()).map(rowToOperation$2);
	}
	async getByQuoteId(mintUrl, method, quoteId) {
		return (await this.db.table("coco_cashu_mint_operations").where("[mintUrl+method+quoteId]").equals([
			mintUrl,
			method,
			quoteId
		]).toArray()).map(rowToOperation$2).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}
	async delete(id) {
		await this.db.runTransaction("rw", ["coco_cashu_mint_operations"], async (tx) => {
			await tx.table("coco_cashu_mint_operations").delete(id);
		});
	}
};

//#endregion
//#region src/repositories/ReceiveOperationRepository.ts
function getOperationUnit(op) {
	return op.unit ?? "sat";
}
function parseInputProofs(inputProofsJson) {
	return (inputProofsJson ? JSON.parse(inputProofsJson) : []).map((proof) => ({
		...proof,
		amount: deserializeAmount(proof.amount)
	}));
}
function rowToOperation$1(row) {
	const base = {
		id: row.id,
		mintUrl: row.mintUrl,
		unit: row.unit ?? "sat",
		amount: deserializeAmount(row.amount),
		inputProofs: parseInputProofs(row.inputProofsJson),
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3,
		error: row.error ?? void 0,
		source: row.sourceJson ? JSON.parse(row.sourceJson) : void 0
	};
	if (row.state === "init") return {
		...base,
		state: "init"
	};
	const preparedData = {
		fee: deserializeAmount(assertFieldPresent(row.fee, "fee", row.id)),
		outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : void 0
	};
	switch (row.state) {
		case "prepared": return {
			...base,
			state: "prepared",
			...preparedData
		};
		case "executing": return {
			...base,
			state: "executing",
			...preparedData
		};
		case "finalized": return {
			...base,
			state: "finalized",
			...preparedData
		};
		case "rolled_back": return {
			...base,
			state: "rolled_back",
			...preparedData
		};
		default: throw new Error(`Unknown state: ${row.state}`);
	}
}
function operationToRow$1(op) {
	const createdAtSeconds = Math.floor(op.createdAt / 1e3);
	const updatedAtSeconds = Math.floor(op.updatedAt / 1e3);
	if (op.state === "init") return {
		id: op.id,
		mintUrl: op.mintUrl,
		unit: getOperationUnit(op),
		amount: serializeAmount(op.amount),
		state: op.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: op.error ?? null,
		fee: null,
		inputProofsJson: JSON.stringify(op.inputProofs),
		outputDataJson: null,
		sourceJson: op.source ? JSON.stringify(op.source) : null
	};
	return {
		id: op.id,
		mintUrl: op.mintUrl,
		unit: getOperationUnit(op),
		amount: serializeAmount(op.amount),
		state: op.state,
		createdAt: createdAtSeconds,
		updatedAt: updatedAtSeconds,
		error: op.error ?? null,
		fee: serializeAmount(op.fee),
		inputProofsJson: JSON.stringify(op.inputProofs),
		outputDataJson: op.outputData ? JSON.stringify(op.outputData) : null,
		sourceJson: op.source ? JSON.stringify(op.source) : null
	};
}
var IdbReceiveOperationRepository = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async create(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_receive_operations"], async (tx) => {
			const table = tx.table("coco_cashu_receive_operations");
			if (await table.get(operation.id)) throw new Error(`ReceiveOperation with id ${operation.id} already exists`);
			await table.add(operationToRow$1(operation));
		});
	}
	async update(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_receive_operations"], async (tx) => {
			const table = tx.table("coco_cashu_receive_operations");
			if (!await table.get(operation.id)) throw new Error(`ReceiveOperation with id ${operation.id} not found`);
			const row = operationToRow$1(operation);
			row.updatedAt = getUnixTimeSeconds();
			await table.put(row);
		});
	}
	async getById(id) {
		const row = await this.db.table("coco_cashu_receive_operations").get(id);
		return row ? rowToOperation$1(row) : null;
	}
	async getByState(state) {
		return (await this.db.table("coco_cashu_receive_operations").where("state").equals(state).toArray()).map(rowToOperation$1);
	}
	async getPending() {
		return (await this.db.table("coco_cashu_receive_operations").where("state").anyOf(["executing"]).toArray()).map(rowToOperation$1);
	}
	async getByMintUrl(mintUrl) {
		return (await this.db.table("coco_cashu_receive_operations").where("mintUrl").equals(mintUrl).toArray()).map(rowToOperation$1);
	}
	async getByPaymentRequestAttemptId(attemptId) {
		return (await this.db.table("coco_cashu_receive_operations").toArray()).map(rowToOperation$1).find((candidate) => candidate.source?.type === "payment-request" && candidate.source.attemptId === attemptId) ?? null;
	}
	async delete(id) {
		await this.db.runTransaction("rw", ["coco_cashu_receive_operations"], async (tx) => {
			await tx.table("coco_cashu_receive_operations").delete(id);
		});
	}
};

//#endregion
//#region src/repositories/PaymentRequestReceiveRepository.ts
function operationToRow(operation) {
	return {
		id: operation.id,
		requestId: operation.requestId ?? null,
		encodedRequest: operation.encodedRequest,
		state: operation.state,
		transport: operation.transport,
		amount: serializeAmount(operation.amount),
		unit: operation.unit,
		mintsJson: JSON.stringify(operation.mints),
		singleUse: operation.singleUse ? 1 : 0,
		description: operation.description ?? null,
		createdAt: Math.floor(operation.createdAt / 1e3),
		updatedAt: Math.floor(operation.updatedAt / 1e3),
		error: operation.error ?? null,
		completedAt: operation.completedAt ? Math.floor(operation.completedAt / 1e3) : null
	};
}
function rowToOperation(row) {
	return {
		id: row.id,
		requestId: row.requestId ?? void 0,
		encodedRequest: row.encodedRequest,
		state: row.state,
		transport: row.transport,
		amount: deserializeAmount(row.amount),
		unit: row.unit,
		mints: JSON.parse(row.mintsJson),
		singleUse: row.singleUse === 1,
		description: row.description ?? void 0,
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3,
		error: row.error ?? void 0,
		completedAt: row.completedAt ? row.completedAt * 1e3 : void 0
	};
}
function attemptToRow(attempt) {
	return {
		id: attempt.id,
		requestOperationId: attempt.requestOperationId,
		requestId: attempt.requestId ?? null,
		transport: attempt.transport,
		transportMessageId: attempt.transportMessageId ?? void 0,
		payloadHash: attempt.payloadHash,
		senderPubkey: attempt.senderPubkey ?? null,
		memo: attempt.memo ?? null,
		mintUrl: attempt.mintUrl,
		unit: attempt.unit,
		grossAmount: serializeAmount(attempt.grossAmount),
		fee: attempt.fee ? serializeAmount(attempt.fee) : null,
		netAmount: attempt.netAmount ? serializeAmount(attempt.netAmount) : null,
		receiveOperationId: attempt.receiveOperationId ?? void 0,
		state: attempt.state,
		error: attempt.error ?? null,
		payloadJson: attempt.payload ? JSON.stringify(attempt.payload) : null,
		createdAt: Math.floor(attempt.createdAt / 1e3),
		updatedAt: Math.floor(attempt.updatedAt / 1e3)
	};
}
function rowToAttempt(row) {
	const payload = row.payloadJson ? JSON.parse(row.payloadJson) : void 0;
	return {
		id: row.id,
		requestOperationId: row.requestOperationId,
		requestId: row.requestId ?? void 0,
		transport: row.transport,
		transportMessageId: row.transportMessageId ?? void 0,
		payloadHash: row.payloadHash,
		senderPubkey: row.senderPubkey ?? void 0,
		memo: row.memo ?? void 0,
		mintUrl: row.mintUrl,
		unit: row.unit,
		grossAmount: deserializeAmount(row.grossAmount),
		fee: row.fee == null ? void 0 : deserializeAmount(row.fee),
		netAmount: row.netAmount == null ? void 0 : deserializeAmount(row.netAmount),
		receiveOperationId: row.receiveOperationId ?? void 0,
		state: row.state,
		error: row.error ?? void 0,
		payload,
		createdAt: row.createdAt * 1e3,
		updatedAt: row.updatedAt * 1e3
	};
}
var IdbPaymentRequestReceiveOperationRepository = class {
	constructor(db) {
		this.db = db;
	}
	async create(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_payment_request_receive_operations"], async (tx) => {
			await tx.table("coco_cashu_payment_request_receive_operations").add(operationToRow(operation));
		});
	}
	async update(operation) {
		await this.db.runTransaction("rw", ["coco_cashu_payment_request_receive_operations"], async (tx) => {
			const row = operationToRow(operation);
			row.updatedAt = getUnixTimeSeconds();
			await tx.table("coco_cashu_payment_request_receive_operations").put(row);
		});
	}
	async getById(id) {
		const row = await this.db.table("coco_cashu_payment_request_receive_operations").get(id);
		return row ? rowToOperation(row) : null;
	}
	async getByState(state) {
		return (await this.db.table("coco_cashu_payment_request_receive_operations").where("state").equals(state).toArray()).map(rowToOperation);
	}
	async getActiveByRequestId(requestId) {
		return (await this.db.table("coco_cashu_payment_request_receive_operations").where("requestId").equals(requestId).filter((row) => row.state === "active").toArray()).map(rowToOperation);
	}
	async list(filter) {
		if (filter?.state) return this.getByState(filter.state);
		return (await this.db.table("coco_cashu_payment_request_receive_operations").toArray()).map(rowToOperation);
	}
};
var IdbPaymentRequestReceiveAttemptRepository = class {
	constructor(db) {
		this.db = db;
	}
	async create(attempt) {
		await this.db.runTransaction("rw", ["coco_cashu_payment_request_receive_attempts"], async (tx) => {
			const table = tx.table("coco_cashu_payment_request_receive_attempts");
			if (attempt.transportMessageId) {
				if (await table.where("transportMessageId").equals(attempt.transportMessageId).first()) throw new Error(`PaymentRequestReceiveAttempt with transport message id ${attempt.transportMessageId} already exists`);
			}
			if (attempt.receiveOperationId) {
				if (await table.where("receiveOperationId").equals(attempt.receiveOperationId).first()) throw new Error(`PaymentRequestReceiveAttempt with receive operation id ${attempt.receiveOperationId} already exists`);
			}
			await table.add(attemptToRow(attempt));
		});
	}
	async update(attempt) {
		await this.db.runTransaction("rw", ["coco_cashu_payment_request_receive_attempts"], async (tx) => {
			const row = attemptToRow(attempt);
			row.updatedAt = getUnixTimeSeconds();
			await tx.table("coco_cashu_payment_request_receive_attempts").put(row);
		});
	}
	async getById(id) {
		const row = await this.db.table("coco_cashu_payment_request_receive_attempts").get(id);
		return row ? rowToAttempt(row) : null;
	}
	async getByRequestOperationId(requestOperationId) {
		return (await this.db.table("coco_cashu_payment_request_receive_attempts").where("requestOperationId").equals(requestOperationId).toArray()).map(rowToAttempt);
	}
	async getByReceiveOperationId(receiveOperationId) {
		const rows = await this.db.table("coco_cashu_payment_request_receive_attempts").where("receiveOperationId").equals(receiveOperationId).toArray();
		return rows[0] ? rowToAttempt(rows[0]) : null;
	}
	async getByTransportMessageId(transportMessageId) {
		const rows = await this.db.table("coco_cashu_payment_request_receive_attempts").where("transportMessageId").equals(transportMessageId).toArray();
		return rows[0] ? rowToAttempt(rows[0]) : null;
	}
	async getByPayloadHash(requestOperationId, payloadHash) {
		const row = await this.db.table("coco_cashu_payment_request_receive_attempts").where("[requestOperationId+payloadHash]").equals([requestOperationId, payloadHash]).first();
		return row ? rowToAttempt(row) : null;
	}
	async getByRequestIdAndPayloadHash(requestId, payloadHash) {
		const rows = await this.db.table("coco_cashu_payment_request_receive_attempts").where("[requestId+payloadHash]").equals([requestId, payloadHash]).toArray();
		const row = rows.find((candidate) => candidate.state === "finalized") ?? rows[0];
		return row ? rowToAttempt(row) : null;
	}
	async getByState(state) {
		return (await this.db.table("coco_cashu_payment_request_receive_attempts").where("state").equals(state).toArray()).map(rowToAttempt);
	}
	async delete(id) {
		await this.db.runTransaction("rw", ["coco_cashu_payment_request_receive_attempts"], async (tx) => {
			await tx.table("coco_cashu_payment_request_receive_attempts").delete(id);
		});
	}
};

//#endregion
//#region src/index.ts
var IndexedDbRepositories = class {
	mintRepository;
	keyRingRepository;
	counterRepository;
	keysetRepository;
	proofRepository;
	meltQuoteRepository;
	mintQuoteRepository;
	legacyMintQuoteRepository;
	historyRepository;
	sendOperationRepository;
	meltOperationRepository;
	authSessionRepository;
	mintOperationRepository;
	receiveOperationRepository;
	paymentRequestReceiveOperationRepository;
	paymentRequestReceiveAttemptRepository;
	db;
	initialized = false;
	constructor(options) {
		this.db = new IdbDb(options);
		this.mintRepository = new IdbMintRepository(this.db);
		this.keyRingRepository = new IdbKeyRingRepository(this.db);
		this.counterRepository = new IdbCounterRepository(this.db);
		this.keysetRepository = new IdbKeysetRepository(this.db);
		this.proofRepository = new IdbProofRepository(this.db);
		this.meltQuoteRepository = new IdbMeltQuoteRepository(this.db);
		this.mintQuoteRepository = new IdbMintQuoteRepository(this.db);
		this.legacyMintQuoteRepository = new IdbLegacyMintQuoteRepository(this.db);
		this.historyRepository = new IdbHistoryRepository(this.db);
		this.sendOperationRepository = new IdbSendOperationRepository(this.db);
		this.meltOperationRepository = new IdbMeltOperationRepository(this.db);
		this.authSessionRepository = new IdbAuthSessionRepository(this.db);
		this.mintOperationRepository = new IdbMintOperationRepository(this.db);
		this.receiveOperationRepository = new IdbReceiveOperationRepository(this.db);
		this.paymentRequestReceiveOperationRepository = new IdbPaymentRequestReceiveOperationRepository(this.db);
		this.paymentRequestReceiveAttemptRepository = new IdbPaymentRequestReceiveAttemptRepository(this.db);
	}
	async init() {
		if (this.initialized) return;
		if (this.db.isOpen()) {
			this.initialized = true;
			return;
		}
		await ensureSchema(this.db);
		this.initialized = true;
	}
	async withTransaction(fn) {
		if (this.db.hasAmbientTransaction) throw new Error("Nested IndexedDB Wallet transactions are not supported");
		const stores = this.db.tables.map((t) => t.name);
		return this.db.runTransaction("rw", stores, async () => {
			const scopedDb = this.db;
			return fn({
				mintRepository: new IdbMintRepository(scopedDb),
				keyRingRepository: new IdbKeyRingRepository(scopedDb),
				counterRepository: new IdbCounterRepository(scopedDb),
				keysetRepository: new IdbKeysetRepository(scopedDb),
				proofRepository: new IdbProofRepository(scopedDb),
				meltQuoteRepository: new IdbMeltQuoteRepository(scopedDb),
				mintQuoteRepository: new IdbMintQuoteRepository(scopedDb),
				legacyMintQuoteRepository: new IdbLegacyMintQuoteRepository(scopedDb),
				historyRepository: new IdbHistoryRepository(scopedDb),
				sendOperationRepository: new IdbSendOperationRepository(scopedDb),
				meltOperationRepository: new IdbMeltOperationRepository(scopedDb),
				authSessionRepository: new IdbAuthSessionRepository(scopedDb),
				mintOperationRepository: new IdbMintOperationRepository(scopedDb),
				receiveOperationRepository: new IdbReceiveOperationRepository(scopedDb),
				paymentRequestReceiveOperationRepository: new IdbPaymentRequestReceiveOperationRepository(scopedDb),
				paymentRequestReceiveAttemptRepository: new IdbPaymentRequestReceiveAttemptRepository(scopedDb)
			});
		});
	}
};

//#endregion
export { IdbAuthSessionRepository, IdbCounterRepository, IdbDb, IdbHistoryRepository, IdbKeyRingRepository, IdbKeysetRepository, IdbLegacyMintQuoteRepository, IdbMeltOperationRepository, IdbMeltQuoteRepository, IdbMintOperationRepository, IdbMintQuoteRepository, IdbMintRepository, IdbPaymentRequestReceiveAttemptRepository, IdbPaymentRequestReceiveOperationRepository, IdbProofRepository, IdbReceiveOperationRepository, IdbSendOperationRepository, IndexedDbRepositories, ensureSchema };