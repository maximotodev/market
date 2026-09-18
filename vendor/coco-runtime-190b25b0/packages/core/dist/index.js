import { $ as assertUnitAmount, A as projectSendOperation, B as getProofStateInputsFromSerializedOutputs, C as operationHistoryId, Ct as UnitMismatchError, D as projectMintOperation, E as projectMeltOperation, H as mapProofToCoreProof, L as deserializeOutputData, M as buildYHexMapsForSecrets, N as computeYHexForSecrets, O as projectOperationToHistoryEntry, Q as assertSameUnit, S as legacyHistoryId, St as TokenValidationError, T as projectLegacyHistoryRow, Tt as UnknownMintError, U as normalizeMintUrl, V as getSecretsFromSerializedOutputData, X as toAmount, Y as sumAmounts, Z as DEFAULT_UNIT, _ as mintQuoteObservationFromBolt12Response, _t as PaymentRequestError, a as deriveBolt11MintQuoteState, at as sameUnitAmount, b as isLegacyHistoryEntry, bt as QuoteIdentityConflictError, c as getMintQuoteRemoteState, ct as DerivationIndexExhaustedError, d as mintQuoteFromBolt11Response, dt as MintFetchError, et as isUnitAmountLikeObject, f as mintQuoteFromBolt12Response, ft as MintOperationError, g as mintQuoteObservationFromBolt11Response, gt as OperationInProgressError, h as assessMintQuoteClaimability, ht as NetworkError, i as applyBolt11MintQuoteStateFallback, it as parseUnitAmount, j as assertNonNegativeInteger, k as projectReceiveOperation, l as isMintQuotePending, lt as HttpResponseError, m as mintQuoteToMethodSnapshot, mt as MintQuoteValidationError, n as RepositoryTransactionConflictError, nt as normalizeUnitAmount, o as getMintQuoteAmount, ot as AuthSessionError, p as mintQuoteFromOnchainResponse, pt as MintQuoteKeyError, q as serializeOutputData, r as normalizeMeltMethodData, rt as normalizeUnitList, s as getMintQuoteAvailableAmount, st as AuthSessionExpiredError, t as parseMintSwapOperation, tt as normalizeUnit, u as isStatefulMintQuote, ut as KeysetSyncError, v as mintQuoteObservationFromOnchainResponse, vt as ProofOperationError, w as parseHistoryEntryId, wt as UnitValidationError, x as isOperationHistoryEntry, xt as SendOperationConflictError, y as compareHistoryEntries, yt as ProofValidationError, z as generateSubId } from "./parseMintSwapOperation-D_P2P6Z6.js";
import { n as ExtensionRegistrationError, t as DuplicatePluginRegistrationError } from "./types-Bs_2hNvG.js";
import { Amount, Amount as Amount$1, AuthManager, JSONInt, KeyChain, Mint, OutputData, PaymentRequest, PaymentRequestTransportType, Wallet, getDecodedToken, getDecodedToken as getDecodedToken$1, getEncodedToken, getEncodedToken as getEncodedToken$1, getP2PKWitnessSignatures, getTokenMetadata, getTokenMetadata as getTokenMetadata$1, hashToCurve, isBlsKeyset, normalizeProofAmounts, parseP2PKSecret, schnorrVerifyMessage, selectProofsRGLI, splitAmount, sumProofs } from "@cashu/cashu-ts";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/curves/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex as bytesToHex$1 } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";

//#region transactions/mints/MintMetadataTransactions.ts
var CoreMintMetadataTransactions = class {
	constructor(runner) {
		this.runner = runner;
	}
	applyObservation(observation) {
		return this.runner.run((transaction) => transaction.mintMetadata.applyObservation(observation));
	}
};

//#endregion
//#region mints/MintMetadata.ts
const MINT_REFRESH_TTL_S = 300;
/** Composes read-only interfaces; fetching a snapshot never refreshes or repairs storage. */
var StoredMintQueries = class {
	constructor(mints, keysets) {
		this.mints = mints;
		this.keysets = keysets;
	}
	async getMetadata(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const mint = (await this.mints.getAllMints()).find((item) => item.mintUrl === mintUrl);
		if (!mint) return null;
		return {
			mint,
			keysets: (await this.keysets.getKeysetsByMintUrl(mintUrl)).filter((keyset) => !isBlsKeyset(keyset.id))
		};
	}
};

//#endregion
//#region operations/send/SendRemote.ts
const VALID_PROOF_STATES = new Set([
	"UNSPENT",
	"PENDING",
	"SPENT"
]);
/** Derive the exact NUT-07 identities for a set of proof secrets. */
function getProofStateYs(expectedProofs) {
	const encoder = new TextEncoder();
	return expectedProofs.map((proof) => hashToCurve(encoder.encode(proof.secret)).toHex(true));
}
/** Validate untrusted NUT-07 evidence against the exact expected proof identities. */
function validateProofStateResponse(expectedProofs, response) {
	const expectedYs = getProofStateYs(expectedProofs);
	const expected = expectedProofs.map((proof, index) => ({
		secret: proof.secret,
		Y: expectedYs[index]
	}));
	const expectedByY = new Map(expected.map((input) => [input.Y, input]));
	if (expectedByY.size !== expected.length) return {
		status: "inconclusive",
		reason: "duplicate"
	};
	if (!Array.isArray(response)) return {
		status: "inconclusive",
		reason: "malformed"
	};
	if (response.length !== expected.length) return {
		status: "inconclusive",
		reason: "incomplete"
	};
	const stateByY = /* @__PURE__ */ new Map();
	for (const candidate of response) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {
			status: "inconclusive",
			reason: "malformed"
		};
		const stateRecord = candidate;
		const { Y, state, witness } = stateRecord;
		if (typeof Y !== "string" || typeof state !== "string" || !VALID_PROOF_STATES.has(state) || !Object.prototype.hasOwnProperty.call(stateRecord, "witness") || witness !== null && typeof witness !== "string") return {
			status: "inconclusive",
			reason: "malformed"
		};
		if (!expectedByY.has(Y)) return {
			status: "inconclusive",
			reason: "unmatched"
		};
		if (stateByY.has(Y)) return {
			status: "inconclusive",
			reason: "duplicate"
		};
		stateByY.set(Y, {
			Y,
			state,
			witness
		});
	}
	if (stateByY.size !== expected.length) return {
		status: "inconclusive",
		reason: "incomplete"
	};
	return {
		status: "complete",
		inputs: expected.map(({ secret, Y }) => ({
			secret,
			state: stateByY.get(Y)
		}))
	};
}

//#endregion
//#region proofs/KeysetSelection.ts
/** The same fee and selection model is used during preflight and authoritative reservation. */
function createKeyChain(mintUrl, unit, keysets) {
	return KeyChain.fromCache(mintUrl, unit, {
		mintUrl,
		keysets: keysets.map((keyset) => ({
			id: keyset.id,
			unit: keyset.unit,
			active: keyset.active,
			input_fee_ppk: keyset.feePpk,
			keys: keyset.keypairs
		}))
	});
}

//#endregion
//#region infra/ProofRestore.ts
/**
* Recovery-only NUT-09 observation. Unlike ordinary Restore, incomplete evidence is never
* collapsed into an empty result.
*/
async function observeOutputProofs(wallet, keysets, unit, serialized) {
	const outputData = deserializeOutputData(serialized);
	const expected = [...outputData.keep, ...outputData.send];
	if (expected.length === 0) return {
		status: "inconclusive",
		reason: "malformed",
		outputs: []
	};
	try {
		const result = await wallet.mint.restore({ outputs: expected.map((output) => output.blindedMessage) });
		if (!Array.isArray(result.outputs) || !Array.isArray(result.signatures)) return {
			status: "inconclusive",
			reason: "malformed",
			outputs: []
		};
		if (result.outputs.length === 0 && result.signatures.length === 0) return { status: "none" };
		if (result.outputs.length !== result.signatures.length) return {
			status: "inconclusive",
			reason: "malformed",
			outputs: []
		};
		const expectedByB = new Map(expected.map((output) => [output.blindedMessage.B_, output]));
		if (expectedByB.size !== expected.length) return {
			status: "inconclusive",
			reason: "malformed",
			outputs: []
		};
		const seen = /* @__PURE__ */ new Set();
		const proofs = [];
		for (let index = 0; index < result.outputs.length; index++) {
			const returned = result.outputs[index];
			const signature = result.signatures[index];
			const B_ = returned?.B_;
			if (!B_ || seen.has(B_) || !signature) return {
				status: "inconclusive",
				reason: "malformed",
				outputs: []
			};
			const output = expectedByB.get(B_);
			if (!output) return {
				status: "inconclusive",
				reason: "unmatched",
				outputs: []
			};
			if (returned.id !== output.blindedMessage.id || String(returned.amount) !== String(output.blindedMessage.amount) || signature.id !== output.blindedMessage.id || String(signature.amount) !== String(output.blindedMessage.amount)) return {
				status: "inconclusive",
				reason: "unmatched",
				outputs: []
			};
			const keyset = keysets.find((candidate) => candidate.id === signature.id);
			if (!keyset) return {
				status: "inconclusive",
				reason: "unmatched",
				outputs: []
			};
			try {
				assertSameUnit(normalizeUnit(keyset.unit), normalizeUnit(unit), "Restored proof keyset");
				proofs.push(output.toProof(signature, {
					id: keyset.id,
					keys: keyset.keypairs
				}));
			} catch {
				return {
					status: "inconclusive",
					reason: "malformed",
					outputs: []
				};
			}
			seen.add(B_);
		}
		let response;
		try {
			response = await wallet.mint.check({ Ys: getProofStateYs(proofs) });
		} catch {
			return {
				status: "inconclusive",
				reason: "unavailable",
				outputs: []
			};
		}
		const observation = validateProofStateResponse(proofs, response && typeof response === "object" && !Array.isArray(response) ? response.states : void 0);
		if (observation.status !== "complete") return {
			status: "inconclusive",
			reason: observation.reason === "unmatched" ? "unmatched" : "malformed",
			outputs: []
		};
		const stateBySecret = new Map(observation.inputs.map(({ secret, state }) => [secret, state]));
		const outputs = proofs.map((proof) => ({
			proof,
			state: stateBySecret.get(proof.secret)
		}));
		return proofs.length === expected.length ? {
			status: "complete",
			outputs
		} : {
			status: "partial",
			outputs,
			missingOutputs: expected.length - proofs.length
		};
	} catch {
		return {
			status: "inconclusive",
			reason: "unavailable",
			outputs: []
		};
	}
}
/** Remote restoration and local unblinding only. The owning workflow persists candidate proofs. */
async function restoreOutputProofs(wallet, keysets, unit, serialized) {
	const outputData = deserializeOutputData(serialized);
	const outputs = [...outputData.keep, ...outputData.send];
	if (outputs.length === 0) return [];
	const result = await wallet.mint.restore({ outputs: outputs.map((output) => output.blindedMessage) });
	const restored = [];
	for (let i = 0; i < result.outputs.length; i++) {
		const output = outputs.find((candidate) => candidate.blindedMessage.B_ === result.outputs[i]?.B_);
		const signature = result.signatures[i];
		if (!output || !signature) continue;
		const keyset = keysets.find((candidate) => candidate.id === signature.id);
		if (!keyset) continue;
		assertSameUnit(normalizeUnit(keyset.unit), normalizeUnit(unit), "Restored proof keyset");
		restored.push(output.toProof(signature, {
			id: keyset.id,
			keys: keyset.keypairs
		}));
	}
	if (restored.length === 0) return [];
	const states = await wallet.checkProofsStates(restored);
	return restored.filter((_, index) => states[index]?.state === "UNSPENT");
}

//#endregion
//#region infra/handlers/send/CashuSendRemote.ts
/** Protocol effects and unblinding. No Services, repositories, transactions, or event publisher. */
var CashuSendRemote = class {
	constructor(mint, requests, outputDataCreator) {
		this.mint = mint;
		this.requests = requests;
		this.outputDataCreator = outputDataCreator;
	}
	open(metadata, unit) {
		const mintUrl = metadata.mint.mintUrl;
		const wallet = new Wallet(new Mint(mintUrl, {
			customRequest: this.requests.getRequestFn(mintUrl),
			authProvider: this.mint.getAuthProvider(mintUrl)
		}), {
			unit,
			outputDataCreator: this.outputDataCreator,
			selectProofs: (proofs) => ({
				keep: [],
				send: normalizeProofAmounts(proofs)
			})
		});
		wallet.loadMintFromCache(metadata.mint.mintInfo, createKeyChain(mintUrl, unit, metadata.keysets).cache);
		return {
			swap: (request) => {
				const data = deserializeOutputData(request.outputData);
				const keysetId = getOutputKeysetId([...data.keep, ...data.send]);
				return wallet.send(request.amount, request.inputProofs, { keysetId }, {
					send: {
						type: "custom",
						data: data.send
					},
					keep: {
						type: "custom",
						data: data.keep
					}
				});
			},
			checkProofStates: (proofs) => wallet.checkProofsStates(proofs),
			observeReclaimInputStates: async (proofs) => {
				try {
					const response = await wallet.mint.check({ Ys: getProofStateYs(proofs) });
					return validateProofStateResponse(proofs, response && typeof response === "object" && !Array.isArray(response) ? response.states : void 0);
				} catch {
					return {
						status: "inconclusive",
						reason: "unavailable"
					};
				}
			},
			restoreOutputs: (outputs) => restoreOutputProofs(wallet, metadata.keysets, unit, outputs),
			observeReclaimOutputs: (outputs) => observeOutputProofs(wallet, metadata.keysets, unit, outputs),
			reclaim: (proofs, outputs) => {
				const data = deserializeOutputData(outputs).keep;
				const keysetId = getOutputKeysetId(data);
				return wallet.receive({
					mint: mintUrl,
					proofs,
					unit
				}, { keysetId }, {
					type: "custom",
					data
				});
			}
		};
	}
};
/** Pin unblinding to the committed output plan, even if the wallet now prefers another keyset. */
function getOutputKeysetId(outputs) {
	const keysetId = outputs[0]?.blindedMessage.id;
	if (!keysetId || outputs.some((output) => output.blindedMessage.id !== keysetId)) throw new ProofValidationError("Send outputs must specify a single non-empty keyset id");
	return keysetId;
}

//#endregion
//#region services/AuthService.ts
/**
* Core service for NUT-21/22 authentication.
*
* Orchestrates cashu-ts AuthManager (CAT/BAT lifecycle) and
* AuthSessionService (token persistence) so callers only need
* `mgr.auth.*` to authenticate with mints.
*/
var AuthService = class {
	/** Per-mint AuthManager (always present after login/restore). */
	managers = /* @__PURE__ */ new Map();
	/** Per-mint PersistingProvider wrapper (returned by getAuthProvider). */
	providers = /* @__PURE__ */ new Map();
	/** Per-mint OIDCAuth (present when refresh_token is available). */
	oidcClients = /* @__PURE__ */ new Map();
	constructor(authSessionService, mintAdapter, logger) {
		this.authSessionService = authSessionService;
		this.mintAdapter = mintAdapter;
		this.logger = logger;
	}
	/**
	* Start an OIDC Device Code authorization flow for a mint.
	*
	* Returns the device-code fields (verification_uri, user_code, etc.)
	* plus a `poll()` helper that resolves once the user authorizes.
	* After `poll()` succeeds the session is persisted and the
	* AuthProvider is wired into MintAdapter automatically.
	*/
	async startDeviceAuth(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const auth = new AuthManager(mintUrl);
		const oidc = await this.attachOIDC(mintUrl, auth);
		const device = await oidc.startDeviceAuth();
		return {
			verification_uri: device.verification_uri,
			verification_uri_complete: device.verification_uri_complete,
			user_code: device.user_code,
			poll: async () => {
				const tokens = await device.poll();
				await this.saveSessionWithPool(mintUrl, auth, {
					access_token: tokens.access_token,
					refresh_token: tokens.refresh_token,
					expires_in: tokens.expires_in
				});
				this.managers.set(mintUrl, auth);
				this.oidcClients.set(mintUrl, oidc);
				const provider = this.createPersistingProvider(mintUrl, auth);
				this.providers.set(mintUrl, provider);
				this.mintAdapter.setAuthProvider(mintUrl, provider);
				this.logger?.info("Auth session established", { mintUrl });
				return tokens;
			},
			cancel: device.cancel
		};
	}
	/**
	* Save OIDC tokens as an auth session and wire the AuthProvider.
	*
	* Use this when the caller already obtained tokens externally
	* (e.g. via Authorization Code + PKCE or password grant).
	*/
	async login(mintUrl, tokens) {
		mintUrl = normalizeMintUrl(mintUrl);
		const auth = new AuthManager(mintUrl);
		auth.setCAT(tokens.access_token);
		if (tokens.refresh_token) await this.attachOIDC(mintUrl, auth);
		const session = await this.saveSessionWithPool(mintUrl, auth, tokens);
		this.managers.set(mintUrl, auth);
		const provider = this.createPersistingProvider(mintUrl, auth);
		this.providers.set(mintUrl, provider);
		this.mintAdapter.setAuthProvider(mintUrl, provider);
		this.logger?.info("Auth login completed", { mintUrl });
		return session;
	}
	/**
	* Restore a persisted auth session and wire the AuthProvider.
	*
	* Call this on app startup for each mint that has a stored session.
	* Returns true if a session was found and restored.
	*
	* If the CAT is expired but a refreshToken exists, OIDC is attached
	* so cashu-ts can automatically refresh the CAT on the next request.
	*/
	async restore(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const session = await this.authSessionService.getSession(mintUrl);
		if (!session) return false;
		const now = Math.floor(Date.now() / 1e3);
		const expired = session.expiresAt <= now;
		if (expired && !session.refreshToken) {
			this.logger?.info("Auth session expired without refresh token, skipping restore", { mintUrl });
			return false;
		}
		const auth = new AuthManager(mintUrl);
		auth.setCAT(session.accessToken);
		if (session.batPool?.length) auth.importPool(session.batPool, "replace");
		if (session.refreshToken) try {
			await this.attachOIDC(mintUrl, auth);
		} catch (err) {
			this.logger?.warn("Failed to attach OIDC for refresh during restore", {
				mintUrl,
				cause: err instanceof Error ? err.message : String(err)
			});
			if (expired) return false;
		}
		this.managers.set(mintUrl, auth);
		const provider = this.createPersistingProvider(mintUrl, auth);
		this.providers.set(mintUrl, provider);
		this.mintAdapter.setAuthProvider(mintUrl, provider);
		this.logger?.info("Auth session restored", {
			mintUrl,
			expired
		});
		await this.authSessionService.emitUpdated(mintUrl);
		return true;
	}
	/** Delete the auth session and disconnect the AuthProvider. */
	async logout(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		await this.authSessionService.deleteSession(mintUrl);
		this.managers.delete(mintUrl);
		this.providers.delete(mintUrl);
		this.oidcClients.delete(mintUrl);
		this.mintAdapter.clearAuthProvider(mintUrl);
		this.logger?.info("Auth logout completed", { mintUrl });
	}
	/** Get a valid (non-expired) session; throws if missing or expired. */
	async getSession(mintUrl) {
		return this.authSessionService.getValidSession(mintUrl);
	}
	/** Check whether a session exists for the given mint. */
	async hasSession(mintUrl) {
		return this.authSessionService.hasSession(mintUrl);
	}
	/** Get the AuthProvider for a mint, or undefined if not authenticated. */
	getAuthProvider(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		return this.providers.get(mintUrl);
	}
	/** Get the current BAT pool size for a mint, or 0 if not authenticated. */
	getPoolSize(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		return this.managers.get(mintUrl)?.poolSize ?? 0;
	}
	/**
	* Create an OIDCAuth instance from the mint's NUT-21 metadata,
	* attach it to the AuthManager for automatic CAT refresh, and
	* register the onTokens callback for persistence.
	*/
	async attachOIDC(mintUrl, auth) {
		const oidc = await new Mint(mintUrl, { authProvider: auth }).oidcAuth({ onTokens: async (t) => {
			auth.setCAT(t.access_token);
			if (t.access_token) {
				let refreshToken = t.refresh_token;
				if (!refreshToken) refreshToken = (await this.authSessionService.getSession(mintUrl))?.refreshToken;
				this.saveSessionWithPool(mintUrl, auth, {
					access_token: t.access_token,
					refresh_token: refreshToken,
					expires_in: t.expires_in
				}).catch((err) => {
					this.logger?.error("Failed to persist session in onTokens", {
						mintUrl,
						cause: err instanceof Error ? err.message : String(err)
					});
				});
			}
		} });
		auth.attachOIDC(oidc);
		this.oidcClients.set(mintUrl, oidc);
		return oidc;
	}
	/**
	* Wrap an AuthManager so that every BAT consumption/topUp automatically
	* persists the updated pool to the session store.
	*/
	createPersistingProvider(mintUrl, auth) {
		return {
			getBlindAuthToken: async (input) => {
				const token = await auth.getBlindAuthToken(input);
				this.persistPool(mintUrl, auth);
				return token;
			},
			ensure: async (minTokens) => {
				await auth.ensure?.(minTokens);
				this.persistPool(mintUrl, auth);
			},
			getCAT: () => auth.getCAT(),
			setCAT: (cat) => auth.setCAT(cat),
			ensureCAT: (minValiditySec) => auth.ensureCAT?.(minValiditySec)
		};
	}
	persistPool(mintUrl, auth) {
		const pool = auth.exportPool();
		this.authSessionService.updateBatPool(mintUrl, pool.length > 0 ? pool : void 0).catch((err) => {
			this.logger?.error("Failed to persist BAT pool after change", {
				mintUrl,
				cause: err instanceof Error ? err.message : String(err)
			});
		});
	}
	async saveSessionWithPool(mintUrl, auth, tokens) {
		const batPool = auth.exportPool();
		return this.authSessionService.saveSession(mintUrl, tokens, batPool.length > 0 ? batPool : void 0);
	}
};

//#endregion
//#region models/MeltQuote.ts
function meltQuoteFromBoltResponse(mintUrl, method, quote, options) {
	const now = options?.now ?? Date.now();
	return {
		mintUrl,
		method,
		quoteId: quote.quote,
		quote: quote.quote,
		request: quote.request,
		amount: Amount$1.from(quote.amount),
		unit: quote.unit,
		fee_reserve: Amount$1.from(quote.fee_reserve),
		expiry: quote.expiry,
		state: quote.state,
		payment_preimage: quote.payment_preimage,
		change: quote.change,
		lastObservedRemoteState: quote.state,
		lastObservedRemoteStateAt: now,
		createdAt: now,
		updatedAt: now
	};
}
function meltQuoteFromBolt11Response(mintUrl, quote, options) {
	return meltQuoteFromBoltResponse(mintUrl, "bolt11", quote, options);
}
function meltQuoteFromBolt12Response(mintUrl, quote, options) {
	return meltQuoteFromBoltResponse(mintUrl, "bolt12", quote, options);
}
function meltQuoteFromOnchainResponse(mintUrl, quote, options) {
	const now = options?.now ?? Date.now();
	const feeOptions = normalizeOnchainFeeOptions(quote.quote, quote.fee_options);
	return {
		mintUrl,
		method: "onchain",
		quoteId: quote.quote,
		quote: quote.quote,
		request: quote.request,
		amount: Amount$1.from(quote.amount),
		unit: quote.unit,
		fee_options: feeOptions,
		expiry: quote.expiry,
		state: quote.state,
		outpoint: quote.outpoint ?? void 0,
		change: quote.change,
		lastObservedRemoteState: quote.state,
		lastObservedRemoteStateAt: now,
		createdAt: now,
		updatedAt: now
	};
}
function meltQuoteToMethodSnapshot(quote) {
	if (quote.method === "onchain") return {
		quote: quote.quoteId,
		request: quote.request,
		method: "onchain",
		amount: quote.amount,
		unit: quote.unit,
		fee_options: quote.fee_options,
		selected_fee_index: null,
		outpoint: quote.outpoint ?? null,
		expiry: quote.expiry,
		state: quote.state,
		change: quote.change
	};
	return {
		quote: quote.quoteId,
		request: quote.request,
		method: quote.method,
		amount: quote.amount,
		unit: quote.unit,
		fee_reserve: quote.fee_reserve,
		expiry: quote.expiry,
		state: quote.state,
		payment_preimage: quote.payment_preimage ?? null,
		change: quote.change
	};
}
function resolveOnchainMeltFeeOption(quote, feeIndex) {
	const feeOptions = quote.fee_options;
	if (feeOptions.length === 0) throw new Error(`Melt quote ${quote.quoteId} has no onchain fee options`);
	if (feeIndex === void 0) throw new Error(`Melt quote ${quote.quoteId} requires an explicit feeIndex`);
	const feeOption = feeOptions.find((option) => option.fee_index === feeIndex);
	if (!feeOption) throw new Error(`Melt quote ${quote.quoteId} does not include onchain fee option ${feeIndex}`);
	return {
		feeIndex,
		feeOption
	};
}
function normalizeOnchainFeeOptions(quoteId, feeOptions) {
	if (!feeOptions || feeOptions.length === 0) throw new Error(`Onchain melt quote ${quoteId} did not include fee_options`);
	const seen = /* @__PURE__ */ new Set();
	return feeOptions.map((option) => {
		if (!Number.isFinite(option.fee_index) || !Number.isInteger(option.fee_index)) throw new Error(`Onchain melt quote ${quoteId} has invalid fee_index`);
		if (seen.has(option.fee_index)) throw new Error(`Onchain melt quote ${quoteId} has duplicate fee_index ${option.fee_index}`);
		seen.add(option.fee_index);
		if (!Number.isFinite(option.estimated_blocks) || !Number.isInteger(option.estimated_blocks) || option.estimated_blocks < 0) throw new Error(`Onchain melt quote ${quoteId} has invalid estimated_blocks`);
		return {
			fee_index: option.fee_index,
			fee_reserve: Amount$1.from(option.fee_reserve),
			estimated_blocks: option.estimated_blocks
		};
	});
}

//#endregion
//#region services/AuthSessionService.ts
var AuthSessionService = class {
	repo;
	eventBus;
	logger;
	constructor(repo, eventBus, logger) {
		this.repo = repo;
		this.eventBus = eventBus;
		this.logger = logger;
	}
	/** Get a valid (non-expired) session; throws if missing or expired. */
	async getValidSession(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const session = await this.repo.getSession(mintUrl);
		if (!session) throw new AuthSessionError(mintUrl, "No auth session found");
		const now = Math.floor(Date.now() / 1e3);
		if (session.expiresAt <= now) {
			await this.eventBus.emit("auth-session:expired", { mintUrl });
			throw new AuthSessionExpiredError(mintUrl);
		}
		return session;
	}
	/** Save OIDC tokens as a session. */
	async saveSession(mintUrl, tokens, batPool) {
		mintUrl = normalizeMintUrl(mintUrl);
		const now = Math.floor(Date.now() / 1e3);
		const session = {
			mintUrl,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: now + (tokens.expires_in ?? 3600),
			scope: tokens.scope,
			batPool
		};
		await this.repo.saveSession(session);
		await this.eventBus.emit("auth-session:updated", { mintUrl });
		this.logger?.info("Auth session saved", {
			mintUrl,
			expiresAt: session.expiresAt
		});
		return session;
	}
	/** Update only the BAT pool of an existing session (no expiry recalculation, no event). */
	async updateBatPool(mintUrl, batPool) {
		mintUrl = normalizeMintUrl(mintUrl);
		const session = await this.repo.getSession(mintUrl);
		if (!session) return;
		session.batPool = batPool;
		await this.repo.saveSession(session);
		this.logger?.debug("BAT pool updated", {
			mintUrl,
			poolSize: batPool?.length ?? 0
		});
	}
	/** Delete (logout) a session. */
	async deleteSession(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		await this.repo.deleteSession(mintUrl);
		await this.eventBus.emit("auth-session:deleted", { mintUrl });
		this.logger?.info("Auth session deleted", { mintUrl });
	}
	/** Notify listeners that auth state changed (e.g. after restore) */
	async emitUpdated(mintUrl) {
		await this.eventBus.emit("auth-session:updated", { mintUrl: normalizeMintUrl(mintUrl) });
	}
	/** Get session without expiry check; returns null if missing. */
	async getSession(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		return this.repo.getSession(mintUrl);
	}
	/** Check whether a valid (non-expired) session exists for the given mint. */
	async hasSession(mintUrl) {
		try {
			await this.getValidSession(mintUrl);
			return true;
		} catch {
			return false;
		}
	}
};

//#endregion
//#region events/EventBus.ts
var EventBus = class {
	listeners = /* @__PURE__ */ new Map();
	constructor(options = {}) {
		this.options = options;
	}
	on(event, handler) {
		let set = this.listeners.get(event);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			this.listeners.set(event, set);
		}
		set.add(handler);
		return () => this.off(event, handler);
	}
	once(event, handler) {
		const wrapped = async (payload) => {
			this.off(event, wrapped);
			await handler(payload);
		};
		return this.on(event, wrapped);
	}
	off(event, handler) {
		const set = this.listeners.get(event);
		if (!set) return;
		set.delete(handler);
		if (set.size === 0) this.listeners.delete(event);
	}
	async emit(event, payload, options) {
		const set = this.listeners.get(event);
		if (!set || set.size === 0) return;
		const handlers = Array.from(set);
		const effectiveThrow = options?.throwOnError ?? this.options.throwOnError ?? false;
		if ((this.options.concurrency ?? "sequential") === "parallel") {
			const results = await Promise.allSettled(handlers.map((h) => h(payload)));
			const errors = [];
			for (const r of results) if (r.status === "rejected") {
				errors.push(r.reason);
				if (this.options.onError) await this.options.onError({
					event,
					payload,
					error: r.reason
				});
			}
			if (errors.length && effectiveThrow) throw new AggregateError(errors, `Event "${String(event)}" had ${errors.length} handler error(s)`);
			return;
		}
		const collectedErrors = [];
		for (const handler of handlers) try {
			await handler(payload);
		} catch (error) {
			if (this.options.onError) await this.options.onError({
				event,
				payload,
				error
			});
			if (effectiveThrow && options?.failFast) throw error;
			if (effectiveThrow) collectedErrors.push(error);
		}
		if (collectedErrors.length && effectiveThrow) throw new AggregateError(collectedErrors, `Event "${String(event)}" had ${collectedErrors.length} handler error(s)`);
	}
};

//#endregion
//#region services/CounterService.ts
var CounterService = class {
	counterRepo;
	eventBus;
	logger;
	constructor(counterRepo, logger, eventBus) {
		this.counterRepo = counterRepo;
		this.logger = logger;
		this.eventBus = eventBus;
	}
	async getCounter(mintUrl, keysetId) {
		const counter = await this.counterRepo.getCounter(mintUrl, keysetId);
		if (!counter) {
			const newCounter = {
				mintUrl,
				keysetId,
				counter: 0
			};
			await this.counterRepo.setCounter(mintUrl, keysetId, 0);
			this.logger?.debug("Initialized counter", {
				mintUrl,
				keysetId
			});
			return newCounter;
		}
		return counter;
	}
	async incrementCounter(mintUrl, keysetId, n) {
		assertNonNegativeInteger("n", n, this.logger);
		const current = await this.getCounter(mintUrl, keysetId);
		const updatedValue = current.counter + n;
		await this.counterRepo.setCounter(mintUrl, keysetId, updatedValue);
		const updated = {
			...current,
			counter: updatedValue
		};
		await this.eventBus?.emit("counter:updated", updated);
		this.logger?.info("Counter incremented", {
			mintUrl,
			keysetId,
			counter: updatedValue
		});
		return updated;
	}
	async overwriteCounter(mintUrl, keysetId, counter) {
		assertNonNegativeInteger("counter", counter, this.logger);
		await this.counterRepo.setCounter(mintUrl, keysetId, counter);
		const updated = {
			mintUrl,
			keysetId,
			counter
		};
		await this.eventBus?.emit("counter:updated", updated);
		this.logger?.info("Counter overwritten", {
			mintUrl,
			keysetId,
			counter
		});
		return updated;
	}
};

//#endregion
//#region services/HistoryService.ts
var HistoryService = class {
	historyRepository;
	logger;
	eventBus;
	constructor(historyRepository, eventBus, logger) {
		this.historyRepository = historyRepository;
		this.logger = logger;
		this.eventBus = eventBus;
		this.eventBus.on("send:prepared", ({ mintUrl, operation }) => {
			return this.emitProjectedSend(mintUrl, operation);
		});
		this.eventBus.on("send:pending", ({ mintUrl, operation, token }) => {
			return this.emitProjectedSend(mintUrl, this.withSendToken(operation, token));
		});
		this.eventBus.on("send:finalized", ({ mintUrl, operation }) => {
			return this.emitProjectedSend(mintUrl, operation);
		});
		this.eventBus.on("send:rolled-back", ({ mintUrl, operation }) => {
			return this.emitProjectedSend(mintUrl, operation);
		});
		this.eventBus.on("melt-op:prepared", ({ mintUrl, operation }) => {
			return this.emitProjectedMelt(mintUrl, operation);
		});
		this.eventBus.on("melt-op:pending", ({ mintUrl, operation }) => {
			return this.emitProjectedMelt(mintUrl, operation);
		});
		this.eventBus.on("melt-op:finalized", ({ mintUrl, operation }) => {
			return this.emitProjectedMelt(mintUrl, operation);
		});
		this.eventBus.on("melt-op:rolled-back", ({ mintUrl, operation }) => {
			return this.emitProjectedMelt(mintUrl, operation);
		});
		this.eventBus.on("mint-op:pending", ({ mintUrl, operation }) => {
			return this.emitProjectedMint(mintUrl, operation);
		});
		this.eventBus.on("mint-op:executing", ({ mintUrl, operation }) => {
			return this.emitProjectedMint(mintUrl, operation);
		});
		this.eventBus.on("mint-op:finalized", ({ mintUrl, operation }) => {
			return this.emitProjectedMint(mintUrl, operation);
		});
		this.eventBus.on("mint-op:failed", ({ mintUrl, operation }) => {
			return this.emitProjectedMint(mintUrl, operation);
		});
		this.eventBus.on("receive-op:finalized", ({ mintUrl, operation }) => {
			return this.emitProjectedReceive(mintUrl, operation);
		});
		this.eventBus.on("receive-op:rolled-back", ({ mintUrl, operation }) => {
			return this.emitProjectedReceive(mintUrl, operation);
		});
	}
	async getPaginatedHistory(offset = 0, limit = 25) {
		return this.historyRepository.getPaginatedHistoryEntries(limit, offset);
	}
	async getHistoryEntryById(id) {
		return this.historyRepository.getHistoryEntryById(id);
	}
	/**
	* Get the operationId for a send history entry.
	* @throws Error if entry not found, is not a send entry, or has no operation id
	*/
	async getOperationIdFromHistoryEntry(historyId) {
		const entry = await this.historyRepository.getHistoryEntryById(historyId);
		if (!entry) throw new Error(`History entry ${historyId} not found`);
		if (entry.type !== "send") throw new Error(`History entry ${historyId} is not a send entry`);
		if (!entry.operationId) throw new Error(`History entry ${historyId} is not backed by an operation`);
		return entry.operationId;
	}
	async emitProjectedSend(mintUrl, operation) {
		await this.emitProjectedEntry(mintUrl, projectSendOperation(operation), "send", operation.id);
	}
	async emitProjectedMelt(mintUrl, operation) {
		await this.emitProjectedEntry(mintUrl, projectMeltOperation(operation), "melt", operation.id);
	}
	async emitProjectedMint(mintUrl, operation) {
		await this.emitProjectedEntry(mintUrl, projectMintOperation(operation), "mint", operation.id);
	}
	async emitProjectedReceive(mintUrl, operation) {
		await this.emitProjectedEntry(mintUrl, projectReceiveOperation(operation), "receive", operation.id);
	}
	async emitProjectedEntry(mintUrl, entry, type, operationId) {
		if (!entry) return;
		try {
			await this.eventBus.emit("history:updated", {
				mintUrl,
				entry: { ...entry }
			});
		} catch (err) {
			this.logger?.error("Failed to emit history projection", {
				mintUrl,
				type,
				operationId,
				err
			});
		}
	}
	withSendToken(operation, token) {
		if (operation.state === "pending" || operation.state === "finalized") return {
			...operation,
			token
		};
		return operation;
	}
};

//#endregion
//#region services/KeyRingService.ts
var KeyRingService = class {
	constructor(keypairQueries, transactions, derivation, signer, logger) {
		this.keypairQueries = keypairQueries;
		this.transactions = transactions;
		this.derivation = derivation;
		this.signer = signer;
		this.logger = logger;
	}
	async generateNewKeyPair(options) {
		return this.generateKeyPairForPurpose("p2pk", options);
	}
	async generateMintQuoteKeyPair() {
		return await this.generateKeyPairForPurpose("nut20_mint_quote", { dumpSecretKey: true });
	}
	async generateKeyPairForPurpose(purpose, options) {
		const input = await this.derivation.prepare(purpose);
		const keyPair = await this.transactions.allocate(input);
		if (options?.dumpSecretKey) return keyPair;
		return { publicKeyHex: keyPair.publicKeyHex };
	}
	async addKeyPair(secretKey) {
		this.logger?.debug("Adding key pair with secret key...");
		if (secretKey.length !== 32) throw new Error("Secret key must be exactly 32 bytes");
		const publicKeyHex = this.getPublicKeyHex(secretKey);
		await this.transactions.importP2pkKey({
			publicKeyHex,
			secretKey,
			purpose: "p2pk"
		});
		this.logger?.debug("Key pair added", { publicKeyHex });
		return {
			publicKeyHex,
			secretKey,
			purpose: "p2pk"
		};
	}
	async removeKeyPair(publicKey) {
		this.logger?.debug("Removing key pair", { publicKey });
		await this.transactions.deleteP2pkKey(publicKey);
		this.logger?.debug("Key pair removed", { publicKey });
	}
	async getKeyPair(publicKey) {
		if (!publicKey || typeof publicKey !== "string") throw new Error("Public key is required and must be a string");
		return this.keypairQueries.getPersistedKeyPair(publicKey, "p2pk");
	}
	async getMintQuoteKeyPair(publicKey) {
		if (!publicKey || typeof publicKey !== "string") throw new Error("Public key is required and must be a string");
		return this.keypairQueries.getPersistedKeyPair(publicKey, "nut20_mint_quote");
	}
	async getLatestKeyPair() {
		return this.keypairQueries.getLatestKeyPair("p2pk");
	}
	async getAllKeyPairs() {
		return this.keypairQueries.getAllPersistedKeyPairs("p2pk");
	}
	async signProof(proof, publicKey) {
		const signedProof = await this.signer.signProof(proof, publicKey);
		this.logger?.debug("Proof signed successfully", { publicKey });
		return signedProof;
	}
	/**
	* Converts a secret key to its corresponding public key in SEC1 compressed format.
	* Note: schnorr.getPublicKey() returns a 32-byte x-only public key (BIP340).
	* We prepend '02' to create a 33-byte SEC1 compressed format as expected by Cashu.
	*/
	getPublicKeyHex(secretKey) {
		return "02" + bytesToHex(schnorr.getPublicKey(secretKey));
	}
};

//#endregion
//#region services/MintService.ts
function excludeBlsKeysets(keysets) {
	return keysets.filter((keyset) => !isBlsKeyset(keyset.id));
}
function supportsNut29MintQuoteCheckFromInfo(mintInfo, method) {
	const nuts = mintInfo.nuts;
	if (!nuts || typeof nuts !== "object") return false;
	const nut29 = nuts["29"];
	if (!nut29 || typeof nut29 !== "object") return false;
	const methods = nut29.methods;
	if (methods !== void 0) return Array.isArray(methods) && methods.includes(method);
	const nut4 = nuts["4"];
	if (!nut4 || typeof nut4 !== "object" || nut4.disabled === true) return false;
	const mintMethods = nut4.methods;
	return Array.isArray(mintMethods) && mintMethods.some((entry) => entry !== null && typeof entry === "object" && entry.method === method);
}
var MintService = class {
	mintRepo;
	keysetRepo;
	mintAdapter;
	eventBus;
	logger;
	constructor(mintRepo, keysetRepo, mintAdapter, metadata, logger, eventBus) {
		this.metadata = metadata;
		this.mintRepo = mintRepo;
		this.keysetRepo = keysetRepo;
		this.mintAdapter = mintAdapter;
		this.logger = logger;
		this.eventBus = eventBus;
	}
	/**
	* Add a new mint by URL, running a single update cycle to fetch info & keysets.
	* If the mint already exists, it ensures it is updated.
	* New mints are added as untrusted by default unless explicitly specified.
	*
	* @param mintUrl - The URL of the mint to add
	* @param options - Optional configuration
	* @param options.trusted - Whether to add the mint as trusted (default: false)
	*/
	async addMintByUrl(mintUrl, options) {
		mintUrl = normalizeMintUrl(mintUrl);
		const trusted = options?.trusted ?? false;
		this.logger?.info("Adding mint by URL", {
			mintUrl,
			trusted
		});
		const exists = await this.mintRepo.getMintByUrl(mintUrl).catch(() => null);
		if (exists) {
			if (options?.trusted !== void 0 && exists.trusted !== options.trusted) {
				await this.mintRepo.setMintTrusted(mintUrl, options.trusted);
				this.logger?.info("Updated mint trust status", {
					mintUrl,
					trusted: options.trusted
				});
				if (options.trusted) await this.eventBus?.emit("mint:trusted", { mintUrl });
				else await this.eventBus?.emit("mint:untrusted", { mintUrl });
				const updated = await this.ensureUpdatedMint(mintUrl);
				await this.eventBus?.emit("mint:updated", updated);
				return updated;
			}
			return this.ensureUpdatedMint(mintUrl);
		}
		const now = Math.floor(Date.now() / 1e3);
		const newMint = {
			mintUrl,
			name: mintUrl,
			mintInfo: {},
			trusted,
			createdAt: now,
			updatedAt: 0
		};
		const added = await this.updateMint(newMint);
		await this.eventBus?.emit("mint:added", added);
		this.logger?.info("Mint added", {
			mintUrl,
			trusted
		});
		return added;
	}
	async updateMintData(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const mint = await this.mintRepo.getMintByUrl(mintUrl).catch(() => null);
		if (!mint) {
			const now = Math.floor(Date.now() / 1e3);
			const newMint = {
				mintUrl,
				name: mintUrl,
				mintInfo: {},
				trusted: false,
				createdAt: now,
				updatedAt: 0
			};
			return this.updateMint(newMint);
		}
		return this.updateMint(mint);
	}
	async isTrustedMint(mintUrl) {
		return await this.mintRepo.isTrustedMint(normalizeMintUrl(mintUrl));
	}
	/**
	* May fetch remotely and independently commit metadata, even if the caller later fails.
	* Fresh metadata needs no transaction. Returns after commit and attempted event publication;
	* listener failures are logged and cannot turn an already committed refresh into a failure.
	* Older or equal-timestamp observations return the committed snapshot without publishing events.
	* Call only outside a Wallet transaction; runtime nesting rejection is not yet universal.
	*/
	async refreshAndCommitIfStale(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const cached = await this.metadata.queries.getMetadata(mintUrl);
		if (cached && cached.mint.updatedAt >= Math.floor(Date.now() / 1e3) - MINT_REFRESH_TTL_S) return cached;
		const observation = await this.mintAdapter.fetchMintMetadata(mintUrl, cached?.keysets ?? []);
		const result = await this.metadata.transactions.applyObservation(observation);
		if (result.applied) {
			await this.publishCommittedEvent("mint:metadata-refreshed", { mintUrl });
			await this.publishCommittedEvent("mint:updated", result.metadata);
		}
		return result.metadata;
	}
	async publishCommittedEvent(event, payload) {
		try {
			await this.eventBus?.emit(event, payload, { throwOnError: true });
		} catch (error) {
			this.logger?.error("Failed to publish committed mint metadata event", {
				event,
				error
			});
		}
	}
	/** Compatibility wrapper; new internal callers use the explicitly committing action. */
	async ensureUpdatedMint(mintUrl) {
		return this.refreshAndCommitIfStale(mintUrl);
	}
	async deleteMint(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		if (!await this.mintRepo.getMintByUrl(mintUrl).catch(() => null)) return;
		const keysets = await this.keysetRepo.getKeysetsByMintUrl(mintUrl);
		await Promise.all(keysets.map((ks) => this.keysetRepo.deleteKeyset(mintUrl, ks.id)));
		await this.mintRepo.deleteMint(mintUrl);
	}
	async getMintInfo(mintUrl) {
		const { mint } = await this.ensureUpdatedMint(normalizeMintUrl(mintUrl));
		return mint.mintInfo;
	}
	/**
	* Returns whether a mint advertises support for a top-level NUT capability.
	*
	* Supports boolean top-level capability metadata used by recovery and security
	* preflight. Mint information is resolved via
	* `getMintInfo()`, so stale local records may be refreshed and fetch failures
	* propagate to the caller. Missing, malformed, or disabled settings return
	* `false` rather than throwing.
	*/
	async supportsNut(mintUrl, nut) {
		this.assertSupportCapabilityNut(nut);
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const mintInfo = await this.getMintInfo(normalizedMintUrl);
		return this.getNutSupportSettings(mintInfo, nut)?.supported === true;
	}
	/**
	* Returns whether a mint advertises NUT-29 mint quote checks for a payment method.
	*
	* When NUT-29 omits its optional method list, enabled NUT-04 method metadata is
	* used as the source of supported mint methods. Missing or malformed metadata
	* returns `false`; mint-info refresh failures propagate unchanged.
	*/
	async supportsNut29MintQuoteCheck(mintUrl, method) {
		return supportsNut29MintQuoteCheckFromInfo(await this.getMintInfo(normalizeMintUrl(mintUrl)), method);
	}
	/**
	* Returns the bounded NUT-29 mint quote check limit for one polling group.
	*
	* Unsupported methods and malformed advertised limits use one quote per polling
	* opportunity. An omitted limit uses Coco's protocol safety cap of 100.
	*/
	async getNut29MintQuoteCheckLimit(mintUrl, method) {
		const mintInfo = await this.getMintInfo(normalizeMintUrl(mintUrl));
		if (!supportsNut29MintQuoteCheckFromInfo(mintInfo, method)) return 1;
		const maxBatchSize = mintInfo.nuts["29"].max_batch_size;
		if (maxBatchSize === void 0) return 100;
		if (!Number.isSafeInteger(maxBatchSize) || Number(maxBatchSize) < 1) return 1;
		return Math.min(Number(maxBatchSize), 100);
	}
	/**
	* Requires a mint to advertise a top-level NUT capability.
	*
	* Returns when support is advertised, throws `ProofValidationError` when
	* support is absent, and lets mint-info refresh/fetch failures propagate.
	*/
	async assertNutSupported(mintUrl, nut, scope) {
		if (await this.supportsNut(mintUrl, nut)) return;
		const context = scope ? ` for ${scope}` : "";
		throw new ProofValidationError(`${this.formatNut(nut)} support is required${context} but is not advertised by mint ${normalizeMintUrl(mintUrl)}`);
	}
	async checkPaymentMethodCapability(input) {
		const operation = this.assertPaymentMethodCapabilityOperation(input.operation);
		const nut = this.nutForPaymentMethodCapabilityOperation(operation);
		return {
			...await this.getMintMethodUnitCapability(input.mintUrl, nut, input.method, input.unit),
			operation
		};
	}
	async getMintMethodUnitCapability(mintUrl, nut, method, unit) {
		this.assertMethodCapabilityNut(nut);
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		const mintInfo = await this.getMintInfo(normalizedMintUrl);
		const settings = this.getNutMethodSettings(mintInfo, nut);
		const nutName = this.formatNut(nut);
		if (settings?.disabled === true) return {
			supported: false,
			disabled: true,
			nut,
			method,
			unit: normalizedUnit,
			reason: `${nutName} is disabled`
		};
		if (!settings || !Array.isArray(settings.methods)) return {
			supported: false,
			disabled: false,
			nut,
			method,
			unit: normalizedUnit,
			reason: `${nutName} method metadata is missing`
		};
		const matchingMethod = settings.methods.find((entry) => {
			try {
				return entry.method === method && normalizeUnit(entry.unit) === normalizedUnit;
			} catch {
				return false;
			}
		});
		if (!matchingMethod) return {
			supported: false,
			disabled: false,
			nut,
			method,
			unit: normalizedUnit,
			reason: `${nutName} method ${method} does not support unit ${normalizedUnit}`
		};
		return {
			supported: true,
			disabled: false,
			nut,
			method,
			unit: normalizedUnit,
			minAmount: this.parseOptionalAmount(matchingMethod.min_amount),
			maxAmount: this.parseOptionalAmount(matchingMethod.max_amount),
			options: matchingMethod.options
		};
	}
	async listPaymentMethodCapabilities(input) {
		const operations = input.operation === void 0 ? ["mint", "melt"] : [this.assertPaymentMethodCapabilityOperation(input.operation)];
		const unitFilter = input.unit === void 0 ? void 0 : normalizeUnit(input.unit);
		const mintInfo = await this.getMintInfo(input.mintUrl);
		const capabilities = [];
		for (const operation of operations) {
			const nut = this.nutForPaymentMethodCapabilityOperation(operation);
			const settings = this.getNutMethodSettings(mintInfo, nut);
			if (!settings || settings.disabled === true || !Array.isArray(settings.methods)) continue;
			for (const entry of settings.methods) {
				let unit;
				try {
					unit = normalizeUnit(entry.unit);
				} catch {
					continue;
				}
				if (unitFilter !== void 0 && unit !== unitFilter) continue;
				capabilities.push({
					operation,
					nut,
					method: entry.method,
					unit,
					minAmount: this.parseOptionalAmount(entry.min_amount),
					maxAmount: this.parseOptionalAmount(entry.max_amount),
					options: entry.options
				});
			}
		}
		return capabilities;
	}
	async assertMethodUnitSupported(mintUrl, nut, method, scope) {
		let unit;
		let requestedAmount;
		if (typeof scope === "string") unit = scope;
		else {
			const intent = normalizeUnitAmount(scope);
			unit = intent.unit;
			requestedAmount = intent.amount;
		}
		const capability = await this.getMintMethodUnitCapability(mintUrl, nut, method, unit);
		if (!capability.supported) throw new ProofValidationError(capability.reason ?? `${this.formatNut(nut)} method ${method} does not support unit ${capability.unit}`);
		if (requestedAmount === void 0) return;
		const amountRequirement = `${this.formatNut(nut)} method ${method} unit ${capability.unit}`;
		if (capability.minAmount && requestedAmount.lessThan(capability.minAmount)) throw new ProofValidationError(`${amountRequirement} requires amount >= ${capability.minAmount}`);
		if (capability.maxAmount && requestedAmount.greaterThan(capability.maxAmount)) throw new ProofValidationError(`${amountRequirement} requires amount <= ${capability.maxAmount}`);
	}
	async getAllMints() {
		return await this.mintRepo.getAllMints();
	}
	async getAllTrustedMints() {
		return await this.mintRepo.getAllTrustedMints();
	}
	async trustMint(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		this.logger?.info("Trusting mint", { mintUrl });
		await this.mintRepo.setMintTrusted(mintUrl, true);
		await this.eventBus?.emit("mint:trusted", { mintUrl });
		await this.eventBus?.emit("mint:updated", await this.ensureUpdatedMint(mintUrl));
	}
	async untrustMint(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		this.logger?.info("Untrusting mint", { mintUrl });
		await this.mintRepo.setMintTrusted(mintUrl, false);
		await this.eventBus?.emit("mint:untrusted", { mintUrl });
		await this.eventBus?.emit("mint:updated", await this.ensureUpdatedMint(mintUrl));
	}
	getNutMethodSettings(mintInfo, nut) {
		return mintInfo.nuts?.[String(nut)];
	}
	getNutSupportSettings(mintInfo, nut) {
		const settings = mintInfo.nuts?.[String(nut)];
		if (!settings || typeof settings !== "object") return;
		return settings;
	}
	assertMethodCapabilityNut(nut) {
		if (nut !== 4 && nut !== 5) throw new ProofValidationError(`NUT-${nut} does not define method-unit capabilities; use NUT-04 or NUT-05 method metadata`);
	}
	assertSupportCapabilityNut(nut) {
		if (nut !== 11 && nut !== 20) throw new ProofValidationError(`NUT-${nut} support capability checks are not implemented`);
	}
	formatNut(nut) {
		return `NUT-${String(nut).padStart(2, "0")}`;
	}
	assertPaymentMethodCapabilityOperation(operation) {
		if (operation !== "mint" && operation !== "melt") throw new ProofValidationError(`Invalid payment method capability operation ${operation}; use mint or melt`);
		return operation;
	}
	nutForPaymentMethodCapabilityOperation(operation) {
		return operation === "mint" ? 4 : 5;
	}
	parseOptionalAmount(amount) {
		return amount === void 0 || amount === null ? null : Amount$1.from(amount);
	}
	async updateMint(mint) {
		let mintInfo;
		try {
			this.logger?.debug("Fetching mint info", { mintUrl: mint.mintUrl });
			mintInfo = await this.mintAdapter.fetchMintInfo(mint.mintUrl);
		} catch (err) {
			this.logger?.error("Failed to fetch mint info", {
				mintUrl: mint.mintUrl,
				err
			});
			throw new MintFetchError(mint.mintUrl, void 0, err);
		}
		let keysets;
		try {
			this.logger?.debug("Fetching keysets", { mintUrl: mint.mintUrl });
			({keysets} = await this.mintAdapter.fetchKeysets(mint.mintUrl));
			keysets = excludeBlsKeysets(keysets);
		} catch (err) {
			this.logger?.error("Failed to fetch keysets", {
				mintUrl: mint.mintUrl,
				err
			});
			throw new MintFetchError(mint.mintUrl, "Failed to fetch keysets", err);
		}
		await Promise.all(keysets.map(async (ks) => {
			if (await this.keysetRepo.getKeysetById(mint.mintUrl, ks.id)) {
				const keysetModel = {
					mintUrl: mint.mintUrl,
					id: ks.id,
					unit: ks.unit,
					active: ks.active,
					feePpk: ks.input_fee_ppk || 0
				};
				return this.keysetRepo.updateKeyset(keysetModel);
			} else try {
				const keysRes = await this.mintAdapter.fetchKeysForId(mint.mintUrl, ks.id);
				return this.keysetRepo.addKeyset({
					mintUrl: mint.mintUrl,
					id: ks.id,
					unit: ks.unit,
					keypairs: keysRes,
					active: ks.active,
					feePpk: ks.input_fee_ppk || 0
				});
			} catch (err) {
				this.logger?.error("Failed to sync keyset", {
					mintUrl: mint.mintUrl,
					keysetId: ks.id,
					err
				});
				throw new KeysetSyncError(mint.mintUrl, ks.id, void 0, err);
			}
		}));
		mint.mintInfo = mintInfo;
		mint.updatedAt = Math.floor(Date.now() / 1e3);
		await this.mintRepo.addOrUpdateMint(mint);
		await this.eventBus?.emit("mint:metadata-refreshed", { mintUrl: mint.mintUrl });
		const repoKeysets = excludeBlsKeysets(await this.keysetRepo.getKeysetsByMintUrl(mint.mintUrl));
		this.logger?.info("Mint updated", {
			mintUrl: mint.mintUrl,
			keysets: repoKeysets.length
		});
		return {
			mint,
			keysets: repoKeysets
		};
	}
};

//#endregion
//#region services/PaymentRequestService.ts
var PaymentRequestService = class {
	sendOperationService;
	proofService;
	mintService;
	logger;
	constructor(sendOperationService, proofService, mintService, logger) {
		this.sendOperationService = sendOperationService;
		this.proofService = proofService;
		this.mintService = mintService;
		this.logger = logger;
	}
	/**
	* Parse and validate a payment request.
	* @param paymentRequest - The payment request to process
	* @returns The resolved payment request
	*/
	async parse(paymentRequest) {
		const decodedPaymentRequest = await this.readPaymentRequest(paymentRequest);
		const transport = this.getPaymentRequestTransport(decodedPaymentRequest);
		const unit = normalizeUnit(decodedPaymentRequest.unit, { defaultUnit: DEFAULT_UNIT });
		const spendingCondition = this.resolveSpendingCondition(decodedPaymentRequest);
		return {
			paymentRequest: decodedPaymentRequest,
			payableMints: await this.findMatchingMints(decodedPaymentRequest, unit, spendingCondition),
			allowedMints: decodedPaymentRequest.mints ?? [],
			amount: decodedPaymentRequest.amount,
			unit,
			transport,
			spendingCondition
		};
	}
	/**
	* Prepare a payment request for execution.
	*/
	async prepare(request, options) {
		const { mintUrl, amount } = options;
		this.validateMint(mintUrl, request.allowedMints);
		const finalAmount = this.validateAmount(request, amount);
		const preparedRequest = await this.resolvePreparedRequest(request, finalAmount);
		const sendOptions = await this.resolveSendOptions(preparedRequest, mintUrl);
		this.logger?.debug("Preparing payment request transaction", {
			mintUrl,
			amount: finalAmount
		});
		const initSend = await this.sendOperationService.init(mintUrl, finalAmount, sendOptions);
		const preparedSend = await this.sendOperationService.prepare(initSend);
		this.logger?.debug("Payment request transaction prepared", {
			mintUrl,
			amount: finalAmount
		});
		return {
			sendOperation: preparedSend,
			request: preparedRequest
		};
	}
	/**
	* Execute a prepared payment request.
	*/
	async execute(transaction) {
		switch (transaction.request.transport.type) {
			case "inband": {
				this.logger?.debug("Creating inband payment request token", {
					mintUrl: transaction.sendOperation.mintUrl,
					amount: transaction.request.amount
				});
				const { operation, token } = await this.sendOperationService.execute(transaction.sendOperation);
				return {
					type: "inband",
					token,
					operation,
					request: transaction.request
				};
			}
			case "http": {
				this.logger?.debug("Handling HTTP payment request", {
					mintUrl: transaction.sendOperation.mintUrl,
					amount: transaction.request.amount,
					url: transaction.request.transport.url
				});
				const { operation, token } = await this.sendOperationService.execute(transaction.sendOperation);
				const response = await fetch(transaction.request.transport.url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSONInt.stringify(token)
				});
				this.logger?.debug("HTTP payment request completed", {
					mintUrl: transaction.sendOperation.mintUrl,
					amount: transaction.request.amount,
					url: transaction.request.transport.url,
					status: response.status
				});
				return {
					type: "http",
					response,
					operation,
					request: transaction.request
				};
			}
			case "nostr": {
				const error = new PaymentRequestError("Nostr payment request execution requires a transport plugin");
				try {
					await this.sendOperationService.rollback(transaction.sendOperation.id, "Nostr payment request execution requires a transport plugin");
				} catch (cause) {
					this.logger?.error("Failed to roll back Nostr payment request send operation", {
						operationId: transaction.sendOperation.id,
						cause
					});
					throw new PaymentRequestError("Nostr payment request execution requires a transport plugin; rollback failed", cause);
				}
				throw error;
			}
		}
	}
	async readPaymentRequest(paymentRequest) {
		this.logger?.debug("Reading payment request", { paymentRequest });
		const decodedPaymentRequest = PaymentRequest.fromEncodedRequest(paymentRequest);
		this.logger?.info("Payment request decoded", { decodedPaymentRequest });
		return decodedPaymentRequest;
	}
	validateMint(mintUrl, mints) {
		if (mints && mints.length > 0 && !mints.includes(mintUrl)) throw new PaymentRequestError(`Mint ${mintUrl} is not in the allowed mints list: ${mints.join(", ")}`);
	}
	getPaymentRequestTransport(pr) {
		if (!pr.transport || Array.isArray(pr.transport) && pr.transport.length === 0) return { type: "inband" };
		if (!Array.isArray(pr.transport)) throw new PaymentRequestError("Malformed payment request: Invalid transport");
		const httpTransport = pr.transport.find((t) => t.type === PaymentRequestTransportType.POST);
		if (httpTransport) return {
			type: "http",
			url: httpTransport.target
		};
		const nostrTransport = pr.transport.find((t) => t.type === PaymentRequestTransportType.NOSTR);
		if (nostrTransport) return {
			type: "nostr",
			target: nostrTransport.target,
			tags: nostrTransport.tags
		};
		throw new PaymentRequestError("Unsupported transport type. Only HTTP POST and Nostr are supported, found: " + pr.transport.map((t) => t.type).join(", "));
	}
	async findMatchingMints(paymentRequest, unit, spendingCondition) {
		if (spendingCondition && (spendingCondition.kind === "unsupported" || spendingCondition.kind === "malformed")) return [];
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		const balances = await this.proofService.getBalancesByMint({
			trustedOnly: true,
			units: [normalizedUnit]
		});
		const amount = paymentRequest.amount ?? Amount$1.zero();
		const mintRequirement = paymentRequest.mints;
		const matchingMints = [];
		for (const [mintUrl, balance] of Object.entries(balances)) if (balance.spendable.greaterThanOrEqual(amount) && (!mintRequirement || mintRequirement.includes(mintUrl))) {
			if (spendingCondition?.kind === "P2PK") try {
				if (!await this.mintService.supportsNut(mintUrl, 11)) continue;
			} catch (cause) {
				this.logger?.warn("Skipping mint for P2PK payment request because NUT-11 support could not be verified", {
					mintUrl,
					cause
				});
				continue;
			}
			matchingMints.push(mintUrl);
		}
		return matchingMints;
	}
	resolveSpendingCondition(paymentRequest) {
		const rawNut10 = paymentRequest.nut10;
		if (!rawNut10) return;
		const nut10Kind = this.getNut10Kind(rawNut10);
		if (nut10Kind !== "P2PK") return {
			kind: "unsupported",
			nut10Kind,
			reason: `Unsupported NUT-10 spending condition '${nut10Kind}'`,
			rawNut10
		};
		try {
			const options = paymentRequest.toP2PKOptions();
			if (!options) return {
				kind: "malformed",
				nut10Kind,
				reason: "NUT-10 P2PK spending condition could not be normalized",
				rawNut10
			};
			return {
				kind: "P2PK",
				p2pk: {
					kind: "P2PK",
					options: this.requireP2pkOnlyOptions(options),
					rawNut10
				}
			};
		} catch (error) {
			return {
				kind: "malformed",
				nut10Kind,
				reason: error instanceof Error ? error.message : String(error),
				rawNut10
			};
		}
	}
	getNut10Kind(nut10) {
		const compact = nut10;
		if (typeof nut10.kind === "string" && nut10.kind.length > 0) return nut10.kind;
		if (typeof compact.k === "string" && compact.k.length > 0) return compact.k;
		return "unknown";
	}
	async resolveSendOptions(request, mintUrl) {
		const spendingCondition = request.spendingCondition;
		if (!spendingCondition) return;
		if (spendingCondition.kind === "unsupported") throw new PaymentRequestError(`Unsupported NUT-10 spending condition '${spendingCondition.nut10Kind}'`);
		if (spendingCondition.kind === "malformed") this.throwMalformedSpendingCondition(spendingCondition, request.paymentRequest);
		const options = this.normalizeP2pkOptionsForPrepare(request.paymentRequest);
		try {
			await this.mintService.assertNutSupported(mintUrl, 11, "payment request P2PK");
		} catch (cause) {
			throw new PaymentRequestError(`Mint ${mintUrl} does not support NUT-11 required by payment request P2PK`, cause);
		}
		return {
			method: "p2pk",
			methodData: { options }
		};
	}
	normalizeP2pkOptionsForPrepare(paymentRequest) {
		try {
			const options = paymentRequest.toP2PKOptions();
			if (!options) throw new PaymentRequestError("NUT-10 P2PK spending condition could not be normalized");
			return this.requireP2pkOnlyOptions(options);
		} catch (cause) {
			throw new PaymentRequestError("Malformed NUT-10 P2PK spending condition", cause);
		}
	}
	requireP2pkOnlyOptions(options) {
		if (options.kind !== "P2PK") throw new PaymentRequestError("P2PK payment requests cannot include hashlock/HTLC options");
		const { kind: _kind, data, pubkeys, ...conditions } = options;
		return {
			pubkey: pubkeys?.length ? [data, ...pubkeys] : data,
			...conditions
		};
	}
	throwMalformedSpendingCondition(spendingCondition, paymentRequest) {
		const message = `Malformed NUT-10 spending condition '${spendingCondition.nut10Kind}': ` + spendingCondition.reason;
		if (spendingCondition.nut10Kind === "P2PK") try {
			this.normalizeP2pkOptionsForPrepare(paymentRequest);
		} catch (cause) {
			throw new PaymentRequestError(message, cause);
		}
		throw new PaymentRequestError(message);
	}
	validateAmount(request, amount) {
		const providedAmount = amount?.amount;
		if (amount) {
			if (normalizeUnit(amount.unit) !== request.unit) throw new PaymentRequestError(`Unit mismatch: request specifies ${request.unit} but ${amount.unit} was provided`);
		}
		if (request.amount && providedAmount && !request.amount.equals(providedAmount)) throw new PaymentRequestError(`Amount mismatch: request specifies ${request.amount} but ${providedAmount} was provided`);
		const finalAmount = request.amount ?? providedAmount;
		if (!finalAmount) throw new PaymentRequestError("Amount is required but was not provided");
		return {
			amount: finalAmount,
			unit: request.unit
		};
	}
	async resolvePreparedRequest(request, intent) {
		const amount = intent.amount;
		const amountUnchanged = request.amount?.equals(amount) === true;
		if (amountUnchanged && !request.paymentRequest.nut10 && !request.spendingCondition) return request;
		const paymentRequest = amountUnchanged ? request.paymentRequest : new PaymentRequest(request.paymentRequest.transport, request.paymentRequest.id, amount, request.unit, request.paymentRequest.mints, request.paymentRequest.description, request.paymentRequest.singleUse, request.paymentRequest.nut10);
		const spendingCondition = this.resolveSpendingCondition(paymentRequest);
		const payableMints = await this.findMatchingMints(paymentRequest, request.unit, spendingCondition);
		return {
			...request,
			amount,
			unit: request.unit,
			payableMints,
			paymentRequest,
			spendingCondition
		};
	}
};

//#endregion
//#region operations/OperationIdLock.ts
/**
* In-memory fail-fast lock keyed by operation ID.
*
* If an operation ID is already locked, acquire throws immediately.
*/
var OperationIdLock = class {
	locks = /* @__PURE__ */ new Map();
	async acquire(operationId) {
		if (this.locks.has(operationId)) throw new OperationInProgressError(operationId);
		const entry = { waiters: [] };
		this.locks.set(operationId, entry);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (this.locks.get(operationId) !== entry) return;
			this.locks.delete(operationId);
			for (const waiter of entry.waiters) waiter();
		};
	}
	async waitForUnlock(operationId) {
		const entry = this.locks.get(operationId);
		if (!entry) return;
		await new Promise((resolve) => {
			entry.waiters.push(resolve);
		});
	}
	isLocked(operationId) {
		return this.locks.has(operationId);
	}
};

//#endregion
//#region services/PaymentRequestReceiveService.ts
var PaymentRequestReceiveService = class {
	lock = new OperationIdLock();
	constructor(operationRepository, attemptRepository, receiveOperationService, receiveOperationRepository, mintService, transportHandlerProvider, logger) {
		this.operationRepository = operationRepository;
		this.attemptRepository = attemptRepository;
		this.receiveOperationService = receiveOperationService;
		this.receiveOperationRepository = receiveOperationRepository;
		this.mintService = mintService;
		this.transportHandlerProvider = transportHandlerProvider;
		this.logger = logger;
	}
	isOperationLocked(operationId) {
		return this.lock.isLocked(operationId);
	}
	registerTransportHandler(handler) {
		return this.transportHandlerProvider.register(handler);
	}
	async acquireLockWhenAvailable(lockId) {
		while (this.lock.isLocked(lockId)) await this.lock.waitForUnlock(lockId);
		return this.lock.acquire(lockId);
	}
	async create(input) {
		const { amount, unit } = parseUnitAmount(input.amount, { explicitUnit: input.unit });
		if (input.nut10) throw new PaymentRequestError("NUT-10 receive requirements are not supported yet");
		if (amount.isZero()) throw new PaymentRequestError("Payment request amount must be positive");
		const mints = input.mints?.map((mintUrl) => normalizeMintUrl(mintUrl)) ?? [];
		for (const mintUrl of mints) if (!await this.mintService.isTrustedMint(mintUrl)) throw new PaymentRequestError(`Mint ${mintUrl} is not trusted`);
		if (input.requestId !== void 0 && input.requestId.trim() === "") throw new PaymentRequestError("Payment request id must not be blank");
		const requestId = input.requestId ?? generateSubId();
		const releaseCreateLock = await this.acquireLockWhenAvailable(`payment-request-receive:create:${requestId}`);
		try {
			if ((await this.operationRepository.getActiveByRequestId(requestId)).length > 0) throw new PaymentRequestError(`An active payment request already exists for request id ${requestId}`);
			const singleUse = input.singleUse ?? true;
			const { transport, paymentRequestTransports } = await this.resolveTransportInput(input.transport, {
				requestId,
				amount,
				unit,
				mints,
				description: input.description,
				singleUse
			});
			const paymentRequest = new PaymentRequest(paymentRequestTransports, requestId, amount, unit, mints.length > 0 ? mints : void 0, input.description, singleUse);
			const encodedRequest = input.encoding === "creqA" ? paymentRequest.toEncodedCreqA() : paymentRequest.toEncodedCreqB();
			const now = Date.now();
			const operation = {
				id: generateSubId(),
				requestId,
				encodedRequest,
				state: "active",
				transport,
				amount,
				unit,
				mints,
				singleUse,
				description: input.description,
				createdAt: now,
				updatedAt: now
			};
			await this.operationRepository.create(operation);
			try {
				await this.activateTransport(operation);
				return await this.operationRepository.getById(operation.id) ?? operation;
			} catch (error) {
				const current = await this.operationRepository.getById(operation.id);
				const hasClaimToPreserve = (await this.attemptRepository.getByRequestOperationId(operation.id)).some((attempt) => this.isInFlightAttempt(attempt) || attempt.state === "finalized");
				if (!current || current.state !== "active" || hasClaimToPreserve) throw error;
				const cancelled = {
					...current,
					state: "cancelled",
					error: error instanceof Error ? error.message : String(error),
					updatedAt: Date.now()
				};
				await this.operationRepository.update(cancelled);
				try {
					await this.deactivateTransport(cancelled, { ignoreMissingHandler: true });
				} catch (deactivationError) {
					this.logger?.warn("Payment request receive transport cleanup failed after activation", {
						operationId: cancelled.id,
						requestId: cancelled.requestId,
						transport: cancelled.transport,
						error: deactivationError
					});
				}
				throw error;
			}
		} finally {
			releaseCreateLock();
		}
	}
	async cancel(operationId, reason) {
		const releaseLock = await this.lock.acquire(operationId);
		try {
			const operation = await this.requireOperation(operationId);
			if (operation.state !== "active") throw new PaymentRequestError(`Cannot cancel payment request receive operation in state '${operation.state}'`);
			const cancelled = {
				...operation,
				state: "cancelled",
				error: reason,
				updatedAt: Date.now()
			};
			await this.operationRepository.update(cancelled);
			try {
				await this.deactivateTransport(cancelled, { ignoreMissingHandler: true });
			} catch (error) {
				this.logger?.warn("Payment request receive transport deactivation failed after cancel", {
					operationId: cancelled.id,
					requestId: cancelled.requestId,
					transport: cancelled.transport,
					error
				});
			}
			return cancelled;
		} finally {
			releaseLock();
		}
	}
	async get(operationId) {
		return this.operationRepository.getById(operationId);
	}
	async list(filter) {
		return this.operationRepository.list(filter);
	}
	async claimPayload(operationOrId, payloadInput, source) {
		const operation = await this.requireOperation(operationOrId);
		const releaseLock = await this.lock.acquire(operation.id);
		try {
			return await this.claimPayloadLocked(operation.id, payloadInput, source);
		} finally {
			releaseLock();
		}
	}
	async ingestPayload(payloadInput, source) {
		const payload = this.parsePayload(payloadInput);
		if (!payload.id) throw new PaymentRequestError("Payment request payload id is required for ingestion");
		const payloadHash = this.hashPayload(payload);
		if (source?.transportMessageId) {
			const existingByMessage = await this.attemptRepository.getByTransportMessageId(source.transportMessageId);
			if (existingByMessage) {
				if (existingByMessage.payloadHash !== payloadHash) throw new PaymentRequestError(`Transport message ${source.transportMessageId} belongs to a different payload`);
				return this.resultForStoredAttempt(existingByMessage);
			}
		}
		const existingByRequestPayload = await this.attemptRepository.getByRequestIdAndPayloadHash(payload.id, payloadHash);
		if (existingByRequestPayload?.state === "finalized") return this.resultForStoredAttempt(existingByRequestPayload);
		const candidates = await this.operationRepository.getActiveByRequestId(payload.id);
		if (candidates.length === 0) {
			if (existingByRequestPayload) return this.resultForStoredAttempt(existingByRequestPayload);
			throw new PaymentRequestError(`No active payment request found for id ${payload.id}`);
		}
		if (candidates.length > 1) throw new PaymentRequestError(`Multiple active payment requests found for id ${payload.id}`);
		const operation = candidates[0];
		const existingByPayload = await this.attemptRepository.getByPayloadHash(operation.id, payloadHash);
		if (existingByPayload) return this.resultForAttempt(operation, existingByPayload);
		return this.claimPayload(operation, payload, source);
	}
	async recoverPendingAttempts() {
		const interruptedBeforeReceive = [...await this.attemptRepository.getByState("received"), ...await this.attemptRepository.getByState("validating")];
		for (const attempt of interruptedBeforeReceive) {
			let releaseLock;
			try {
				releaseLock = await this.lock.acquire(attempt.requestOperationId);
			} catch (error) {
				if (error instanceof OperationInProgressError) {
					this.logger?.debug("Payment request receive operation is in progress, skipping pre-child recovery", {
						operationId: attempt.requestOperationId,
						attemptId: attempt.id
					});
					continue;
				}
				throw error;
			}
			try {
				const currentAttempt = await this.attemptRepository.getById(attempt.id);
				if (!currentAttempt || currentAttempt.state !== "received" && currentAttempt.state !== "validating") continue;
				const childReceive = currentAttempt.state === "validating" ? await this.receiveOperationRepository.getByPaymentRequestAttemptId(currentAttempt.id) : null;
				if (childReceive) {
					const linkedAttempt = await this.updateAttempt({
						...currentAttempt,
						state: "receiving",
						receiveOperationId: childReceive.id
					});
					await this.recoverReceivingAttemptLocked(linkedAttempt);
					continue;
				}
				await this.recoverPreChildAttemptLocked(currentAttempt);
			} finally {
				releaseLock();
			}
		}
		await this.recoverReceivingAttempts();
		await this.receiveOperationService.recoverPendingOperations();
		await this.recoverReceivingAttempts();
		await this.recoverFinalizedAttempts();
		await this.recoverActiveTransports();
	}
	async recoverActiveTransports() {
		const activeOperations = await this.operationRepository.getByState("active");
		for (const operation of activeOperations) try {
			await this.activateTransport(operation);
		} catch (error) {
			this.logger?.warn("Payment request receive transport recovery failed", {
				operationId: operation.id,
				requestId: operation.requestId,
				transport: operation.transport,
				error
			});
		}
	}
	async activateTransport(operation) {
		if (operation.transport === "inband") return;
		await this.transportHandlerProvider.get(operation.transport).activate(operation);
	}
	async deactivateTransport(operation, options) {
		if (operation.transport === "inband") return;
		const handler = this.transportHandlerProvider.getOptional(operation.transport);
		if (!handler) {
			if (options?.ignoreMissingHandler) {
				this.logger?.warn("Payment request receive transport deactivation skipped", {
					operationId: operation.id,
					requestId: operation.requestId,
					transport: operation.transport
				});
				return;
			}
			throw new PaymentRequestError(`No payment request receive transport handler registered for '${operation.transport}'`);
		}
		await handler.deactivate(operation);
	}
	async recoverFinalizedAttempts() {
		const attempts = await this.attemptRepository.getByState("finalized");
		for (const attempt of attempts) {
			const operation = await this.operationRepository.getById(attempt.requestOperationId);
			if (!operation || !operation.singleUse || operation.state !== "active") continue;
			let releaseLock;
			try {
				releaseLock = await this.lock.acquire(operation.id);
			} catch (error) {
				if (error instanceof OperationInProgressError) {
					this.logger?.debug("Payment request receive operation is in progress, skipping finalized recovery", {
						operationId: operation.id,
						attemptId: attempt.id
					});
					continue;
				}
				throw error;
			}
			try {
				const currentOperation = await this.operationRepository.getById(operation.id);
				if (currentOperation?.singleUse && currentOperation.state === "active") await this.completeIfSingleUse(currentOperation, { ignoreMissingTransportHandler: true });
			} finally {
				releaseLock();
			}
		}
	}
	async recoverReceivingAttempts() {
		const attempts = await this.attemptRepository.getByState("receiving");
		for (const attempt of attempts) {
			let releaseLock;
			try {
				releaseLock = await this.lock.acquire(attempt.requestOperationId);
			} catch (error) {
				if (error instanceof OperationInProgressError) {
					this.logger?.debug("Payment request receive operation is in progress, skipping recovery", {
						operationId: attempt.requestOperationId,
						attemptId: attempt.id
					});
					continue;
				}
				throw error;
			}
			try {
				const currentAttempt = await this.attemptRepository.getById(attempt.id);
				if (!currentAttempt || currentAttempt.state !== "receiving") continue;
				await this.recoverReceivingAttemptLocked(currentAttempt);
			} finally {
				releaseLock();
			}
		}
	}
	async recoverReceivingAttemptLocked(attempt) {
		if (!attempt.receiveOperationId) {
			await this.dropAttemptForRetryOrReject(attempt, "Missing child receive operation id");
			return;
		}
		const receiveOperation = await this.receiveOperationService.getOperation(attempt.receiveOperationId);
		if (!receiveOperation) {
			await this.dropAttemptForRetryOrReject(attempt, "Child receive operation was not found");
			return;
		}
		if (receiveOperation.state === "finalized") await this.finalizeAttemptFromReceive(attempt, receiveOperation, { ignoreMissingTransportHandler: true });
		else if (receiveOperation.state === "rolled_back") await this.rejectAttempt(attempt, receiveOperation.error ?? "Child receive operation rolled back");
		else if (receiveOperation.state === "prepared") await this.resumePreparedChildReceive(attempt, receiveOperation, { ignoreMissingTransportHandler: true });
		else if (receiveOperation.state === "init") await this.resumeInitChildReceive(attempt, receiveOperation, { ignoreMissingTransportHandler: true });
	}
	async recoverPreChildAttemptLocked(attempt) {
		const operation = await this.operationRepository.getById(attempt.requestOperationId);
		if (!operation) {
			await this.rejectAttempt(attempt, "Payment request receive operation was not found");
			return;
		}
		if (operation.state !== "active") {
			await this.rejectAttempt(attempt, `Cannot recover payload for payment request receive operation in state '${operation.state}'`);
			return;
		}
		if (!attempt.payload) {
			await this.attemptRepository.delete(attempt.id);
			this.logger?.warn("Incomplete payment request receive attempt removed for redelivery retry", {
				operationId: attempt.requestOperationId,
				attemptId: attempt.id
			});
			return;
		}
		const storedPayload = attempt.payload;
		let currentAttempt = attempt.state === "received" ? await this.updateAttempt({
			...attempt,
			state: "validating"
		}) : attempt;
		try {
			const payload = this.parsePayload(storedPayload);
			if (this.hashPayload(payload) !== currentAttempt.payloadHash) {
				await this.rejectAttempt(currentAttempt, "Stored payment request payload hash mismatch");
				return;
			}
			const grossAmount = sumProofs(payload.proofs);
			await this.validatePayload(operation, payload, grossAmount);
			await this.assertSingleUseAvailable(operation, currentAttempt.id);
			const sourceMetadata = {
				type: "payment-request",
				requestOperationId: operation.id,
				requestId: operation.requestId,
				attemptId: currentAttempt.id,
				transport: currentAttempt.transport,
				transportMessageId: currentAttempt.transportMessageId,
				senderPubkey: currentAttempt.senderPubkey,
				memo: currentAttempt.memo
			};
			const initReceive = await this.receiveOperationService.init({
				mint: payload.mint,
				unit: payload.unit,
				proofs: payload.proofs
			}, sourceMetadata);
			currentAttempt = await this.updateAttempt({
				...currentAttempt,
				state: "receiving",
				receiveOperationId: initReceive.id
			});
			await this.resumeInitChildReceive(currentAttempt, initReceive, { ignoreMissingTransportHandler: true });
		} catch (error) {
			const receiveOperation = currentAttempt.receiveOperationId ? await this.receiveOperationService.getOperation(currentAttempt.receiveOperationId) : await this.receiveOperationRepository.getByPaymentRequestAttemptId(currentAttempt.id);
			if (receiveOperation?.state === "finalized") {
				await this.finalizeAttemptFromReceive(currentAttempt, receiveOperation, { ignoreMissingTransportHandler: true });
				return;
			}
			if (receiveOperation?.state === "rolled_back") {
				await this.rejectAttempt(currentAttempt, receiveOperation.error ?? "Child receive operation rolled back");
				return;
			}
			if (receiveOperation?.state === "prepared") {
				await this.resumePreparedChildReceive(currentAttempt, receiveOperation, { ignoreMissingTransportHandler: true });
				return;
			}
			if (receiveOperation?.state === "init") {
				await this.resumeInitChildReceive(currentAttempt, receiveOperation, { ignoreMissingTransportHandler: true });
				return;
			}
			if (error instanceof PaymentRequestError || error instanceof ProofValidationError) {
				await this.rejectAttempt(currentAttempt, error instanceof Error ? error.message : String(error));
				return;
			}
			this.logger?.warn("Payment request pre-child attempt left for recovery retry", {
				attemptId: currentAttempt.id,
				operationId: currentAttempt.requestOperationId,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	async claimPayloadLocked(operationId, payloadInput, source) {
		const operation = await this.requireOperation(operationId);
		const payload = this.parsePayload(payloadInput);
		const payloadHash = this.hashPayload(payload);
		if (source?.transportMessageId) {
			const existingByMessage = await this.attemptRepository.getByTransportMessageId(source.transportMessageId);
			if (existingByMessage) {
				if (existingByMessage.requestOperationId !== operation.id) throw new PaymentRequestError(`Transport message ${source.transportMessageId} belongs to another payment request receive operation`);
				if (existingByMessage.payloadHash !== payloadHash) throw new PaymentRequestError(`Transport message ${source.transportMessageId} belongs to a different payload`);
				return this.resultForAttempt(operation, existingByMessage);
			}
		}
		const existingByPayload = await this.attemptRepository.getByPayloadHash(operation.id, payloadHash);
		if (existingByPayload) return this.resultForAttempt(operation, existingByPayload);
		if (operation.state !== "active") throw new PaymentRequestError(`Cannot claim payload for payment request receive operation in state '${operation.state}'`);
		const grossAmount = sumProofs(payload.proofs);
		const now = Date.now();
		let attempt = {
			id: generateSubId(),
			requestOperationId: operation.id,
			requestId: payload.id,
			transport: source?.transport ?? operation.transport,
			transportMessageId: source?.transportMessageId,
			payloadHash,
			senderPubkey: source?.senderPubkey,
			memo: payload.memo,
			mintUrl: payload.mint,
			unit: payload.unit,
			grossAmount,
			state: "received",
			payload,
			createdAt: now,
			updatedAt: now
		};
		await this.attemptRepository.create(attempt);
		let validationCompleted = false;
		try {
			attempt = await this.updateAttempt({
				...attempt,
				state: "validating"
			});
			await this.validatePayload(operation, payload, grossAmount);
			await this.assertSingleUseAvailable(operation, attempt.id);
			validationCompleted = true;
			const sourceMetadata = {
				type: "payment-request",
				requestOperationId: operation.id,
				requestId: operation.requestId,
				attemptId: attempt.id,
				transport: attempt.transport,
				transportMessageId: attempt.transportMessageId,
				senderPubkey: attempt.senderPubkey,
				memo: attempt.memo
			};
			const initReceive = await this.receiveOperationService.init({
				mint: payload.mint,
				unit: payload.unit,
				proofs: payload.proofs
			}, sourceMetadata);
			attempt = await this.updateAttempt({
				...attempt,
				state: "receiving",
				receiveOperationId: initReceive.id
			});
			const preparedReceive = await this.receiveOperationService.prepare(initReceive);
			const netAmount = preparedReceive.amount.subtract(preparedReceive.fee);
			attempt = await this.updateAttempt({
				...attempt,
				fee: preparedReceive.fee,
				netAmount
			});
			const finalizedReceive = await this.receiveOperationService.execute(preparedReceive);
			attempt = await this.updateAttempt({
				...attempt,
				state: "finalized",
				fee: finalizedReceive.fee,
				netAmount: finalizedReceive.amount.subtract(finalizedReceive.fee),
				payload: void 0
			});
			return {
				operation: await this.completeIfSingleUse(operation),
				attempt,
				receiveOperation: finalizedReceive
			};
		} catch (error) {
			const receiveOperation = attempt.receiveOperationId ? await this.receiveOperationService.getOperation(attempt.receiveOperationId) : void 0;
			if (receiveOperation?.state === "finalized") {
				attempt = await this.finalizeAttemptFromReceive(attempt, receiveOperation);
				return {
					operation: await this.operationRepository.getById(operation.id) ?? operation,
					attempt,
					receiveOperation
				};
			}
			if (receiveOperation?.state === "prepared" || receiveOperation?.state === "executing") {
				this.logger?.warn("Payment request receive attempt left for recovery", {
					attemptId: attempt.id,
					receiveOperationId: receiveOperation.id,
					childState: receiveOperation.state
				});
				throw error;
			}
			if (attempt.state === "finalized") throw error;
			if (validationCompleted && (!receiveOperation || receiveOperation.state === "init") && attempt.payload) {
				if (this.shouldDropAttemptForRetry(error)) {
					await this.attemptRepository.delete(attempt.id);
					this.logger?.warn("Payment request receive attempt removed for retry", {
						attemptId: attempt.id,
						receiveOperationId: attempt.receiveOperationId,
						error: error instanceof Error ? error.message : String(error)
					});
					throw error;
				}
				attempt = await this.rejectAttempt(attempt, error instanceof Error ? error.message : String(error));
				return {
					operation,
					attempt,
					receiveOperation: receiveOperation ?? void 0
				};
			}
			if (!validationCompleted && attempt.payload && this.shouldDropAttemptForRetry(error)) {
				await this.attemptRepository.delete(attempt.id);
				this.logger?.warn("Payment request receive attempt removed for retry", {
					attemptId: attempt.id,
					error: error instanceof Error ? error.message : String(error)
				});
				throw error;
			}
			attempt = await this.rejectAttempt(attempt, error instanceof Error ? error.message : String(error));
			return {
				operation,
				attempt,
				receiveOperation: receiveOperation ?? void 0
			};
		}
	}
	async resolveTransportInput(input, createInput) {
		if (!input || input === "inband" || typeof input === "object" && input.type === "inband") return {
			transport: "inband",
			paymentRequestTransports: []
		};
		if (typeof input === "string") {
			const handler = this.transportHandlerProvider.getOptional(input);
			if (!handler?.createRequestTransport) throw new PaymentRequestError(`Transport '${input}' is not supported yet`);
			const paymentRequestTransport = await handler.createRequestTransport(createInput);
			return {
				transport: input,
				paymentRequestTransports: [this.normalizePaymentRequestTransport(paymentRequestTransport)]
			};
		}
		const paymentRequestTransport = this.normalizePaymentRequestTransport(input);
		return {
			transport: this.toReceiveTransport(paymentRequestTransport.type),
			paymentRequestTransports: [paymentRequestTransport]
		};
	}
	toReceiveTransport(type) {
		switch (type) {
			case PaymentRequestTransportType.NOSTR: return "nostr";
			case PaymentRequestTransportType.POST: return "post";
			default: throw new PaymentRequestError(`Unsupported payment request transport '${type}'`);
		}
	}
	normalizePaymentRequestTransport(transport) {
		if (!transport.target || transport.target.trim().length === 0) throw new PaymentRequestError(`Transport '${transport.type}' target is required`);
		switch (transport.type) {
			case "nostr":
			case PaymentRequestTransportType.NOSTR: return {
				type: PaymentRequestTransportType.NOSTR,
				target: transport.target,
				tags: transport.tags
			};
			case "post":
			case PaymentRequestTransportType.POST: return {
				type: PaymentRequestTransportType.POST,
				target: transport.target,
				tags: transport.tags
			};
			default: throw new PaymentRequestError("Unsupported payment request transport");
		}
	}
	parsePayload(payloadInput) {
		const raw = typeof payloadInput === "string" ? JSONInt.parse(payloadInput) : payloadInput;
		if (!raw || typeof raw !== "object") throw new PaymentRequestError("Payment request payload must be an object");
		if (!raw.mint || typeof raw.mint !== "string") throw new PaymentRequestError("Payment request payload mint is required");
		if (!raw.unit || typeof raw.unit !== "string") throw new PaymentRequestError("Payment request payload unit is required");
		if (!Array.isArray(raw.proofs) || raw.proofs.length === 0) throw new PaymentRequestError("Payment request payload proofs are required");
		const proofs = raw.proofs.map((proof) => ({
			...proof,
			amount: Amount$1.from(proof.amount)
		}));
		return {
			id: raw.id,
			memo: raw.memo,
			mint: normalizeMintUrl(raw.mint),
			unit: normalizeUnit(raw.unit, { defaultUnit: DEFAULT_UNIT }),
			proofs
		};
	}
	async validatePayload(operation, payload, grossAmount) {
		if (operation.requestId !== void 0 && payload.id !== operation.requestId) throw new PaymentRequestError("Payment request payload id does not match request id");
		if (!operation.requestId && !payload.id) this.logger?.debug("Claiming id-less payment request payload by explicit operation id", { operationId: operation.id });
		if (!await this.mintService.isTrustedMint(payload.mint)) throw new PaymentRequestError(`Mint ${payload.mint} is not trusted`);
		if (operation.mints.length > 0 && !operation.mints.includes(payload.mint)) throw new PaymentRequestError(`Mint ${payload.mint} is not allowed for this request`);
		if (payload.unit !== operation.unit) throw new PaymentRequestError(`Payment request payload unit '${payload.unit}' does not match request unit '${operation.unit}'`);
		if (grossAmount.lessThan(operation.amount)) throw new PaymentRequestError("Payment request payload amount is below requested amount");
	}
	async assertSingleUseAvailable(operation, currentAttemptId) {
		if (!operation.singleUse) return;
		const blockingAttempt = (await this.attemptRepository.getByRequestOperationId(operation.id)).find((attempt) => attempt.id !== currentAttemptId && (attempt.state === "received" || attempt.state === "validating" || attempt.state === "receiving" || attempt.state === "finalized"));
		if (!blockingAttempt) return;
		if (blockingAttempt.state === "finalized") throw new PaymentRequestError("Single-use payment request has already been paid");
		throw new PaymentRequestError("Single-use payment request has an in-flight claim");
	}
	hashPayload(payload) {
		const proofYHexes = computeYHexForSecrets(payload.proofs.map((proof) => proof.secret));
		const proofSummaries = payload.proofs.map((proof, index) => {
			const { id, amount, C, secret: _secret, ...proofMetadata } = proof;
			return {
				y: proofYHexes[index] ?? "",
				id,
				amount: Amount$1.from(amount).toString(),
				C,
				metadata: this.canonicalizePayloadHashValue(proofMetadata)
			};
		}).sort((a, b) => a.y.localeCompare(b.y));
		const canonical = JSON.stringify({
			id: payload.id,
			memo: payload.memo,
			mint: payload.mint,
			unit: payload.unit,
			proofs: proofSummaries
		});
		return bytesToHex$1(sha256(new TextEncoder().encode(canonical)));
	}
	canonicalizePayloadHashValue(value) {
		if (value === void 0) return;
		if (typeof value === "bigint") return value.toString();
		if (Array.isArray(value)) return value.map((item) => this.canonicalizePayloadHashValue(item));
		if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, entryValue]) => [key, this.canonicalizePayloadHashValue(entryValue)]));
		return value;
	}
	async updateAttempt(attempt) {
		const updated = {
			...attempt,
			updatedAt: Date.now()
		};
		await this.attemptRepository.update(updated);
		return updated;
	}
	async rejectAttempt(attempt, error) {
		return this.updateAttempt({
			...attempt,
			state: "rejected",
			error,
			payload: void 0
		});
	}
	async dropAttemptForRetryOrReject(attempt, error) {
		if (attempt.payload) {
			await this.attemptRepository.delete(attempt.id);
			this.logger?.warn("Payment request receive attempt removed for redelivery retry", {
				attemptId: attempt.id,
				receiveOperationId: attempt.receiveOperationId,
				error
			});
			return;
		}
		await this.rejectAttempt(attempt, error);
	}
	shouldDropAttemptForRetry(error) {
		return !(error instanceof PaymentRequestError || error instanceof ProofValidationError);
	}
	async finalizeAttemptFromReceive(attempt, receiveOperation, options) {
		const finalized = await this.updateAttempt({
			...attempt,
			state: "finalized",
			fee: receiveOperation.fee,
			netAmount: receiveOperation.amount.subtract(receiveOperation.fee),
			payload: void 0
		});
		const operation = await this.operationRepository.getById(finalized.requestOperationId);
		if (operation) await this.completeIfSingleUse(operation, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
		return finalized;
	}
	async resumePreparedChildReceive(attempt, receiveOperation, options) {
		try {
			const finalizedReceive = await this.receiveOperationService.execute(receiveOperation);
			await this.finalizeAttemptFromReceive(attempt, finalizedReceive, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
		} catch (error) {
			const latestReceive = await this.receiveOperationService.getOperation(receiveOperation.id);
			if (!latestReceive) {
				await this.rejectAttempt(attempt, "Child receive operation was not found after resume");
				return;
			}
			if (latestReceive.state === "finalized") {
				await this.finalizeAttemptFromReceive(attempt, latestReceive, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
				return;
			}
			if (latestReceive.state === "rolled_back") {
				await this.rejectAttempt(attempt, latestReceive.error ?? "Child receive operation rolled back");
				return;
			}
			this.logger?.warn("Payment request prepared child receive left for recovery retry", {
				attemptId: attempt.id,
				receiveOperationId: receiveOperation.id,
				childState: latestReceive.state,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	async resumeInitChildReceive(attempt, receiveOperation, options) {
		try {
			const preparedReceive = await this.receiveOperationService.prepare(receiveOperation);
			const netAmount = preparedReceive.amount.subtract(preparedReceive.fee);
			const updatedAttempt = await this.updateAttempt({
				...attempt,
				fee: preparedReceive.fee,
				netAmount
			});
			await this.resumePreparedChildReceive(updatedAttempt, preparedReceive, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
		} catch (error) {
			const latestReceive = await this.receiveOperationService.getOperation(receiveOperation.id);
			if (!latestReceive || latestReceive.state === "init") {
				const message = error instanceof Error ? error.message : String(error);
				if (this.shouldDropAttemptForRetry(error)) await this.dropAttemptForRetryOrReject(attempt, message);
				else await this.rejectAttempt(attempt, message);
				return;
			}
			if (latestReceive.state === "finalized") {
				await this.finalizeAttemptFromReceive(attempt, latestReceive, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
				return;
			}
			if (latestReceive.state === "rolled_back") {
				await this.rejectAttempt(attempt, latestReceive.error ?? "Child receive operation rolled back");
				return;
			}
			if (latestReceive.state === "prepared") {
				await this.resumePreparedChildReceive(attempt, latestReceive, { ignoreMissingTransportHandler: options?.ignoreMissingTransportHandler });
				return;
			}
			this.logger?.warn("Payment request init child receive left for recovery retry", {
				attemptId: attempt.id,
				receiveOperationId: receiveOperation.id,
				childState: latestReceive.state,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	async completeIfSingleUse(operation, options) {
		if (!operation.singleUse) return operation;
		const completed = {
			...operation,
			state: "completed",
			completedAt: Date.now(),
			updatedAt: Date.now()
		};
		await this.operationRepository.update(completed);
		try {
			await this.deactivateTransport(completed, { ignoreMissingHandler: options?.ignoreMissingTransportHandler });
		} catch (error) {
			this.logger?.warn("Payment request receive transport deactivation failed after completion", {
				operationId: completed.id,
				requestId: completed.requestId,
				transport: completed.transport,
				error
			});
		}
		return completed;
	}
	async resultForAttempt(operation, attempt) {
		if (this.isInFlightAttempt(attempt)) throw new OperationInProgressError(operation.id);
		const receiveOperation = attempt.receiveOperationId ? await this.receiveOperationService.getOperation(attempt.receiveOperationId) : void 0;
		return {
			operation: await this.operationRepository.getById(operation.id) ?? operation,
			attempt,
			receiveOperation: receiveOperation ?? void 0
		};
	}
	async resultForStoredAttempt(attempt) {
		const operation = await this.operationRepository.getById(attempt.requestOperationId);
		if (!operation) throw new PaymentRequestError(`Payment request receive operation ${attempt.requestOperationId} not found`);
		return this.resultForAttempt(operation, attempt);
	}
	isInFlightAttempt(attempt) {
		return attempt.state === "received" || attempt.state === "validating" || attempt.state === "receiving";
	}
	async requireOperation(operationOrId) {
		if (typeof operationOrId !== "string") return operationOrId;
		const operation = await this.operationRepository.getById(operationOrId);
		if (!operation) throw new PaymentRequestError(`Payment request receive operation ${operationOrId} not found`);
		return operation;
	}
};

//#endregion
//#region services/WalletService.ts
var WalletService = class {
	walletCache = /* @__PURE__ */ new Map();
	CACHE_TTL = 300 * 1e3;
	mintService;
	seedService;
	inFlight = /* @__PURE__ */ new Map();
	logger;
	requestProvider;
	authProviderGetter;
	outputDataCreator;
	constructor(mintService, seedService, requestProvider, logger, authProviderGetter, outputDataCreator) {
		this.mintService = mintService;
		this.seedService = seedService;
		this.requestProvider = requestProvider;
		this.logger = logger;
		this.authProviderGetter = authProviderGetter;
		this.outputDataCreator = outputDataCreator;
	}
	async getWallet(mintUrl, unit) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new Error("mintUrl is required");
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const normalizedUnit = normalizeUnit(unit);
		const cacheKey = this.getWalletCacheKey(normalizedMintUrl, normalizedUnit);
		const cached = this.walletCache.get(cacheKey);
		if (cached && Date.now() - cached.lastCheck < this.CACHE_TTL) {
			this.logger?.debug("Wallet served from cache", {
				mintUrl: normalizedMintUrl,
				unit: normalizedUnit
			});
			return cached.wallet;
		}
		const existing = this.inFlight.get(cacheKey);
		if (existing) return existing;
		const promise = this.buildWallet(normalizedMintUrl, normalizedUnit).finally(() => {
			this.inFlight.delete(cacheKey);
		});
		this.inFlight.set(cacheKey, promise);
		return promise;
	}
	async getWalletWithActiveKeysetId(mintUrl, unit) {
		const normalizedUnit = normalizeUnit(unit);
		const wallet = await this.getWallet(mintUrl, normalizedUnit);
		const keyset = wallet.keyChain.getCheapestKeyset();
		const mintKeys = keyset.toMintKeys();
		const mintKeyset = keyset.toMintKeyset();
		if (mintKeys === null) throw new Error("MintKeys is null. Cannot return a valid response.");
		const keysetUnit = this.normalizeKeysetUnit(mintKeyset.unit);
		if (keysetUnit !== normalizedUnit) throw new Error(`Active keyset ${keyset.id} unit ${keysetUnit} does not match requested unit ${normalizedUnit}`);
		return {
			wallet,
			keysetId: keyset.id,
			keyset: mintKeyset,
			keys: mintKeys,
			unit: normalizedUnit
		};
	}
	/**
	* Clear cached wallet for a specific mint URL
	*/
	clearCache(mintUrl, unit) {
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		if (unit !== void 0) {
			const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
			const cacheKey = this.getWalletCacheKey(normalizedMintUrl, normalizedUnit);
			this.walletCache.delete(cacheKey);
			this.inFlight.delete(cacheKey);
			this.logger?.debug("Wallet cache cleared", {
				mintUrl: normalizedMintUrl,
				unit: normalizedUnit
			});
			return;
		}
		const prefix = `${normalizedMintUrl}::`;
		for (const key of this.walletCache.keys()) if (key.startsWith(prefix)) this.walletCache.delete(key);
		for (const key of this.inFlight.keys()) if (key.startsWith(prefix)) this.inFlight.delete(key);
		this.logger?.debug("Wallet cache cleared", { mintUrl: normalizedMintUrl });
	}
	/**
	* Clear all cached wallets
	*/
	clearAllCaches() {
		this.walletCache.clear();
		this.inFlight.clear();
		this.logger?.debug("All wallet caches cleared");
	}
	/**
	* Force refresh mint data and get fresh wallet
	*/
	async refreshWallet(mintUrl, unit) {
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const normalizedUnit = normalizeUnit(unit);
		this.clearCache(normalizedMintUrl, normalizedUnit);
		await this.mintService.updateMintData(normalizedMintUrl);
		return this.getWallet(normalizedMintUrl, normalizedUnit);
	}
	getWalletCacheKey(mintUrl, unit) {
		return `${normalizeMintUrl(mintUrl)}::${normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT })}`;
	}
	normalizeKeysetUnit(unit) {
		return normalizeUnit(unit || DEFAULT_UNIT, { defaultUnit: DEFAULT_UNIT });
	}
	async buildWallet(mintUrl, unit) {
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const normalizedUnit = normalizeUnit(unit);
		const { mint, keysets } = await this.mintService.ensureUpdatedMint(normalizedMintUrl);
		const validKeysets = keysets.filter((keyset) => !isBlsKeyset(keyset.id) && keyset.keypairs && Object.keys(keyset.keypairs).length > 0 && this.normalizeKeysetUnit(keyset.unit) === normalizedUnit);
		if (validKeysets.length === 0) throw new Error(`No valid keysets found for mint ${normalizedMintUrl} and unit ${normalizedUnit}`);
		const keysetCache = validKeysets.map((keyset) => ({
			id: keyset.id,
			unit: this.normalizeKeysetUnit(keyset.unit),
			active: keyset.active,
			input_fee_ppk: keyset.feePpk,
			keys: keyset.keypairs
		}));
		const cache = {
			mintUrl: mint.mintUrl,
			keysets: keysetCache
		};
		const seed = await this.seedService.getSeed();
		const requestFn = this.requestProvider.getRequestFn(normalizedMintUrl);
		const authProvider = this.authProviderGetter?.(normalizedMintUrl);
		const wallet = new Wallet(new Mint(normalizedMintUrl, {
			customRequest: requestFn,
			authProvider
		}), {
			unit: normalizedUnit,
			logger: this.logger && this.logger.child ? this.logger.child({ module: "Wallet" }) : void 0,
			bip39seed: seed,
			outputDataCreator: this.outputDataCreator
		});
		wallet.loadMintFromCache(mint.mintInfo, cache);
		this.walletCache.set(this.getWalletCacheKey(normalizedMintUrl, normalizedUnit), {
			wallet,
			lastCheck: Date.now()
		});
		this.logger?.info("Wallet built", {
			mintUrl: normalizedMintUrl,
			unit: normalizedUnit,
			keysetCount: validKeysets.length
		});
		return wallet;
	}
};

//#endregion
//#region services/ProofService.ts
function countBlankOutputsForAmount(amount) {
	const value = amount.toBigInt();
	if (value === 0n) return 0;
	return Math.max((value - 1n).toString(2).length, 1);
}
var ProofService = class {
	counterService;
	proofRepository;
	eventBus;
	walletService;
	mintService;
	signer;
	seedService;
	logger;
	outputDataCreator;
	constructor(counterService, proofRepository, walletService, mintService, signer, seedService, logger, eventBus, outputDataCreator) {
		this.counterService = counterService;
		this.walletService = walletService;
		this.mintService = mintService;
		this.signer = signer;
		this.proofRepository = proofRepository;
		this.seedService = seedService;
		this.logger = logger;
		this.eventBus = eventBus;
		this.outputDataCreator = outputDataCreator ?? OutputData;
	}
	/**
	* Calculates the send amount including receiver fees.
	* This is used when the sender pays fees for the receiver.
	*/
	async calculateSendAmountWithFees(mintUrl, intent) {
		const { amount: requestedSendAmount, unit } = normalizeUnitAmount(intent);
		const { wallet, keys, keysetId } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
		let denominations = splitAmount(requestedSendAmount, keys.keys);
		let receiveFee = wallet.getFeesForKeyset(denominations.length, keysetId);
		let receiveFeeAmounts = splitAmount(receiveFee, keys.keys);
		while (wallet.getFeesForKeyset(denominations.length + receiveFeeAmounts.length, keysetId).greaterThan(receiveFee)) {
			receiveFee = receiveFee.add(1);
			receiveFeeAmounts = splitAmount(receiveFee, keys.keys);
		}
		return requestedSendAmount.add(receiveFee);
	}
	async checkInflightProofs() {
		const inflightProofs = await this.proofRepository.getInflightProofs();
		this.logger?.debug("Checking inflight proofs", { count: inflightProofs.length });
		if (inflightProofs.length === 0) return;
		const batchedByMintAndUnit = /* @__PURE__ */ new Map();
		for (const proof of inflightProofs) {
			const mintUrl = proof.mintUrl;
			if (!mintUrl) continue;
			const unit = normalizeUnit(proof.unit, { defaultUnit: DEFAULT_UNIT });
			const batchKey = `${mintUrl}::${unit}`;
			(batchedByMintAndUnit.get(batchKey) ?? (() => {
				const next = {
					mintUrl,
					unit,
					proofs: []
				};
				batchedByMintAndUnit.set(batchKey, next);
				return next;
			})()).proofs.push(proof);
		}
		for (const { mintUrl, unit, proofs } of batchedByMintAndUnit.values()) {
			if (!proofs || proofs.length === 0) continue;
			this.logger?.debug("Checking inflight proofs for mint", {
				mintUrl,
				unit,
				count: proofs.length
			});
			try {
				const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
				const proofStates = await wallet.checkProofsStates(proofs);
				if (!Array.isArray(proofStates) || proofStates.length !== proofs.length) {
					this.logger?.warn("Malformed proof state check response", {
						mintUrl,
						expected: proofs.length,
						received: proofStates?.length ?? 0
					});
					continue;
				}
				const spentSecrets = proofStates.reduce((acc, state, index) => {
					if (state?.state === "SPENT" && proofs[index]?.secret) acc.push(proofs[index].secret);
					return acc;
				}, []);
				if (spentSecrets.length > 0) {
					await this.setProofState(mintUrl, spentSecrets, "spent");
					this.logger?.info("Marked inflight proofs as spent after check", {
						mintUrl,
						unit,
						count: spentSecrets.length
					});
				}
			} catch (error) {
				this.logger?.warn("Failed to check inflight proofs for mint", {
					mintUrl,
					unit,
					error
				});
			}
		}
	}
	async createOutputsAndIncrementCounters(mintUrl, amount, options) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		const keep = normalizeUnitAmount(amount.keep);
		const send = normalizeUnitAmount(amount.send);
		assertSameUnit(keep.unit, send.unit, "Output amount");
		const requestedKeep = keep.amount;
		const requestedSend = send.amount;
		const unit = keep.unit;
		const { wallet, keys, keysetId } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
		const seed = await this.seedService.getSeed();
		const currentCounter = await this.counterService.getCounter(mintUrl, keys.id);
		const data = {
			keep: [],
			send: []
		};
		let sendAmount = requestedSend;
		let keepAmount = requestedKeep;
		if (options?.includeFees && !requestedSend.isZero()) {
			sendAmount = await this.calculateSendAmountWithFees(mintUrl, {
				amount: requestedSend,
				unit
			});
			const feeAmount = sendAmount.subtract(requestedSend);
			keepAmount = requestedKeep.greaterThanOrEqual(feeAmount) ? requestedKeep.subtract(feeAmount) : Amount$1.zero();
			this.logger?.debug("Fee calculation for send amount", {
				mintUrl,
				unit,
				originalSendAmount: requestedSend.toString(),
				originalKeepAmount: requestedKeep.toString(),
				feeAmount: feeAmount.toString(),
				finalSendAmount: sendAmount.toString(),
				adjustedKeepAmount: keepAmount.toString()
			});
		}
		if (!keepAmount.isZero()) {
			data.keep = this.outputDataCreator.createDeterministicData(keepAmount, seed, currentCounter.counter, keys);
			if (data.keep.length > 0) await this.counterService.incrementCounter(mintUrl, keys.id, data.keep.length);
		}
		if (!sendAmount.isZero()) {
			data.send = this.outputDataCreator.createDeterministicData(sendAmount, seed, currentCounter.counter + data.keep.length, keys);
			if (data.send.length > 0) await this.counterService.incrementCounter(mintUrl, keys.id, data.send.length);
		}
		this.logger?.debug("Deterministic outputs created", {
			mintUrl,
			unit,
			keysetId: keys.id,
			amount,
			outputs: data.keep.length + data.send.length
		});
		return {
			keep: data.keep,
			send: data.send,
			sendAmount,
			keepAmount
		};
	}
	async saveProofs(mintUrl, proofs) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!Array.isArray(proofs) || proofs.length === 0) return;
		const normalizedProofs = proofs.map((proof) => ({
			...proof,
			unit: normalizeUnit(proof.unit)
		}));
		const groupedByKeyset = this.groupProofsByKeysetId(normalizedProofs);
		const tasks = Array.from(groupedByKeyset.entries()).map(([keysetId, group]) => (async () => {
			await this.proofRepository.saveProofs(mintUrl, group);
			await this.eventBus?.emit("proofs:saved", {
				mintUrl,
				keysetId,
				proofs: group
			});
			this.logger?.info("Proofs saved", {
				mintUrl,
				keysetId,
				count: group.length
			});
		})().catch((error) => {
			throw {
				keysetId,
				error
			};
		}));
		const failed = (await Promise.allSettled(tasks)).filter((r) => r.status === "rejected");
		if (failed.length > 0) {
			for (const fr of failed) {
				const { keysetId, error } = fr.reason;
				this.logger?.error("Failed to persist proofs for keyset", {
					mintUrl,
					keysetId,
					error
				});
			}
			const details = failed.map((fr) => fr.reason);
			const failedKeysets = details.map((d) => d.keysetId).filter((id) => Boolean(id));
			const aggregate = new AggregateError(details.map((d) => d?.error instanceof Error ? d.error : new Error(String(d?.error))), `Failed to persist proofs for ${failed.length} keyset group(s)`);
			throw new ProofOperationError(mintUrl, failedKeysets.length > 0 ? `Failed to persist proofs for ${failed.length} keyset group(s) [${failedKeysets.join(", ")}]` : `Failed to persist proofs for ${failed.length} keyset group(s)`, void 0, aggregate);
		}
	}
	async getReadyProofs(mintUrl, filter) {
		return this.proofRepository.getReadyProofs(mintUrl, filter);
	}
	async getAllReadyProofs(filter) {
		return this.proofRepository.getAllReadyProofs(filter);
	}
	/**
	* Gets the total balance for a single mint.
	* @param mintUrl - The URL of the mint
	* @returns The total balance for the mint
	*/
	async getBalance(mintUrl) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		return (await this.getBalancesByMint({ mintUrls: [mintUrl] }))[mintUrl]?.total ?? Amount$1.zero();
	}
	/**
	* Gets the spendable balance for a single mint.
	* @param mintUrl - The URL of the mint
	* @returns The spendable balance for the mint
	*/
	async getSpendableBalance(mintUrl) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		return (await this.getBalancesByMint({ mintUrls: [mintUrl] }))[mintUrl]?.spendable ?? Amount$1.zero();
	}
	/**
	* Gets the full balance breakdown for a single mint.
	* @param mintUrl - The URL of the mint
	* @returns Balance breakdown with ready, reserved, and total amounts
	*/
	async getBalanceBreakdown(mintUrl) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		const balance = await this.getBalancesByMint({ mintUrls: [mintUrl] });
		return this.snapshotToBreakdown(balance[mintUrl] ?? this.emptyBalanceSnapshot());
	}
	/**
	* Gets balances for all mints.
	* @returns An object mapping mint URLs to their total balances
	*/
	async getBalances() {
		const balances = await this.getBalancesByMint();
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, balance.total]));
	}
	/**
	* Gets spendable balances for all mints.
	* @returns An object mapping mint URLs to their spendable balances
	*/
	async getSpendableBalances() {
		const balances = await this.getBalancesByMint();
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, balance.spendable]));
	}
	/**
	* Gets canonical balances for all mints with spendable, reserved, and total amounts.
	* @returns An object mapping mint URLs to their balances
	*/
	async getBalancesByMint(scope) {
		const unit = this.getSingleBalanceUnit(scope, "getBalancesByMint");
		if (unit === void 0) return {};
		const balancesByMintAndUnit = await this.getBalancesByMintAndUnit({
			...scope,
			units: [unit]
		});
		return Object.fromEntries(Object.entries(balancesByMintAndUnit).map(([mintUrl, balancesByUnit]) => [mintUrl, balancesByUnit[unit] ?? this.emptyBalanceSnapshot(unit)]));
	}
	async getBalancesByMintAndUnit(scope) {
		const requestedMintUrls = scope?.mintUrls ? Array.from(new Set(scope.mintUrls)) : void 0;
		const requestedUnits = normalizeUnitList(scope?.units);
		if (requestedUnits && requestedUnits.length === 0) return {};
		const trustedMintUrls = scope?.trustedOnly ? new Set((await this.mintService.getAllTrustedMints()).map((mint) => mint.mintUrl)) : void 0;
		const balances = {};
		const scopedMintUrls = requestedMintUrls?.filter((mintUrl) => !trustedMintUrls || trustedMintUrls.has(mintUrl));
		const proofFilter = requestedUnits ? { units: requestedUnits } : void 0;
		const proofs = scopedMintUrls ? (await Promise.all(scopedMintUrls.map((mintUrl) => this.proofRepository.getReadyProofs(mintUrl, proofFilter)))).flat() : trustedMintUrls ? (await Promise.all(Array.from(trustedMintUrls).map((mintUrl) => this.proofRepository.getReadyProofs(mintUrl, proofFilter)))).flat() : await this.getAllReadyProofs(proofFilter);
		for (const proof of proofs) {
			const mintUrl = proof.mintUrl;
			if (trustedMintUrls && !trustedMintUrls.has(mintUrl)) continue;
			const unit = normalizeUnit(proof.unit, { defaultUnit: DEFAULT_UNIT });
			const balancesForMint = balances[mintUrl] ?? (balances[mintUrl] = {});
			const balance = balancesForMint[unit] || this.emptyBalanceSnapshot(unit);
			if (proof.usedByOperationId) balance.reserved = balance.reserved.add(proof.amount);
			else balance.spendable = balance.spendable.add(proof.amount);
			balance.total = balance.spendable.add(balance.reserved);
			balancesForMint[unit] = balance;
		}
		if (scopedMintUrls && requestedUnits) for (const mintUrl of scopedMintUrls) {
			const balancesForMint = balances[mintUrl] ?? (balances[mintUrl] = {});
			for (const unit of requestedUnits) balancesForMint[unit] ??= this.emptyBalanceSnapshot(unit);
		}
		return balances;
	}
	/**
	* Gets the aggregated balance for the selected mint scope.
	* @returns A single balance snapshot with spendable, reserved, and total amounts
	*/
	async getBalanceTotal(scope) {
		const unit = this.getSingleBalanceUnit(scope, "getBalanceTotal");
		if (unit === void 0) return this.emptyBalanceSnapshot();
		const balances = await this.getBalancesByMint(scope);
		return Object.values(balances).reduce((total, balance) => ({
			spendable: total.spendable.add(balance.spendable),
			reserved: total.reserved.add(balance.reserved),
			total: total.total.add(balance.total),
			unit
		}), this.emptyBalanceSnapshot(unit));
	}
	async getBalancesByUnit(scope) {
		return this.getBalanceTotalByUnit(scope);
	}
	async getBalanceTotalByUnit(scope) {
		const requestedUnits = normalizeUnitList(scope?.units);
		if (requestedUnits && requestedUnits.length === 0) return {};
		const balancesByMintAndUnit = await this.getBalancesByMintAndUnit(scope);
		const totals = {};
		for (const balancesByUnit of Object.values(balancesByMintAndUnit)) for (const [unit, balance] of Object.entries(balancesByUnit)) {
			const total = totals[unit] ?? this.emptyBalanceSnapshot(unit);
			total.spendable = total.spendable.add(balance.spendable);
			total.reserved = total.reserved.add(balance.reserved);
			total.total = total.total.add(balance.total);
			totals[unit] = total;
		}
		if (requestedUnits) for (const unit of requestedUnits) totals[unit] ??= this.emptyBalanceSnapshot(unit);
		return totals;
	}
	/**
	* Gets balance breakdowns for all mints.
	* @returns An object mapping mint URLs to their balance breakdowns
	*/
	async getBalancesBreakdown() {
		const balances = await this.getBalancesByMint();
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, this.snapshotToBreakdown(balance)]));
	}
	/**
	* Gets balances for trusted mints only.
	* @returns An object mapping trusted mint URLs to their total balances
	*/
	async getTrustedBalances() {
		const balances = await this.getBalancesByMint({ trustedOnly: true });
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, balance.total]));
	}
	/**
	* Gets spendable balances for trusted mints only.
	* @returns An object mapping trusted mint URLs to their spendable balances
	*/
	async getTrustedSpendableBalances() {
		const balances = await this.getBalancesByMint({ trustedOnly: true });
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, balance.spendable]));
	}
	/**
	* Gets balance breakdowns for trusted mints only.
	* @returns An object mapping trusted mint URLs to their balance breakdowns
	*/
	async getTrustedBalancesBreakdown() {
		const balances = await this.getBalancesByMint({ trustedOnly: true });
		return Object.fromEntries(Object.entries(balances).map(([mintUrl, balance]) => [mintUrl, this.snapshotToBreakdown(balance)]));
	}
	getSingleBalanceUnit(scope, caller) {
		const units = normalizeUnitList(scope?.units);
		if (!units) return DEFAULT_UNIT;
		if (units.length === 0) return;
		if (units.length > 1) throw new ProofValidationError(`${caller} cannot aggregate multiple units; use getBalanceTotalByUnit or getBalancesByMintAndUnit`);
		return units[0];
	}
	emptyBalanceSnapshot(unit = DEFAULT_UNIT) {
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		return {
			spendable: Amount$1.zero(),
			reserved: Amount$1.zero(),
			total: Amount$1.zero(),
			unit: normalizedUnit
		};
	}
	snapshotToBreakdown(balance) {
		return {
			ready: balance.spendable,
			reserved: balance.reserved,
			total: balance.total
		};
	}
	async setProofState(mintUrl, secrets, state) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!secrets || secrets.length === 0) return;
		await this.proofRepository.setProofState(mintUrl, secrets, state);
		await this.eventBus?.emit("proofs:state-changed", {
			mintUrl,
			secrets,
			state
		});
		this.logger?.debug("Proof state updated", {
			mintUrl,
			count: secrets.length,
			state
		});
	}
	/**
	* Reserve proofs for an operation.
	* Validates that proofs are available (ready and not already reserved) before reserving.
	* Emits 'proofs:reserved' event on success.
	*
	* @throws ProofOperationError if any proof is not available for reservation
	*/
	async reserveProofs(mintUrl, secrets, operationId, options) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!operationId || operationId.trim().length === 0) throw new ProofValidationError("operationId is required");
		if (!secrets || secrets.length === 0) return {
			amount: Amount$1.zero(),
			unit: normalizeUnit(options?.unit, { defaultUnit: DEFAULT_UNIT })
		};
		const proofsToReserve = await this.proofRepository.getProofsBySecrets(mintUrl, secrets);
		const proofUnits = Array.from(new Set(proofsToReserve.map((proof) => normalizeUnit(proof.unit, { defaultUnit: DEFAULT_UNIT }))));
		if (proofUnits.length > 1) throw new ProofValidationError("Cannot reserve proofs across multiple units");
		const unit = normalizeUnit(options?.unit ?? proofUnits[0], { defaultUnit: DEFAULT_UNIT });
		for (const proofUnit of proofUnits) assertSameUnit(proofUnit, unit, "Proof reservation");
		await this.proofRepository.reserveProofs(mintUrl, secrets, operationId);
		const amount = sumProofs(await this.proofRepository.getProofsBySecrets(mintUrl, secrets));
		await this.eventBus?.emit("proofs:reserved", {
			mintUrl,
			operationId,
			secrets,
			amount: {
				amount,
				unit
			}
		});
		this.logger?.debug("Proofs reserved", {
			mintUrl,
			unit,
			operationId,
			count: secrets.length,
			amount
		});
		return {
			amount,
			unit
		};
	}
	/**
	* Release proofs from an operation.
	* Clears the reservation so proofs become available again.
	* Emits 'proofs:released' event on success.
	*/
	async releaseProofs(mintUrl, secrets) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!secrets || secrets.length === 0) return;
		await this.proofRepository.releaseProofs(mintUrl, secrets);
		await this.eventBus?.emit("proofs:released", {
			mintUrl,
			secrets
		});
		this.logger?.debug("Proofs released", {
			mintUrl,
			count: secrets.length
		});
	}
	/**
	* Restore proofs to ready state and clear their operation reservation.
	* Used during rollback when inflight proofs need to be made available again.
	* This sets state to 'ready' and clears usedByOperationId.
	*/
	async restoreProofsToReady(mintUrl, secrets) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!secrets || secrets.length === 0) return;
		await this.proofRepository.setProofState(mintUrl, secrets, "ready");
		await this.proofRepository.releaseProofs(mintUrl, secrets);
		await this.eventBus?.emit("proofs:state-changed", {
			mintUrl,
			secrets,
			state: "ready"
		});
		await this.eventBus?.emit("proofs:released", {
			mintUrl,
			secrets
		});
		this.logger?.debug("Proofs restored to ready", {
			mintUrl,
			count: secrets.length
		});
	}
	async deleteProofs(mintUrl, secrets) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!secrets || secrets.length === 0) return;
		await this.proofRepository.deleteProofs(mintUrl, secrets);
		await this.eventBus?.emit("proofs:deleted", {
			mintUrl,
			secrets
		});
		this.logger?.info("Proofs deleted", {
			mintUrl,
			count: secrets.length
		});
	}
	async wipeProofsByKeysetId(mintUrl, keysetId) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!keysetId || keysetId.trim().length === 0) throw new ProofValidationError("keysetId is required");
		await this.proofRepository.wipeProofsByKeysetId(mintUrl, keysetId);
		await this.eventBus?.emit("proofs:wiped", {
			mintUrl,
			keysetId
		});
		this.logger?.info("Proofs wiped by keyset", {
			mintUrl,
			keysetId
		});
	}
	/**
	* Select proofs to send for a given amount.
	* Uses the wallet's proof selection algorithm to choose optimal denominations.
	* Only available proofs are considered (ready and not reserved by another operation).
	*
	* @param mintUrl - The mint URL to select proofs from
	* @param amount - The amount to send
	* @param includeFees - Whether to include fees in the selection (default: true)
	* @returns The selected proofs
	* @throws ProofValidationError if insufficient balance to cover the amount
	*/
	async selectProofsToSend(mintUrl, intent, includeFees = true) {
		const { amount: requestedAmount, unit } = normalizeUnitAmount(intent);
		const proofs = await this.proofRepository.getAvailableProofs(mintUrl, { unit });
		if (sumProofs(proofs).lessThan(requestedAmount)) throw new ProofValidationError("Not enough proofs to send");
		const selectedProofs = (await this.walletService.getWallet(mintUrl, unit)).selectProofsToSend(proofs, requestedAmount, includeFees);
		this.logger?.debug("Selected proofs to send", {
			mintUrl,
			unit,
			amount: requestedAmount.toString(),
			selectedProofs,
			count: selectedProofs.send.length
		});
		return selectedProofs.send;
	}
	groupProofsByKeysetId(proofs) {
		const map = /* @__PURE__ */ new Map();
		for (const proof of proofs) {
			if (!proof.secret) throw new ProofValidationError("Proof missing secret");
			normalizeUnit(proof.unit);
			const keysetId = proof.id;
			if (!keysetId || keysetId.trim().length === 0) throw new ProofValidationError("Proof missing keyset id");
			const existing = map.get(keysetId);
			if (existing) existing.push(proof);
			else map.set(keysetId, [proof]);
		}
		return map;
	}
	async getProofsByKeysetId(mintUrl, keysetId, filter) {
		return this.proofRepository.getProofsByKeysetId(mintUrl, keysetId, filter);
	}
	async hasProofsForKeyset(mintUrl, keysetId) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!keysetId || keysetId.trim().length === 0) throw new ProofValidationError("keysetId is required");
		const proofs = await this.proofRepository.getProofsByKeysetId(mintUrl, keysetId);
		const hasProofs = proofs.length > 0;
		this.logger?.debug("Checked proofs for keyset", {
			mintUrl,
			keysetId,
			hasProofs,
			totalProofs: proofs.length
		});
		return hasProofs;
	}
	async prepareProofsForReceiving(proofs) {
		this.logger?.debug("Preparing proofs for receiving", { totalProofs: proofs.length });
		const preparedProofs = [...proofs];
		let regularProofCount = 0;
		let p2pkProofCount = 0;
		for (let i = 0; i < preparedProofs.length; i++) {
			const proof = preparedProofs[i];
			if (!proof) continue;
			let parsedSecret;
			try {
				parsedSecret = JSON.parse(proof.secret);
			} catch (parseError) {
				this.logger?.debug("Regular proof detected, skipping P2PK processing", { proofIndex: i });
				regularProofCount++;
				continue;
			}
			if (parsedSecret[0] !== "P2PK") {
				this.logger?.error("Unsupported locking script type", {
					proofIndex: i,
					scriptType: parsedSecret[0]
				});
				throw new ProofValidationError("Only P2PK locking scripts are supported");
			}
			const additionalKeysTag = parsedSecret[1].tags?.find((tag) => tag[0] === "pubkeys");
			if (additionalKeysTag && additionalKeysTag[1] && additionalKeysTag[1].length > 0) {
				this.logger?.error("Multisig P2PK proof detected", { proofIndex: i });
				throw new ProofValidationError("Multisig is not supported");
			}
			try {
				preparedProofs[i] = await this.signer.signProof(proof, parsedSecret[1].data);
				this.logger?.debug("P2PK proof signed successfully", {
					proofIndex: i,
					recipient: parsedSecret[1].data
				});
				p2pkProofCount++;
			} catch (error) {
				this.logger?.error("Failed to sign P2PK proof for receiving", {
					proofIndex: i,
					recipient: parsedSecret[1].data,
					error
				});
				throw error;
			}
		}
		this.logger?.info("Proofs prepared for receiving", {
			totalProofs: proofs.length,
			regularProofs: regularProofCount,
			p2pkProofs: p2pkProofCount
		});
		return preparedProofs;
	}
	async createBlankOutputs(mintUrl, intent) {
		const { amount: requestedAmount, unit } = normalizeUnitAmount(intent);
		const { keys } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
		if (requestedAmount.isZero()) return [];
		const outputNumber = countBlankOutputsForAmount(requestedAmount);
		const currentCounter = await this.counterService.getCounter(mintUrl, keys.id);
		const seed = await this.seedService.getSeed();
		const outputData = Array(outputNumber).fill(0).map((_, index) => {
			return this.outputDataCreator.createSingleDeterministicData(0, seed, currentCounter.counter + index, keys.id);
		});
		if (outputData.length > 0) await this.counterService.incrementCounter(mintUrl, keys.id, outputData.length);
		return outputData;
	}
	/**
	* Unblind change signatures and save the resulting proofs.
	* Used after melt operations to process change returned by the mint.
	*
	* @param mintUrl - The mint URL
	* @param outputData - The output data used to create blank outputs for change
	* @param changeSignatures - The blinded signatures returned by the mint
	* @param keys - The mint keys for unblinding
	* @param options - Optional settings including createdByOperationId
	* @returns The saved change proofs
	*/
	async unblindAndSaveChangeProofs(mintUrl, outputData, changeSignatures, options) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		const unit = normalizeUnit(options.unit);
		if (!outputData || outputData.length === 0 || !changeSignatures || changeSignatures.length === 0) return [];
		const { keysets } = await this.mintService.ensureUpdatedMint(mintUrl);
		const keysetMap = {};
		keysets.forEach((ks) => {
			keysetMap[ks.id] = ks;
		});
		const proofs = outputData.slice(0, changeSignatures.length).flatMap((output, i) => {
			const sig = changeSignatures[i];
			const keyset = keysetMap[output.blindedMessage.id];
			if (!sig || !keyset) {
				const reason = !sig ? "missing signature" : "missing keyset";
				this.logger?.warn("Failed to create change proof", {
					reason,
					index: i
				});
				return [];
			}
			assertSameUnit(normalizeUnit(keyset.unit, { defaultUnit: DEFAULT_UNIT }), unit, "Change proof keyset");
			return [output.toProof(sig, {
				id: keyset.id,
				keys: keyset.keypairs
			})];
		});
		if (proofs.length === 0) return [];
		const coreProofs = mapProofToCoreProof(mintUrl, "ready", proofs, {
			unit,
			createdByOperationId: options?.createdByOperationId
		});
		await this.saveProofs(mintUrl, coreProofs);
		this.logger?.info("Change proofs unblinded and saved", {
			mintUrl,
			unit,
			count: coreProofs.length,
			operationId: options?.createdByOperationId
		});
		return coreProofs;
	}
	/**
	* Recover proofs from a completed swap using the mint's restore endpoint.
	* This is used when a swap succeeded but proofs were not saved (e.g., crash recovery).
	*
	* First checks if the proofs are still unspent before attempting recovery.
	* Only unspent proofs will be recovered and saved.
	*
	* @param mintUrl - The mint URL
	* @param serializedOutputData - The serialized output data containing secrets and blinding factors
	* @param options - Optional metadata to attach to recovered proofs
	* @returns The recovered proofs (only unspent ones)
	*/
	async recoverProofsFromOutputData(mintUrl, serializedOutputData, options) {
		if (!mintUrl || mintUrl.trim().length === 0) throw new ProofValidationError("mintUrl is required");
		if (!serializedOutputData) throw new ProofValidationError("serializedOutputData is required");
		const unit = normalizeUnit(options.unit);
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
		const { keysets } = await this.mintService.ensureUpdatedMint(mintUrl);
		const unspentProofs = await restoreOutputProofs(wallet, keysets, unit, serializedOutputData);
		if (unspentProofs.length === 0) return [];
		if (options?.persistRecoveredProofs !== false) await this.saveProofs(mintUrl, mapProofToCoreProof(mintUrl, "ready", unspentProofs, {
			unit,
			createdByOperationId: options?.createdByOperationId
		}));
		this.logger?.info("Recovered proofs from output data", {
			mintUrl,
			unit,
			unspentCount: unspentProofs.length,
			persisted: options?.persistRecoveredProofs !== false
		});
		return unspentProofs;
	}
};

//#endregion
//#region services/SeedService.ts
var SeedService = class {
	seedGetter;
	seedTtlMs;
	cachedSeed = null;
	cachedUntil = 0;
	inFlight = null;
	constructor(seedGetter, options) {
		this.seedGetter = seedGetter;
		this.seedTtlMs = Math.max(0, options?.seedTtlMs ?? 0);
	}
	async getSeed() {
		const now = Date.now();
		if (this.cachedSeed && now < this.cachedUntil) return new Uint8Array(this.cachedSeed);
		if (this.inFlight) {
			const seed = await this.inFlight;
			return new Uint8Array(seed);
		}
		this.inFlight = (async () => {
			const seed = await this.seedGetter();
			if (!(seed instanceof Uint8Array) || seed.length !== 64) throw new Error("SeedService: seedGetter must return a 64-byte Uint8Array");
			if (this.seedTtlMs > 0) {
				this.cachedSeed = new Uint8Array(seed);
				this.cachedUntil = Date.now() + this.seedTtlMs;
			} else {
				this.cachedSeed = null;
				this.cachedUntil = 0;
			}
			return seed;
		})();
		try {
			const seed = await this.inFlight;
			return new Uint8Array(seed);
		} finally {
			this.inFlight = null;
		}
	}
	clear() {
		this.cachedSeed = null;
		this.cachedUntil = 0;
	}
};

//#endregion
//#region services/WalletRestoreService.ts
var WalletRestoreService = class {
	proofService;
	counterService;
	walletService;
	requestProvider;
	logger;
	outputDataCreator;
	restoreGapLimit = 300;
	restoreBatchSize = 100;
	restoreStartCounter = 0;
	constructor(proofService, counterService, walletService, requestProvider, logger, outputDataCreator) {
		this.proofService = proofService;
		this.counterService = counterService;
		this.walletService = walletService;
		this.requestProvider = requestProvider;
		this.logger = logger;
		this.outputDataCreator = outputDataCreator;
	}
	async sweepKeyset(mintUrl, keysetId, bip39seed, unit = DEFAULT_UNIT) {
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		this.logger?.debug("Sweeping keyset", {
			mintUrl,
			keysetId
		});
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, normalizedUnit);
		const sweepWallet = new Wallet(new Mint(mintUrl, { customRequest: this.requestProvider.getRequestFn(mintUrl) }), {
			bip39seed,
			unit: normalizedUnit,
			outputDataCreator: this.outputDataCreator
		});
		await sweepWallet.loadMint();
		const { proofs } = await sweepWallet.batchRestore({
			gapLimit: this.restoreGapLimit,
			batchSize: this.restoreBatchSize,
			counter: this.restoreStartCounter,
			keysetId,
			filterSpent: false
		});
		if (proofs.length === 0) {
			this.logger?.warn("No proofs to sweep", {
				mintUrl,
				keysetId
			});
			return;
		}
		this.logger?.debug("Proofs found for sweep", {
			mintUrl,
			keysetId,
			count: proofs.length
		});
		const states = await sweepWallet.checkProofsStates(proofs);
		if (!Array.isArray(states) || states.length !== proofs.length) {
			this.logger?.error("Malformed state check", {
				mintUrl,
				keysetId,
				statesLength: states?.length,
				proofsLength: proofs.length
			});
			throw new Error("Malformed state check");
		}
		const checkedProofs = {
			spent: [],
			ready: []
		};
		for (const [index, state] of states.entries()) {
			if (!proofs[index]) {
				this.logger?.error("Proof not found", {
					mintUrl,
					keysetId,
					index
				});
				throw new Error("Proof not found");
			}
			if (state.state === "SPENT") checkedProofs.spent.push(proofs[index]);
			else checkedProofs.ready.push(proofs[index]);
		}
		this.logger?.debug("Checked proof states", {
			mintUrl,
			keysetId,
			ready: checkedProofs.ready.length,
			spent: checkedProofs.spent.length
		});
		if (checkedProofs.ready.length === 0) {
			this.logger?.warn("No ready proofs to sweep, all spent", {
				mintUrl,
				keysetId,
				spentCount: checkedProofs.spent.length
			});
			return;
		}
		const sweepFee = sweepWallet.getFeesForProofs(checkedProofs.ready);
		const sweepAmount = sumProofs(checkedProofs.ready);
		if (sweepAmount.lessThanOrEqual(sweepFee)) {
			this.logger?.warn("Sweep amount is less than fee", {
				mintUrl,
				keysetId,
				amount: sweepAmount,
				fee: sweepFee
			});
			return;
		}
		const sweepTotalAmount = sweepAmount.subtract(sweepFee);
		this.logger?.debug("Sweep calculation", {
			mintUrl,
			keysetId,
			amount: sweepAmount,
			fee: sweepFee,
			total: sweepTotalAmount
		});
		const outputAmounts = {
			keep: {
				amount: sweepTotalAmount.subtract(sweepTotalAmount),
				unit: normalizedUnit
			},
			send: {
				amount: sweepTotalAmount,
				unit: normalizedUnit
			}
		};
		const outputResults = await this.proofService.createOutputsAndIncrementCounters(mintUrl, outputAmounts);
		const outputConfig = {
			send: {
				type: "custom",
				data: outputResults.send
			},
			keep: {
				type: "custom",
				data: outputResults.keep
			}
		};
		const { send, keep } = await wallet.send(sweepTotalAmount, checkedProofs.ready, void 0, outputConfig);
		await this.proofService.saveProofs(mintUrl, mapProofToCoreProof(mintUrl, "ready", [...keep, ...send], { unit: normalizedUnit }));
		this.logger?.info("Keyset sweep completed", {
			mintUrl,
			keysetId,
			readyProofs: checkedProofs.ready.length,
			spentProofs: checkedProofs.spent.length,
			sweptAmount: sweepAmount,
			fee: sweepFee
		});
	}
	/**
	* Restore and persist proofs for a single keyset.
	* Enforces the invariant: restored proofs must be >= previously stored proofs.
	* Throws on any validation or persistence error. No transactions are used here.
	*/
	async restoreKeyset(mintUrl, wallet, keysetId, unit = DEFAULT_UNIT) {
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		this.logger?.debug("Restoring keyset", {
			mintUrl,
			keysetId
		});
		const oldProofs = await this.proofService.getProofsByKeysetId(mintUrl, keysetId);
		this.logger?.debug("Existing proofs before restore", {
			mintUrl,
			keysetId,
			count: oldProofs.length
		});
		const { proofs, lastCounterWithSignature } = await wallet.batchRestore({
			gapLimit: this.restoreGapLimit,
			batchSize: this.restoreBatchSize,
			counter: this.restoreStartCounter,
			keysetId,
			filterSpent: false
		});
		if (proofs.length === 0) {
			this.logger?.warn("No proofs to restore", {
				mintUrl,
				keysetId
			});
			return;
		}
		this.logger?.info("Batch restore result", {
			mintUrl,
			keysetId,
			restored: proofs.length,
			lastCounterWithSignature
		});
		if (oldProofs.length > proofs.length) {
			this.logger?.warn("Restored fewer proofs than previously stored", {
				mintUrl,
				keysetId,
				previous: oldProofs.length,
				restored: proofs.length
			});
			throw new Error("Restored less proofs than expected.");
		}
		const states = await wallet.checkProofsStates(proofs);
		if (!Array.isArray(states) || states.length !== proofs.length) {
			this.logger?.error("Malformed state check", {
				mintUrl,
				keysetId,
				statesLength: states?.length,
				proofsLength: proofs.length
			});
			throw new Error("Malformed state check");
		}
		const checkedProofs = {
			spent: [],
			ready: []
		};
		for (const [index, state] of states.entries()) {
			if (!proofs[index]) {
				this.logger?.error("Proof not found", {
					mintUrl,
					keysetId,
					index
				});
				throw new Error("Proof not found");
			}
			if (state.state === "SPENT") checkedProofs.spent.push(proofs[index]);
			else checkedProofs.ready.push(proofs[index]);
		}
		this.logger?.debug("Checked proof states", {
			mintUrl,
			keysetId,
			ready: checkedProofs.ready.length,
			spent: checkedProofs.spent.length
		});
		const newCounter = lastCounterWithSignature ? lastCounterWithSignature + 1 : 0;
		await this.counterService.overwriteCounter(mintUrl, keysetId, newCounter);
		this.logger?.debug("Requested counter overwrite for keyset", {
			mintUrl,
			keysetId,
			counter: newCounter
		});
		await this.proofService.saveProofs(mintUrl, mapProofToCoreProof(mintUrl, "ready", checkedProofs.ready, { unit: normalizedUnit }));
		this.logger?.info("Saved restored proofs for keyset", {
			mintUrl,
			keysetId,
			total: checkedProofs.ready.length + checkedProofs.spent.length
		});
	}
};

//#endregion
//#region services/watchers/MintOperationWatcherService.ts
function toKey$3(mintUrl, method, quoteId) {
	return `${mintUrl}::${method}::${quoteId}`;
}
const mintQuoteWatchPolicies = {
	bolt11: {
		subscriptionKind: "bolt11_mint_quote",
		getPayloadQuoteId: (payload) => payload.quote
	},
	onchain: {
		subscriptionKind: "onchain_mint_quote",
		getPayloadQuoteId: (payload) => payload.quote
	},
	bolt12: {
		subscriptionKind: "bolt12_mint_quote",
		getPayloadQuoteId: (payload) => payload.quote
	}
};
var MintOperationWatcherService = class {
	subs;
	mintService;
	mintOperations;
	quoteLifecycle;
	bus;
	logger;
	options;
	running = false;
	watchRecordByKey = /* @__PURE__ */ new Map();
	keyByOperationId = /* @__PURE__ */ new Map();
	offQuoteUpdated;
	offPending;
	offExecuting;
	offFinalized;
	offFailed;
	offUntrusted;
	constructor(subs, mintService, mintOperations, quoteLifecycle, bus, logger, options) {
		this.subs = subs;
		this.mintService = mintService;
		this.mintOperations = mintOperations;
		this.quoteLifecycle = quoteLifecycle;
		this.bus = bus;
		this.logger = logger;
		this.options = {
			watchExistingPendingOnStart: options?.watchExistingPendingOnStart ?? true,
			watchExistingPendingQuotesOnStart: options?.watchExistingPendingQuotesOnStart ?? true
		};
	}
	isRunning() {
		return this.running;
	}
	async start() {
		if (this.running) return;
		this.running = true;
		this.logger?.info("MintOperationWatcherService started");
		this.offPending = this.bus.on("mint-op:pending", async ({ operation }) => {
			if (operation.state !== "pending") return;
			if (!operation.quoteId) return;
			try {
				await this.watchOperations([operation]);
			} catch (err) {
				this.logger?.error("Failed to start watching pending mint operation", {
					operationId: operation.id,
					mintUrl: operation.mintUrl,
					quoteId: operation.quoteId,
					err
				});
			}
		});
		this.offQuoteUpdated = this.bus.on("mint-quote:updated", async ({ quote }) => {
			if (!this.getPolicy(quote.method)) return;
			const key = toKey$3(quote.mintUrl, quote.method, quote.quoteId);
			if (assessMintQuoteClaimability(quote).status === "complete") {
				await this.stopWatching(key);
				return;
			}
			try {
				await this.watchMintQuotes([{
					...quote,
					snapshot: mintQuoteToMethodSnapshot(quote)
				}], { canonical: true });
			} catch (err) {
				this.logger?.error("Failed to start watching canonical mint quote", {
					mintUrl: quote.mintUrl,
					quoteId: quote.quoteId,
					err
				});
			}
		});
		this.offExecuting = this.bus.on("mint-op:executing", async ({ operationId }) => {
			try {
				await this.stopWatchingOperation(operationId);
			} catch (err) {
				this.logger?.error("Failed to stop watching executing mint operation", {
					operationId,
					err
				});
			}
		});
		this.offFinalized = this.bus.on("mint-op:finalized", async ({ operationId }) => {
			try {
				await this.stopWatchingOperation(operationId);
			} catch (err) {
				this.logger?.error("Failed to stop watching finalized mint operation", {
					operationId,
					err
				});
			}
		});
		this.offFailed = this.bus.on("mint-op:failed", async ({ operationId }) => {
			try {
				await this.stopWatchingOperation(operationId);
			} catch (err) {
				this.logger?.error("Failed to stop watching failed mint operation", {
					operationId,
					err
				});
			}
		});
		this.offUntrusted = this.bus.on("mint:untrusted", async ({ mintUrl }) => {
			try {
				await this.stopWatchingMint(mintUrl);
			} catch (err) {
				this.logger?.error("Failed to stop watching mint operations on untrust", {
					mintUrl,
					err
				});
			}
		});
		if (this.options.watchExistingPendingOnStart) try {
			const pending = await this.mintOperations.getPendingOperations();
			const byMint = /* @__PURE__ */ new Map();
			for (const operation of pending) {
				if (!operation.quoteId) continue;
				let arr = byMint.get(operation.mintUrl);
				if (!arr) {
					arr = [];
					byMint.set(operation.mintUrl, arr);
				}
				arr.push(operation);
			}
			for (const [mintUrl, operations] of byMint.entries()) {
				if (!await this.mintService.isTrustedMint(mintUrl)) {
					this.logger?.debug("Skipping pending mint operations for untrusted mint", {
						mintUrl,
						count: operations.length
					});
					continue;
				}
				try {
					await this.watchOperations(operations);
				} catch (err) {
					this.logger?.warn("Failed to watch pending mint operation batch", {
						mintUrl,
						count: operations.length,
						err
					});
				}
			}
		} catch (err) {
			this.logger?.error("Failed to load pending mint operations to watch", { err });
		}
		if (this.options.watchExistingPendingQuotesOnStart) try {
			const quotes = await this.quoteLifecycle.getPendingMintQuotes();
			await this.watchMintQuotes(quotes.map((quote) => ({
				mintUrl: quote.mintUrl,
				method: quote.method,
				quoteId: quote.quoteId,
				snapshot: mintQuoteToMethodSnapshot(quote)
			})), { canonical: true });
		} catch (err) {
			this.logger?.error("Failed to load pending mint quotes to watch", { err });
		}
	}
	async stop() {
		if (!this.running) return;
		this.running = false;
		if (this.offQuoteUpdated) try {
			this.offQuoteUpdated();
		} catch {} finally {
			this.offQuoteUpdated = void 0;
		}
		if (this.offPending) try {
			this.offPending();
		} catch {} finally {
			this.offPending = void 0;
		}
		if (this.offExecuting) try {
			this.offExecuting();
		} catch {} finally {
			this.offExecuting = void 0;
		}
		if (this.offFinalized) try {
			this.offFinalized();
		} catch {} finally {
			this.offFinalized = void 0;
		}
		if (this.offFailed) try {
			this.offFailed();
		} catch {} finally {
			this.offFailed = void 0;
		}
		if (this.offUntrusted) try {
			this.offUntrusted();
		} catch {} finally {
			this.offUntrusted = void 0;
		}
		const keys = Array.from(this.watchRecordByKey.keys());
		for (const key of keys) await this.stopWatching(key);
		this.logger?.info("MintOperationWatcherService stopped");
	}
	async watchOperations(operations) {
		if (!this.running) return;
		if (operations.length === 0) return;
		const uniqueByQuote = /* @__PURE__ */ new Map();
		const operationIdsByKey = /* @__PURE__ */ new Map();
		for (const operation of operations) {
			if (!operation.quoteId || !this.getPolicy(operation.method)) continue;
			const key = toKey$3(operation.mintUrl, operation.method, operation.quoteId);
			uniqueByQuote.set(key, {
				mintUrl: operation.mintUrl,
				method: operation.method,
				quoteId: operation.quoteId
			});
			const operationIds = operationIdsByKey.get(key) ?? [];
			operationIds.push(operation.id);
			operationIdsByKey.set(key, operationIds);
		}
		await this.watchMintQuotes(Array.from(uniqueByQuote.values()), {
			canonical: true,
			operationIdsByKey
		});
	}
	async watchMintQuotes(quotes, interest) {
		if (!this.running) return;
		if (quotes.length === 0) return;
		const byGroup = /* @__PURE__ */ new Map();
		for (const quote of quotes) {
			const policy = this.getPolicy(quote.method);
			if (!policy) continue;
			const key = toKey$3(quote.mintUrl, quote.method, quote.quoteId);
			const existing = this.watchRecordByKey.get(key);
			if (existing?.stop) {
				this.addInterest(existing, key, interest);
				continue;
			}
			const groupKey = `${quote.mintUrl}::${policy.subscriptionKind}`;
			let group = byGroup.get(groupKey);
			if (!group) {
				group = [];
				byGroup.set(groupKey, group);
			}
			group.push(quote);
		}
		for (const mintQuotes of byGroup.values()) {
			const first = mintQuotes[0];
			if (!first) continue;
			const mintUrl = first.mintUrl;
			const policy = this.getPolicy(first.method);
			if (!policy) continue;
			if (!await this.mintService.isTrustedMint(mintUrl)) {
				this.logger?.debug("Skipping watch for untrusted mint", { mintUrl });
				continue;
			}
			const chunks = [];
			for (let i = 0; i < mintQuotes.length; i += 100) chunks.push(mintQuotes.slice(i, i + 100));
			for (const batch of chunks) {
				const quoteIds = batch.map((quote) => quote.quoteId);
				const records = [];
				for (const quote of batch) {
					const record = this.ensureWatchRecord(quote);
					this.addInterest(record, toKey$3(quote.mintUrl, quote.method, quote.quoteId), interest);
					records.push(record);
				}
				let unsubscribe;
				let subId;
				try {
					const subscription = await this.subs.subscribe(mintUrl, policy.subscriptionKind, quoteIds, async (payload) => {
						await this.handleSubscriptionPayload(mintUrl, policy.subscriptionKind, payload);
					});
					subId = subscription.subId;
					unsubscribe = subscription.unsubscribe;
				} catch (err) {
					for (const record of records) this.removeWatchRecord(toKey$3(record.mintUrl, record.method, record.quoteId));
					throw err;
				}
				let didUnsubscribe = false;
				const remaining = new Set(quoteIds);
				const groupUnsubscribeOnce = async () => {
					if (didUnsubscribe) return;
					didUnsubscribe = true;
					await unsubscribe?.();
				};
				for (const record of records) {
					toKey$3(record.mintUrl, record.method, record.quoteId);
					const perKeyStop = async () => {
						if (remaining.has(record.quoteId)) remaining.delete(record.quoteId);
						if (remaining.size === 0) await groupUnsubscribeOnce();
					};
					record.stop = perKeyStop;
				}
				this.logger?.debug("Watching mint quote batch", {
					mintUrl,
					subId,
					count: batch.length
				});
			}
		}
	}
	getPolicy(method) {
		return mintQuoteWatchPolicies[method];
	}
	ensureWatchRecord(quote) {
		const policy = this.getPolicy(quote.method);
		if (!policy) throw new Error(`No mint quote watch policy for method ${quote.method}`);
		const key = toKey$3(quote.mintUrl, quote.method, quote.quoteId);
		let record = this.watchRecordByKey.get(key);
		if (!record) {
			record = {
				mintUrl: quote.mintUrl,
				method: quote.method,
				quoteId: quote.quoteId,
				subscriptionKind: policy.subscriptionKind,
				canonical: false,
				operationIds: /* @__PURE__ */ new Set()
			};
			this.watchRecordByKey.set(key, record);
		}
		return record;
	}
	addInterest(record, key, interest) {
		if (interest.canonical) record.canonical = true;
		const operationIds = interest.operationIdsByKey?.get(key) ?? [];
		for (const operationId of operationIds) {
			record.operationIds.add(operationId);
			this.keyByOperationId.set(operationId, key);
		}
	}
	async handleSubscriptionPayload(mintUrl, subscriptionKind, payload) {
		const record = this.findRecordForPayload(mintUrl, subscriptionKind, payload);
		if (!record) return;
		const policy = this.getPolicy(record.method);
		if (!policy) return;
		const methodPayload = payload;
		const quoteId = policy.getPayloadQuoteId(methodPayload);
		if (!quoteId) return;
		const key = toKey$3(mintUrl, record.method, quoteId);
		try {
			if (assessMintQuoteClaimability(await this.quoteLifecycle.recordMintQuoteSnapshot(mintUrl, record.method, methodPayload)).status === "complete") await this.stopWatching(key);
		} catch (err) {
			this.logger?.error("Failed to persist mint quote update from remote update", {
				mintUrl,
				method: record.method,
				errorName: err instanceof Error ? err.name : typeof err
			});
		}
	}
	findRecordForPayload(mintUrl, subscriptionKind, payload) {
		for (const record of this.watchRecordByKey.values()) {
			if (record.mintUrl !== mintUrl || record.subscriptionKind !== subscriptionKind) continue;
			if (this.getPolicy(record.method)?.getPayloadQuoteId(payload) === record.quoteId) return record;
		}
	}
	async stopWatching(key) {
		const record = this.watchRecordByKey.get(key);
		if (!record) return;
		try {
			await record.stop?.();
		} catch (err) {
			this.logger?.warn("Unsubscribe watcher failed", {
				key,
				err
			});
		} finally {
			this.removeWatchRecord(key);
		}
	}
	async stopWatchingOperation(operationId) {
		const key = this.keyByOperationId.get(operationId);
		if (!key) return;
		const record = this.watchRecordByKey.get(key);
		this.keyByOperationId.delete(operationId);
		if (!record) return;
		record.operationIds.delete(operationId);
		if (this.shouldStopWatchingWithoutInterest(record)) await this.stopWatching(key);
	}
	shouldStopWatchingWithoutInterest(record) {
		if (record.canonical || record.operationIds.size > 0) return false;
		return true;
	}
	removeWatchRecord(key) {
		const record = this.watchRecordByKey.get(key);
		if (!record) return;
		for (const operationId of record.operationIds) if (this.keyByOperationId.get(operationId) === key) this.keyByOperationId.delete(operationId);
		this.watchRecordByKey.delete(key);
	}
	async stopWatchingMint(mintUrl) {
		this.logger?.info("Stopping all quote watchers for mint", { mintUrl });
		const prefix = `${mintUrl}::`;
		const keysToStop = [];
		for (const key of this.watchRecordByKey.keys()) if (key.startsWith(prefix)) keysToStop.push(key);
		for (const key of keysToStop) await this.stopWatching(key);
		this.logger?.info("Stopped quote watchers for mint", {
			mintUrl,
			count: keysToStop.length
		});
	}
};

//#endregion
//#region services/watchers/MintOperationProcessor.ts
var DefaultMintOperationHandler = class {
	constructor(mintOperations) {
		this.mintOperations = mintOperations;
	}
	async process(_mintUrl, operationId) {
		await this.mintOperations.finalize(operationId);
	}
};
var MintOperationProcessor = class {
	mintOperations;
	quoteLifecycle;
	bus;
	logger;
	running = false;
	queue = [];
	processing = false;
	processingTimer;
	offQuoteUpdated;
	offPending;
	offRequeue;
	offUntrusted;
	claimingQuotes = /* @__PURE__ */ new Set();
	quoteClaimsNeedingFollowUp = /* @__PURE__ */ new Set();
	claimTasks = /* @__PURE__ */ new Set();
	handlers = /* @__PURE__ */ new Map();
	processIntervalMs;
	maxRetries;
	baseRetryDelayMs;
	initialEnqueueDelayMs;
	autoClaimMintQuotes;
	constructor(mintOperations, quoteLifecycle, bus, logger, options) {
		this.mintOperations = mintOperations;
		this.quoteLifecycle = quoteLifecycle;
		this.bus = bus;
		this.logger = logger;
		this.processIntervalMs = options?.processIntervalMs ?? 3e3;
		this.maxRetries = options?.maxRetries ?? 3;
		this.baseRetryDelayMs = options?.baseRetryDelayMs ?? 5e3;
		this.initialEnqueueDelayMs = options?.initialEnqueueDelayMs ?? 500;
		this.autoClaimMintQuotes = options?.autoClaimMintQuotes ?? true;
		const defaultHandler = new DefaultMintOperationHandler(mintOperations);
		for (const method of [
			"bolt11",
			"bolt12",
			"onchain"
		]) this.registerHandler(method, defaultHandler);
	}
	registerHandler(method, handler) {
		this.handlers.set(method, handler);
		this.logger?.debug("Registered mint operation handler", { method });
	}
	isRunning() {
		return this.running;
	}
	async start() {
		if (this.running) return;
		this.running = true;
		this.logger?.info("MintOperationProcessor started");
		this.offQuoteUpdated = this.bus.on("mint-quote:updated", async ({ mintUrl, method, quoteId }) => {
			this.scheduleQuoteClaim(mintUrl, method, quoteId);
		});
		this.offPending = this.bus.on("mint-op:pending", async ({ operation }) => {
			if (operation.state !== "pending") return;
			if (await this.quoteLifecycle.getMintQuote(operation.mintUrl, operation.method, operation.quoteId)) this.scheduleQuoteClaim(operation.mintUrl, operation.method, operation.quoteId);
		});
		this.offRequeue = this.bus.on("mint-op:requeue", ({ mintUrl, operationId, operation }) => {
			this.enqueue(mintUrl, operationId, operation.method);
		});
		this.offUntrusted = this.bus.on("mint:untrusted", ({ mintUrl }) => {
			this.clearMintFromQueue(mintUrl);
		});
		if (this.autoClaimMintQuotes) this.schedulePendingQuoteClaims();
		this.scheduleNextProcess();
	}
	async stop() {
		if (!this.running) return;
		this.running = false;
		if (this.offQuoteUpdated) try {
			this.offQuoteUpdated();
		} catch {} finally {
			this.offQuoteUpdated = void 0;
		}
		if (this.offPending) try {
			this.offPending();
		} catch {} finally {
			this.offPending = void 0;
		}
		if (this.offRequeue) try {
			this.offRequeue();
		} catch {} finally {
			this.offRequeue = void 0;
		}
		if (this.offUntrusted) try {
			this.offUntrusted();
		} catch {} finally {
			this.offUntrusted = void 0;
		}
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = void 0;
		}
		while (this.processing || this.claimTasks.size > 0) await new Promise((resolve) => setTimeout(resolve, 100));
		this.logger?.info("MintOperationProcessor stopped", { pendingItems: this.queue.length });
	}
	/**
	* Wait for the queue to be empty and all processing to complete.
	* Useful for CLI applications that want to ensure all queued operations are processed before exiting.
	*/
	async waitForCompletion() {
		while (this.queue.length > 0 || this.processing || this.claimTasks.size > 0) await new Promise((resolve) => setTimeout(resolve, 100));
	}
	/**
	* Remove all queued items for a specific mint.
	* Called when a mint is untrusted to stop processing its operations.
	*/
	clearMintFromQueue(mintUrl) {
		const before = this.queue.length;
		this.queue = this.queue.filter((item) => item.mintUrl !== mintUrl);
		const removed = before - this.queue.length;
		if (removed > 0) this.logger?.info("Cleared mint operations from processor queue", {
			mintUrl,
			removed
		});
	}
	enqueue(mintUrl, operationId, method) {
		if (this.queue.find((item) => item.mintUrl === mintUrl && item.operationId === operationId)) {
			this.logger?.debug("Mint operation already in queue", {
				mintUrl,
				operationId
			});
			return;
		}
		const wasEmpty = this.queue.length === 0;
		this.queue.push({
			mintUrl,
			operationId,
			method,
			retryCount: 0,
			nextRetryAt: 0
		});
		this.logger?.debug("Mint operation enqueued for processing", {
			mintUrl,
			operationId,
			method,
			queueLength: this.queue.length
		});
		if (wasEmpty && this.running && !this.processing) {
			if (this.processingTimer) {
				clearTimeout(this.processingTimer);
				this.processingTimer = void 0;
			}
			this.processingTimer = setTimeout(() => {
				this.processingTimer = void 0;
				this.processNext();
			}, this.initialEnqueueDelayMs);
		}
	}
	scheduleNextProcess() {
		if (!this.running || this.processingTimer) return;
		this.processingTimer = setTimeout(() => {
			this.processingTimer = void 0;
			this.processNext();
		}, this.processIntervalMs);
	}
	scheduleQuoteClaim(mintUrl, method, quoteId) {
		if (!this.autoClaimMintQuotes) return;
		const key = `${mintUrl}::${method}::${quoteId}`;
		if (this.claimingQuotes.has(key)) {
			this.quoteClaimsNeedingFollowUp.add(key);
			this.logger?.debug("Mint quote claim already in progress", {
				mintUrl,
				method,
				quoteId
			});
			return;
		}
		this.claimingQuotes.add(key);
		const task = (async () => {
			try {
				const assessment = await this.mintOperations.getMintQuoteClaimability(mintUrl, method, quoteId);
				if (assessment?.status !== "claimable" && assessment?.status !== "complete") {
					this.logger?.debug("Mint quote has no locally claimable value", {
						mintUrl,
						method,
						quoteId
					});
					return;
				}
				await this.mintOperations.claimMintQuote(mintUrl, method, quoteId, { autoClaimRemaining: true });
			} catch (error) {
				this.logger?.warn("Failed to check or claim mint quote", {
					mintUrl,
					method,
					quoteId,
					error: error instanceof Error ? error.message : String(error)
				});
			} finally {
				this.claimingQuotes.delete(key);
				if (this.quoteClaimsNeedingFollowUp.delete(key) && this.running) this.scheduleQuoteClaim(mintUrl, method, quoteId);
			}
		})();
		this.claimTasks.add(task);
		task.finally(() => {
			this.claimTasks.delete(task);
		});
	}
	schedulePendingQuoteClaims() {
		const task = (async () => {
			try {
				await this.mintOperations.claimPendingMintQuotes({ autoClaimRemaining: true });
			} catch (error) {
				this.logger?.warn("Failed to claim pending mint quotes on startup", { error: error instanceof Error ? error.message : String(error) });
			}
		})();
		this.claimTasks.add(task);
		task.finally(() => {
			this.claimTasks.delete(task);
		});
	}
	async processNext() {
		if (!this.running || this.processing || this.queue.length === 0) {
			if (this.running) this.scheduleNextProcess();
			return;
		}
		const now = Date.now();
		const readyIndex = this.queue.findIndex((item) => item.nextRetryAt <= now);
		if (readyIndex === -1) {
			const nextReady = Math.min(...this.queue.map((item) => item.nextRetryAt));
			const delay = Math.max(this.processIntervalMs, nextReady - now);
			this.processingTimer = setTimeout(() => {
				this.processingTimer = void 0;
				this.processNext();
			}, delay);
			return;
		}
		const [item] = this.queue.splice(readyIndex, 1);
		if (!item) return;
		this.processing = true;
		try {
			await this.processItem(item);
		} catch (err) {
			this.handleProcessingError(item, err);
		} finally {
			this.processing = false;
			if (this.running) this.scheduleNextProcess();
		}
	}
	async processItem(item) {
		const { mintUrl, operationId, method } = item;
		const handler = this.handlers.get(method);
		if (!handler) {
			this.logger?.warn("No handler registered for mint method", {
				method,
				mintUrl,
				operationId
			});
			return;
		}
		this.logger?.info("Processing mint operation", {
			mintUrl,
			operationId,
			method,
			attempt: item.retryCount + 1
		});
		await handler.process(mintUrl, operationId);
		this.logger?.info("Successfully processed mint operation", {
			mintUrl,
			operationId,
			method
		});
	}
	handleProcessingError(item, err) {
		const { mintUrl, operationId } = item;
		if (err instanceof MintOperationError) {
			if (err.code === 20002) {
				this.logger?.info("Mint operation quote already issued", {
					mintUrl,
					operationId
				});
				return;
			}
			this.logger?.error("Mint operation error, not retrying", {
				mintUrl,
				operationId,
				code: err.code,
				detail: err.message
			});
			return;
		}
		if (err instanceof NetworkError || err instanceof Error && err.message.includes("network")) {
			item.retryCount++;
			if (item.retryCount <= this.maxRetries) {
				const delay = this.baseRetryDelayMs * Math.pow(2, item.retryCount - 1);
				item.nextRetryAt = Date.now() + delay;
				this.logger?.warn("Network error, will retry", {
					mintUrl,
					operationId,
					attempt: item.retryCount,
					maxRetries: this.maxRetries,
					retryInMs: delay
				});
				this.queue.push(item);
				return;
			}
			this.logger?.error("Max retries exceeded for network error", {
				mintUrl,
				operationId,
				maxRetries: this.maxRetries
			});
			return;
		}
		this.logger?.error("Failed to process mint operation", {
			mintUrl,
			operationId,
			err
		});
	}
};

//#endregion
//#region services/watchers/MeltQuoteWatcherService.ts
function toKey$2(mintUrl, method, quoteId) {
	return `${mintUrl}::${method}::${quoteId}`;
}
function isExpiredMeltQuote(quote) {
	return quote.expiry * 1e3 <= Date.now();
}
function isMeltQuoteState(value) {
	return value === "UNPAID" || value === "PENDING" || value === "PAID";
}
function hasFullMeltQuotePayload(method, payload) {
	if (typeof payload !== "object" || payload === null) return false;
	const quote = payload;
	if (typeof quote.quote !== "string" || typeof quote.request !== "string" || quote.amount === void 0 || typeof quote.unit !== "string" || typeof quote.expiry !== "number" || !isMeltQuoteState(quote.state)) return false;
	if (method === "onchain") return Array.isArray(quote.fee_options);
	return quote.fee_reserve !== void 0;
}
const CANONICAL_INTEREST = {
	kind: "canonical",
	id: "canonical"
};
const meltQuoteWatchPolicies = {
	bolt11: {
		subscriptionKind: "bolt11_melt_quote",
		getPayloadQuoteId: (payload) => typeof payload === "object" && payload !== null && typeof payload.quote === "string" ? payload.quote : void 0,
		toCanonicalQuote: (mintUrl, payload) => meltQuoteFromBolt11Response(mintUrl, payload)
	},
	bolt12: {
		subscriptionKind: "bolt12_melt_quote",
		getPayloadQuoteId: (payload) => typeof payload === "object" && payload !== null && typeof payload.quote === "string" ? payload.quote : void 0,
		toCanonicalQuote: (mintUrl, payload) => meltQuoteFromBolt12Response(mintUrl, payload)
	},
	onchain: {
		subscriptionKind: "onchain_melt_quote",
		getPayloadQuoteId: (payload) => typeof payload === "object" && payload !== null && typeof payload.quote === "string" ? payload.quote : void 0,
		toCanonicalQuote: (mintUrl, payload) => meltQuoteFromOnchainResponse(mintUrl, payload)
	}
};
var MeltQuoteInterestRegistry = class {
	interestsByKey = /* @__PURE__ */ new Map();
	add(key, interest) {
		let byKind = this.interestsByKey.get(key);
		if (!byKind) {
			byKind = /* @__PURE__ */ new Map();
			this.interestsByKey.set(key, byKind);
		}
		let ids = byKind.get(interest.kind);
		if (!ids) {
			ids = /* @__PURE__ */ new Set();
			byKind.set(interest.kind, ids);
		}
		ids.add(interest.id);
	}
	remove(key, interest) {
		const byKind = this.interestsByKey.get(key);
		const ids = byKind?.get(interest.kind);
		if (!ids) return;
		ids.delete(interest.id);
		if (ids.size === 0) byKind?.delete(interest.kind);
		if (byKind?.size === 0) this.interestsByKey.delete(key);
	}
	removeAll(key) {
		this.interestsByKey.delete(key);
	}
	hasAny(key) {
		return this.interestsByKey.has(key);
	}
	hasKind(key, kind) {
		return (this.interestsByKey.get(key)?.get(kind)?.size ?? 0) > 0;
	}
	keysFor(interest) {
		const keys = [];
		for (const [key, byKind] of this.interestsByKey.entries()) if (byKind.get(interest.kind)?.has(interest.id)) keys.push(key);
		return keys;
	}
};
var MeltQuoteWatcherService = class {
	subs;
	mintService;
	quoteLifecycle;
	bus;
	logger;
	options;
	running = false;
	interests = new MeltQuoteInterestRegistry();
	watchRecordByKey = /* @__PURE__ */ new Map();
	offQuoteUpdated;
	offUntrusted;
	constructor(subs, mintService, quoteLifecycle, bus, logger, options) {
		this.subs = subs;
		this.mintService = mintService;
		this.quoteLifecycle = quoteLifecycle;
		this.bus = bus;
		this.logger = logger;
		this.options = { watchExistingPendingQuotesOnStart: options?.watchExistingPendingQuotesOnStart ?? true };
	}
	isRunning() {
		return this.running;
	}
	async start() {
		if (this.running) return;
		this.running = true;
		this.logger?.info("MeltQuoteWatcherService started");
		this.offQuoteUpdated = this.bus.on("melt-quote:updated", async ({ quote }) => {
			try {
				await this.handleCanonicalQuoteUpdate(quote);
			} catch (err) {
				this.logger?.error("Failed to handle canonical melt quote update", {
					mintUrl: quote.mintUrl,
					method: quote.method,
					quoteId: quote.quoteId,
					err
				});
			}
		});
		this.offUntrusted = this.bus.on("mint:untrusted", async ({ mintUrl }) => {
			try {
				await this.stopWatchingMint(mintUrl);
			} catch (err) {
				this.logger?.error("Failed to stop watching melt quotes on untrust", {
					mintUrl,
					err
				});
			}
		});
		if (this.options.watchExistingPendingQuotesOnStart) try {
			const quotes = await this.quoteLifecycle.getPendingMeltQuotes();
			await this.watchMeltQuotes(quotes.map((quote) => ({
				mintUrl: quote.mintUrl,
				method: quote.method,
				quoteId: quote.quoteId,
				quote
			})), CANONICAL_INTEREST);
		} catch (err) {
			this.logger?.error("Failed to load pending melt quotes to watch", { err });
		}
	}
	async stop() {
		if (!this.running) return;
		this.running = false;
		if (this.offQuoteUpdated) try {
			this.offQuoteUpdated();
		} finally {
			this.offQuoteUpdated = void 0;
		}
		if (this.offUntrusted) try {
			this.offUntrusted();
		} finally {
			this.offUntrusted = void 0;
		}
		const keys = Array.from(this.watchRecordByKey.keys());
		for (const key of keys) await this.stopWatching(key);
		this.logger?.info("MeltQuoteWatcherService stopped");
	}
	/** @internal Registers future operation-owned interest without wiring operation settlement. */
	async registerOperationInterest(interest) {
		await this.watchMeltQuotes([{
			mintUrl: interest.mintUrl,
			method: interest.method,
			quoteId: interest.quoteId
		}], {
			kind: "operation",
			id: interest.operationId
		});
	}
	/** @internal Removes future operation-owned interest and stops the watch if no interest remains. */
	async removeOperationInterest(operationId) {
		const interest = {
			kind: "operation",
			id: operationId
		};
		const keys = this.interests.keysFor(interest);
		for (const key of keys) {
			this.interests.remove(key, interest);
			if (!this.interests.hasAny(key)) await this.stopWatching(key);
		}
	}
	async handleCanonicalQuoteUpdate(quote) {
		const key = toKey$2(quote.mintUrl, quote.method, quote.quoteId);
		if (quote.state === "PAID") {
			await this.stopWatching(key);
			return;
		}
		if (isExpiredMeltQuote(quote)) {
			this.interests.remove(key, CANONICAL_INTEREST);
			if (!this.interests.hasKind(key, "operation")) await this.stopWatching(key);
			return;
		}
		await this.watchMeltQuotes([{
			mintUrl: quote.mintUrl,
			method: quote.method,
			quoteId: quote.quoteId,
			quote
		}], CANONICAL_INTEREST);
	}
	async watchMeltQuotes(quotes, interest) {
		if (!this.running) return;
		if (quotes.length === 0) return;
		for (const quote of quotes) {
			const key = toKey$2(quote.mintUrl, quote.method, quote.quoteId);
			if (quote.quote?.state === "PAID") {
				await this.stopWatching(key);
				continue;
			}
			if (interest.kind === "canonical" && quote.quote && isExpiredMeltQuote(quote.quote)) {
				this.interests.remove(key, CANONICAL_INTEREST);
				if (!this.interests.hasKind(key, "operation")) await this.stopWatching(key);
				continue;
			}
			const existing = this.watchRecordByKey.get(key);
			if (existing) {
				this.interests.add(key, interest);
				await existing.start;
				continue;
			}
			const policy = this.getPolicy(quote.method);
			const record = this.ensureWatchRecord(quote, policy);
			this.interests.add(key, interest);
			record.start = this.startWatchingRecord(record, policy);
			try {
				await record.start;
			} finally {
				if (this.watchRecordByKey.get(key) === record) record.start = void 0;
			}
		}
	}
	getPolicy(method) {
		return meltQuoteWatchPolicies[method];
	}
	ensureWatchRecord(quote, policy) {
		const key = toKey$2(quote.mintUrl, quote.method, quote.quoteId);
		let record = this.watchRecordByKey.get(key);
		if (!record) {
			record = {
				mintUrl: quote.mintUrl,
				method: quote.method,
				quoteId: quote.quoteId,
				subscriptionKind: policy.subscriptionKind
			};
			this.watchRecordByKey.set(key, record);
		}
		return record;
	}
	async startWatchingRecord(record, policy) {
		const key = toKey$2(record.mintUrl, record.method, record.quoteId);
		let unsubscribe;
		try {
			if (!await this.mintService.isTrustedMint(record.mintUrl)) {
				this.logger?.debug("Skipping melt quote watch for untrusted mint", {
					mintUrl: record.mintUrl,
					quoteId: record.quoteId
				});
				if (this.watchRecordByKey.get(key) === record) this.removeWatchRecord(key);
				return;
			}
			if (!this.running || this.watchRecordByKey.get(key) !== record) return;
			unsubscribe = (await this.subs.subscribe(record.mintUrl, policy.subscriptionKind, [record.quoteId], async (payload) => {
				await this.handleSubscriptionPayload(record, payload);
			})).unsubscribe;
		} catch (err) {
			if (this.watchRecordByKey.get(key) === record) this.removeWatchRecord(key);
			throw err;
		}
		if (this.watchRecordByKey.get(key) !== record) {
			try {
				await unsubscribe?.();
			} catch (err) {
				this.logger?.warn("Unsubscribe melt quote watcher failed", {
					key,
					err
				});
			}
			return;
		}
		record.stop = async () => {
			await unsubscribe?.();
		};
		this.logger?.debug("Watching melt quote", {
			mintUrl: record.mintUrl,
			method: record.method,
			quoteId: record.quoteId
		});
	}
	async handleSubscriptionPayload(record, payload) {
		const key = toKey$2(record.mintUrl, record.method, record.quoteId);
		const payloadQuoteId = this.getPolicy(record.method).getPayloadQuoteId(payload);
		if (payloadQuoteId && payloadQuoteId !== record.quoteId) return;
		try {
			const quote = await this.recordSubscriptionObservation(record, payload);
			if (!quote) return;
			if (quote.state === "PAID") {
				await this.stopWatching(key);
				return;
			}
			if (isExpiredMeltQuote(quote)) {
				this.interests.remove(key, CANONICAL_INTEREST);
				if (!this.interests.hasKind(key, "operation")) await this.stopWatching(key);
			}
		} catch (err) {
			this.logger?.error("Failed to persist melt quote update from remote update", {
				mintUrl: record.mintUrl,
				method: record.method,
				quoteId: record.quoteId,
				err
			});
		}
	}
	async recordSubscriptionObservation(record, payload) {
		const policy = this.getPolicy(record.method);
		if (hasFullMeltQuotePayload(record.method, payload) && policy.getPayloadQuoteId(payload)) return this.quoteLifecycle.recordMeltQuoteObservation(policy.toCanonicalQuote(record.mintUrl, payload));
		const payloadState = isMeltQuoteState(payload) ? payload : this.getObjectPayloadState(payload);
		if (!payloadState) return;
		if (payloadState === "PAID") return this.quoteLifecycle.refreshMeltQuote(record.mintUrl, record.method, record.quoteId);
		const existing = await this.quoteLifecycle.getMeltQuote(record.mintUrl, record.method, record.quoteId);
		if (!existing) return;
		const now = Date.now();
		return this.quoteLifecycle.recordMeltQuoteObservation({
			...existing,
			state: payloadState,
			lastObservedRemoteState: payloadState,
			lastObservedRemoteStateAt: now,
			updatedAt: now
		});
	}
	getObjectPayloadState(payload) {
		if (typeof payload !== "object" || payload === null) return;
		const state = payload.state;
		return isMeltQuoteState(state) ? state : void 0;
	}
	async stopWatching(key) {
		const record = this.watchRecordByKey.get(key);
		if (!record) {
			this.interests.removeAll(key);
			return;
		}
		this.removeWatchRecord(key);
		try {
			await record.start;
			await record.stop?.();
		} catch (err) {
			this.logger?.warn("Unsubscribe melt quote watcher failed", {
				key,
				err
			});
		}
	}
	removeWatchRecord(key) {
		this.watchRecordByKey.delete(key);
		this.interests.removeAll(key);
	}
	async stopWatchingMint(mintUrl) {
		this.logger?.info("Stopping all melt quote watchers for mint", { mintUrl });
		const prefix = `${mintUrl}::`;
		const keysToStop = [];
		for (const key of this.watchRecordByKey.keys()) if (key.startsWith(prefix)) keysToStop.push(key);
		for (const key of keysToStop) await this.stopWatching(key);
	}
};

//#endregion
//#region services/watchers/MeltSettlementProcessor.ts
function toKey$1(mintUrl, method, quoteId) {
	return `${normalizeMintUrl(mintUrl)}::${method}::${quoteId}`;
}
function isPendingMeltOperation(operation) {
	return operation.state === "pending";
}
var MeltSettlementInterestRegistry = class {
	operationIdsByQuoteKey = /* @__PURE__ */ new Map();
	quoteKeyByOperationId = /* @__PURE__ */ new Map();
	operationById = /* @__PURE__ */ new Map();
	add(operation) {
		const key = toKey$1(operation.mintUrl, operation.method, operation.quoteId);
		const existingKey = this.quoteKeyByOperationId.get(operation.id);
		if (existingKey === key) {
			this.operationById.set(operation.id, operation);
			return false;
		}
		if (existingKey) this.remove(operation.id);
		let operationIds = this.operationIdsByQuoteKey.get(key);
		if (!operationIds) {
			operationIds = /* @__PURE__ */ new Set();
			this.operationIdsByQuoteKey.set(key, operationIds);
		}
		operationIds.add(operation.id);
		this.quoteKeyByOperationId.set(operation.id, key);
		this.operationById.set(operation.id, operation);
		return true;
	}
	remove(operationId) {
		const key = this.quoteKeyByOperationId.get(operationId);
		if (!key) return false;
		this.quoteKeyByOperationId.delete(operationId);
		this.operationById.delete(operationId);
		const operationIds = this.operationIdsByQuoteKey.get(key);
		operationIds?.delete(operationId);
		if (operationIds?.size === 0) this.operationIdsByQuoteKey.delete(key);
		return true;
	}
	has(operationId) {
		return this.quoteKeyByOperationId.has(operationId);
	}
	getOperationIds(mintUrl, method, quoteId) {
		return Array.from(this.operationIdsByQuoteKey.get(toKey$1(mintUrl, method, quoteId)) ?? []);
	}
	getAllOperationIds() {
		return Array.from(this.quoteKeyByOperationId.keys());
	}
	getAllOperations() {
		return Array.from(this.operationById.values());
	}
};
var MeltSettlementProcessor = class {
	meltOperations;
	bus;
	logger;
	options;
	interestRegistrar;
	running = false;
	offPending;
	offQuoteUpdated;
	offFinalized;
	offRolledBack;
	interests = new MeltSettlementInterestRegistry();
	inFlightOperationIds = /* @__PURE__ */ new Set();
	followUpCheckByOperationId = /* @__PURE__ */ new Map();
	registeredOperationInterestIds = /* @__PURE__ */ new Set();
	scheduledInitialCheckOperationIds = /* @__PURE__ */ new Set();
	inFlightChecks = /* @__PURE__ */ new Set();
	constructor(meltOperations, bus, logger, options = {}) {
		this.meltOperations = meltOperations;
		this.bus = bus;
		this.logger = logger;
		this.options = { initializeExistingPendingOperationsOnStart: options.initializeExistingPendingOperationsOnStart ?? true };
		this.interestRegistrar = options.interestRegistrar;
	}
	isRunning() {
		return this.running;
	}
	/** @internal Rebinds the watcher that owns operation quote subscriptions. */
	async setInterestRegistrar(interestRegistrar) {
		if (this.interestRegistrar === interestRegistrar) {
			if (this.running && interestRegistrar) await this.registerTrackedOperationInterests();
			return;
		}
		const previousRegistrar = this.interestRegistrar;
		const registeredOperationIds = Array.from(this.registeredOperationInterestIds);
		this.interestRegistrar = interestRegistrar;
		this.registeredOperationInterestIds.clear();
		if (previousRegistrar) for (const operationId of registeredOperationIds) await this.removeOperationWatchInterest(previousRegistrar, operationId);
		if (this.running && this.interestRegistrar) await this.registerTrackedOperationInterests();
	}
	async start() {
		if (this.running) return;
		this.running = true;
		this.logger?.info("MeltSettlementProcessor started");
		this.offPending = this.bus.on("melt-op:pending", async ({ operation }) => {
			if (isPendingMeltOperation(operation)) await this.registerOperationInterest(operation);
		});
		this.offQuoteUpdated = this.bus.on("melt-quote:updated", async ({ mintUrl, method, quoteId, quote }) => {
			const operationIds = this.interests.getOperationIds(mintUrl, method, quoteId);
			if (operationIds.length === 0) return;
			await Promise.all(operationIds.map((operationId) => this.checkInterestedOperation(operationId, {
				mintUrl: quote.mintUrl,
				method: quote.method,
				quoteId: quote.quoteId
			})));
		});
		this.offFinalized = this.bus.on("melt-op:finalized", async ({ operationId }) => {
			await this.removeOperationInterest(operationId);
		});
		this.offRolledBack = this.bus.on("melt-op:rolled-back", async ({ operationId }) => {
			await this.removeOperationInterest(operationId);
		});
		if (this.options.initializeExistingPendingOperationsOnStart) await this.initializeExistingPendingOperations();
	}
	async stop() {
		if (!this.running) return;
		this.running = false;
		const unsubscribe = (off) => {
			try {
				off?.();
			} catch {}
		};
		unsubscribe(this.offPending);
		unsubscribe(this.offQuoteUpdated);
		unsubscribe(this.offFinalized);
		unsubscribe(this.offRolledBack);
		this.offPending = void 0;
		this.offQuoteUpdated = void 0;
		this.offFinalized = void 0;
		this.offRolledBack = void 0;
		while (this.inFlightChecks.size > 0) await Promise.allSettled(Array.from(this.inFlightChecks));
		const operationIds = this.interests.getAllOperationIds();
		for (const operationId of operationIds) await this.removeOperationInterest(operationId);
		this.inFlightOperationIds.clear();
		this.followUpCheckByOperationId.clear();
		this.registeredOperationInterestIds.clear();
		this.scheduledInitialCheckOperationIds.clear();
		this.logger?.info("MeltSettlementProcessor stopped");
	}
	async initializeExistingPendingOperations() {
		try {
			const operations = await this.meltOperations.getPendingOperations();
			if (!this.running) return;
			for (const operation of operations) {
				if (!this.running) return;
				if (isPendingMeltOperation(operation)) await this.registerOperationInterest(operation);
			}
		} catch (err) {
			this.logger?.warn("Failed to initialize pending melt settlement interest", { err });
		}
	}
	async registerOperationInterest(operation) {
		if (!this.running) return;
		const mintUrl = normalizeMintUrl(operation.mintUrl);
		const operationInterest = {
			id: operation.id,
			mintUrl,
			method: operation.method,
			quoteId: operation.quoteId
		};
		const added = this.interests.add(operationInterest);
		if (!added && !this.interestRegistrar) return;
		if (added) this.logger?.debug("Registered melt settlement interest", {
			operationId: operation.id,
			mintUrl,
			method: operation.method,
			quoteId: operation.quoteId
		});
		if (this.interestRegistrar) {
			if (!await this.registerOperationWatchInterest(operationInterest)) {
				if (added) this.interests.remove(operation.id);
				return;
			}
		}
		if (!this.running || !this.interests.has(operation.id)) {
			await this.removeRegisteredOperationInterest(operation.id);
			return;
		}
		this.scheduleInitialOperationCheck(operation.id, {
			mintUrl,
			method: operation.method,
			quoteId: operation.quoteId
		});
	}
	async removeOperationInterest(operationId) {
		if (!this.interests.remove(operationId)) return;
		this.followUpCheckByOperationId.delete(operationId);
		this.scheduledInitialCheckOperationIds.delete(operationId);
		this.logger?.debug("Removed melt settlement interest", { operationId });
		await this.removeRegisteredOperationInterest(operationId);
	}
	async registerTrackedOperationInterests() {
		for (const operation of this.interests.getAllOperations()) {
			if (!this.running) return;
			if (this.registeredOperationInterestIds.has(operation.id)) continue;
			await this.registerOperationWatchInterest(operation);
		}
	}
	async registerOperationWatchInterest(operation) {
		if (!this.interestRegistrar) return true;
		try {
			await this.interestRegistrar.registerOperationInterest({
				operationId: operation.id,
				mintUrl: operation.mintUrl,
				method: operation.method,
				quoteId: operation.quoteId
			});
			this.registeredOperationInterestIds.add(operation.id);
			return true;
		} catch (err) {
			this.logger?.warn("Failed to register melt quote operation watch interest", {
				operationId: operation.id,
				mintUrl: operation.mintUrl,
				method: operation.method,
				quoteId: operation.quoteId,
				err
			});
			return false;
		}
	}
	scheduleInitialOperationCheck(operationId, context) {
		if (this.scheduledInitialCheckOperationIds.has(operationId)) return;
		this.scheduledInitialCheckOperationIds.add(operationId);
		setTimeout(() => {
			this.scheduledInitialCheckOperationIds.delete(operationId);
			if (!this.running || !this.interests.has(operationId)) return;
			this.checkInterestedOperation(operationId, context);
		}, 0);
	}
	async removeRegisteredOperationInterest(operationId) {
		if (!this.registeredOperationInterestIds.delete(operationId)) return;
		if (!this.interestRegistrar) return;
		await this.removeOperationWatchInterest(this.interestRegistrar, operationId);
	}
	async removeOperationWatchInterest(registrar, operationId) {
		try {
			await registrar.removeOperationInterest(operationId);
		} catch (err) {
			this.logger?.warn("Failed to remove melt quote operation watch interest", {
				operationId,
				err
			});
		}
	}
	checkInterestedOperation(operationId, quote) {
		const context = {
			mintUrl: normalizeMintUrl(quote.mintUrl),
			method: quote.method,
			quoteId: quote.quoteId
		};
		if (this.inFlightOperationIds.has(operationId)) {
			this.followUpCheckByOperationId.set(operationId, context);
			this.logger?.debug("Melt settlement check already in flight", {
				operationId,
				mintUrl: context.mintUrl,
				method: context.method,
				quoteId: context.quoteId
			});
			return Promise.resolve();
		}
		const check = this.runOperationCheckLoop(operationId, context);
		this.inFlightChecks.add(check);
		check.finally(() => {
			this.inFlightChecks.delete(check);
		});
		return check;
	}
	async runOperationCheckLoop(operationId, initialContext) {
		this.inFlightOperationIds.add(operationId);
		let nextContext = initialContext;
		try {
			while (nextContext) {
				const context = nextContext;
				nextContext = void 0;
				try {
					await this.meltOperations.checkPendingOperation(operationId);
				} catch (err) {
					this.logger?.warn("Failed to settle pending melt operation", {
						operationId,
						mintUrl: context.mintUrl,
						method: context.method,
						quoteId: context.quoteId,
						err
					});
				}
				const followUpContext = this.followUpCheckByOperationId.get(operationId);
				if (followUpContext) {
					this.followUpCheckByOperationId.delete(operationId);
					nextContext = followUpContext;
				}
			}
		} finally {
			this.inFlightOperationIds.delete(operationId);
			this.followUpCheckByOperationId.delete(operationId);
		}
	}
};

//#endregion
//#region operations/send/SendOperation.ts
/**
* Check if operation has PreparedData (any state after init)
*/
function hasPreparedData$1(op) {
	return op.state !== "init";
}
/**
* Check if operation is in a terminal state
*/
function isTerminalOperation$1(op) {
	return op.state === "finalized" || op.state === "rolled_back";
}
/**
* Get the secrets of proofs that will be sent (for finalization tracking).
* - If needsSwap: secrets come from outputData.send
* - If !needsSwap: secrets are the inputProofSecrets (exact match)
*/
function getSendProofSecrets(op) {
	if (!op.needsSwap) return op.inputProofSecrets;
	if (!op.outputData) return [];
	const { sendSecrets } = getSecretsFromSerializedOutputData(op.outputData);
	return sendSecrets;
}
/**
* Get the secrets of proofs we keep (change from swap).
* - If needsSwap: secrets come from outputData.keep
* - If !needsSwap: empty (no change proofs)
*/
function getKeepProofSecrets(op) {
	if (!op.needsSwap) return [];
	if (!op.outputData) return [];
	const { keepSecrets } = getSecretsFromSerializedOutputData(op.outputData);
	return keepSecrets;
}
/**
* Creates a new SendOperation in init state
*/
function createSendOperation(id, mintUrl, amount, options) {
	const now = Date.now();
	return {
		id,
		state: "init",
		mintUrl,
		amount: amount.amount,
		unit: normalizeUnit(amount.unit),
		method: options.method,
		methodData: options.methodData,
		createdAt: now,
		updatedAt: now,
		revision: 0
	};
}
/** Older P2PK recovery could persist pending without a token after all outputs were spent. */
function isLegacyTokenlessP2pkSend(operation) {
	return operation.state === "pending" && operation.method === "p2pk" && operation.needsSwap && (operation.revision ?? 0) === 0 && operation.token == null && !!operation.outputData?.send.length;
}

//#endregion
//#region services/watchers/ProofStateWatcherService.ts
function toKey(mintUrl, secret) {
	return `${mintUrl}::${secret}`;
}
var ProofStateWatcherService = class {
	subs;
	mintService;
	proofs;
	proofRepository;
	bus;
	logger;
	options;
	sendOperationService;
	running = false;
	unsubscribeByKey = /* @__PURE__ */ new Map();
	inflightByKey = /* @__PURE__ */ new Set();
	offProofsStateChanged;
	offProofsSaved;
	offUntrusted;
	constructor(subs, mintService, proofs, proofRepository, bus, logger, options = { watchExistingInflightOnStart: true }) {
		this.subs = subs;
		this.mintService = mintService;
		this.proofs = proofs;
		this.proofRepository = proofRepository;
		this.bus = bus;
		this.logger = logger;
		this.options = options;
	}
	/**
	* Set the SendOperationService for auto-finalizing send operations.
	* This is set after construction to avoid circular dependencies.
	*/
	setSendOperationService(service) {
		this.sendOperationService = service;
	}
	isRunning() {
		return this.running;
	}
	async start() {
		if (this.running) return;
		this.running = true;
		this.logger?.info("ProofStateWatcherService started");
		this.offProofsStateChanged = this.bus.on("proofs:state-changed", async ({ mintUrl, secrets, state }) => {
			try {
				if (!this.running) return;
				if (state === "inflight") try {
					await this.watchProof(mintUrl, secrets);
				} catch (err) {
					this.logger?.warn("Failed to watch inflight proofs", {
						mintUrl,
						count: secrets.length,
						err
					});
				}
				else if (state === "spent") {
					const operationIds = /* @__PURE__ */ new Set();
					for (const secret of secrets) {
						const key = toKey(mintUrl, secret);
						try {
							await this.stopWatching(key);
						} catch (err) {
							this.logger?.warn("Failed to stop watcher on spent proof", {
								mintUrl,
								secret,
								err
							});
						}
						if (!this.sendOperationService) continue;
						try {
							const operationId = await this.getSendOperationIdForSpentProof(mintUrl, secret);
							if (operationId) operationIds.add(operationId);
						} catch (err) {
							this.logger?.warn("Failed to resolve send operation from spent proof event", {
								mintUrl,
								secret,
								err
							});
						}
					}
					for (const operationId of operationIds) await this.tryFinalizeSendOperation(mintUrl, operationId);
				}
			} catch (err) {
				this.logger?.error("Error handling proofs:state-changed", { err });
			}
		});
		this.offProofsSaved = this.bus.on("proofs:saved", async ({ mintUrl, proofs }) => {
			try {
				if (!this.running) return;
				const inflightSecrets = proofs.filter((p) => p.state === "inflight").map((p) => p.secret);
				if (inflightSecrets.length > 0) try {
					await this.watchProof(mintUrl, inflightSecrets);
				} catch (err) {
					this.logger?.warn("Failed to watch inflight proofs from saved event", {
						mintUrl,
						count: inflightSecrets.length,
						err
					});
				}
			} catch (err) {
				this.logger?.error("Error handling proofs:saved", { err });
			}
		});
		this.offUntrusted = this.bus.on("mint:untrusted", async ({ mintUrl }) => {
			try {
				await this.stopWatchingMint(mintUrl);
			} catch (err) {
				this.logger?.error("Failed to stop watching mint proofs on untrust", {
					mintUrl,
					err
				});
			}
		});
		if (this.options.watchExistingInflightOnStart) this.bootstrapInflightProofs().catch((err) => {
			this.logger?.warn("Failed to bootstrap inflight proof watchers", { err });
		});
	}
	async stop() {
		if (!this.running) return;
		this.running = false;
		if (this.offProofsStateChanged) try {
			this.offProofsStateChanged();
		} catch {} finally {
			this.offProofsStateChanged = void 0;
		}
		if (this.offProofsSaved) try {
			this.offProofsSaved();
		} catch {} finally {
			this.offProofsSaved = void 0;
		}
		if (this.offUntrusted) try {
			this.offUntrusted();
		} catch {} finally {
			this.offUntrusted = void 0;
		}
		const entries = Array.from(this.unsubscribeByKey.entries());
		this.unsubscribeByKey.clear();
		for (const [key, unsub] of entries) try {
			await unsub();
			this.logger?.debug("Stopped watching proof", { key });
		} catch (err) {
			this.logger?.warn("Failed to unsubscribe proof watcher", {
				key,
				err
			});
		}
		this.inflightByKey.clear();
		this.logger?.info("ProofStateWatcherService stopped");
	}
	async watchProof(mintUrl, secrets) {
		if (!this.running) return;
		if (!await this.mintService.isTrustedMint(mintUrl)) {
			this.logger?.debug("Skipping watch for untrusted mint", { mintUrl });
			return;
		}
		const toWatch = Array.from(new Set(secrets)).filter((secret) => !this.unsubscribeByKey.has(toKey(mintUrl, secret)));
		if (toWatch.length === 0) return;
		const { secretByYHex, yHexBySecret } = buildYHexMapsForSecrets(toWatch);
		const filters = Array.from(secretByYHex.keys());
		const { subId, unsubscribe } = await this.subs.subscribe(mintUrl, "proof_state", filters, async (payload) => {
			if (payload.state !== "SPENT") return;
			const secret = secretByYHex.get(payload.Y);
			if (!secret) return;
			const key = toKey(mintUrl, secret);
			if (this.inflightByKey.has(key)) return;
			this.inflightByKey.add(key);
			try {
				const sendOperationId = this.sendOperationService ? await this.getSendOperationIdForSpentProof(mintUrl, secret) : void 0;
				if (!(sendOperationId && this.sendOperationService ? await this.sendOperationService.recordProofSpent(sendOperationId, secret) : false)) await this.proofs.setProofState(mintUrl, [secret], "spent");
				this.logger?.info("Marked inflight proof as spent from mint notification", {
					mintUrl,
					subId
				});
				await this.stopWatching(key);
			} catch (err) {
				this.logger?.error("Failed to mark inflight proof as spent", {
					mintUrl,
					subId,
					err
				});
			} finally {
				this.inflightByKey.delete(key);
			}
		});
		let didUnsubscribe = false;
		const remaining = new Set(filters);
		const groupUnsubscribeOnce = async () => {
			if (didUnsubscribe) return;
			didUnsubscribe = true;
			await unsubscribe();
			this.logger?.debug("Unsubscribed watcher for inflight proof group", {
				mintUrl,
				subId
			});
		};
		for (const secret of toWatch) {
			const key = toKey(mintUrl, secret);
			const yHex = yHexBySecret.get(secret);
			const perKeyStop = async () => {
				if (remaining.has(yHex)) remaining.delete(yHex);
				if (remaining.size === 0) await groupUnsubscribeOnce();
			};
			this.unsubscribeByKey.set(key, perKeyStop);
		}
		this.logger?.debug("Watching inflight proof states", {
			mintUrl,
			subId,
			filterCount: filters.length
		});
	}
	async bootstrapInflightProofs() {
		if (!this.running) return;
		this.logger?.info("Bootstrapping inflight proof watchers");
		await this.proofs.checkInflightProofs();
		if (!this.running) return;
		const inflightProofs = await this.proofRepository.getInflightProofs();
		if (!this.running || inflightProofs.length === 0) return;
		const byMint = /* @__PURE__ */ new Map();
		for (const proof of inflightProofs) {
			if (!proof.mintUrl || !proof.secret) continue;
			const secrets = byMint.get(proof.mintUrl) ?? [];
			secrets.push(proof.secret);
			byMint.set(proof.mintUrl, secrets);
		}
		for (const [mintUrl, secrets] of byMint.entries()) {
			if (!this.running) return;
			if (secrets.length === 0) continue;
			try {
				await this.watchProof(mintUrl, secrets);
			} catch (err) {
				this.logger?.warn("Failed to watch existing inflight proofs", {
					mintUrl,
					count: secrets.length,
					err
				});
			}
		}
	}
	async stopWatching(key) {
		const unsubscribe = this.unsubscribeByKey.get(key);
		if (!unsubscribe) return;
		try {
			await unsubscribe();
		} catch (err) {
			this.logger?.warn("Unsubscribe proof watcher failed", {
				key,
				err
			});
		} finally {
			this.unsubscribeByKey.delete(key);
		}
	}
	async stopWatchingMint(mintUrl) {
		this.logger?.info("Stopping all proof watchers for mint", { mintUrl });
		const prefix = `${mintUrl}::`;
		const keysToStop = [];
		for (const key of this.unsubscribeByKey.keys()) if (key.startsWith(prefix)) keysToStop.push(key);
		for (const key of this.inflightByKey) if (key.startsWith(prefix)) this.inflightByKey.delete(key);
		for (const key of keysToStop) await this.stopWatching(key);
		this.logger?.info("Stopped proof watchers for mint", {
			mintUrl,
			count: keysToStop.length
		});
	}
	/**
	* Resolve the send operation associated with a spent proof, if any.
	*/
	async getSendOperationIdForSpentProof(mintUrl, secret) {
		const spentProof = await this.proofRepository.getProofBySecret(mintUrl, secret);
		return spentProof?.usedByOperationId || spentProof?.createdByOperationId;
	}
	/**
	* Check if all send proofs for an operation are spent and finalize it if so.
	*/
	async tryFinalizeSendOperation(mintUrl, operationId) {
		if (!this.sendOperationService) return;
		try {
			const operation = await this.sendOperationService.getOperation(operationId);
			if (!operation || operation.state !== "pending") return;
			if (!hasPreparedData$1(operation)) return;
			const sendProofSecrets = getSendProofSecrets(operation);
			if (sendProofSecrets.length === 0) return;
			const sendProofs = await this.proofRepository.getProofsBySecrets(mintUrl, sendProofSecrets);
			const expectedProofCount = new Set(sendProofSecrets).size;
			if (sendProofs.length === expectedProofCount && sendProofs.every((proof) => proof.state === "spent")) {
				this.logger?.info("All send proofs spent, finalizing operation", { operationId });
				await this.sendOperationService.finalize(operationId);
			}
		} catch (err) {
			this.logger?.error("Failed to check/finalize send operation", {
				mintUrl,
				operationId,
				err
			});
		}
	}
};

//#endregion
//#region services/TokenService.ts
var TokenService = class {
	mintService;
	logger;
	constructor(mintService, logger) {
		this.mintService = mintService;
		this.logger = logger;
	}
	/** Decode a token into a Token object using the mint's keysets for decoding.
	* @param token - The token to decode (can be a string or already decoded Token object)
	* @param mintUrl - The URL of the mint to use for fetching keysets for decoding
	* @returns The decoded Token object with proofs decoded using the mint's keysets
	*/
	async decodeToken(token, mintUrl, expectedUnit) {
		if (!token) {
			this.logger?.warn("No token provided for decoding", { token });
			throw new TokenValidationError("Token is required");
		}
		if (!mintUrl) {
			this.logger?.warn("No mint URL provided for token decoding", { token });
			throw new TokenValidationError("Mint URL is required for token decoding");
		}
		let mintKeysets;
		try {
			const { keysets } = await this.mintService.ensureUpdatedMint(mintUrl);
			mintKeysets = keysets;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : "Unable to retrieve mint keysets";
			this.logger?.warn("Failed to get updated keysets for mint", {
				token,
				mintUrl,
				err: errMsg
			});
			throw new TokenValidationError(errMsg);
		}
		try {
			const keysetIds = mintKeysets.map((keyset) => keyset.id);
			const decoded = typeof token === "string" ? getDecodedToken$1(token, keysetIds) : token;
			const decodedForUnitResolution = typeof token === "string" && !encodedTokenMetadataHasExplicitUnit(token) ? {
				...decoded,
				unit: void 0
			} : decoded;
			if (decoded.proofs.some((proof) => isBlsKeyset(proof.id))) throw new ProofValidationError("BLS v3 keysets are not supported");
			const unit = this.resolveTokenUnit(decodedForUnitResolution, mintKeysets, expectedUnit);
			return {
				...decoded,
				unit
			};
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : "Unknown error during token decoding";
			this.logger?.warn("Failed to decode token", {
				token,
				mintUrl,
				err: errMsg
			});
			throw new ProofValidationError(errMsg);
		}
	}
	resolveTokenUnit(token, keysets, expectedUnit) {
		const keysetUnits = new Map(keysets.map((keyset) => [keyset.id, normalizeUnit(keyset.unit || DEFAULT_UNIT, { defaultUnit: DEFAULT_UNIT })]));
		const resolvedProofUnits = token.proofs.map((proof) => keysetUnits.get(proof.id)).filter((unit) => unit !== void 0);
		const uniqueProofUnits = Array.from(new Set(resolvedProofUnits));
		if (uniqueProofUnits.length > 1) throw new TokenValidationError(`Token contains proofs from multiple units: ${uniqueProofUnits.join(", ")}`);
		const tokenUnit = token.unit === void 0 || token.unit === null ? void 0 : normalizeUnit(token.unit, { defaultUnit: DEFAULT_UNIT });
		const resolvedUnit = tokenUnit ?? uniqueProofUnits[0] ?? DEFAULT_UNIT;
		if (tokenUnit && uniqueProofUnits[0]) assertSameUnit(uniqueProofUnits[0], tokenUnit, "Token proof keysets");
		if (expectedUnit !== void 0) assertSameUnit(resolvedUnit, expectedUnit, "Token");
		return resolvedUnit;
	}
};
function encodedTokenMetadataHasExplicitUnit(token) {
	try {
		const metadata = getTokenMetadata$1(token);
		if (metadata.unit === void 0 || metadata.unit === null) return false;
		if (isLegacyTokenWithoutUnit(token)) return false;
		return true;
	} catch {
		return true;
	}
}
function stripCashuTokenPrefix(token) {
	for (const prefix of [
		"web+cashu://",
		"cashu://",
		"cashu:"
	]) if (token.startsWith(prefix)) return stripCashuTokenPrefix(token.slice(prefix.length));
	return token.startsWith("cashu") ? token.slice(5) : token;
}
function decodeBase64Url(input) {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	let buffer = 0;
	let bits = 0;
	const bytes = [];
	for (const char of normalized) {
		if (char === "=") break;
		const value = BASE64_ALPHABET.indexOf(char);
		if (value < 0) throw new Error("Invalid base64url character");
		buffer = buffer << 6 | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push(buffer >> bits & 255);
		}
	}
	return Uint8Array.from(bytes);
}
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function isLegacyTokenWithoutUnit(token) {
	const payload = stripCashuTokenPrefix(token);
	if (payload.slice(0, 1) !== "A") return false;
	const body = payload.slice(1);
	const json = new TextDecoder().decode(decodeBase64Url(body));
	const decoded = JSON.parse(json);
	return !Object.prototype.hasOwnProperty.call(decoded, "unit");
}

//#endregion
//#region infra/handlers/send/SendHandlerProvider.ts
/**
* Runtime registry for send method handlers.
* Keeps wiring concerns out of the core send domain.
*/
var SendHandlerProvider = class {
	registry = {};
	constructor(initialHandlers) {
		if (initialHandlers) this.registerMany(initialHandlers);
	}
	register(method, handler) {
		this.registry[method] = handler;
	}
	registerMany(handlers) {
		for (const [method, handler] of Object.entries(handlers)) if (handler) this.registry[method] = handler;
	}
	get(method) {
		const handler = this.registry[method];
		if (!handler) throw new Error(`No send handler registered for method ${method}`);
		return handler;
	}
	getAll() {
		return this.registry;
	}
};

//#endregion
//#region operations/MintScopedLock.ts
/**
* In-memory FIFO lock keyed by mint URL.
*
* This lock coordinates proof selection/reservation critical sections across
* operation services within a single runtime.
*/
var MintScopedLock = class {
	queues = /* @__PURE__ */ new Map();
	async acquire(mintUrl) {
		let queue = this.queues.get(mintUrl);
		if (!queue) {
			queue = {
				locked: false,
				waiters: []
			};
			this.queues.set(mintUrl, queue);
		}
		if (queue.locked) await new Promise((resolve) => {
			queue.waiters.push(resolve);
		});
		queue.locked = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = queue.waiters.shift();
			if (next) {
				next();
				return;
			}
			queue.locked = false;
			this.queues.delete(mintUrl);
		};
	}
};

//#endregion
//#region operations/send/SendOperationService.ts
const DEFINITIVE_SWAP_MINT_ERROR_CODES = new Set([
	10001,
	11005,
	11007,
	11008,
	11009,
	11010,
	11014,
	11015,
	12001,
	12002,
	12003
]);
/**
* Service that manages send operations as sagas.
*
* This service provides crash recovery and rollback capabilities for send operations
* by breaking them into discrete steps: init → prepare → execute → finalize/rollback.
*/
var SendOperationService = class {
	operationQueries;
	proofQueries;
	transactions;
	mintQueries;
	mintMetadataQueries;
	mintMetadataRefresh;
	remote;
	loadSeed;
	eventBus;
	handlerProvider;
	logger;
	outputDataCreator;
	/** In-memory lock to prevent concurrent operations on the same operation ID */
	operationIdLock = new OperationIdLock();
	/** Lock for the global recovery process */
	recoveryLock = null;
	/** In-memory lock to serialize proof selection/reservation per mint */
	mintScopedLock;
	constructor(dependencies) {
		this.operationQueries = dependencies.operationQueries;
		this.proofQueries = dependencies.proofQueries;
		this.transactions = dependencies.transactions;
		this.mintQueries = dependencies.mintQueries;
		this.mintMetadataQueries = dependencies.mintMetadataQueries;
		this.mintMetadataRefresh = dependencies.mintMetadataRefresh;
		this.remote = dependencies.remote;
		this.loadSeed = dependencies.loadSeed;
		this.eventBus = dependencies.eventBus;
		this.handlerProvider = dependencies.handlerProvider;
		this.logger = dependencies.logger;
		this.outputDataCreator = dependencies.outputDataCreator ?? OutputData;
		this.mintScopedLock = dependencies.mintScopedLock ?? new MintScopedLock();
	}
	/**
	* Acquire a lock for an operation.
	* Returns a release function that must be called when the operation completes.
	* Throws if the operation is already locked.
	*/
	async acquireOperationLock(operationId) {
		return this.operationIdLock.acquire(operationId);
	}
	/**
	* Check if an operation is currently locked.
	*/
	isOperationLocked(operationId) {
		return this.operationIdLock.isLocked(operationId);
	}
	/**
	* Check if recovery is currently in progress.
	*/
	isRecoveryInProgress() {
		return this.recoveryLock !== null;
	}
	/**
	* Create a new send operation.
	* This is the entry point for the saga.
	*/
	async init(mintUrl, amount, options = {
		method: "default",
		methodData: {}
	}) {
		mintUrl = normalizeMintUrl(mintUrl);
		const parsed = normalizeUnitAmount(amount);
		if (!await this.mintQueries.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		if (parsed.amount.isZero()) throw new ProofValidationError("Amount must be a positive number");
		const id = generateSubId();
		const operation = createSendOperation(id, mintUrl, parsed, options);
		this.logger?.debug("Send operation initialized in memory", {
			operationId: id,
			mintUrl,
			amount: parsed.amount,
			unit: parsed.unit,
			method: options.method
		});
		return operation;
	}
	/**
	* Prepare the operation by reserving proofs and creating outputs.
	* After this step, the operation can be executed or rolled back.
	*
	* Throws if the operation is already in progress.
	*/
	async prepare(operation) {
		const releaseLock = await this.acquireOperationLock(operation.id);
		let result;
		try {
			const releaseMintLock = await this.mintScopedLock.acquire(operation.mintUrl);
			try {
				const handler = this.handlerProvider.get(operation.method);
				if (!await this.mintQueries.isTrustedMint(operation.mintUrl)) throw new UnknownMintError(`Mint ${operation.mintUrl} is not trusted`);
				const metadata = await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl);
				const keys = this.activeKeys(metadata, operation.unit);
				const seed = await this.loadSeed();
				const plan = handler.prepare({
					operation,
					activeKeys: keys,
					mintInfo: metadata.mint.mintInfo,
					outputDataCreator: this.outputDataCreator
				});
				result = await this.transactions.prepare({
					operation: {
						...operation,
						updatedAt: Date.now()
					},
					activeKeys: keys,
					seed,
					...plan
				});
			} finally {
				releaseMintLock();
			}
		} finally {
			releaseLock();
		}
		await this.publishPrepared(result);
		return result.operation;
	}
	/**
	* Execute the prepared operation.
	* Performs the swap (if needed) and creates the token.
	* If a memo is provided, trims it and persists it on the token before saving the
	* pending operation. Whitespace-only memos are omitted.
	*
	* Swap execution commits the exact request before contacting the mint and applies a successful
	* response in a second atomic transition. Ambiguous outcomes remain executing for recovery.
	* Throws if the operation is already in progress.
	*/
	async execute(operation, options) {
		const current = await this.operationQueries.getById(operation.id);
		if (!current) throw new SendOperationConflictError(operation.id, `Send operation ${operation.id} not found`);
		if (current.state !== "prepared" && !(current.state === "pending" && !current.needsSwap)) throw new SendOperationConflictError(operation.id, `Cannot execute Send operation in state ${current.state}`);
		return current.needsSwap ? this.executePreparedSwap(current.id, options) : this.executeExactMatch(current.id, options?.memo);
	}
	async executePreparedSwap(operationId, options) {
		const releaseLock = await this.acquireOperationLock(operationId);
		let outcome;
		try {
			const current = await this.operationQueries.getById(operationId);
			if (!current) throw new Error(`Operation ${operationId} not found`);
			if (current.state !== "prepared") throw new SendOperationConflictError(operationId, `Cannot execute Send operation in state ${current.state}`);
			outcome = await this.executeSwap(current, options);
		} finally {
			releaseLock();
		}
		if (!outcome) throw new Error(`Send operation ${operationId} did not produce a pending result`);
		if (outcome.status === "FAILED") {
			await this.publishFailedSwap(outcome.result);
			throw outcome.error;
		}
		await this.publishAppliedSwap(outcome.result);
		return {
			operation: outcome.result.operation,
			token: outcome.result.operation.token
		};
	}
	async executeSwap(operation, options) {
		if (!operation.outputData) throw new Error("Missing output data for swap operation");
		const remote = this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl), operation.unit);
		const begun = await this.transactions.beginExecution({
			operationId: operation.id,
			updatedAt: Date.now(),
			memo: options?.memo ? this.normalizeMemo(options.memo) : void 0
		});
		return this.submitPersistedSwap(begun.operation, begun.request, remote, "initial");
	}
	async submitPersistedSwap(operation, request, remote, submission) {
		let result;
		try {
			result = await remote.swap(request);
		} catch (error) {
			if (submission === "replay" || !this.isDefinitiveSwapFailure(error)) throw error;
			return {
				status: "FAILED",
				result: await this.transactions.failExecution({
					operationId: operation.id,
					expectedRevision: operation.revision ?? 0,
					updatedAt: Date.now(),
					error: error.message
				}),
				error
			};
		}
		const keepProofs = mapProofToCoreProof(request.mintUrl, "ready", result.keep, {
			unit: request.unit,
			createdByOperationId: operation.id
		});
		const sendProofs = mapProofToCoreProof(request.mintUrl, "inflight", result.send, {
			unit: request.unit,
			createdByOperationId: operation.id
		});
		const token = {
			mint: request.mintUrl,
			proofs: result.send,
			unit: request.unit,
			...operation.executionMemo ? { memo: operation.executionMemo } : {}
		};
		return {
			status: "PENDING",
			result: await this.transactions.applyResult({
				operationId: operation.id,
				updatedAt: Date.now(),
				keepProofs,
				sendProofs,
				token
			})
		};
	}
	async executeExactMatch(operationId, memo) {
		const releaseLock = await this.acquireOperationLock(operationId);
		let result;
		try {
			result = await this.transactions.executeExact({
				operationId,
				updatedAt: Date.now(),
				memo
			});
		} finally {
			releaseLock();
		}
		if (result.committed) {
			await this.publishCommittedEvent("send:pending", {
				mintUrl: result.operation.mintUrl,
				operationId: result.operation.id,
				operation: result.operation,
				token: result.token
			});
			await this.publishCommittedEvent("proofs:state-changed", {
				mintUrl: result.operation.mintUrl,
				secrets: result.operation.inputProofSecrets,
				state: "inflight"
			});
		}
		this.logger?.info("Exact-match Send operation executed", {
			operationId,
			proofCount: result.token.proofs.length,
			committed: result.committed
		});
		return result;
	}
	/**
	* High-level send method that orchestrates init → prepare → execute.
	* This is the main entry point for consumers.
	*/
	async send(mintUrl, amount) {
		const initOp = await this.init(mintUrl, amount);
		const preparedOp = await this.prepare(initOp);
		const { token } = await this.execute(preparedOp);
		return token;
	}
	/**
	* Finalize a pending operation after its proofs have been spent.
	* This method is idempotent - calling it on an already finalized operation is a no-op.
	* If the operation was rolled back, finalization is skipped (rollback takes precedence).
	* Throws if the operation is already in progress.
	*/
	async finalize(operationId) {
		if (!await this.operationQueries.getById(operationId)) throw new Error(`Operation ${operationId} not found`);
		return this.completePersistedSend(operationId);
	}
	async completePersistedSend(operationId) {
		let releaseLock;
		let result;
		try {
			try {
				releaseLock = await this.acquireOperationLock(operationId);
			} catch (error) {
				if (!(error instanceof OperationInProgressError)) throw error;
				await this.operationIdLock.waitForUnlock(operationId);
				const latest = await this.operationQueries.getById(operationId);
				if (!latest) throw new Error(`Operation ${operationId} not found`);
				if (latest.state === "finalized") {
					this.logger?.debug("Operation finalized while waiting for lock", { operationId });
					return;
				}
				if (latest.state === "rolled_back" || latest.state === "rolling_back") {
					this.logger?.debug("Operation rolled back while waiting for lock", {
						operationId,
						state: latest.state
					});
					return;
				}
				releaseLock = await this.acquireOperationLock(operationId);
			}
			const operation = await this.operationQueries.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (operation.state === "finalized") {
				this.logger?.debug("Operation already finalized", { operationId });
				return;
			}
			if (operation.state === "rolled_back" || operation.state === "rolling_back") {
				this.logger?.debug("Operation was rolled back or is rolling back, skipping finalization", { operationId });
				return;
			}
			if (operation.state !== "pending") throw new Error(`Cannot finalize operation in state ${operation.state}`);
			if (isLegacyTokenlessP2pkSend(operation)) {
				const observation = await this.observeLegacyTokenlessP2pk(operation);
				if (!observation) throw new ProofValidationError(`Cannot finalize unspent Send operation ${operationId}`);
				result = await this.transactions.completePending(observation);
			} else {
				const sendSecrets = getSendProofSecrets(operation);
				const localProofs = await this.proofQueries.getProofsBySecrets(operation.mintUrl, sendSecrets);
				const locallySpent = localProofs.length === new Set(sendSecrets).size && localProofs.every((proof) => proof.state === "spent");
				let observedSpentSecrets;
				if (!locallySpent) {
					if (!(await this.checkProofStatesWithMint(operation.mintUrl, sendSecrets, operation.unit)).every((state) => state.state === "SPENT")) throw new ProofValidationError(`Cannot finalize unspent Send operation ${operationId}`);
					observedSpentSecrets = sendSecrets;
				}
				result = await this.transactions.completePending({
					operationId,
					updatedAt: Date.now(),
					spentProofSecrets: observedSpentSecrets
				});
			}
		} finally {
			releaseLock?.();
		}
		if (result) await this.publishCompletedSend(result);
	}
	/**
	* Cancel a prepared operation and release its reservations.
	* Reclaim commits its Output Allocation before mint I/O and applies the result atomically.
	* Throws if the operation is already in progress.
	*/
	async rollback(operationId, reason = "Rolled back by user action") {
		const operation = await this.operationQueries.getById(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		const handler = this.handlerProvider.get(operation.method);
		if (operation.state !== "prepared" && !handler.canReclaim) throw new Error(`P2PK Send Operation in ${operation.state} state can not be rolled back.`);
		return this.rollbackPersistedSend(operationId, reason);
	}
	/**
	* Reclaims the frozen Friday NUT-11 refund subset. A pending call creates one durable plan;
	* a rolling_back call only resumes that exact plan.
	*/
	async reclaim(operationId, options) {
		if (options.spendingPath !== "refund") throw new ProofValidationError("Unsupported Send reclaim spending path");
		for (;;) {
			let releaseLock;
			let completed;
			let result;
			try {
				try {
					releaseLock = await this.acquireOperationLock(operationId);
				} catch (error) {
					if (!(error instanceof OperationInProgressError)) throw error;
					await this.operationIdLock.waitForUnlock(operationId);
					continue;
				}
				const operation = await this.operationQueries.getById(operationId);
				if (!operation) throw new Error(`Operation ${operationId} not found`);
				if (operation.state === "rolled_back" || operation.state === "finalized") result = operation;
				else if (operation.state === "pending") {
					if (operation.method !== "p2pk") throw new SendOperationConflictError(operationId, "Refund spending path requires a pending P2PK Send operation");
					const p2pkOperation = operation;
					const inputProofs = await this.loadExactRefundInputs(p2pkOperation);
					const handler = this.handlerProvider.get("p2pk");
					if (!handler.prepareReclaim) throw new ProofValidationError("P2PK refund reclaim is unavailable");
					const prepared = await handler.prepareReclaim({
						operation: p2pkOperation,
						inputProofs
					});
					const cached = await this.mintMetadataQueries.getMetadata(operation.mintUrl);
					if (!cached) throw new UnknownMintError(`Mint ${operation.mintUrl} is not stored`);
					const begun = await this.transactions.beginReclaim({
						operationId,
						updatedAt: Date.now(),
						activeKeys: this.activeKeys(cached, operation.unit),
						seed: await this.loadSeed(),
						spendingPath: "refund",
						expectedRevision: operation.revision ?? 0,
						expectedInputProofSecrets: inputProofs.map((proof) => proof.secret),
						conditionFingerprint: prepared.conditionFingerprint,
						refundPublicKeyX: prepared.refundPublicKeyX
					});
					if (begun.counter) await this.publishCommittedEvent("counter:updated", begun.counter);
					const reclaimed = await this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl), operation.unit).reclaim(prepared.inputProofs, begun.operation.reclaimData.outputData);
					completed = await this.completeRefundReclaim(begun.operation, reclaimed);
					result = completed.operation;
				} else if (operation.state === "rolling_back") {
					if (operation.method !== "p2pk" || operation.reclaimData?.spendingPath !== "refund") throw new SendOperationConflictError(operationId, "Rolling-back Send does not contain a P2PK refund plan");
					const recovered = await this.recoverRefundReclaim(operation);
					completed = recovered.completed;
					result = recovered.operation;
				} else throw new SendOperationConflictError(operationId, `Cannot refund Send operation in state ${operation.state}`);
			} finally {
				releaseLock?.();
			}
			if (completed) await this.publishReclaimedSend(completed);
			if (!result) throw new Error(`Send operation ${operationId} produced no refund result`);
			return result;
		}
	}
	async recoverRefundReclaim(operation) {
		const reclaimData = operation.reclaimData;
		if (!reclaimData || reclaimData.spendingPath !== "refund") throw new SendOperationConflictError(operation.id, "P2PK refund plan is missing");
		let remote;
		try {
			remote = this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl), operation.unit);
		} catch {
			return { operation };
		}
		const restored = await this.observeRefundOutputs(remote, reclaimData.outputData);
		const restoredCompletion = await this.completeObservedRefund(operation, restored);
		if (restoredCompletion) return {
			operation: restoredCompletion.operation,
			completed: restoredCompletion
		};
		if (restored.status !== "none") return { operation };
		let inputProofs;
		try {
			inputProofs = await this.loadExactRefundInputs(operation);
		} catch {
			return { operation };
		}
		let inputStates;
		try {
			inputStates = await remote.observeReclaimInputStates(inputProofs);
		} catch {
			return { operation };
		}
		if (inputStates.status !== "complete" || !inputStates.inputs.every(({ state }) => state.state === "UNSPENT")) return { operation };
		const handler = this.handlerProvider.get("p2pk");
		if (!handler.prepareReclaim) return { operation };
		let prepared;
		try {
			prepared = await handler.prepareReclaim({
				operation,
				inputProofs
			});
			if (prepared.conditionFingerprint !== reclaimData.conditionFingerprint || prepared.refundPublicKeyX !== reclaimData.refundPublicKeyX) return { operation };
		} catch {
			return { operation };
		}
		try {
			const proofs = await remote.reclaim(prepared.inputProofs, reclaimData.outputData);
			const completed = await this.completeRefundReclaim(operation, proofs);
			return {
				operation: completed.operation,
				completed
			};
		} catch {
			const replayObservation = await this.observeRefundOutputs(remote, reclaimData.outputData);
			const completed = await this.completeObservedRefund(operation, replayObservation);
			return completed ? {
				operation: completed.operation,
				completed
			} : { operation };
		}
	}
	async observeRefundOutputs(remote, outputData) {
		try {
			return await remote.observeReclaimOutputs(outputData);
		} catch {
			return {
				status: "inconclusive",
				reason: "unavailable",
				outputs: []
			};
		}
	}
	async completeObservedRefund(operation, observation) {
		if (observation.status !== "complete" || !observation.outputs.every((output) => output.state.state === "UNSPENT")) return;
		return this.completeRefundReclaim(operation, observation.outputs.map((output) => output.proof));
	}
	completeRefundReclaim(operation, proofs) {
		return this.transactions.completeReclaim({
			operationId: operation.id,
			updatedAt: Date.now(),
			reason: "Refunded after P2PK locktime",
			proofs: mapProofToCoreProof(operation.mintUrl, "ready", proofs, { unit: operation.unit })
		});
	}
	async loadExactRefundInputs(operation) {
		const secrets = operation.state === "rolling_back" && operation.reclaimData?.spendingPath === "refund" ? operation.reclaimData.inputProofSecrets : getSendProofSecrets(operation);
		if (secrets.length === 0 || new Set(secrets).size !== secrets.length) throw new ProofValidationError("P2PK refund input binding is empty or duplicated");
		const stored = await this.proofQueries.getProofsBySecrets(operation.mintUrl, secrets);
		const bySecret = new Map(stored.map((proof) => [proof.secret, proof]));
		if (bySecret.size !== secrets.length) throw new ProofValidationError("P2PK refund input metadata is incomplete");
		const proofs = secrets.map((secret) => bySecret.get(secret));
		if (proofs.some((proof) => proof.unit !== operation.unit || proof.state !== "inflight" || (operation.needsSwap ? proof.createdByOperationId !== operation.id : proof.usedByOperationId !== operation.id))) throw new ProofValidationError("P2PK refund inputs are not exact operation-owned proofs");
		return proofs;
	}
	async rollbackPersistedSend(operationId, reason) {
		const releaseLock = await this.acquireOperationLock(operationId);
		let cancelled;
		let reclaimed;
		try {
			const operation = await this.operationQueries.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (operation.state === "prepared") cancelled = await this.transactions.cancelPrepared({
				operationId,
				updatedAt: Date.now(),
				reason
			});
			else if (operation.state === "pending" && operation.method === "default") {
				const metadata = await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl);
				const remote = this.remote.open(metadata, operation.unit);
				const begun = await this.transactions.beginReclaim({
					operationId,
					updatedAt: Date.now(),
					activeKeys: this.activeKeys(metadata, operation.unit),
					seed: await this.loadSeed()
				});
				if (begun.counter) await this.publishCommittedEvent("counter:updated", begun.counter);
				if (begun.skippedForFees) this.logger?.warn("Cannot reclaim send proofs because fees consume the amount", { operationId });
				const proofs = begun.operation.reclaimData ? await remote.reclaim(begun.inputProofs, begun.operation.reclaimData.outputData) : [];
				reclaimed = await this.transactions.completeReclaim({
					operationId,
					updatedAt: Date.now(),
					reason,
					proofs: mapProofToCoreProof(operation.mintUrl, "ready", proofs, { unit: operation.unit })
				});
			} else throw new Error(`Cannot rollback operation in state ${operation.state}`);
		} finally {
			releaseLock();
		}
		if (cancelled) await this.publishCancelledSend(cancelled);
		if (reclaimed) await this.publishReclaimedSend(reclaimed);
	}
	async publishReclaimedSend(reclaimed) {
		await this.publishSavedProofs(reclaimed.operation.mintUrl, reclaimed.savedProofs);
		if (reclaimed.spentProofSecrets.length > 0) await this.publishCommittedEvent("proofs:state-changed", {
			mintUrl: reclaimed.operation.mintUrl,
			secrets: reclaimed.spentProofSecrets,
			state: "spent"
		});
		if (reclaimed.releasedProofSecrets.length > 0) await this.publishCommittedEvent("proofs:released", {
			mintUrl: reclaimed.operation.mintUrl,
			secrets: reclaimed.releasedProofSecrets
		});
		await this.publishCommittedEvent("send:rolled-back", {
			mintUrl: reclaimed.operation.mintUrl,
			operationId: reclaimed.operation.id,
			operation: reclaimed.operation
		});
	}
	/**
	* Recover pending operations on startup.
	* This should be called during initialization.
	* Throws if recovery is already in progress.
	*/
	async recoverPendingOperations() {
		if (this.recoveryLock) throw new Error("Recovery is already in progress");
		let releaseRecoveryLock;
		this.recoveryLock = new Promise((resolve) => {
			releaseRecoveryLock = resolve;
		});
		try {
			let initCount = 0;
			let executingCount = 0;
			let pendingCount = 0;
			let rollingBackCount = 0;
			let orphanCount = 0;
			const initOps = await this.operationQueries.getByState("init");
			for (const op of initOps) {
				await this.recoverInitOperation(op);
				initCount++;
			}
			const preparedOps = await this.operationQueries.getByState("prepared");
			for (const op of preparedOps) this.logger?.warn("Found stale prepared operation, user can rollback manually", { operationId: op.id });
			const executingOps = await this.operationQueries.getByState("executing");
			for (const op of executingOps) try {
				await this.recoverExecutingOperation(op);
				executingCount++;
			} catch (e) {
				this.logger?.error("Error recovering executing operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const pendingOps = await this.operationQueries.getByState("pending");
			for (const op of pendingOps) try {
				await this.checkPendingOperation(op);
				pendingCount++;
			} catch (e) {
				this.logger?.error("Error checking pending operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const rollingBackOps = await this.operationQueries.getByState("rolling_back");
			for (const op of rollingBackOps) {
				if (op.method === "p2pk" && op.reclaimData?.spendingPath === "refund") try {
					await this.reclaim(op.id, { spendingPath: "refund" });
				} catch (error) {
					this.logger?.error("Error recovering P2PK refund reclaim", {
						operationId: op.id,
						error: error instanceof Error ? error.message : String(error)
					});
				}
				else this.logger?.warn("Found operation stuck in rolling_back state. This indicates a crash during rollback. Manual recovery via seed restore may be needed.", {
					operationId: op.id,
					mintUrl: op.mintUrl,
					amount: op.amount
				});
				rollingBackCount++;
			}
			orphanCount = await this.cleanupOrphanedReservations();
			this.logger?.info("Recovery completed", {
				initOperations: initCount,
				executingOperations: executingCount,
				pendingOperations: pendingCount,
				rollingBackOperations: rollingBackCount,
				orphanedReservations: orphanCount
			});
		} finally {
			this.recoveryLock = null;
			releaseRecoveryLock();
		}
	}
	/**
	* Clean up a failed init operation.
	* Releases any orphaned proof reservations and deletes the operation.
	*/
	async recoverInitOperation(op) {
		const result = await this.transactions.cleanupLegacyInit(op.id);
		if (result.releasedProofSecrets.length > 0) await this.publishCommittedEvent("proofs:released", {
			mintUrl: result.mintUrl,
			secrets: result.releasedProofSecrets
		});
		this.logger?.info("Cleaned up failed init operation", { operationId: op.id });
	}
	/**
	* Recover an executing swap using only its persisted inputs, outputs, and memo.
	*/
	async recoverExecutingOperation(op) {
		const latest = await this.operationQueries.getById(op.id);
		if (!latest || latest.state !== "executing") {
			this.logger?.debug("Skipping executing Send recovery because state changed", {
				operationId: op.id,
				state: latest?.state
			});
			return;
		}
		if (!latest.needsSwap) {
			const recovered = await this.transactions.recoverLegacyExact({
				operationId: latest.id,
				updatedAt: Date.now()
			});
			if (recovered.readyProofSecrets.length > 0) await this.publishCommittedEvent("proofs:state-changed", {
				mintUrl: recovered.operation.mintUrl,
				secrets: recovered.readyProofSecrets,
				state: "ready"
			});
			await this.publishCancelledSend(recovered);
			return;
		}
		if (!latest.outputData) {
			this.logger?.warn("Executing Send lacks a persisted swap request; leaving it for recovery", { operationId: latest.id });
			return;
		}
		const storedInputs = await this.proofQueries.getProofsBySecrets(latest.mintUrl, latest.inputProofSecrets);
		const inputBySecret = new Map(storedInputs.map((proof) => [proof.secret, proof]));
		if (inputBySecret.size !== latest.inputProofSecrets.length) throw new ProofValidationError("Cannot recover Send operation: missing input proof metadata");
		const inputProofs = latest.inputProofSecrets.map((secret) => inputBySecret.get(secret));
		const remote = this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(latest.mintUrl), latest.unit);
		const inputStates = await remote.checkProofStates(inputProofs);
		if (inputStates.length !== inputProofs.length) {
			this.logger?.warn("Executing Send proof-state response was incomplete; preserving recovery material", { operationId: latest.id });
			return;
		}
		const allUnspent = inputStates.every((state) => state.state === "UNSPENT");
		const allSpent = inputStates.every((state) => state.state === "SPENT");
		if (allUnspent) {
			const claimed = await this.transactions.claimRecovery({
				operationId: latest.id,
				expectedRevision: latest.revision ?? 0,
				updatedAt: Date.now()
			});
			const outcome = await this.submitPersistedSwap(claimed.operation, claimed.request, remote, "replay");
			if (outcome.status === "FAILED") await this.publishFailedSwap(outcome.result);
			else await this.publishAppliedSwap(outcome.result);
			this.logger?.info("Replayed executing Send from its persisted request", {
				operationId: latest.id,
				result: outcome.status
			});
			return;
		}
		if (!allSpent) {
			this.logger?.warn("Executing Send outcome remains ambiguous; preserving recovery material", { operationId: latest.id });
			return;
		}
		const recoveryOperation = (await this.transactions.claimRecovery({
			operationId: latest.id,
			expectedRevision: latest.revision ?? 0,
			updatedAt: Date.now()
		})).operation;
		const outputSecrets = getSecretsFromSerializedOutputData(recoveryOperation.outputData);
		const expectedSecrets = [...outputSecrets.keepSecrets, ...outputSecrets.sendSecrets];
		const storedOutputs = await this.proofQueries.getProofsBySecrets(recoveryOperation.mintUrl, expectedSecrets);
		const recoveredBySecret = new Map(storedOutputs.filter((proof) => proof.createdByOperationId === recoveryOperation.id).map((proof) => [proof.secret, proof]));
		if (!expectedSecrets.every((secret) => recoveredBySecret.has(secret))) {
			const recovered = await remote.restoreOutputs(recoveryOperation.outputData);
			for (const proof of recovered) if (!recoveredBySecret.has(proof.secret)) recoveredBySecret.set(proof.secret, proof);
		}
		if (!expectedSecrets.every((secret) => recoveredBySecret.has(secret))) {
			this.logger?.warn("Executing Send outputs could not be fully reconstructed; preserving recovery material", { operationId: recoveryOperation.id });
			return;
		}
		const keepProofs = mapProofToCoreProof(recoveryOperation.mintUrl, "ready", outputSecrets.keepSecrets.map((secret) => recoveredBySecret.get(secret)), {
			unit: recoveryOperation.unit,
			createdByOperationId: recoveryOperation.id
		});
		const sendProofs = mapProofToCoreProof(recoveryOperation.mintUrl, "inflight", outputSecrets.sendSecrets.map((secret) => recoveredBySecret.get(secret)), {
			unit: recoveryOperation.unit,
			createdByOperationId: recoveryOperation.id
		});
		const token = {
			mint: recoveryOperation.mintUrl,
			proofs: outputSecrets.sendSecrets.map((secret) => recoveredBySecret.get(secret)),
			unit: recoveryOperation.unit,
			...recoveryOperation.executionMemo ? { memo: recoveryOperation.executionMemo } : {}
		};
		const applied = await this.transactions.applyResult({
			operationId: recoveryOperation.id,
			updatedAt: Date.now(),
			keepProofs,
			sendProofs,
			token
		});
		await this.publishAppliedSwap(applied);
		this.logger?.info("Restored executing Send outputs from its persisted request", { operationId: recoveryOperation.id });
	}
	/**
	* Check a pending operation to see if it should be finalized.
	*/
	async checkPendingOperation(op) {
		const latest = await this.operationQueries.getById(op.id);
		if (!latest || latest.state !== "pending") return;
		return this.checkPersistedSend(latest);
	}
	async checkPersistedSend(op) {
		const latest = await this.operationQueries.getById(op.id);
		if (!latest || latest.state !== "pending") return;
		const sendSecrets = getSendProofSecrets(latest);
		let completion;
		try {
			if (isLegacyTokenlessP2pkSend(latest)) completion = await this.observeLegacyTokenlessP2pk(latest);
			else completion = (await this.checkProofStatesWithMint(latest.mintUrl, sendSecrets, latest.unit)).every((state) => state.state === "SPENT") ? {
				operationId: latest.id,
				updatedAt: Date.now(),
				spentProofSecrets: sendSecrets
			} : null;
		} catch (_e) {
			this.logger?.warn("Could not reach mint for recovery, will retry later", {
				operationId: latest.id,
				mintUrl: latest.mintUrl
			});
			return;
		}
		if (!completion) {
			this.logger?.debug("Pending operation token not yet claimed, leaving as pending", { operationId: latest.id });
			return;
		}
		const result = await this.transactions.completePending(completion);
		await this.publishCompletedSend(result);
		this.logger?.info("Send operation finalized during recovery", { operationId: latest.id });
	}
	/**
	* Persist a mint proof-state notification through the Send transaction boundary. The last send
	* proof observation and the pending-to-finalized transition commit together.
	*/
	async recordProofSpent(operationId, secret) {
		const operation = await this.operationQueries.getById(operationId);
		if (!operation || operation.state !== "pending") return false;
		if (!getSendProofSecrets(operation).includes(secret)) throw new ProofValidationError(`Proof ${secret} does not belong to Send operation`);
		const completion = isLegacyTokenlessP2pkSend(operation) ? await this.observeLegacyTokenlessP2pk(operation) : {
			operationId,
			updatedAt: Date.now(),
			spentProofSecrets: [secret]
		};
		if (!completion) return true;
		const result = await this.transactions.completePending(completion);
		await this.publishCompletedSend(result);
		return true;
	}
	async observeLegacyTokenlessP2pk(operation) {
		const outputData = structuredClone(operation.outputData);
		const proofInputs = getProofStateInputsFromSerializedOutputs(outputData.send);
		if (proofInputs.some((proof) => !proof.id || !proof.secret) || new Set(proofInputs.map((proof) => proof.secret)).size !== proofInputs.length) throw new ProofValidationError("Cannot check legacy P2PK Send: invalid output allocation");
		const states = await this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(operation.mintUrl), operation.unit).checkProofStates(proofInputs);
		if (states.length !== proofInputs.length) throw new ProofValidationError("Cannot check legacy P2PK Send: incomplete mint response");
		if (!states.every((state) => state.state === "SPENT")) return null;
		return {
			operationId: operation.id,
			updatedAt: Date.now(),
			spentProofSecrets: proofInputs.map((proof) => proof.secret),
			legacyP2pkOutputObservation: {
				expectedRevision: operation.revision ?? 0,
				mintUrl: operation.mintUrl,
				unit: operation.unit,
				outputData
			}
		};
	}
	/**
	* Check proof states with the mint.
	*/
	async checkProofStatesWithMint(mintUrl, secrets, unit) {
		const remote = this.remote.open(await this.mintMetadataRefresh.refreshAndCommitIfStale(mintUrl), unit);
		const proofInputs = await this.proofQueries.getProofsBySecrets(mintUrl, secrets);
		if (proofInputs.length !== secrets.length) throw new ProofValidationError("Cannot check proof states: missing proof metadata");
		const states = await remote.checkProofStates(proofInputs);
		if (states.length !== proofInputs.length) throw new ProofValidationError("Cannot check proof states: incomplete mint response");
		return states;
	}
	/**
	* Clean up orphaned proof reservations.
	* Releases proofs reserved by known terminal Sends; unidentified owners remain reserved.
	*/
	async cleanupOrphanedReservations() {
		const result = await this.transactions.cleanupOrphanedReservations();
		for (const group of result.released) await this.publishCommittedEvent("proofs:released", group);
		if (result.count > 0) this.logger?.info("Released orphaned proof reservations", { count: result.count });
		return result.count;
	}
	async publishPrepared(result) {
		if (result.counter) await this.publishCommittedEvent("counter:updated", result.counter);
		await this.publishCommittedEvent("proofs:reserved", {
			mintUrl: result.reservation.mintUrl,
			operationId: result.reservation.operationId,
			secrets: result.reservation.secrets,
			amount: {
				amount: result.reservation.amount,
				unit: result.reservation.unit
			}
		});
		await this.publishCommittedEvent("send:prepared", {
			mintUrl: result.operation.mintUrl,
			operationId: result.operation.id,
			operation: result.operation
		});
	}
	async publishSavedProofs(mintUrl, savedProofs) {
		const groups = /* @__PURE__ */ new Map();
		for (const proof of savedProofs) groups.set(proof.id, [...groups.get(proof.id) ?? [], proof]);
		for (const [keysetId, proofs] of groups) await this.publishCommittedEvent("proofs:saved", {
			mintUrl,
			keysetId,
			proofs
		});
	}
	async publishAppliedSwap(result) {
		if (!result.committed) return;
		await this.publishCommittedEvent("send:pending", {
			mintUrl: result.operation.mintUrl,
			operationId: result.operation.id,
			operation: result.operation,
			token: result.operation.token
		});
		await this.publishSavedProofs(result.operation.mintUrl, result.savedProofs);
		if (result.inflightProofSecrets.length > 0) await this.publishCommittedEvent("proofs:state-changed", {
			mintUrl: result.operation.mintUrl,
			secrets: result.inflightProofSecrets,
			state: "inflight"
		});
		await this.publishCommittedEvent("proofs:state-changed", {
			mintUrl: result.operation.mintUrl,
			secrets: result.spentInputSecrets,
			state: "spent"
		});
	}
	async publishFailedSwap(result) {
		if (!result.committed) return;
		await this.publishCommittedEvent("proofs:released", {
			mintUrl: result.operation.mintUrl,
			secrets: result.releasedInputSecrets
		});
		await this.publishCommittedEvent("send:rolled-back", {
			mintUrl: result.operation.mintUrl,
			operationId: result.operation.id,
			operation: result.operation
		});
	}
	async publishCancelledSend(result) {
		if (!result.committed) return;
		await this.publishCommittedEvent("proofs:released", {
			mintUrl: result.operation.mintUrl,
			secrets: result.releasedInputSecrets
		});
		await this.publishCommittedEvent("send:rolled-back", {
			mintUrl: result.operation.mintUrl,
			operationId: result.operation.id,
			operation: result.operation
		});
		this.logger?.info("Prepared Send operation cancelled", { operationId: result.operation.id });
	}
	async publishCompletedSend(result) {
		if (!result.committed) return;
		if (result.spentProofSecrets.length > 0) await this.publishCommittedEvent("proofs:state-changed", {
			mintUrl: result.operation.mintUrl,
			secrets: result.spentProofSecrets,
			state: "spent"
		});
		if (result.releasedInputSecrets.length > 0) await this.publishCommittedEvent("proofs:released", {
			mintUrl: result.operation.mintUrl,
			secrets: result.releasedInputSecrets
		});
		if (result.operation.state === "finalized") {
			await this.publishCommittedEvent("send:finalized", {
				mintUrl: result.operation.mintUrl,
				operationId: result.operation.id,
				operation: result.operation
			});
			this.logger?.info("Send operation finalized", { operationId: result.operation.id });
		}
	}
	activeKeys(metadata, unit) {
		const keys = createKeyChain(metadata.mint.mintUrl, unit, metadata.keysets).getCheapestKeyset().toMintKeys();
		if (!keys) throw new ProofValidationError("Active keyset is missing mint keys");
		return keys;
	}
	isDefinitiveSwapFailure(error) {
		return error instanceof MintOperationError && DEFINITIVE_SWAP_MINT_ERROR_CODES.has(error.code);
	}
	async publishCommittedEvent(event, payload) {
		try {
			await this.eventBus.emit(event, payload, { throwOnError: true });
		} catch (error) {
			this.logger?.error("Failed to publish committed Send event", {
				event,
				error
			});
		}
	}
	normalizeMemo(memo) {
		const trimmed = memo.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/**
	* Get an operation by ID.
	*/
	async getOperation(operationId) {
		return this.operationQueries.getById(operationId);
	}
	/**
	* Get all pending operations.
	*/
	async getPendingOperations() {
		return this.operationQueries.getPending();
	}
	/**
	* Get all prepared operations.
	*/
	async getPreparedOperations() {
		return (await this.operationQueries.getByState("prepared")).filter((op) => op.state === "prepared");
	}
};

//#endregion
//#region operations/melt/MeltOperation.ts
/**
* Check if operation has PreparedData (any state after init)
*/
function hasPreparedData(op) {
	return op.state !== "init";
}
/**
* Creates a new SendOperation in init state
*/
function createMeltOperation(id, mintUrl, meta, unit = DEFAULT_UNIT, options) {
	const now = Date.now();
	return {
		...meta,
		id,
		state: "init",
		mintUrl,
		unit: normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT }),
		...options?.quoteId ? { quoteId: options.quoteId } : {},
		createdAt: now,
		updatedAt: now
	};
}

//#endregion
//#region operations/melt/MeltOperationService.ts
/**
* MeltOperationService orchestrates melt sagas while delegating
* method-specific behavior to MeltMethodHandlers.
*/
var MeltOperationService = class {
	handlerProvider;
	meltOperationRepository;
	quoteLifecycle;
	proofRepository;
	proofService;
	mintService;
	walletService;
	mintAdapter;
	eventBus;
	logger;
	operationIdLock = new OperationIdLock();
	recoveryLock = null;
	mintScopedLock;
	constructor(handlerProvider, meltOperationRepository, quoteLifecycle, proofRepository, proofService, mintService, walletService, mintAdapter, eventBus, logger, mintScopedLock) {
		this.handlerProvider = handlerProvider;
		this.meltOperationRepository = meltOperationRepository;
		this.quoteLifecycle = quoteLifecycle;
		this.proofRepository = proofRepository;
		this.proofService = proofService;
		this.mintService = mintService;
		this.walletService = walletService;
		this.mintAdapter = mintAdapter;
		this.eventBus = eventBus;
		this.logger = logger;
		this.mintScopedLock = mintScopedLock ?? new MintScopedLock();
	}
	buildDeps() {
		return {
			proofRepository: this.proofRepository,
			proofService: this.proofService,
			walletService: this.walletService,
			mintService: this.mintService,
			mintAdapter: this.mintAdapter,
			eventBus: this.eventBus,
			logger: this.logger
		};
	}
	async acquireOperationLock(operationId) {
		return this.operationIdLock.acquire(operationId);
	}
	isOperationLocked(operationId) {
		return this.operationIdLock.isLocked(operationId);
	}
	isRecoveryInProgress() {
		return this.recoveryLock !== null;
	}
	async resolvePendingSettlementQuote(op, canonicalQuote) {
		if (canonicalQuote) {
			if (canonicalQuote.state === "PAID" && !Array.isArray(canonicalQuote.change)) return this.quoteLifecycle.refreshMeltQuote(op.mintUrl, op.method, op.quoteId);
			return canonicalQuote;
		}
		const persistedQuote = await this.quoteLifecycle.getMeltQuote(op.mintUrl, op.method, op.quoteId);
		if (persistedQuote?.state === "PAID" && Array.isArray(persistedQuote.change)) return persistedQuote;
		return this.quoteLifecycle.refreshMeltQuote(op.mintUrl, op.method, op.quoteId);
	}
	async init(mintUrl, method, methodData, unit = DEFAULT_UNIT, options) {
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		let normalizedMethodData;
		try {
			normalizedMethodData = normalizeMeltMethodData(methodData);
			if ("amountSats" in normalizedMethodData && normalizedMethodData.amountSats !== void 0 && normalizedMethodData.amountSats.isZero()) throw new ProofValidationError("Amount must be a positive number");
		} catch (error) {
			if (error instanceof ProofValidationError) throw error;
			throw new ProofValidationError("Amount must be a positive number");
		}
		const id = generateSubId();
		const createOperation = async (operationMintUrl, operationQuoteId) => {
			const operation = createMeltOperation(id, operationMintUrl, {
				method,
				methodData: normalizedMethodData
			}, normalizedUnit, operationQuoteId ? { quoteId: operationQuoteId } : void 0);
			await this.meltOperationRepository.create(operation);
			return operation;
		};
		const operation = options?.quoteId ? await this.createQuoteBoundInitOperation(mintUrl, method, options.quoteId, normalizedUnit, createOperation) : await createOperation(mintUrl);
		this.logger?.debug("Melt operation created", {
			operationId: id,
			mintUrl: operation.mintUrl,
			method,
			unit: normalizedUnit,
			quoteId: operation.quoteId
		});
		return operation;
	}
	async createQuoteBoundInitOperation(mintUrl, method, quoteId, expectedUnit, createOperation) {
		const releaseMintLock = await this.mintScopedLock.acquire(normalizeMintUrl(mintUrl));
		try {
			const quote = await this.quoteLifecycle.requireMeltQuoteForPrepare(mintUrl, method, quoteId, expectedUnit);
			const existing = await this.getTrackedOperationForQuote(quote.mintUrl, method, quote.quoteId);
			if (existing) throw new Error(`Melt quote ${quote.quoteId} is already tracked by operation ${existing.id} in state ${existing.state}`);
			return createOperation(quote.mintUrl, quote.quoteId);
		} finally {
			releaseMintLock();
		}
	}
	async getTrackedOperationForQuote(mintUrl, method, quoteId) {
		const matching = (await this.meltOperationRepository.getByQuoteId(mintUrl, quoteId)).filter((operation) => operation.method === method);
		if (matching.length === 0) return null;
		return matching.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
	}
	async prepareExistingQuote(quoteRef, options = {}) {
		const quote = await this.quoteLifecycle.requireMeltQuoteRefForPrepare(quoteRef);
		const methodData = this.methodDataFromMeltQuote(quote, options);
		const initOperation = await this.init(quote.mintUrl, quote.method, methodData, quote.unit, { quoteId: quote.quoteId });
		return this.prepare(initOperation.id);
	}
	methodDataFromMeltQuote(quote, options = {}) {
		switch (quote.method) {
			case "bolt11": return { invoice: quote.request };
			case "bolt12": return { offer: quote.request };
			case "onchain": {
				const { feeIndex } = resolveOnchainMeltFeeOption(quote, options.feeIndex);
				return {
					address: quote.request,
					amountSats: quote.amount,
					feeIndex
				};
			}
		}
	}
	/**
	* Prepare the operation by reserving proofs and creating outputs.
	* After this step, the operation can be executed or rolled back.
	*
	* If preparation fails, automatically attempts to recover the init operation.
	* Throws if the operation is already in progress.
	*/
	async prepare(operationId) {
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.meltOperationRepository.getById(operationId);
			if (!operation || operation.state !== "init") throw new Error(`Cannot prepare operation ${operationId}: expected state 'init' but found '${operation?.state ?? "not found"}'`);
			const initOp = operation;
			const releaseMintLock = await this.mintScopedLock.acquire(initOp.mintUrl);
			try {
				const handler = this.handlerProvider.get(initOp.method);
				await this.mintService.assertMethodUnitSupported(initOp.mintUrl, 5, initOp.method, initOp.unit);
				const { wallet } = await this.walletService.getWalletWithActiveKeysetId(initOp.mintUrl, initOp.unit);
				const quote = await this.quoteLifecycle.loadMeltQuoteSnapshotForOperation(initOp);
				const preparedOp = {
					...await handler.prepare({
						...this.buildDeps(),
						operation: initOp,
						wallet,
						quote
					}),
					state: "prepared",
					updatedAt: Date.now()
				};
				await this.meltOperationRepository.update(preparedOp);
				await this.eventBus.emit("melt-op:prepared", {
					mintUrl: preparedOp.mintUrl,
					operationId: preparedOp.id,
					operation: preparedOp
				});
				this.logger?.info("Melt operation prepared", {
					operationId: preparedOp.id,
					method: preparedOp.method
				});
				return preparedOp;
			} catch (e) {
				await this.tryRecoverInitOperation(initOp);
				throw e;
			} finally {
				releaseMintLock();
			}
		} finally {
			releaseLock();
		}
	}
	/**
	* Execute the prepared operation.
	* Performs the melt (swap if needed) and processes the result.
	*
	* If execution fails after transitioning to 'executing' state,
	* automatically attempts to recover the operation.
	* Throws if the operation is already in progress.
	*/
	async execute(operationId) {
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.meltOperationRepository.getById(operationId);
			if (!operation || operation.state !== "prepared") throw new Error(`Cannot execute operation ${operationId}: expected state 'prepared' but found '${operation?.state ?? "not found"}'`);
			const executing = {
				...operation,
				state: "executing",
				updatedAt: Date.now()
			};
			await this.meltOperationRepository.update(executing);
			try {
				const handler = this.handlerProvider.get(executing.method);
				const { wallet } = await this.walletService.getWalletWithActiveKeysetId(executing.mintUrl, executing.unit);
				const reservedProofs = (await this.proofRepository.getProofsByOperationId(executing.mintUrl, executing.id)).filter((p) => p.usedByOperationId === operationId);
				const result = await handler.execute({
					...this.buildDeps(),
					operation: executing,
					wallet,
					reservedProofs
				});
				switch (result.status) {
					case "PAID": {
						const finalizedOp = {
							...result.finalized,
							state: "finalized",
							updatedAt: Date.now()
						};
						await this.meltOperationRepository.update(finalizedOp);
						await this.eventBus.emit("melt-op:finalized", {
							mintUrl: finalizedOp.mintUrl,
							operationId: finalizedOp.id,
							operation: finalizedOp
						});
						this.logger?.info("Melt operation executing -> finalized (immediate)", {
							operationId: finalizedOp.id,
							method: finalizedOp.method
						});
						return finalizedOp;
					}
					case "PENDING": {
						const pendingOp = {
							...result.pending,
							state: "pending",
							updatedAt: Date.now()
						};
						await this.meltOperationRepository.update(pendingOp);
						await this.eventBus.emit("melt-op:pending", {
							mintUrl: pendingOp.mintUrl,
							operationId: pendingOp.id,
							operation: pendingOp
						});
						this.logger?.info("Melt operation executing -> pending", {
							operationId: pendingOp.id,
							method: pendingOp.method
						});
						return pendingOp;
					}
					case "FAILED": throw new Error(result.failed.error ?? "Melt execution failed");
				}
			} catch (e) {
				await this.tryRecoverExecutingOperation(executing);
				throw e;
			}
		} finally {
			releaseLock();
		}
	}
	async finalize(operationId, options = {}) {
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.meltOperationRepository.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (operation.state === "finalized") {
				this.logger?.debug("Operation already finalized", { operationId });
				const finalizedOp = operation;
				return {
					changeAmount: finalizedOp.changeAmount,
					effectiveFee: finalizedOp.effectiveFee,
					finalizedData: finalizedOp.finalizedData
				};
			}
			if (operation.state === "rolled_back" || operation.state === "rolling_back") {
				this.logger?.debug("Operation was rolled back or is rolling back, skipping finalization", { operationId });
				return {
					changeAmount: void 0,
					effectiveFee: void 0,
					finalizedData: void 0
				};
			}
			if (operation.state !== "pending") throw new Error(`Cannot finalize operation in state ${operation.state}`);
			const pendingOp = operation;
			const handler = this.handlerProvider.get(pendingOp.method);
			const canonicalQuote = await this.resolvePendingSettlementQuote(pendingOp, options.canonicalQuote);
			const finalizeResult = await handler.finalize?.({
				...this.buildDeps(),
				operation: pendingOp,
				canonicalQuote
			});
			const finalized = {
				...pendingOp,
				state: "finalized",
				updatedAt: Date.now(),
				changeAmount: finalizeResult?.changeAmount,
				effectiveFee: finalizeResult?.effectiveFee,
				finalizedData: finalizeResult?.finalizedData
			};
			await this.meltOperationRepository.update(finalized);
			await this.eventBus.emit("melt-op:finalized", {
				mintUrl: pendingOp.mintUrl,
				operationId,
				operation: finalized
			});
			this.logger?.info("Melt operation finalized", {
				operationId,
				changeAmount: finalized.changeAmount,
				effectiveFee: finalized.effectiveFee
			});
			return {
				changeAmount: finalized.changeAmount,
				effectiveFee: finalized.effectiveFee,
				finalizedData: finalized.finalizedData
			};
		} finally {
			releaseLock();
		}
	}
	async rollback(operationId, reason = "Rolled back", options = {}) {
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.meltOperationRepository.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (operation.state === "finalized" || operation.state === "rolled_back" || operation.state === "rolling_back" || operation.state === "init" || operation.state === "executing") throw new Error(`Cannot rollback operation in state ${operation.state}`);
			if (!hasPreparedData(operation)) throw new Error(`Operation ${operationId} is not in a rollbackable state`);
			const handler = this.handlerProvider.get(operation.method);
			const { wallet } = await this.walletService.getWalletWithActiveKeysetId(operation.mintUrl, operation.unit);
			if (operation.state === "pending") {
				const pendingOp = operation;
				const canonicalQuote = await this.resolvePendingSettlementQuote(pendingOp);
				const decision = await handler.checkPending?.({
					...this.buildDeps(),
					operation: pendingOp,
					wallet,
					canonicalQuote
				});
				if (decision !== "rollback") throw new Error(`Cannot rollback pending operation: quote state is not UNPAID (decision: ${decision})`);
			}
			let opForRollback = operation;
			const rolling = {
				...operation,
				state: "rolling_back",
				updatedAt: Date.now()
			};
			await this.meltOperationRepository.update(rolling);
			opForRollback = rolling;
			await handler.rollback?.({
				...this.buildDeps(),
				operation: opForRollback,
				wallet
			});
			await this.markAsRolledBack(opForRollback, reason);
		} finally {
			releaseLock();
		}
	}
	/**
	* Recover pending operations on startup.
	* This should be called during initialization.
	* Throws if recovery is already in progress.
	*/
	async recoverPendingOperations() {
		if (this.recoveryLock) throw new Error("Recovery is already in progress");
		let releaseRecoveryLock;
		this.recoveryLock = new Promise((resolve) => {
			releaseRecoveryLock = resolve;
		});
		try {
			let initCount = 0;
			let executingCount = 0;
			let pendingCount = 0;
			let rollingBackCount = 0;
			let orphanCount = 0;
			const initOps = await this.meltOperationRepository.getByState("init");
			for (const op of initOps) {
				await this.recoverInitOperation(op);
				initCount++;
			}
			const preparedOps = await this.meltOperationRepository.getByState("prepared");
			for (const op of preparedOps) this.logger?.warn("Found stale prepared operation, user can rollback manually", { operationId: op.id });
			const executingOps = await this.meltOperationRepository.getByState("executing");
			for (const op of executingOps) try {
				await this.recoverExecutingOperation(op);
				executingCount++;
			} catch (e) {
				this.logger?.error("Error recovering executing operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const pendingOps = await this.meltOperationRepository.getByState("pending");
			for (const op of pendingOps) try {
				await this.checkPendingOperation(op.id);
				pendingCount++;
			} catch (e) {
				this.logger?.error("Error checking pending melt operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const rollingBackOps = await this.meltOperationRepository.getByState("rolling_back");
			for (const op of rollingBackOps) {
				this.logger?.warn("Found operation stuck in rolling_back state. This indicates a crash during rollback. Manual recovery may be needed.", {
					operationId: op.id,
					mintUrl: op.mintUrl,
					method: op.method
				});
				rollingBackCount++;
			}
			this.logger?.info("Recovery completed", {
				initOperations: initCount,
				executingOperations: executingCount,
				pendingOperations: pendingCount,
				rollingBackOperations: rollingBackCount,
				orphanedReservations: orphanCount
			});
		} finally {
			this.recoveryLock = null;
			releaseRecoveryLock();
		}
	}
	async checkPendingOperation(operationId) {
		const op = await this.getOperation(operationId);
		if (!op || op.state !== "pending") throw new Error(`Cannot check operation ${operationId}: expected state 'pending' but found '${op?.state ?? "not found"}'`);
		const persistedQuote = await this.quoteLifecycle.getMeltQuote(op.mintUrl, op.method, op.quoteId);
		if (persistedQuote?.state === "PAID") {
			await this.finalize(op.id, { canonicalQuote: persistedQuote });
			return "finalize";
		}
		const handler = this.handlerProvider.get(op.method);
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(op.mintUrl, op.unit);
		const quote = await this.quoteLifecycle.refreshMeltQuoteById({
			mintUrl: op.mintUrl,
			quoteId: op.quoteId
		});
		const decision = await handler.checkPending?.({
			...this.buildDeps(),
			operation: op,
			wallet,
			canonicalQuote: quote
		}) ?? "stay_pending";
		if (decision === "finalize") {
			await this.finalize(op.id, { canonicalQuote: quote });
			return "finalize";
		} else if (decision === "rollback") {
			await this.rollback(op.id, "Rollback requested by handler");
			return "rollback";
		} else {
			this.logger?.debug("Pending melt remains pending", { operationId: op.id });
			return "stay_pending";
		}
	}
	async markAsRolledBack(op, error) {
		const rolledBack = {
			...op,
			state: "rolled_back",
			updatedAt: Date.now(),
			error
		};
		await this.meltOperationRepository.update(rolledBack);
		await this.eventBus.emit("melt-op:rolled-back", {
			mintUrl: op.mintUrl,
			operationId: op.id,
			operation: rolledBack
		});
		this.logger?.info("Melt operation rolled back", {
			operationId: op.id,
			error
		});
		return rolledBack;
	}
	/**
	* Clean up a failed init operation.
	* Releases any orphaned proof reservations and deletes the operation.
	*/
	async recoverInitOperation(op) {
		const orphanedForOp = (await this.proofRepository.getReservedProofs()).filter((p) => p.usedByOperationId === op.id);
		if (orphanedForOp.length > 0) await this.proofService.releaseProofs(op.mintUrl, orphanedForOp.map((p) => p.secret));
		await this.meltOperationRepository.delete(op.id);
		this.logger?.info("Cleaned up failed init operation", { operationId: op.id });
	}
	/**
	* Attempts to recover an init operation, swallowing recovery errors.
	* If recovery fails, logs warning and leaves for startup recovery.
	*/
	async tryRecoverInitOperation(op) {
		try {
			await this.recoverInitOperation(op);
			this.logger?.info("Recovered init operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover init operation, will retry on next startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	/**
	* Recover an executing operation.
	* Delegates to handler for proof cleanup and state determination.
	* Updates operation state based on handler result (finalized, pending, or failed).
	*/
	async recoverExecutingOperation(op, options) {
		const releaseLock = options?.skipLock ? void 0 : await this.acquireOperationLock(op.id);
		try {
			const current = await this.meltOperationRepository.getById(op.id);
			if (!current) {
				this.logger?.warn("Melt operation missing during recovery", { operationId: op.id });
				return;
			}
			if (current.state === "finalized" || current.state === "failed" || current.state === "rolled_back") return;
			if (current.state !== "executing") {
				this.logger?.debug("Melt operation not executing during recovery", {
					operationId: current.id,
					state: current.state
				});
				return;
			}
			const executing = current;
			const handler = this.handlerProvider.get(executing.method);
			const { wallet } = await this.walletService.getWalletWithActiveKeysetId(executing.mintUrl, executing.unit);
			const result = await handler.recoverExecuting({
				...this.buildDeps(),
				operation: executing,
				wallet
			});
			switch (result.status) {
				case "PAID": {
					const finalizedOp = {
						...result.finalized,
						state: "finalized",
						updatedAt: Date.now()
					};
					await this.meltOperationRepository.update(finalizedOp);
					await this.eventBus.emit("melt-op:finalized", {
						mintUrl: finalizedOp.mintUrl,
						operationId: finalizedOp.id,
						operation: finalizedOp
					});
					this.logger?.info("Recovered executing operation as finalized", { operationId: executing.id });
					break;
				}
				case "PENDING": {
					const pendingOp = {
						...result.pending,
						state: "pending",
						updatedAt: Date.now()
					};
					await this.meltOperationRepository.update(pendingOp);
					await this.eventBus.emit("melt-op:pending", {
						mintUrl: pendingOp.mintUrl,
						operationId: pendingOp.id,
						operation: pendingOp
					});
					this.logger?.info("Recovered executing operation as pending", { operationId: executing.id });
					break;
				}
				case "FAILED":
					await this.markAsRolledBack(executing, result.failed.error ?? "Recovered: operation failed");
					break;
			}
		} finally {
			if (releaseLock) releaseLock();
		}
	}
	/**
	* Attempts to recover an executing operation, swallowing recovery errors.
	* If recovery fails (e.g., mint unreachable), logs warning and leaves
	* for startup recovery.
	*/
	async tryRecoverExecutingOperation(op) {
		try {
			await this.recoverExecutingOperation(op, { skipLock: true });
			this.logger?.info("Recovered executing operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover executing operation, will retry on next startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	async getOperation(operationId) {
		return this.meltOperationRepository.getById(operationId);
	}
	async getOperationByQuote(mintUrl, method, quoteId) {
		const matching = (await this.meltOperationRepository.getByQuoteId(mintUrl, quoteId)).filter((operation) => operation.method === method && hasPreparedData(operation));
		if (matching.length === 0) return null;
		if (matching.length > 1) throw new Error(`Found ${matching.length} melt operations for mint ${mintUrl}, method ${method}, and quote ${quoteId}`);
		return matching[0];
	}
	async getOperationByQuoteIdentity(identity) {
		const quote = await this.quoteLifecycle.getMeltQuoteById(identity);
		if (!quote) return null;
		const operations = await this.meltOperationRepository.getByQuoteId(normalizeMintUrl(quote.mintUrl), quote.quoteId);
		if (operations.length === 0) return null;
		if (operations.length > 1) throw new Error(`Found ${operations.length} melt operations for mint ${quote.mintUrl} and quote ${quote.quoteId}`);
		return operations[0];
	}
	async listOperationsByQuote(mintUrl, quoteId) {
		return (await this.meltOperationRepository.getByQuoteId(normalizeMintUrl(mintUrl), quoteId)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}
	async getPendingOperations() {
		return this.meltOperationRepository.getPending();
	}
	async getPreparedOperations() {
		return (await this.meltOperationRepository.getByState("prepared")).filter((op) => op.state === "prepared");
	}
};

//#endregion
//#region operations/mint/MintOperation.ts
function hasPendingData(op) {
	return op.state !== "init";
}
function isTerminalOperation(op) {
	return op.state === "finalized" || op.state === "failed";
}
function getOutputProofSecrets$1(op) {
	const { keepSecrets, sendSecrets } = getSecretsFromSerializedOutputData(op.outputData);
	return [...keepSecrets, ...sendSecrets];
}
function createMintOperation(id, mintUrl, meta, intent, options) {
	const now = Date.now();
	return {
		...meta,
		...intent,
		amount: intent.amount,
		unit: normalizeUnit(intent.unit),
		quoteId: options.quoteId,
		id,
		state: "init",
		mintUrl,
		createdAt: now,
		updatedAt: now
	};
}

//#endregion
//#region operations/mint/MintOperationService.ts
/**
* MintOperationService orchestrates mint quote redemption as a crash-safe saga.
*/
var MintOperationService = class {
	handlerProvider;
	mintOperationRepository;
	quoteLifecycle;
	proofRepository;
	proofService;
	mintService;
	walletService;
	mintAdapter;
	eventBus;
	logger;
	operationIdLock = new OperationIdLock();
	recoveryLock = null;
	mintScopedLock;
	constructor(handlerProvider, mintOperationRepository, quoteLifecycle, proofRepository, proofService, mintService, walletService, mintAdapter, eventBus, logger, mintScopedLock) {
		this.handlerProvider = handlerProvider;
		this.mintOperationRepository = mintOperationRepository;
		this.quoteLifecycle = quoteLifecycle;
		this.proofRepository = proofRepository;
		this.proofService = proofService;
		this.mintService = mintService;
		this.walletService = walletService;
		this.mintAdapter = mintAdapter;
		this.eventBus = eventBus;
		this.logger = logger;
		this.mintScopedLock = mintScopedLock ?? new MintScopedLock();
	}
	buildDeps() {
		return {
			proofRepository: this.proofRepository,
			proofService: this.proofService,
			walletService: this.walletService,
			mintService: this.mintService,
			mintAdapter: this.mintAdapter,
			eventBus: this.eventBus,
			logger: this.logger
		};
	}
	async acquireOperationLock(operationId) {
		return this.operationIdLock.acquire(operationId);
	}
	async acquireOperationLockAfterWait(operationId) {
		try {
			return await this.acquireOperationLock(operationId);
		} catch (error) {
			if (!(error instanceof OperationInProgressError)) throw error;
			await this.operationIdLock.waitForUnlock(operationId);
			return this.acquireOperationLock(operationId);
		}
	}
	isOperationLocked(operationId) {
		return this.operationIdLock.isLocked(operationId);
	}
	isRecoveryInProgress() {
		return this.recoveryLock !== null;
	}
	async createInitOperation(mintUrl, intent, method, methodData, options) {
		const parsed = normalizeUnitAmount(intent);
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		if (parsed.amount.isZero()) throw new ProofValidationError("Amount must be a positive number");
		const operationId = generateSubId();
		const releaseMintLock = await this.mintScopedLock.acquire(normalizeMintUrl(mintUrl));
		try {
			const quote = await this.resolveMintQuoteForOperationCreation(mintUrl, method, options.quoteId, parsed);
			const operation = createMintOperation(operationId, quote.mintUrl, {
				method,
				methodData
			}, parsed, { quoteId: quote.quoteId });
			await this.mintOperationRepository.create(operation);
			this.logger?.debug("Mint operation created", {
				operationId,
				mintUrl: operation.mintUrl,
				quoteId: operation.quoteId,
				method,
				amount: parsed.amount,
				unit: parsed.unit
			});
			return operation;
		} finally {
			releaseMintLock();
		}
	}
	async resolveMintQuoteForOperationCreation(mintUrl, method, quoteId, intent) {
		const quote = await this.quoteLifecycle.getMintQuote(mintUrl, method, quoteId);
		if (!quote) throw new Error(`Mint quote ${quoteId} for ${method} at ${mintUrl} was not found`);
		const fixedAmount = getMintQuoteAmount(quote);
		if (fixedAmount && !fixedAmount.equals(intent.amount)) throw new Error(`Mint quote ${quote.quoteId} amount ${fixedAmount} does not match requested amount ${intent.amount}`);
		if (quote.unit !== intent.unit) throw new Error(`Mint quote ${quote.quoteId} unit ${quote.unit} does not match requested unit ${intent.unit}`);
		if (fixedAmount) {
			const existing = await this.getOperationByQuote(quote.mintUrl, method, quote.quoteId);
			if (existing) throw new Error(`Mint quote ${quote.quoteId} is already tracked by operation ${existing.id} in state ${existing.state}`);
		}
		return quote;
	}
	async prepare(quoteRef, requestedAmount) {
		const quote = await this.quoteLifecycle.requireMintQuoteRefForPrepare(quoteRef);
		const amount = Amount$1.from(requestedAmount);
		const fixedAmount = getMintQuoteAmount(quote);
		if (fixedAmount && !fixedAmount.equals(amount)) throw new Error(`Mint quote ${quote.quoteId} amount ${fixedAmount} does not match requested amount ${amount}`);
		await this.handlerProvider.get(quote.method).validateQuoteForPrepare?.(quote);
		const initOperation = await this.createInitOperation(quote.mintUrl, {
			amount,
			unit: quote.unit
		}, quote.method, {}, { quoteId: quote.quoteId });
		return this.prepareInitOperation(initOperation.id);
	}
	async prepareInitOperation(operationId, options) {
		const releaseLock = await this.acquireOperationLock(operationId);
		let releaseMintLock = null;
		let initOp = null;
		let failure;
		try {
			const operation = await this.mintOperationRepository.getById(operationId);
			if (!operation || operation.state !== "init") throw new Error(`Cannot prepare operation ${operationId}: expected state 'init' but found '${operation?.state ?? "not found"}'`);
			initOp = operation;
			if (!options?.skipMintLock) releaseMintLock = await this.mintScopedLock.acquire(initOp.mintUrl);
			try {
				const importedQuote = await this.quoteLifecycle.loadMintQuoteSnapshotForOperation(initOp);
				const handler = this.handlerProvider.get(initOp.method);
				await this.mintService.assertMethodUnitSupported(initOp.mintUrl, 4, initOp.method, initOp.method === "onchain" ? initOp.unit : {
					amount: initOp.amount,
					unit: initOp.unit
				});
				const { wallet } = await this.walletService.getWalletWithActiveKeysetId(initOp.mintUrl, initOp.unit);
				const pendingOp = {
					...await handler.prepare({
						...this.buildDeps(),
						operation: initOp,
						wallet,
						importedQuote
					}),
					state: "pending",
					updatedAt: Date.now()
				};
				await this.mintOperationRepository.update(pendingOp);
				await this.eventBus.emit("mint-op:pending", {
					mintUrl: pendingOp.mintUrl,
					operationId: pendingOp.id,
					operation: pendingOp
				});
				this.logger?.info("Mint operation is pending", {
					operationId: pendingOp.id,
					mintUrl: pendingOp.mintUrl,
					quoteId: pendingOp.quoteId,
					method: pendingOp.method
				});
				return pendingOp;
			} catch (e) {
				failure = e;
			} finally {
				releaseMintLock?.();
			}
		} finally {
			releaseLock();
		}
		if (failure) {
			if (initOp) await this.tryRecoverInitOperation(initOp);
			throw failure;
		}
		throw new Error(`Failed to prepare operation ${operationId}`);
	}
	async execute(operationId) {
		while (true) {
			const operation = await this.mintOperationRepository.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (isTerminalOperation(operation)) return operation;
			if (operation.state === "executing") {
				if (this.isOperationLocked(operationId)) {
					await this.operationIdLock.waitForUnlock(operationId);
					continue;
				}
				try {
					await this.recoverExecutingOperation(operation);
				} catch (error) {
					if (!(error instanceof OperationInProgressError)) throw error;
					await this.operationIdLock.waitForUnlock(operationId);
				}
				if ((await this.mintOperationRepository.getById(operationId))?.state === "executing") throw new Error(`Operation ${operationId} remains executing after recovery`);
				continue;
			}
			if (operation.state !== "pending") throw new Error(`Cannot execute operation ${operationId}: expected state 'pending' but found '${operation.state}'`);
			const quote = await this.quoteLifecycle.getMintQuote(operation.mintUrl, operation.method, operation.quoteId);
			if (quote) return this.claimPendingQuoteOperation(operation, quote);
			return this.executeReadyOperation(operationId);
		}
	}
	async executeReadyOperation(operationId) {
		const releaseLock = await this.acquireOperationLockAfterWait(operationId);
		try {
			const operation = await this.mintOperationRepository.getById(operationId);
			if (operation && isTerminalOperation(operation)) return operation;
			if (!operation || operation.state !== "pending") throw new Error(`Cannot execute operation ${operationId}: expected state 'pending' but found '${operation?.state ?? "not found"}'`);
			if (!await this.mintService.isTrustedMint(operation.mintUrl)) throw new UnknownMintError(`Mint ${operation.mintUrl} is not trusted`);
			const executing = {
				...operation,
				state: "executing",
				updatedAt: Date.now(),
				error: void 0
			};
			await this.mintOperationRepository.update(executing);
			await this.eventBus.emit("mint-op:executing", {
				mintUrl: executing.mintUrl,
				operationId: executing.id,
				operation: executing
			});
			try {
				const handler = this.handlerProvider.get(executing.method);
				const { wallet } = await this.walletService.getWalletWithActiveKeysetId(executing.mintUrl, executing.unit);
				const result = await handler.execute({
					...this.buildDeps(),
					operation: executing,
					wallet
				});
				switch (result.status) {
					case "ISSUED":
						if (!await this.ensureOutputsSaved(executing, result.proofs)) throw new Error(`Failed to persist output proofs for operation ${executing.id}`);
						return await this.finalizeIssuedOperation(executing);
					case "ALREADY_ISSUED": {
						const error = await this.ensureOutputsSaved(executing) ? void 0 : `Recovered issued quote ${executing.quoteId} but no proofs could be restored`;
						if (error) this.logger?.warn("Mint quote was already issued but proofs could not be recovered", {
							operationId: executing.id,
							mintUrl: executing.mintUrl,
							quoteId: executing.quoteId
						});
						return await this.finalizeIssuedOperation(executing, error);
					}
					case "FAILED": throw new Error(result.error ?? "Mint execution failed");
				}
			} catch (e) {
				await this.tryRecoverExecutingOperation(executing);
				const current = await this.mintOperationRepository.getById(operationId);
				if (current && isTerminalOperation(current)) return current;
				throw e;
			}
		} finally {
			releaseLock();
		}
	}
	async finalize(operationId) {
		const operation = await this.mintOperationRepository.getById(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		if (isTerminalOperation(operation)) {
			this.logger?.debug("Operation already finalized", { operationId });
			return operation;
		}
		if (operation.state === "pending") return this.execute(operation.id);
		if (operation.state === "executing") {
			await this.recoverExecutingOperation(operation);
			const updated = await this.mintOperationRepository.getById(operationId);
			if (updated && isTerminalOperation(updated)) return updated;
			if (updated?.state === "pending") throw new Error(`Operation ${operationId} remains pending after recovery`);
			throw new Error(`Unable to finalize operation ${operationId} in state '${updated?.state ?? "missing"}'`);
		}
		throw new Error(`Cannot finalize operation ${operationId} in state '${operation.state}'. Expected 'pending' or 'executing'.`);
	}
	async recoverPendingOperations() {
		if (this.recoveryLock) throw new Error("Recovery is already in progress");
		let releaseRecoveryLock;
		this.recoveryLock = new Promise((resolve) => {
			releaseRecoveryLock = resolve;
		});
		try {
			let initCount = 0;
			let pendingCount = 0;
			let executingCount = 0;
			const initOps = await this.mintOperationRepository.getByState("init");
			for (const op of initOps) try {
				await this.recoverInitOperation(op);
				initCount++;
			} catch (e) {
				if (e instanceof OperationInProgressError) {
					this.logger?.debug("Mint init operation in progress, skipping recovery", { operationId: op.id });
					continue;
				}
				this.logger?.warn("Failed to recover mint init operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const pendingOps = await this.mintOperationRepository.getByState("pending");
			for (const op of pendingOps) try {
				if (await this.mintService.isTrustedMint(op.mintUrl)) {
					await this.checkPendingOperation(op.id);
					pendingCount++;
				} else this.logger?.warn("Skipping recovery of pending operation for untrusted mint", {
					operationId: op.id,
					mintUrl: op.mintUrl
				});
			} catch (e) {
				this.logger?.warn("Failed to reconcile stale pending mint operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			const executingOps = await this.mintOperationRepository.getByState("executing");
			for (const op of executingOps) try {
				await this.recoverExecutingOperation(op);
				executingCount++;
			} catch (e) {
				if (e instanceof OperationInProgressError) {
					this.logger?.debug("Mint executing operation in progress, skipping recovery", { operationId: op.id });
					continue;
				}
				this.logger?.error("Error recovering executing mint operation", {
					operationId: op.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			this.logger?.info("Mint operation recovery completed", {
				initOperations: initCount,
				pendingOperations: pendingCount,
				executingOperations: executingCount
			});
		} finally {
			this.recoveryLock = null;
			releaseRecoveryLock();
		}
	}
	async recoverExecutingOperation(op, options) {
		const releaseLock = options?.skipLock ? void 0 : await this.acquireOperationLock(op.id);
		try {
			const current = await this.mintOperationRepository.getById(op.id);
			if (!current) {
				this.logger?.warn("Mint operation missing during recovery", { operationId: op.id });
				return;
			}
			if (isTerminalOperation(current)) return;
			if (current.state !== "executing") {
				this.logger?.debug("Mint operation not executing during recovery", {
					operationId: current.id,
					state: current.state
				});
				return;
			}
			const executing = current;
			if (await this.hasSavedOutputs(executing)) {
				await this.finalizeIssuedOperation(executing);
				return;
			}
			if (!await this.mintService.isTrustedMint(executing.mintUrl)) {
				this.logger?.warn("Mint is not trusted, skipping recovery of executing mint operation", {
					operationId: executing.id,
					mintUrl: executing.mintUrl,
					quoteId: executing.quoteId
				});
				return;
			}
			const handler = this.handlerProvider.get(executing.method);
			const { wallet } = await this.walletService.getWalletWithActiveKeysetId(executing.mintUrl, executing.unit);
			const siblings = await this.mintOperationRepository.getByQuoteId(executing.mintUrl, executing.method, executing.quoteId);
			const result = await handler.recoverExecuting({
				...this.buildDeps(),
				operation: executing,
				wallet,
				localClaimabilityFacts: this.getLocalClaimabilityFacts(siblings, executing.id)
			});
			switch (result.status) {
				case "FINALIZED":
					if (await this.ensureOutputsSaved(executing)) await this.finalizeIssuedOperation(executing);
					else await this.transitionToPending(executing, `Recovered issued quote ${executing.quoteId} but no proofs could be restored`);
					break;
				case "PENDING":
					await this.transitionToPending(executing, result.error);
					this.logger?.warn("Mint operation returned to pending after recovery", {
						operationId: executing.id,
						mintUrl: executing.mintUrl,
						quoteId: executing.quoteId,
						error: result.error
					});
					break;
				case "TERMINAL":
					await this.failOperation(executing, result.error);
					this.logger?.warn("Mint operation moved to failed during recovery", {
						operationId: executing.id,
						mintUrl: executing.mintUrl,
						quoteId: executing.quoteId,
						error: result.error
					});
					break;
			}
		} finally {
			if (releaseLock) releaseLock();
		}
	}
	async getOperation(operationId) {
		return this.mintOperationRepository.getById(operationId);
	}
	async getOperationByQuote(mintUrl, method, quoteId) {
		const operations = await this.getOperationsForQuote(mintUrl, method, quoteId);
		if (operations.length === 0) return null;
		const sorted = operations.sort((a, b) => {
			if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
			if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
			return b.id.localeCompare(a.id);
		});
		const finalized = sorted.find((op) => op.state === "finalized");
		if (finalized) return finalized;
		const terminal = sorted.find((op) => isTerminalOperation(op));
		if (terminal) return terminal;
		return sorted[0] ?? null;
	}
	async getOperationsForQuote(mintUrl, method, quoteId) {
		return this.mintOperationRepository.getByQuoteId(mintUrl, method, quoteId);
	}
	async listOperationsByQuote(mintUrl, quoteId) {
		return (await this.mintOperationRepository.getByMintUrl(normalizeMintUrl(mintUrl))).filter((operation) => operation.quoteId === quoteId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}
	async claimMintQuote(mintUrl, method, quoteId, options = {}) {
		const releaseQuoteLock = await this.mintScopedLock.acquire(this.quoteLockKey(mintUrl, method, quoteId));
		try {
			const quote = await this.quoteLifecycle.getMintQuote(mintUrl, method, quoteId);
			if (!quote) throw new Error(`Cannot claim mint quote ${quoteId}: quote for ${method} at ${mintUrl} was not found`);
			const siblings = await this.mintOperationRepository.getByQuoteId(mintUrl, method, quoteId);
			const assessment = this.assessQuoteClaimability(quote, siblings);
			const claimable = assessment.claimAmount ?? Amount$1.zero();
			if (assessment.status === "complete") {
				const completed = [];
				for (const operation of siblings) if (operation.state === "pending") completed.push(await this.executeReadyOperation(operation.id));
				return completed;
			}
			if (assessment.status !== "claimable" || claimable.isZero()) return [];
			let selectedAmount = Amount$1.zero();
			const selected = [];
			const autoClaimRemaining = options.autoClaimRemaining ?? true;
			for (const operation of siblings) {
				if (operation.state !== "pending") continue;
				const nextAmount = selectedAmount.add(operation.amount);
				if (nextAmount.greaterThan(claimable)) break;
				selected.push(operation);
				selectedAmount = nextAmount;
			}
			const claimed = [];
			for (const operation of selected) claimed.push(await this.executeReadyOperation(operation.id));
			const remaining = claimable.subtract(selectedAmount);
			if (autoClaimRemaining && !remaining.isZero()) {
				const refreshedQuote = await this.quoteLifecycle.getMintQuote(mintUrl, method, quoteId) ?? quote;
				const refreshedSiblings = await this.mintOperationRepository.getByQuoteId(mintUrl, method, quoteId);
				const currentAssessment = this.assessQuoteClaimability(refreshedQuote, refreshedSiblings);
				if (currentAssessment.status === "claimable" && currentAssessment.claimAmount) {
					const autoClaimAmount = remaining.lessThan(currentAssessment.claimAmount) ? remaining : currentAssessment.claimAmount;
					if (!autoClaimAmount.isZero()) {
						const autoClaim = await this.createAutoClaimOperation(refreshedQuote, autoClaimAmount);
						claimed.push(await this.executeReadyOperation(autoClaim.id));
					}
				}
			}
			return claimed;
		} finally {
			releaseQuoteLock();
		}
	}
	async claimPendingMintQuotes(options = {}) {
		const quotes = await this.quoteLifecycle.getPendingMintQuotes();
		const claimed = [];
		for (const quote of quotes) {
			if (!await this.mintService.isTrustedMint(quote.mintUrl)) {
				this.logger?.debug("Skipping pending mint quote for untrusted mint", {
					mintUrl: quote.mintUrl,
					method: quote.method
				});
				continue;
			}
			claimed.push(...await this.claimMintQuote(quote.mintUrl, quote.method, quote.quoteId, options));
		}
		return claimed;
	}
	/** @internal Used by background schedulers to assess a canonical quote with local operation facts. */
	async getMintQuoteClaimability(mintUrl, method, quoteId, options = {}) {
		const quote = await this.quoteLifecycle.getMintQuote(mintUrl, method, quoteId);
		if (!quote) return;
		const siblings = await this.mintOperationRepository.getByQuoteId(mintUrl, method, quoteId);
		return this.assessQuoteClaimability(quote, siblings, options);
	}
	async claimPendingQuoteOperation(operation, initialQuote) {
		const releaseQuoteLock = await this.mintScopedLock.acquire(this.quoteLockKey(operation.mintUrl, operation.method, operation.quoteId));
		try {
			const current = await this.mintOperationRepository.getById(operation.id);
			if (!current || current.state !== "pending") {
				if (current) return current;
				throw new Error(`Operation ${operation.id} not found`);
			}
			const pending = current;
			const quote = await this.quoteLifecycle.getMintQuote(pending.mintUrl, pending.method, pending.quoteId) ?? initialQuote;
			const siblings = await this.mintOperationRepository.getByQuoteId(pending.mintUrl, pending.method, pending.quoteId);
			const assessment = this.assessQuoteClaimability(quote, siblings, {
				requestedAmount: pending.amount,
				targetOperationId: pending.id
			});
			if (assessment.status === "invalid") throw new Error(`Mint quote ${pending.quoteId} has invalid claimability accounting`);
			if (assessment.status === "waiting") {
				this.logger?.info("Mint quote is not sufficiently funded for operation", {
					operationId: pending.id,
					mintUrl: pending.mintUrl,
					quoteId: pending.quoteId,
					requestedAmount: pending.amount.toString(),
					claimableAmount: assessment.claimAmount?.toString() ?? "0"
				});
				return pending;
			}
			return this.executeReadyOperation(pending.id);
		} finally {
			releaseQuoteLock();
		}
	}
	async createAutoClaimOperation(quote, amount) {
		const initOperation = await this.createInitOperation(quote.mintUrl, {
			amount,
			unit: quote.unit
		}, quote.method, {}, { quoteId: quote.quoteId });
		return this.prepareInitOperation(initOperation.id);
	}
	assessQuoteClaimability(quote, siblings, options = {}) {
		return assessMintQuoteClaimability(quote, {
			...this.getLocalClaimabilityFacts(siblings, options.targetOperationId),
			requestedAmount: options.requestedAmount
		});
	}
	getLocalClaimabilityFacts(siblings, targetOperationId) {
		return {
			finalizedAmount: siblings.reduce((total, operation) => operation.state === "finalized" ? total.add(operation.amount) : total, Amount$1.zero()),
			reservedAmount: siblings.reduce((total, operation) => {
				if (operation.state !== "executing" || operation.id === targetOperationId) return total;
				return total.add(operation.amount);
			}, Amount$1.zero())
		};
	}
	quoteLockKey(mintUrl, method, quoteId) {
		return `${mintUrl}::${method}::${quoteId}`;
	}
	async getInFlightOperations() {
		return this.mintOperationRepository.getPending();
	}
	async recoverInitOperation(op) {
		const releaseLock = await this.acquireOperationLock(op.id);
		try {
			const current = await this.mintOperationRepository.getById(op.id);
			if (!current || current.state !== "init") return;
			await this.mintOperationRepository.delete(op.id);
			this.logger?.info("Cleaned up failed mint init operation", { operationId: op.id });
		} finally {
			releaseLock();
		}
	}
	async getPendingOperations() {
		return (await this.mintOperationRepository.getByState("pending")).filter((op) => op.state === "pending");
	}
	async tryRecoverInitOperation(op) {
		try {
			await this.recoverInitOperation(op);
			this.logger?.info("Recovered mint init operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover mint init operation, will retry on startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	async tryRecoverExecutingOperation(op) {
		try {
			await this.recoverExecutingOperation(op, { skipLock: true });
			this.logger?.info("Recovered executing mint operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover executing mint operation, will retry on startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	async ensureOutputsSaved(op, proofsFromExecute) {
		if (await this.hasSavedOutputs(op)) return true;
		if (proofsFromExecute && proofsFromExecute.length > 0) await this.proofService.saveProofs(op.mintUrl, mapProofToCoreProof(op.mintUrl, "ready", proofsFromExecute, {
			unit: op.unit,
			createdByOperationId: op.id
		}));
		if (await this.hasSavedOutputs(op)) return true;
		await this.proofService.recoverProofsFromOutputData(op.mintUrl, op.outputData, {
			unit: op.unit,
			createdByOperationId: op.id
		});
		return this.hasSavedOutputs(op);
	}
	async finalizeIssuedOperation(op, error) {
		const current = await this.mintOperationRepository.getById(op.id);
		if (!current) throw new Error(`Operation ${op.id} not found`);
		if (current.state === "finalized") return current;
		if (current.state !== "executing") throw new Error(`Cannot finalize operation ${op.id} in state ${current.state}`);
		if (current.method === "bolt11") await this.quoteLifecycle.recordMintQuoteObservation(current, "ISSUED", Date.now());
		const finalized = {
			...current,
			state: "finalized",
			updatedAt: Date.now(),
			error
		};
		await this.mintOperationRepository.update(finalized);
		await this.eventBus.emit("mint-op:finalized", {
			mintUrl: finalized.mintUrl,
			operationId: finalized.id,
			operation: finalized
		});
		this.logger?.info("Mint operation finalized", {
			operationId: finalized.id,
			mintUrl: finalized.mintUrl,
			quoteId: finalized.quoteId
		});
		return finalized;
	}
	async failOperation(op, error) {
		const current = await this.mintOperationRepository.getById(op.id);
		if (!current) throw new Error(`Operation ${op.id} not found`);
		if (current.state === "failed") return current;
		if (current.state === "finalized") throw new Error(`Cannot fail operation ${op.id} in state ${current.state}`);
		if (current.state !== "executing") throw new Error(`Cannot fail operation ${op.id} in state ${current.state}`);
		const failed = {
			...current,
			state: "failed",
			updatedAt: Date.now(),
			error,
			terminalFailure: {
				reason: error,
				observedAt: Date.now()
			}
		};
		await this.mintOperationRepository.update(failed);
		await this.eventBus.emit("mint-op:failed", {
			mintUrl: failed.mintUrl,
			operationId: failed.id,
			operation: failed
		});
		this.logger?.info("Mint operation failed during recovery", {
			operationId: failed.id,
			mintUrl: failed.mintUrl,
			quoteId: failed.quoteId,
			error
		});
		return failed;
	}
	async transitionToPending(op, error) {
		const pending = {
			...op,
			state: "pending",
			updatedAt: Date.now(),
			error
		};
		await this.mintOperationRepository.update(pending);
		await this.eventBus.emit("mint-op:pending", {
			mintUrl: op.mintUrl,
			operationId: op.id,
			operation: pending
		});
		this.logger?.info("Mint operation moved to pending", {
			operationId: op.id,
			mintUrl: op.mintUrl,
			quoteId: op.quoteId,
			error
		});
		return pending;
	}
	async observePendingOperation(operationId) {
		const op = await this.getOperation(operationId);
		if (!op || op.state !== "pending") throw new Error(`Cannot check operation ${operationId}: expected state 'pending' but found '${op?.state ?? "not found"}'`);
		const observation = await this.handlerProvider.get(op.method).checkPending({
			operation: op,
			mintAdapter: this.mintAdapter,
			logger: this.logger
		});
		let canonicalQuote;
		if (observation.quoteSnapshot) canonicalQuote = await this.quoteLifecycle.recordMintQuoteSnapshot(op.mintUrl, op.method, observation.quoteSnapshot);
		let result;
		if (observation.validationFailure) result = {
			observedRemoteStateAt: observation.observedAt,
			quoteSnapshot: observation.quoteSnapshot,
			category: "terminal",
			terminalFailure: observation.validationFailure
		};
		else {
			if (!canonicalQuote) throw new Error(`Pending mint observation for operation ${op.id} has no quote snapshot`);
			const siblings = await this.mintOperationRepository.getByQuoteId(op.mintUrl, op.method, op.quoteId);
			const assessment = this.assessQuoteClaimability(canonicalQuote, siblings, {
				requestedAmount: op.amount,
				targetOperationId: op.id
			});
			result = {
				observedRemoteStateAt: observation.observedAt,
				quoteSnapshot: observation.quoteSnapshot,
				category: assessment.status === "claimable" ? "ready" : assessment.status === "complete" ? "completed" : assessment.status === "invalid" ? "terminal" : "waiting",
				terminalFailure: assessment.status === "invalid" ? {
					reason: `Mint quote ${op.quoteId} has invalid claimability accounting`,
					code: "invalid_quote",
					retryable: false,
					observedAt: observation.observedAt
				} : void 0
			};
		}
		if (result.category === "terminal" && result.terminalFailure) await this.failPendingOperation(op, result.terminalFailure);
		return result;
	}
	async checkPendingOperation(operationId) {
		const result = await this.observePendingOperation(operationId);
		if (result.category === "ready" || result.category === "completed") await this.finalize(operationId);
		return result;
	}
	async failPendingOperation(op, terminalFailure) {
		if (!terminalFailure) throw new Error(`Cannot fail pending operation ${op.id} without terminal failure details`);
		const current = await this.mintOperationRepository.getById(op.id);
		if (!current) throw new Error(`Operation ${op.id} not found`);
		if (current.state === "failed") return current;
		if (current.state === "finalized") throw new Error(`Cannot fail operation ${op.id} in state ${current.state}`);
		if (current.state !== "pending") throw new Error(`Cannot fail operation ${op.id} in state ${current.state}`);
		const failed = {
			...current,
			state: "failed",
			updatedAt: Date.now(),
			error: terminalFailure.reason,
			terminalFailure
		};
		await this.mintOperationRepository.update(failed);
		await this.eventBus.emit("mint-op:failed", {
			mintUrl: failed.mintUrl,
			operationId: failed.id,
			operation: failed
		});
		this.logger?.info("Mint operation failed while pending", {
			operationId: failed.id,
			mintUrl: failed.mintUrl,
			quoteId: failed.quoteId,
			error: terminalFailure.reason
		});
		return failed;
	}
	async hasSavedOutputs(op) {
		if (!hasPendingData(op)) return false;
		const outputSecrets = getOutputProofSecrets$1(op);
		if (outputSecrets.length === 0) return false;
		for (const secret of outputSecrets) if (!await this.proofRepository.getProofBySecret(op.mintUrl, secret)) return false;
		return true;
	}
};

//#endregion
//#region operations/receive/ReceiveOperation.ts
function getOutputProofSecrets(op) {
	const { keepSecrets, sendSecrets } = getSecretsFromSerializedOutputData(op.outputData);
	return [...keepSecrets, ...sendSecrets];
}
/**
* Creates a new ReceiveOperation in init state
*/
function createReceiveOperation(id, mintUrl, intent, inputProofs, source) {
	const now = Date.now();
	const amount = normalizeUnitAmount(intent);
	return {
		id,
		state: "init",
		mintUrl,
		unit: amount.unit,
		amount: amount.amount,
		inputProofs,
		source,
		createdAt: now,
		updatedAt: now
	};
}

//#endregion
//#region operations/receive/ReceiveOperationService.ts
const NON_TERMINAL_RECEIVE_MINT_ERROR_CODES = new Set([11003]);
/**
* Service that manages receive operations as sagas.
*
* This service provides crash recovery and rollback capabilities for receive operations
* By breaking them into discrete step:  init → prepare → execute → finalized
* rolledback for failure state
*/
var ReceiveOperationService = class {
	receiveOperationRepository;
	proofRepository;
	proofService;
	mintService;
	walletService;
	mintAdapter;
	tokenService;
	eventBus;
	logger;
	/** In-memory lock to prevent concurrent operations on the same operation ID */
	operationIdLock = new OperationIdLock();
	/** Lock for the global recovery process */
	recoveryLock = null;
	/** In-memory lock to serialize deterministic-output derivation (counter) per mint */
	mintScopedLock;
	constructor(receiveOperationRepository, proofRepository, proofService, mintService, walletService, mintAdapter, tokenService, eventBus, logger, mintScopedLock) {
		this.receiveOperationRepository = receiveOperationRepository;
		this.proofRepository = proofRepository;
		this.proofService = proofService;
		this.mintService = mintService;
		this.walletService = walletService;
		this.mintAdapter = mintAdapter;
		this.tokenService = tokenService;
		this.eventBus = eventBus;
		this.logger = logger;
		this.mintScopedLock = mintScopedLock ?? new MintScopedLock();
	}
	/**
	* Acquire an in-memory lock for a specific operation to prevent concurrency races.
	* Returns a release function that must be called in a finally block.
	* Throws if the operation is already locked.
	*/
	async acquireOperationLock(operationId) {
		return this.operationIdLock.acquire(operationId);
	}
	/** Check if an operation is currently locked (for concurrency control). */
	isOperationLocked(operationId) {
		return this.operationIdLock.isLocked(operationId);
	}
	/** Check if a recovery sweep is in progress. */
	isRecoveryInProgress() {
		return this.recoveryLock !== null;
	}
	/**
	* Create a new receive operation by decoding and validating the token.
	* Persists the init state so recovery can reason about this operation.
	*/
	async init(token, source) {
		const mintUrl = this.extractMintUrl(token);
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		const decodedToken = await this.tokenService.decodeToken(token, mintUrl);
		const unit = normalizeUnit(decodedToken.unit, { defaultUnit: DEFAULT_UNIT });
		const proofs = decodedToken.proofs;
		const preparedProofs = await this.proofService.prepareProofsForReceiving(proofs);
		if (!Array.isArray(preparedProofs) || preparedProofs.length === 0) {
			this.logger?.warn("Token contains no proofs", { mintUrl });
			throw new ProofValidationError("Token contains no proofs");
		}
		const amount = sumProofs(preparedProofs);
		if (amount.isZero()) {
			this.logger?.warn("Token has invalid or non-positive amount", {
				mintUrl,
				amount
			});
			throw new ProofValidationError("Token amount must be a positive integer");
		}
		const id = generateSubId();
		const operation = createReceiveOperation(id, mintUrl, {
			amount,
			unit
		}, preparedProofs, source);
		await this.receiveOperationRepository.create(operation);
		this.logger?.debug("Receive operation created", {
			operationId: id,
			mintUrl,
			amount,
			proofCount: preparedProofs.length
		});
		return operation;
	}
	/**
	* Prepare the operation by calculating fees and creating deterministic outputs.
	* Transitions init -> prepared and stores outputData for crash recovery.
	*/
	async prepare(operation) {
		const releaseLock = await this.acquireOperationLock(operation.id);
		try {
			const releaseMintLock = await this.mintScopedLock.acquire(operation.mintUrl);
			let prepared;
			try {
				const current = await this.receiveOperationRepository.getById(operation.id);
				if (!current) throw new Error(`Operation ${operation.id} not found`);
				if (current.state !== "init") throw new Error(`Cannot prepare operation in state '${current.state}'. Expected 'init'.`);
				try {
					prepared = await this.prepareInternal(current);
				} catch (e) {
					if (current.state === "init") await this.tryRecoverInitOperation(current);
					throw e;
				}
			} finally {
				releaseMintLock();
			}
			await this.eventBus.emit("receive-op:prepared", {
				mintUrl: prepared.mintUrl,
				operationId: prepared.id,
				operation: prepared
			});
			return prepared;
		} finally {
			releaseLock();
		}
	}
	/** Internal prepare logic used by prepare(), separated for error handling. */
	async prepareInternal(operation) {
		if (!operation.inputProofs || operation.inputProofs.length === 0) throw new ProofValidationError("Receive operation has no input proofs");
		const { mintUrl } = operation;
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, operation.unit);
		const fee = wallet.getFeesForProofs(operation.inputProofs);
		if (operation.amount.lessThanOrEqual(fee)) throw new ProofValidationError("Receive amount is not sufficient after fees");
		const keepAmount = operation.amount.subtract(fee);
		const outputResult = await this.proofService.createOutputsAndIncrementCounters(mintUrl, {
			keep: {
				amount: keepAmount,
				unit: operation.unit
			},
			send: {
				amount: Amount$1.zero(),
				unit: operation.unit
			}
		}, {});
		if (!outputResult.keep || outputResult.keep.length === 0) throw new Error("Failed to create deterministic outputs for receive");
		const outputData = serializeOutputData({
			keep: outputResult.keep,
			send: []
		});
		const prepared = {
			...operation,
			state: "prepared",
			updatedAt: Date.now(),
			fee,
			outputData
		};
		await this.receiveOperationRepository.update(prepared);
		this.logger?.info("Receive operation prepared", {
			operationId: operation.id,
			mintUrl,
			fee,
			proofCount: operation.inputProofs.length
		});
		return prepared;
	}
	/**
	* Execute the prepared operation.
	* Marks executing before mint interaction to ensure crash-safe recovery.
	*/
	async execute(operation) {
		const releaseLock = await this.acquireOperationLock(operation.id);
		try {
			const current = await this.receiveOperationRepository.getById(operation.id);
			if (!current) throw new Error(`Operation ${operation.id} not found`);
			if (current.state !== "prepared") throw new Error(`Cannot execute operation in state '${current.state}'. Expected 'prepared'.`);
			const executing = {
				...current,
				state: "executing",
				updatedAt: Date.now()
			};
			await this.receiveOperationRepository.update(executing);
			try {
				return await this.executeInternal(executing);
			} catch (e) {
				const rollbackReason = this.getRollbackReasonForReceiveFailure(e);
				if (rollbackReason) {
					await this.markAsRolledBack(executing, rollbackReason);
					throw e;
				}
				await this.tryRecoverExecutingOperation(executing);
				throw e;
			}
		} finally {
			releaseLock();
		}
	}
	/** Internal execute logic used by execute(), separated for error handling. */
	async executeInternal(executing) {
		if (!executing.outputData) throw new Error("Missing output data for receive operation");
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(executing.mintUrl, executing.unit);
		const outputData = deserializeOutputData(executing.outputData);
		this.logger?.info("Receiving token", {
			operationId: executing.id,
			mintUrl: executing.mintUrl,
			proofs: executing.inputProofs.length,
			amount: executing.amount
		});
		const newProofs = await wallet.receive({
			mint: executing.mintUrl,
			proofs: executing.inputProofs,
			unit: executing.unit
		}, void 0, {
			type: "custom",
			data: outputData.keep
		});
		await this.proofService.saveProofs(executing.mintUrl, mapProofToCoreProof(executing.mintUrl, "ready", newProofs, {
			unit: executing.unit,
			createdByOperationId: executing.id
		}));
		return await this.markAsFinalized(executing);
	}
	/**
	* High-level receive method that orchestrates init → prepare → execute.
	* This is the primary entry point used by WalletApi.
	*/
	async receive(token) {
		const initOp = await this.init(token);
		const preparedOp = await this.prepare(initOp);
		await this.execute(preparedOp);
	}
	/**
	* Finalize an executing operation (idempotent).
	* Used by recovery when outputs are already saved.
	*/
	async finalize(operationId) {
		const preCheck = await this.receiveOperationRepository.getById(operationId);
		if (!preCheck) throw new Error(`Operation ${operationId} not found`);
		if (preCheck.state === "finalized") {
			this.logger?.debug("Receive operation already finalized", { operationId });
			return;
		}
		if (preCheck.state === "rolled_back") {
			this.logger?.debug("Receive operation rolled back, skipping finalization", { operationId });
			return;
		}
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.receiveOperationRepository.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			if (operation.state === "finalized") return;
			if (operation.state === "rolled_back") return;
			if (operation.state !== "executing") throw new Error(`Cannot finalize operation in state ${operation.state}`);
			const executing = operation;
			if (!await this.hasSavedOutputs(executing)) throw new Error("Cannot finalize receive operation: outputs not persisted");
			await this.markAsFinalized(executing);
		} finally {
			releaseLock();
		}
	}
	/**
	* Recover pending operations on startup.
	* Handles init cleanup, logs stale prepared operations, and recovers executing operations.
	*/
	async recoverPendingOperations() {
		if (this.recoveryLock) throw new Error("Recovery is already in progress");
		let releaseRecoveryLock;
		this.recoveryLock = new Promise((resolve) => {
			releaseRecoveryLock = resolve;
		});
		try {
			let initCount = 0;
			let executingCount = 0;
			const initOps = await this.receiveOperationRepository.getByState("init");
			for (const op of initOps) {
				let didRecover = false;
				try {
					const releaseLock = await this.acquireOperationLock(op.id);
					try {
						const current = await this.receiveOperationRepository.getById(op.id);
						if (current && current.state === "init") {
							await this.recoverInitOperation(current);
							didRecover = true;
						}
					} finally {
						releaseLock();
					}
				} catch (e) {
					if (e instanceof OperationInProgressError) {
						this.logger?.debug("Init receive operation is in progress, skipping recovery", { operationId: op.id });
						continue;
					}
					throw e;
				}
				if (didRecover) initCount++;
			}
			const preparedOps = await this.receiveOperationRepository.getByState("prepared");
			for (const op of preparedOps) this.logger?.warn("Found stale prepared receive operation, user can rollback manually", { operationId: op.id });
			const executingOps = await this.receiveOperationRepository.getByState("executing");
			for (const op of executingOps) {
				let didRecover = false;
				try {
					const current = await this.receiveOperationRepository.getById(op.id);
					if (current && current.state === "executing") {
						await this.recoverExecutingOperation(current);
						didRecover = true;
					}
				} catch (e) {
					if (e instanceof OperationInProgressError) {
						this.logger?.debug("Executing receive operation is in progress, skipping recovery", { operationId: op.id });
						continue;
					}
					this.logger?.error("Error recovering executing receive operation", {
						operationId: op.id,
						error: e instanceof Error ? e.message : String(e)
					});
				}
				if (didRecover) executingCount++;
			}
			this.logger?.info("Receive recovery completed", {
				initOperations: initCount,
				executingOperations: executingCount
			});
		} finally {
			this.recoveryLock = null;
			releaseRecoveryLock();
		}
	}
	/** Cleanup for failed init operations with no external side effects. */
	async recoverInitOperation(op) {
		await this.receiveOperationRepository.delete(op.id);
		this.logger?.info("Cleaned up failed receive init operation", { operationId: op.id });
	}
	/** Init recovery when prepare fails. */
	async tryRecoverInitOperation(op) {
		try {
			await this.recoverInitOperation(op);
			this.logger?.info("Recovered init receive operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover init receive operation, will retry on next startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	/**
	* Recover an executing operation by checking mint state and restoring outputs.
	* Uses outputData to recover proofs if inputs were spent at the mint.
	*/
	async recoverExecutingOperation(op, options) {
		const releaseLock = options?.skipLock ? void 0 : await this.acquireOperationLock(op.id);
		try {
			const current = await this.receiveOperationRepository.getById(op.id);
			if (!current) {
				this.logger?.warn("Receive operation missing during recovery", { operationId: op.id });
				return;
			}
			if (current.state === "finalized" || current.state === "rolled_back") return;
			if (current.state !== "executing") {
				this.logger?.debug("Receive operation not executing during recovery", {
					operationId: current.id,
					state: current.state
				});
				return;
			}
			const executing = current;
			if (await this.hasSavedOutputs(executing)) {
				await this.markAsFinalized(executing);
				this.logger?.info("Receive operation finalized during recovery (outputs already saved)", { operationId: executing.id });
				return;
			}
			let inputStates;
			try {
				inputStates = await this.checkProofStatesWithMint(executing.mintUrl, executing.inputProofs);
			} catch (e) {
				this.logger?.warn("Could not reach mint for receive recovery, will retry later", {
					operationId: executing.id,
					mintUrl: executing.mintUrl
				});
				return;
			}
			const allUnspent = inputStates.every((s) => s.state === "UNSPENT");
			const allSpent = inputStates.every((s) => s.state === "SPENT");
			if (allUnspent) {
				if (!executing.outputData) {
					await this.markAsRolledBack(executing, "Recovered: missing output data for receive");
					return;
				}
				try {
					await this.executeInternal(executing);
				} catch (e) {
					const rollbackReason = this.getRollbackReasonForReceiveFailure(e);
					if (rollbackReason) {
						await this.markAsRolledBack(executing, rollbackReason);
						return;
					}
					this.logger?.warn("Receive re-execution failed, will retry later", {
						operationId: executing.id,
						mintUrl: executing.mintUrl,
						error: e instanceof Error ? e.message : String(e)
					});
				}
				return;
			}
			if (!allSpent) {
				this.logger?.warn("Receive operation inputs not conclusively spent, retry later", { operationId: executing.id });
				return;
			}
			if (!executing.outputData) {
				await this.markAsRolledBack(executing, "Recovered: missing output data for receive");
				return;
			}
			try {
				const recovered = await this.proofService.recoverProofsFromOutputData(executing.mintUrl, executing.outputData, {
					unit: executing.unit,
					createdByOperationId: executing.id
				});
				if (await this.hasSavedOutputs(executing)) {
					await this.markAsFinalized(executing);
					return;
				}
				if (recovered.length === 0) {
					await this.markAsRolledBack(executing, "Recovered: input proofs spent without recoverable outputs");
					return;
				}
				this.logger?.warn("Receive outputs not persisted after recovery attempt", {
					operationId: executing.id,
					mintUrl: executing.mintUrl,
					recoveredCount: recovered.length
				});
			} catch (e) {
				const rollbackReason = this.getRollbackReasonForReceiveFailure(e);
				if (rollbackReason) {
					await this.markAsRolledBack(executing, rollbackReason);
					return;
				}
				this.logger?.warn("Recovering receive outputs failed, will retry later", {
					operationId: executing.id,
					mintUrl: executing.mintUrl,
					error: e instanceof Error ? e.message : String(e)
				});
			}
		} finally {
			if (releaseLock) releaseLock();
		}
	}
	/** Best-effort executing recovery used when execute fails. */
	async tryRecoverExecutingOperation(op) {
		try {
			await this.recoverExecutingOperation(op, { skipLock: true });
			this.logger?.info("Recovered executing receive operation after failure", { operationId: op.id });
		} catch (recoveryError) {
			this.logger?.warn("Failed to recover executing receive operation, will retry on startup", {
				operationId: op.id,
				error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
			});
		}
	}
	getRollbackReasonForReceiveFailure(error) {
		if (error instanceof MintOperationError) return NON_TERMINAL_RECEIVE_MINT_ERROR_CODES.has(error.code) ? null : error.message;
		return null;
	}
	async checkProofStatesWithMint(mintUrl, proofs) {
		const batches = [];
		let batchResults = [];
		const yHexes = computeYHexForSecrets(proofs.map((p) => p.secret));
		for (let i = 0; i < yHexes.length; i += 100) batches.push(yHexes.slice(i, i + 100));
		batchResults = await Promise.all(batches.map((batch) => this.mintAdapter.checkProofStates(mintUrl, batch)));
		return batchResults.flat();
	}
	/**
	* Persist finalized state and emit the operation finalized event.
	*/
	async markAsFinalized(op) {
		const current = await this.receiveOperationRepository.getById(op.id);
		if (!current) throw new Error(`Operation ${op.id} not found`);
		if (current.state === "finalized") return current;
		if (current.state === "rolled_back") throw new Error(`Cannot finalize operation in state ${current.state}`);
		if (current.state !== "executing") throw new Error(`Cannot finalize operation in state ${current.state}`);
		const finalized = {
			...current,
			state: "finalized",
			updatedAt: Date.now()
		};
		await this.receiveOperationRepository.update(finalized);
		await this.eventBus.emit("receive-op:finalized", {
			mintUrl: finalized.mintUrl,
			operationId: finalized.id,
			operation: finalized
		});
		this.logger?.info("Receive operation finalized", {
			operationId: finalized.id,
			mintUrl: finalized.mintUrl,
			proofCount: finalized.inputProofs.length
		});
		return finalized;
	}
	/**
	* Persist rolled back state with error context.
	*/
	async markAsRolledBack(op, error) {
		const rolledBack = {
			...op,
			state: "rolled_back",
			updatedAt: Date.now(),
			error
		};
		await this.receiveOperationRepository.update(rolledBack);
		await this.eventBus.emit("receive-op:rolled-back", {
			mintUrl: rolledBack.mintUrl,
			operationId: rolledBack.id,
			operation: rolledBack
		});
		this.logger?.info("Receive operation rolled back", {
			operationId: op.id,
			error
		});
		return rolledBack;
	}
	/**
	* Check if any output proofs already exist locally.
	* Used to avoid unnecessary recovery work.
	*/
	async hasSavedOutputs(op) {
		const outputSecrets = getOutputProofSecrets(op);
		if (outputSecrets.length === 0) return false;
		return (await this.proofRepository.getProofsBySecrets(op.mintUrl, outputSecrets)).length === new Set(outputSecrets).size;
	}
	/** Extract and normalize mint URL from token, with validation. */
	extractMintUrl(token) {
		try {
			return normalizeMintUrl(typeof token === "string" ? getTokenMetadata$1(token).mint : token.mint);
		} catch (err) {
			this.logger?.warn("Failed to decode token for receive", { err });
			throw new ProofValidationError("Invalid token");
		}
	}
	/**
	* Get an operation by ID.
	*/
	async getOperation(operationId) {
		return this.receiveOperationRepository.getById(operationId);
	}
	/**
	* Get all pending operations.
	*/
	async getPendingOperations() {
		return this.receiveOperationRepository.getPending();
	}
	/**
	* Get all prepared operations.
	*/
	async getPreparedOperations() {
		return (await this.receiveOperationRepository.getByState("prepared")).filter((op) => op.state === "prepared");
	}
	/**
	* Rollback a receive operation.
	* Only allowed for operations in 'init' or 'prepared' state.
	*/
	async rollback(operationId, reason) {
		const releaseLock = await this.acquireOperationLock(operationId);
		try {
			const operation = await this.receiveOperationRepository.getById(operationId);
			if (!operation) throw new Error(`Operation ${operationId} not found`);
			switch (operation.state) {
				case "executing": throw new Error(`Cannot rollback operation in state ${operation.state}`);
				case "finalized": throw new Error(`Cannot rollback operation in state ${operation.state}`);
				case "rolled_back": throw new Error(`Cannot rollback operation in state ${operation.state}`);
				case "init":
					await this.receiveOperationRepository.delete(operation.id);
					this.logger?.info("Receive operation cancelled", {
						operationId,
						reason: reason ?? "User cancelled receive operation"
					});
					return;
				case "prepared":
					await this.markAsRolledBack(operation, reason ?? "User cancelled receive operation");
					return;
				default: throw new Error(`Cannot rollback operation in unknown state`);
			}
		} finally {
			releaseLock();
		}
	}
};

//#endregion
//#region infra/MintAdapter.ts
/**
* Adapter for making HTTP requests to Cashu mints.
*
* All requests are rate-limited through the MintRequestProvider,
* sharing the same rate limits with other components (e.g., WalletService).
*/
var MintAdapter = class {
	cashuMints = {};
	requestProvider;
	authProviders = /* @__PURE__ */ new Map();
	constructor(requestProvider) {
		this.requestProvider = requestProvider;
	}
	/** Register an AuthProvider for a mint (NUT-21/22). Invalidates the cached Mint instance. */
	setAuthProvider(mintUrl, provider) {
		this.authProviders.set(mintUrl, provider);
		delete this.cashuMints[mintUrl];
	}
	/** Get the AuthProvider for a mint (if registered). */
	getAuthProvider(mintUrl) {
		return this.authProviders.get(mintUrl);
	}
	/** Remove the AuthProvider for a mint. Invalidates the cached Mint instance. */
	clearAuthProvider(mintUrl) {
		this.authProviders.delete(mintUrl);
		delete this.cashuMints[mintUrl];
	}
	async fetchMintInfo(mintUrl) {
		return await this.getCashuMint(mintUrl).getInfo();
	}
	async fetchKeysets(mintUrl) {
		return await this.getCashuMint(mintUrl).getKeySets();
	}
	async fetchKeysForId(mintUrl, id) {
		const { keysets } = await this.getCashuMint(mintUrl).getKeys(id);
		if (keysets.length !== 1 || !keysets[0]) throw new Error(`Expected 1 keyset for ${id}, got ${keysets.length}`);
		return keysets[0].keys;
	}
	/** Fetches a metadata observation, reusing known keys without accessing Wallet storage. */
	async fetchMintMetadata(mintUrl, knownKeysets) {
		const observedAt = Math.floor(Date.now() / 1e3);
		const mintInfo = await this.fetchMintInfo(mintUrl).catch((error) => {
			throw new MintFetchError(mintUrl, void 0, error);
		});
		const result = await this.fetchKeysets(mintUrl).catch((error) => {
			throw new MintFetchError(mintUrl, "Failed to fetch keysets", error);
		});
		return {
			mintUrl,
			mintInfo,
			keysets: await Promise.all(result.keysets.filter((keyset) => !isBlsKeyset(keyset.id)).map(async (keyset) => {
				const keypairs = knownKeysets.find((candidate) => candidate.id === keyset.id)?.keypairs ?? await this.fetchKeysForId(mintUrl, keyset.id).catch((error) => {
					throw new KeysetSyncError(mintUrl, keyset.id, void 0, error);
				});
				return {
					mintUrl,
					id: keyset.id,
					unit: keyset.unit,
					active: keyset.active,
					feePpk: keyset.input_fee_ppk || 0,
					keypairs
				};
			})),
			observedAt
		};
	}
	getCashuMint(mintUrl) {
		if (!this.cashuMints[mintUrl]) {
			const requestFn = this.requestProvider.getRequestFn(mintUrl);
			const authProvider = this.authProviders.get(mintUrl);
			this.cashuMints[mintUrl] = new Mint(mintUrl, {
				customRequest: requestFn,
				authProvider
			});
		}
		return this.cashuMints[mintUrl];
	}
	async checkMintQuote(mintUrl, method, quoteId) {
		return this.getCashuMint(mintUrl).checkMintQuote(method, quoteId);
	}
	/** Send one NUT-29 mint-quote batch check through the shared auth and rate-limit boundary. */
	async checkMintQuoteBatch(mintUrl, method, quoteIds) {
		return this.getCashuMint(mintUrl).checkMintQuoteBatch(method, quoteIds);
	}
	async checkMeltQuote(mintUrl, quoteId) {
		return await this.getCashuMint(mintUrl).checkMeltQuoteBolt11(quoteId);
	}
	async checkMeltQuoteBolt12(mintUrl, quoteId) {
		return await this.getCashuMint(mintUrl).checkMeltQuoteBolt12(quoteId);
	}
	async checkMeltQuoteOnchain(mintUrl, quoteId) {
		return await this.getCashuMint(mintUrl).checkMeltQuoteOnchain(quoteId);
	}
	async checkMeltQuoteState(mintUrl, quoteId) {
		return (await this.checkMeltQuote(mintUrl, quoteId)).state;
	}
	async checkMeltQuoteBolt12State(mintUrl, quoteId) {
		return (await this.checkMeltQuoteBolt12(mintUrl, quoteId)).state;
	}
	async checkMeltQuoteOnchainState(mintUrl, quoteId) {
		return (await this.checkMeltQuoteOnchain(mintUrl, quoteId)).state;
	}
	async checkProofStates(mintUrl, Ys) {
		const cashuMint = this.getCashuMint(mintUrl);
		const payload = { Ys };
		return (await cashuMint.check(payload)).states;
	}
	async customMeltBolt11(mintUrl, proofsToSend, changeOutputs, quoteId) {
		const cashuMint = this.getCashuMint(mintUrl);
		const blindedMessages = changeOutputs.map((output) => output.blindedMessage);
		return cashuMint.meltBolt11({
			quote: quoteId,
			inputs: proofsToSend,
			outputs: blindedMessages
		});
	}
	async customMeltBolt12(mintUrl, proofsToSend, changeOutputs, quoteId) {
		const cashuMint = this.getCashuMint(mintUrl);
		const blindedMessages = changeOutputs.map((output) => output.blindedMessage);
		return cashuMint.meltBolt12({
			quote: quoteId,
			inputs: proofsToSend,
			outputs: blindedMessages
		});
	}
	async customMeltOnchain(mintUrl, proofsToSend, changeOutputs, quoteId, feeIndex) {
		const cashuMint = this.getCashuMint(mintUrl);
		const blindedMessages = changeOutputs.map((output) => output.blindedMessage);
		return cashuMint.meltOnchain({
			quote: quoteId,
			inputs: proofsToSend,
			outputs: blindedMessages,
			fee_index: feeIndex,
			prefer_async: true
		});
	}
};

//#endregion
//#region infra/RequestRateLimiter.ts
function stringifyJson(value, space) {
	const body = JSONInt.stringify(value, void 0, space);
	if (body === void 0) throw new TypeError("Failed to serialize JSON body");
	return body;
}
async function parseJsonResponse(response) {
	return JSONInt.parse(await response.text());
}
/**
* Token-bucket based request rate limiter that exposes a request-compatible API
* for the cashu-ts `_customRequest` parameter.
*
* - Token capacity determines max burst size.
* - Tokens refill continuously based on `refillPerMinute`.
* - Paths starting with any configured prefix are not throttled.
* - Requests are queued FIFO when tokens are exhausted.
*/
var RequestRateLimiter = class {
	capacity;
	refillPerMinute;
	tokens;
	lastRefillAt;
	bypassPathPrefixes;
	logger;
	queue = [];
	processingTimer = null;
	constructor(options) {
		this.capacity = Math.max(1, options?.capacity ?? 25);
		this.refillPerMinute = Math.max(1, options?.refillPerMinute ?? 25);
		this.tokens = this.capacity;
		this.lastRefillAt = Date.now();
		this.bypassPathPrefixes = options?.bypassPathPrefixes ?? [];
		this.logger = options?.logger;
	}
	/**
	* The request function compatible with cashu-ts's `request(options)` signature.
	* It uses the global fetch under the hood.
	*/
	request = async (options) => {
		const url = new URL(options.endpoint);
		if (this.shouldBypass(url.pathname)) return this.performFetch(options);
		await this.acquireToken();
		try {
			return await this.performFetch(options);
		} finally {
			this.scheduleProcessingIfNeeded();
		}
	};
	shouldBypass(pathname) {
		if (!this.bypassPathPrefixes.length) return false;
		return this.bypassPathPrefixes.some((p) => pathname.startsWith(p));
	}
	performFetch = async (options) => {
		const { endpoint, requestBody, headers, ...init } = options;
		const finalHeaders = new Headers({
			Accept: "application/json, text/plain, */*",
			...headers || {}
		});
		let body = void 0;
		if (requestBody !== void 0) {
			finalHeaders.set("Content-Type", "application/json");
			body = stringifyJson(requestBody);
		}
		this.logger?.debug("Mint request", {
			method: init.method || "GET",
			endpoint,
			requestBody: requestBody ? stringifyJson(requestBody, 2) : void 0
		});
		let response;
		try {
			response = await fetch(endpoint, {
				...init,
				headers: finalHeaders,
				body
			});
		} catch (err) {
			this.logger?.debug("Mint request network error", {
				endpoint,
				error: err instanceof Error ? err.message : String(err)
			});
			throw new NetworkError(err instanceof Error ? err.message : "Network request failed");
		}
		if (!response.ok) {
			let errorData = { error: "bad response" };
			try {
				errorData = await parseJsonResponse(response.clone());
			} catch {}
			this.logger?.debug("Mint response error", {
				endpoint,
				status: response.status,
				errorData: stringifyJson(errorData, 2)
			});
			if (response.status === 400 && errorData && typeof errorData.code === "number" && typeof errorData.detail === "string") {
				const { code, detail } = errorData;
				throw new MintOperationError(code, detail);
			}
			let errorMessage = "HTTP request failed";
			const anyErr = errorData;
			if (typeof anyErr?.error === "string") errorMessage = anyErr.error;
			else if (typeof anyErr?.detail === "string") errorMessage = anyErr.detail;
			throw new HttpResponseError(errorMessage, response.status);
		}
		try {
			const responseData = await parseJsonResponse(response);
			this.logger?.debug("Mint response success", {
				endpoint,
				status: response.status,
				responseData: stringifyJson(responseData, 2)
			});
			return responseData;
		} catch (err) {
			this.logger?.error("Failed to parse HTTP response", err);
			throw new HttpResponseError("bad response", response.status);
		}
	};
	acquireToken() {
		this.refillTokens();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			this.logger?.debug("RateLimiter token granted immediately", {
				tokens: this.tokens,
				capacity: this.capacity
			});
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.queue.push(() => {
				resolve();
			});
			this.logger?.debug("Queued request due to empty bucket", { queueLength: this.queue.length });
			this.scheduleProcessingIfNeeded();
		});
	}
	scheduleProcessingIfNeeded() {
		if (this.processingTimer) return;
		const delayMs = this.msUntilNextToken();
		this.processingTimer = setTimeout(() => {
			this.processingTimer = null;
			this.processQueue();
		}, delayMs);
	}
	processQueue() {
		this.refillTokens();
		while (this.tokens >= 1 && this.queue.length > 0) {
			const next = this.queue.shift();
			if (!next) continue;
			this.tokens -= 1;
			try {
				next();
			} catch (err) {
				this.logger?.error("RateLimiter queue task error", err);
			}
		}
		if (this.queue.length > 0) this.scheduleProcessingIfNeeded();
	}
	refillTokens() {
		const now = Date.now();
		const elapsedMs = now - this.lastRefillAt;
		if (elapsedMs <= 0) return;
		const refill = elapsedMs * (this.refillPerMinute / 6e4);
		const newTokens = Math.min(this.capacity, this.tokens + refill);
		if (newTokens !== this.tokens) {
			this.tokens = newTokens;
			this.lastRefillAt = now;
		} else this.lastRefillAt = now;
	}
	msUntilNextToken() {
		this.refillTokens();
		if (this.tokens >= 1) return 0;
		const tokensPerMs = this.refillPerMinute / 6e4;
		const deficit = 1 - this.tokens;
		return Math.max(1, Math.ceil(deficit / tokensPerMs));
	}
};

//#endregion
//#region infra/MintRequestProvider.ts
/**
* Manages per-mint request rate limiters.
*
* This class provides a centralized way to share rate limiters across
* all components that need to make HTTP requests to mints (WalletService,
* MintAdapter, etc.).
*/
var MintRequestProvider = class {
	limiters = /* @__PURE__ */ new Map();
	options;
	constructor(options) {
		this.options = {
			capacity: options?.capacity ?? 20,
			refillPerMinute: options?.refillPerMinute ?? 20,
			bypassPathPrefixes: options?.bypassPathPrefixes ?? [],
			configForMint: options?.configForMint,
			logger: options?.logger
		};
	}
	/**
	* Get the request function for a specific mint.
	* Creates a new rate limiter if one doesn't exist for this mint.
	*/
	getRequestFn(mintUrl) {
		return this.getOrCreateLimiter(mintUrl).request;
	}
	/**
	* Get or create a rate limiter for a specific mint.
	*/
	getOrCreateLimiter(mintUrl) {
		const existing = this.limiters.get(mintUrl);
		if (existing) return existing;
		const perMintConfig = this.options.configForMint?.(mintUrl) ?? {};
		const limiter = new RequestRateLimiter({
			capacity: perMintConfig.capacity ?? this.options.capacity,
			refillPerMinute: perMintConfig.refillPerMinute ?? this.options.refillPerMinute,
			bypassPathPrefixes: perMintConfig.bypassPathPrefixes ?? this.options.bypassPathPrefixes,
			logger: this.options.logger?.child ? this.options.logger.child({
				module: "RequestRateLimiter",
				mintUrl
			}) : this.options.logger
		});
		this.limiters.set(mintUrl, limiter);
		return limiter;
	}
	/**
	* Clear the rate limiter for a specific mint.
	*/
	clearMint(mintUrl) {
		this.limiters.delete(mintUrl);
	}
	/**
	* Clear all rate limiters.
	*/
	clearAll() {
		this.limiters.clear();
	}
};

//#endregion
//#region infra/PollingTransport.ts
const SUPPORTED_POLLING_KINDS = new Set([
	"bolt11_mint_quote",
	"onchain_mint_quote",
	"bolt12_mint_quote",
	"bolt11_melt_quote",
	"bolt12_melt_quote",
	"onchain_melt_quote",
	"proof_state"
]);
const MINT_QUOTE_METHOD_BY_KIND = {
	bolt11_mint_quote: "bolt11",
	bolt12_mint_quote: "bolt12",
	onchain_mint_quote: "onchain"
};
var PollingTransport = class {
	logger;
	mintAdapter;
	mintQuotePolling;
	options;
	listenersByMint = /* @__PURE__ */ new Map();
	schedByMint = /* @__PURE__ */ new Map();
	proofQueueByMint = /* @__PURE__ */ new Map();
	proofSetByMint = /* @__PURE__ */ new Map();
	yToSubsByMint = /* @__PURE__ */ new Map();
	subToYsByMint = /* @__PURE__ */ new Map();
	intervalByMint = /* @__PURE__ */ new Map();
	unsubscribedByMint = /* @__PURE__ */ new Map();
	paused = false;
	constructor(mintAdapter, options, logger, mintQuotePolling) {
		this.logger = logger;
		this.mintAdapter = mintAdapter;
		this.mintQuotePolling = mintQuotePolling;
		this.options = { intervalMs: options?.intervalMs ?? 5e3 };
	}
	on(mintUrl, event, handler) {
		mintUrl = normalizeMintUrl(mintUrl);
		let map = this.listenersByMint.get(mintUrl);
		if (!map) {
			map = /* @__PURE__ */ new Map();
			this.listenersByMint.set(mintUrl, map);
		}
		let set = map.get(event);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			map.set(event, set);
		}
		if (!set.has(handler)) set.add(handler);
		if (event === "open") {
			if (!((map.get("open")?.size ?? 0) > 0)) queueMicrotask(() => {
				try {
					handler({ type: "open" });
				} catch {}
			});
		}
		this.ensureScheduler(mintUrl);
	}
	send(mintUrl, req) {
		mintUrl = normalizeMintUrl(mintUrl);
		if (req.method === "subscribe") {
			const params = req.params;
			const subId = params.subId;
			if (!this.isSupportedPollingKind(params.kind)) {
				this.logger?.error("PollingTransport: unsupported subscription kind", {
					mintUrl,
					kind: params.kind,
					req
				});
				const resp = {
					jsonrpc: "2.0",
					error: {
						code: -32602,
						message: `Unsupported subscription kind: ${String(params.kind)}`
					},
					id: req.id
				};
				this.emit(mintUrl, "message", { data: JSON.stringify(resp) });
				return;
			}
			const scheduler = this.ensureScheduler(mintUrl);
			if (params.kind === "proof_state") {
				const ys = params.filters || [];
				if (!ys.length) this.logger?.error("PollingTransport: subscribe proof_state with no filters", {
					mintUrl,
					req
				});
				let yToSubs = this.yToSubsByMint.get(mintUrl);
				if (!yToSubs) {
					yToSubs = /* @__PURE__ */ new Map();
					this.yToSubsByMint.set(mintUrl, yToSubs);
				}
				let subToYs = this.subToYsByMint.get(mintUrl);
				if (!subToYs) {
					subToYs = /* @__PURE__ */ new Map();
					this.subToYsByMint.set(mintUrl, subToYs);
				}
				let q = this.proofQueueByMint.get(mintUrl);
				if (!q) {
					q = [];
					this.proofQueueByMint.set(mintUrl, q);
				}
				let set = this.proofSetByMint.get(mintUrl);
				if (!set) {
					set = /* @__PURE__ */ new Set();
					this.proofSetByMint.set(mintUrl, set);
				}
				let subYs = subToYs.get(subId);
				if (!subYs) {
					subYs = /* @__PURE__ */ new Set();
					subToYs.set(subId, subYs);
				}
				for (const y of ys) {
					subYs.add(y);
					let subs = yToSubs.get(y);
					if (!subs) {
						subs = /* @__PURE__ */ new Set();
						yToSubs.set(y, subs);
					}
					subs.add(subId);
					if (!set.has(y)) {
						set.add(y);
						q.push(y);
					}
				}
				if (!scheduler.hasProofBatchTask) {
					scheduler.queue.push({
						kind: "proof_state",
						batch: true
					});
					scheduler.hasProofBatchTask = true;
				}
			} else {
				const filters = params.filters ?? [];
				if (filters.length === 0) {
					this.logger?.error("PollingTransport: subscribe with no filter", {
						mintUrl,
						req
					});
					return;
				}
				for (const filter of filters) scheduler.queue.push({
					subId,
					kind: params.kind,
					filter
				});
			}
			const resp = {
				jsonrpc: "2.0",
				result: {
					status: "OK",
					subId
				},
				id: req.id
			};
			this.emit(mintUrl, "message", { data: JSON.stringify(resp) });
			this.maybeRun(mintUrl);
			return;
		}
		if (req.method === "unsubscribe") {
			const subId = req.params.subId;
			const scheduler = this.ensureScheduler(mintUrl);
			scheduler.queue = scheduler.queue.filter((t) => t.subId !== subId);
			let unsubscribed = this.unsubscribedByMint.get(mintUrl);
			if (!unsubscribed) {
				unsubscribed = /* @__PURE__ */ new Set();
				this.unsubscribedByMint.set(mintUrl, unsubscribed);
			}
			unsubscribed.add(subId);
			const subToYs = this.subToYsByMint.get(mintUrl);
			const yToSubs = this.yToSubsByMint.get(mintUrl);
			const q = this.proofQueueByMint.get(mintUrl);
			const set = this.proofSetByMint.get(mintUrl);
			if (subToYs && yToSubs) {
				const ys = subToYs.get(subId);
				if (ys) {
					for (const y of ys) {
						const subs = yToSubs.get(y);
						if (subs) {
							subs.delete(subId);
							if (subs.size === 0) {
								yToSubs.delete(y);
								if (set) set.delete(y);
								if (q) {
									const idx = q.indexOf(y);
									if (idx >= 0) q.splice(idx, 1);
								}
							}
						}
					}
					subToYs.delete(subId);
				}
				if (yToSubs.size === 0 && scheduler.hasProofBatchTask) {
					scheduler.queue = scheduler.queue.filter((t) => !(t.kind === "proof_state" && t.batch));
					scheduler.hasProofBatchTask = false;
				}
			}
			return;
		}
	}
	closeAll() {
		for (const scheduler of this.schedByMint.values()) this.clearTimer(scheduler);
		this.schedByMint.clear();
		this.listenersByMint.clear();
		this.proofQueueByMint.clear();
		this.proofSetByMint.clear();
		this.yToSubsByMint.clear();
		this.subToYsByMint.clear();
		this.intervalByMint.clear();
		this.unsubscribedByMint.clear();
	}
	closeMint(mintUrl) {
		mintUrl = normalizeMintUrl(mintUrl);
		const scheduler = this.schedByMint.get(mintUrl);
		if (scheduler) this.clearTimer(scheduler);
		this.schedByMint.delete(mintUrl);
		this.listenersByMint.delete(mintUrl);
		this.proofQueueByMint.delete(mintUrl);
		this.proofSetByMint.delete(mintUrl);
		this.yToSubsByMint.delete(mintUrl);
		this.subToYsByMint.delete(mintUrl);
		this.intervalByMint.delete(mintUrl);
		this.unsubscribedByMint.delete(mintUrl);
	}
	pause() {
		this.paused = true;
		for (const scheduler of this.schedByMint.values()) this.clearTimer(scheduler);
	}
	resume() {
		this.paused = false;
		for (const mintUrl of this.schedByMint.keys()) this.maybeRun(mintUrl);
	}
	/**
	* Set a custom polling interval for a specific mint.
	* If not set, the default interval from constructor options is used.
	*/
	setIntervalForMint(mintUrl, intervalMs) {
		this.intervalByMint.set(normalizeMintUrl(mintUrl), intervalMs);
	}
	/**
	* Get the polling interval for a mint (per-mint or default).
	*/
	getIntervalForMint(mintUrl) {
		return this.intervalByMint.get(mintUrl) ?? this.options.intervalMs;
	}
	isSupportedPollingKind(kind) {
		return typeof kind === "string" && SUPPORTED_POLLING_KINDS.has(kind);
	}
	ensureScheduler(mintUrl) {
		let s = this.schedByMint.get(mintUrl);
		if (!s) {
			s = {
				nextAllowedAt: 0,
				queue: [],
				running: false,
				hasProofBatchTask: false
			};
			this.schedByMint.set(mintUrl, s);
			if (!this.proofQueueByMint.get(mintUrl)) this.proofQueueByMint.set(mintUrl, []);
			if (!this.proofSetByMint.get(mintUrl)) this.proofSetByMint.set(mintUrl, /* @__PURE__ */ new Set());
			if (!this.yToSubsByMint.get(mintUrl)) this.yToSubsByMint.set(mintUrl, /* @__PURE__ */ new Map());
			if (!this.subToYsByMint.get(mintUrl)) this.subToYsByMint.set(mintUrl, /* @__PURE__ */ new Map());
		}
		return s;
	}
	clearTimer(scheduler) {
		if (scheduler.timer === void 0) return;
		clearTimeout(scheduler.timer);
		scheduler.timer = void 0;
	}
	scheduleNext(mintUrl, scheduler) {
		this.clearTimer(scheduler);
		if (this.paused || this.schedByMint.get(mintUrl) !== scheduler || scheduler.running || scheduler.queue.length === 0) return;
		const timer = setTimeout(() => {
			if (this.schedByMint.get(mintUrl) !== scheduler || scheduler.timer !== timer) return;
			scheduler.timer = void 0;
			this.maybeRun(mintUrl);
		}, Math.max(0, scheduler.nextAllowedAt - Date.now()));
		scheduler.timer = timer;
	}
	async maybeRun(mintUrl) {
		if (this.paused) return;
		const s = this.schedByMint.get(mintUrl);
		if (!s || s.running) return;
		this.clearTimer(s);
		if (s.queue.length === 0) return;
		if (Date.now() < s.nextAllowedAt) {
			this.scheduleNext(mintUrl, s);
			return;
		}
		s.running = true;
		const task = s.queue.shift();
		let opportunity = [task];
		try {
			opportunity = await this.selectOpportunity(mintUrl, task, s);
			await this.performOpportunity(mintUrl, opportunity);
			this.requeueOpportunity(mintUrl, s, opportunity);
		} catch (err) {
			this.logger?.error("Polling task error", {
				mintUrl,
				err
			});
			if (this.getMintQuoteMethod(task.kind) && this.mintQuotePolling) this.requeueOpportunity(mintUrl, s, opportunity);
		} finally {
			s.nextAllowedAt = Date.now() + this.getIntervalForMint(mintUrl);
			s.running = false;
			this.scheduleNext(mintUrl, s);
		}
	}
	async selectOpportunity(mintUrl, first, scheduler) {
		const method = this.getMintQuoteMethod(first.kind);
		if (!method || !this.mintQuotePolling || !first.filter) return [first];
		const advertisedLimit = await this.mintQuotePolling.getMintQuotePollingLimit(mintUrl, method);
		const limit = Math.max(1, Math.min(100, Math.floor(advertisedLimit)));
		if (limit === 1) return [first];
		const selected = [first];
		const selectedQuoteIds = new Set([first.filter]);
		const remaining = [];
		for (const candidate of scheduler.queue) {
			const isCompatible = candidate.kind === first.kind && candidate.filter !== void 0;
			if (isCompatible && selectedQuoteIds.has(candidate.filter) || isCompatible && selectedQuoteIds.size < limit) {
				selected.push(candidate);
				selectedQuoteIds.add(candidate.filter);
			} else remaining.push(candidate);
		}
		scheduler.queue = remaining;
		return selected;
	}
	requeueOpportunity(mintUrl, scheduler, opportunity) {
		const unsubscribed = this.unsubscribedByMint.get(mintUrl);
		const removedSubIds = /* @__PURE__ */ new Set();
		for (const task of opportunity) if (task.subId && unsubscribed?.has(task.subId)) removedSubIds.add(task.subId);
		else scheduler.queue.push(task);
		for (const subId of removedSubIds) unsubscribed?.delete(subId);
	}
	getMintQuoteMethod(kind) {
		return MINT_QUOTE_METHOD_BY_KIND[kind];
	}
	async performOpportunity(mintUrl, opportunity) {
		const first = opportunity[0];
		const method = this.getMintQuoteMethod(first.kind);
		if (!method || !this.mintQuotePolling) {
			await this.performTask(mintUrl, first);
			return;
		}
		const quoteIds = Array.from(new Set(opportunity.map(({ filter }) => filter).filter((filter) => filter !== void 0)));
		const result = await this.mintQuotePolling.checkMintQuotesForPolling(method, quoteIds.map((quoteId) => ({
			mintUrl,
			quoteId
		})));
		const outcomesByQuoteId = new Map(result.outcomes.map((outcome) => [outcome.identity.quoteId, outcome]));
		const unsubscribed = this.unsubscribedByMint.get(mintUrl);
		for (const task of opportunity) {
			if (!task.subId || !task.filter || unsubscribed?.has(task.subId)) continue;
			const outcome = outcomesByQuoteId.get(task.filter);
			if (outcome?.status !== "updated" || outcome.quote.method !== method) continue;
			const payload = mintQuoteToMethodSnapshot(outcome.quote);
			this.emitNormalizedNotification(mintUrl, task.subId, payload);
		}
	}
	async performTask(mintUrl, task) {
		if (task.kind === "proof_state" && task.batch) {
			const yToSubs = this.yToSubsByMint.get(mintUrl) ?? /* @__PURE__ */ new Map();
			const queue = this.proofQueueByMint.get(mintUrl) ?? [];
			if (queue.length === 0 || yToSubs.size === 0) return;
			const selected = [];
			const selectedSet = /* @__PURE__ */ new Set();
			let remaining = queue.length;
			while (selected.length < 100 && remaining > 0 && queue.length > 0) {
				remaining--;
				const y = queue.shift();
				const subs = yToSubs.get(y);
				if (subs && subs.size > 0 && !selectedSet.has(y)) {
					selected.push(y);
					selectedSet.add(y);
					queue.push(y);
				} else if (subs && subs.size > 0) continue;
				else {
					const set = this.proofSetByMint.get(mintUrl);
					if (set) set.delete(y);
				}
			}
			if (selected.length === 0) return;
			const results = await this.mintAdapter.checkProofStates(mintUrl, selected);
			for (let i = 0; i < results.length; i++) {
				const payload = results[i];
				const y = (payload && typeof payload.Y === "string" ? payload.Y : void 0) ?? selected[i] ?? "";
				if (!y) continue;
				const subs = yToSubs.get(y);
				if (!subs) continue;
				for (const subId of subs.values()) this.emitNormalizedNotification(mintUrl, subId, payload);
			}
			return;
		}
		let payload;
		switch (task.kind) {
			case "bolt11_mint_quote":
				payload = await this.mintAdapter.checkMintQuote(mintUrl, "bolt11", task.filter);
				break;
			case "onchain_mint_quote":
				payload = await this.mintAdapter.checkMintQuote(mintUrl, "onchain", task.filter);
				break;
			case "bolt12_mint_quote":
				payload = await this.mintAdapter.checkMintQuote(mintUrl, "bolt12", task.filter);
				break;
			case "bolt11_melt_quote":
				payload = await this.mintAdapter.checkMeltQuoteState(mintUrl, task.filter);
				break;
			case "bolt12_melt_quote":
				payload = await this.mintAdapter.checkMeltQuoteBolt12State(mintUrl, task.filter);
				break;
			case "onchain_melt_quote":
				payload = await this.mintAdapter.checkMeltQuoteOnchain(mintUrl, task.filter);
				break;
			default: throw new Error(`Unsupported polling task kind: ${String(task.kind)}`);
		}
		this.emitNormalizedNotification(mintUrl, task.subId, payload);
	}
	emitNormalizedNotification(mintUrl, subId, payload) {
		const notification = {
			jsonrpc: "2.0",
			method: "subscribe",
			params: {
				subId,
				payload
			}
		};
		this.emit(mintUrl, "message", {
			data: JSON.stringify(notification),
			normalizedPayload: payload
		});
	}
	emit(mintUrl, event, evt) {
		const set = this.listenersByMint.get(mintUrl)?.get(event);
		if (!set) return;
		for (const handler of set.values()) try {
			handler(evt);
		} catch {}
	}
};

//#endregion
//#region infra/WsConnectionManager.ts
var WsConnectionManager = class {
	sockets = /* @__PURE__ */ new Map();
	isOpenByMint = /* @__PURE__ */ new Map();
	sendQueueByMint = /* @__PURE__ */ new Map();
	logger;
	listenersByMint = /* @__PURE__ */ new Map();
	reconnectAttemptsByMint = /* @__PURE__ */ new Map();
	reconnectTimeoutByMint = /* @__PURE__ */ new Map();
	options;
	paused = false;
	constructor(wsFactory, logger, options) {
		this.wsFactory = wsFactory;
		this.logger = logger;
		this.options = { disableReconnect: options?.disableReconnect ?? false };
	}
	buildWsUrl(baseMintUrl) {
		const url = new URL(baseMintUrl);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		url.pathname = `${url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname}/v1/ws`;
		return url.toString();
	}
	ensureSocket(mintUrl) {
		const existing = this.sockets.get(mintUrl);
		if (existing) return existing;
		const wsUrl = this.buildWsUrl(mintUrl);
		const socket = this.wsFactory(wsUrl);
		this.sockets.set(mintUrl, socket);
		this.isOpenByMint.set(mintUrl, false);
		const onOpen = () => {
			this.isOpenByMint.set(mintUrl, true);
			const pending = this.reconnectTimeoutByMint.get(mintUrl);
			if (pending) {
				clearTimeout(pending);
				this.reconnectTimeoutByMint.delete(mintUrl);
			}
			this.reconnectAttemptsByMint.delete(mintUrl);
			const queue = this.sendQueueByMint.get(mintUrl);
			if (queue && queue.length > 0) {
				this.logger?.debug("Flushing queued messages", {
					mintUrl,
					count: queue.length
				});
				for (const payload of queue) try {
					socket.send(payload);
					this.logger?.debug("Sent queued message", {
						mintUrl,
						payloadLength: payload.length
					});
				} catch (err) {
					this.logger?.error("WS send error while flushing queue", {
						mintUrl,
						err
					});
				}
				this.sendQueueByMint.set(mintUrl, []);
			}
			this.logger?.info("WS opened", { mintUrl });
		};
		const onError = (err) => {
			this.logger?.error("WS error", {
				mintUrl,
				err
			});
		};
		const onClose = () => {
			this.logger?.info("WS closed", { mintUrl });
			this.sockets.delete(mintUrl);
			this.isOpenByMint.set(mintUrl, false);
			this.sendQueueByMint.delete(mintUrl);
			if (!this.paused && !this.options.disableReconnect) {
				const hasListeners = this.listenersByMint.get(mintUrl);
				if (hasListeners && Array.from(hasListeners.values()).some((s) => s.size > 0)) this.scheduleReconnect(mintUrl);
			}
		};
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		const map = this.listenersByMint.get(mintUrl);
		if (map) for (const [type, set] of map.entries()) for (const listener of set.values()) socket.addEventListener(type, listener);
		return socket;
	}
	scheduleReconnect(mintUrl) {
		if (this.reconnectTimeoutByMint.get(mintUrl)) return;
		const attempt = (this.reconnectAttemptsByMint.get(mintUrl) ?? 0) + 1;
		this.reconnectAttemptsByMint.set(mintUrl, attempt);
		const delayMs = Math.min(3e4, 1e3 * 2 ** Math.min(6, attempt - 1));
		this.logger?.info("Scheduling WS reconnect", {
			mintUrl,
			attempt,
			delayMs
		});
		const timeoutId = setTimeout(() => {
			this.reconnectTimeoutByMint.delete(mintUrl);
			try {
				this.ensureSocket(mintUrl);
			} catch (err) {
				this.logger?.error("WS reconnect attempt failed to create socket", {
					mintUrl,
					err
				});
			}
		}, delayMs);
		this.reconnectTimeoutByMint.set(mintUrl, timeoutId);
	}
	on(mintUrl, type, listener) {
		const socketExists = this.sockets.has(mintUrl);
		let map = this.listenersByMint.get(mintUrl);
		if (!map) {
			map = /* @__PURE__ */ new Map();
			this.listenersByMint.set(mintUrl, map);
		}
		let set = map.get(type);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			map.set(type, set);
		}
		if (set.has(listener)) return;
		set.add(listener);
		const socket = this.ensureSocket(mintUrl);
		if (socketExists) socket.addEventListener(type, listener);
	}
	off(mintUrl, type, listener) {
		this.ensureSocket(mintUrl).removeEventListener(type, listener);
		(this.listenersByMint.get(mintUrl)?.get(type))?.delete(listener);
	}
	send(mintUrl, message) {
		const socket = this.ensureSocket(mintUrl);
		const payload = typeof message === "string" ? message : JSON.stringify(message);
		if (this.isOpenByMint.get(mintUrl)) {
			try {
				socket.send(payload);
				this.logger?.debug("Sent message immediately (socket open)", {
					mintUrl,
					payloadLength: payload.length
				});
			} catch (err) {
				this.logger?.error("WS send error", {
					mintUrl,
					err
				});
			}
			return;
		}
		let queue = this.sendQueueByMint.get(mintUrl);
		if (!queue) {
			queue = [];
			this.sendQueueByMint.set(mintUrl, queue);
		}
		queue.push(payload);
		this.logger?.debug("Queued message (socket not open)", {
			mintUrl,
			queueLength: queue.length,
			payloadLength: payload.length
		});
	}
	closeAll() {
		for (const [mintUrl, socket] of this.sockets.entries()) try {
			socket.close(1e3, "Normal Closure");
		} catch (err) {
			this.logger?.warn("Error while closing WS", {
				mintUrl,
				err
			});
		}
		this.sockets.clear();
		this.isOpenByMint.clear();
		this.sendQueueByMint.clear();
		for (const timeout of this.reconnectTimeoutByMint.values()) clearTimeout(timeout);
		this.reconnectTimeoutByMint.clear();
		this.reconnectAttemptsByMint.clear();
	}
	closeMint(mintUrl) {
		const socket = this.sockets.get(mintUrl);
		if (socket) {
			try {
				socket.close(1e3, "Mint closed");
				this.logger?.debug("WS closed for mint", { mintUrl });
			} catch (err) {
				this.logger?.warn("Error while closing WS for mint", {
					mintUrl,
					err
				});
			}
			this.sockets.delete(mintUrl);
		}
		this.isOpenByMint.delete(mintUrl);
		this.sendQueueByMint.delete(mintUrl);
		this.listenersByMint.delete(mintUrl);
		const timeout = this.reconnectTimeoutByMint.get(mintUrl);
		if (timeout) {
			clearTimeout(timeout);
			this.reconnectTimeoutByMint.delete(mintUrl);
		}
		this.reconnectAttemptsByMint.delete(mintUrl);
		this.logger?.info("WsConnectionManager closed mint", { mintUrl });
	}
	pause() {
		this.paused = true;
		for (const timeout of this.reconnectTimeoutByMint.values()) clearTimeout(timeout);
		this.reconnectTimeoutByMint.clear();
		this.reconnectAttemptsByMint.clear();
		for (const [mintUrl, socket] of this.sockets.entries()) try {
			socket.close(1e3, "Paused");
			this.logger?.debug("WS closed for pause", { mintUrl });
		} catch (err) {
			this.logger?.warn("Error while closing WS for pause", {
				mintUrl,
				err
			});
		}
		this.sockets.clear();
		this.isOpenByMint.clear();
		this.sendQueueByMint.clear();
		this.logger?.info("WsConnectionManager paused");
	}
	resume() {
		this.paused = false;
		for (const [mintUrl, listenerMap] of this.listenersByMint.entries()) if (Array.from(listenerMap.values()).some((s) => s.size > 0)) try {
			this.ensureSocket(mintUrl);
			this.logger?.debug("WS reconnecting after resume", { mintUrl });
		} catch (err) {
			this.logger?.error("Failed to reconnect WS after resume", {
				mintUrl,
				err
			});
		}
		this.logger?.info("WsConnectionManager resumed");
	}
};

//#endregion
//#region infra/WsTransport.ts
var WsTransport = class {
	ws;
	constructor(wsFactoryOrManager, logger, options) {
		this.ws = typeof wsFactoryOrManager === "function" ? new WsConnectionManager(wsFactoryOrManager, logger, options) : wsFactoryOrManager;
	}
	on(mintUrl, event, handler) {
		this.ws.on(mintUrl, event, handler);
	}
	send(mintUrl, req) {
		this.ws.send(mintUrl, req);
	}
	closeAll() {
		this.ws.closeAll();
	}
	closeMint(mintUrl) {
		this.ws.closeMint(mintUrl);
	}
	pause() {
		this.ws.pause();
	}
	resume() {
		this.ws.resume();
	}
};

//#endregion
//#region infra/HybridTransport.ts
/**
* HybridTransport runs both WebSocket and polling transports in parallel.
*
* - WebSocket: Primary transport for real-time updates. One-shot per mint—no reconnection on failure.
* - Polling: Backup transport always running. Starts slow (20s), speeds up (5s) if WS fails.
* - Deduplication: Both transports emit the same notifications, so we deduplicate at this layer.
*/
var HybridTransport = class {
	wsTransport;
	pollingTransport;
	logger;
	options;
	wsFailedByMint = /* @__PURE__ */ new Set();
	wsConnectedByMint = /* @__PURE__ */ new Set();
	hasInternalHandlersByMint = /* @__PURE__ */ new Set();
	lastNotificationSignatureByKey = /* @__PURE__ */ new Map();
	hasEmittedOpenByMint = /* @__PURE__ */ new Set();
	paused = false;
	constructor(wsFactory, mintAdapter, options, logger, mintQuotePolling) {
		this.logger = logger;
		this.options = {
			slowPollingIntervalMs: options?.slowPollingIntervalMs ?? 2e4,
			fastPollingIntervalMs: options?.fastPollingIntervalMs ?? 5e3
		};
		this.wsTransport = new WsTransport(wsFactory, logger, { disableReconnect: true });
		this.pollingTransport = new PollingTransport(mintAdapter, { intervalMs: this.options.slowPollingIntervalMs }, logger, mintQuotePolling);
	}
	on(mintUrl, event, handler) {
		const wrappedHandler = this.createDedupeHandler(mintUrl, event, handler);
		this.wsTransport.on(mintUrl, event, wrappedHandler);
		this.pollingTransport.on(mintUrl, event, wrappedHandler);
		this.ensureInternalHandlers(mintUrl);
	}
	send(mintUrl, req) {
		this.wsTransport.send(mintUrl, req);
		this.pollingTransport.send(mintUrl, req);
	}
	closeAll() {
		this.wsTransport.closeAll();
		this.pollingTransport.closeAll();
		this.wsFailedByMint.clear();
		this.wsConnectedByMint.clear();
		this.hasInternalHandlersByMint.clear();
		this.lastNotificationSignatureByKey.clear();
		this.hasEmittedOpenByMint.clear();
	}
	closeMint(mintUrl) {
		this.wsTransport.closeMint(mintUrl);
		this.pollingTransport.closeMint(mintUrl);
		this.wsFailedByMint.delete(mintUrl);
		this.wsConnectedByMint.delete(mintUrl);
		this.hasInternalHandlersByMint.delete(mintUrl);
		this.hasEmittedOpenByMint.delete(mintUrl);
		for (const key of this.lastNotificationSignatureByKey.keys()) if (key.startsWith(`${mintUrl}::`)) this.lastNotificationSignatureByKey.delete(key);
	}
	pause() {
		this.paused = true;
		this.wsTransport.pause();
		this.pollingTransport.pause();
		this.wsFailedByMint.clear();
		this.wsConnectedByMint.clear();
		this.hasEmittedOpenByMint.clear();
	}
	resume() {
		this.paused = false;
		this.wsTransport.resume();
		this.pollingTransport.resume();
	}
	/**
	* Register internal handlers on WsTransport to track connection state.
	* Only registers once per mint.
	*/
	ensureInternalHandlers(mintUrl) {
		if (this.hasInternalHandlersByMint.has(mintUrl)) return;
		this.hasInternalHandlersByMint.add(mintUrl);
		this.wsTransport.on(mintUrl, "open", () => {
			this.wsConnectedByMint.add(mintUrl);
		});
		this.wsTransport.on(mintUrl, "close", () => {
			this.handleWsFailure(mintUrl);
		});
	}
	/**
	* Handle WS failure - mark as failed and speed up polling.
	*/
	handleWsFailure(mintUrl) {
		if (this.paused) return;
		if (this.wsFailedByMint.has(mintUrl)) return;
		this.wsFailedByMint.add(mintUrl);
		this.updatePollingInterval(mintUrl);
		this.logger?.info("HybridTransport: WS failed, polling will compensate", { mintUrl });
	}
	/**
	* Speed up polling for a mint after WS failure.
	*/
	updatePollingInterval(mintUrl) {
		this.pollingTransport.setIntervalForMint(mintUrl, this.options.fastPollingIntervalMs);
	}
	/**
	* Create a handler wrapper that deduplicates events.
	*/
	createDedupeHandler(mintUrl, event, originalHandler) {
		return (evt) => {
			if (event === "open") {
				if (this.hasEmittedOpenByMint.has(mintUrl)) return;
				this.hasEmittedOpenByMint.add(mintUrl);
				originalHandler(evt);
				return;
			}
			if (event === "close" || event === "error") {
				originalHandler(evt);
				return;
			}
			try {
				const data = typeof evt.data === "string" ? evt.data : evt.data?.toString?.();
				if (!data) {
					originalHandler(evt);
					return;
				}
				const parsed = JSON.parse(data);
				if (parsed.method !== "subscribe") {
					originalHandler(evt);
					return;
				}
				const signature = this.getNotificationSignature(parsed.params?.payload);
				if (signature === void 0) {
					originalHandler(evt);
					return;
				}
				const key = this.getStateKey(mintUrl, parsed);
				if (this.lastNotificationSignatureByKey.get(key) === signature) return;
				this.lastNotificationSignatureByKey.set(key, signature);
				originalHandler(evt);
			} catch {
				originalHandler(evt);
			}
		};
	}
	/**
	* Generate a deduplication key for a notification.
	* Includes mintUrl, subId, and identifier (Y for proofs, quote for quotes).
	*/
	getStateKey(mintUrl, notification) {
		const subId = notification.params?.subId ?? "";
		const payload = notification.params?.payload;
		return `${mintUrl}::${subId}::${payload?.Y ?? payload?.quote ?? ""}`;
	}
	getNotificationSignature(payload) {
		if (!payload) return void 0;
		const expirySignature = this.getExpirySignature(payload);
		if (payload.amount_paid !== void 0 && payload.amount_issued !== void 0) try {
			return `${Amount$1.from(payload.amount_paid).toString()}:${Amount$1.from(payload.amount_issued).toString()}:${expirySignature}`;
		} catch {
			return;
		}
		if (payload.state !== void 0) return `${JSON.stringify(payload.state)}:${expirySignature}`;
	}
	getExpirySignature(payload) {
		if (typeof payload.expiry !== "number" || payload.expiry === 0) return "no-expiry";
		return String(payload.expiry);
	}
};

//#endregion
//#region infra/SubscriptionManager.ts
var SubscriptionManager = class {
	nextIdByMint = /* @__PURE__ */ new Map();
	subscriptions = /* @__PURE__ */ new Map();
	activeByMint = /* @__PURE__ */ new Map();
	pendingSubscribeByMint = /* @__PURE__ */ new Map();
	transportByMint = /* @__PURE__ */ new Map();
	logger;
	messageHandlerByMint = /* @__PURE__ */ new Map();
	openHandlerByMint = /* @__PURE__ */ new Map();
	hasOpenedByMint = /* @__PURE__ */ new Map();
	wsFactory;
	mintAdapter;
	mintQuotePolling;
	options;
	paused = false;
	constructor(wsFactoryOrManager, mintAdapter, logger, options, mintQuotePolling) {
		this.logger = logger;
		this.mintAdapter = mintAdapter;
		this.mintQuotePolling = mintQuotePolling;
		this.options = {
			slowPollingIntervalMs: options?.slowPollingIntervalMs ?? 2e4,
			fastPollingIntervalMs: options?.fastPollingIntervalMs ?? 5e3
		};
		if (typeof wsFactoryOrManager === "function") this.wsFactory = wsFactoryOrManager;
		else {
			const injected = wsFactoryOrManager;
			this.transportByMint.set("*", injected);
		}
	}
	/**
	* Get or create a transport for a mint.
	*
	* Uses HybridTransport (WS + polling in parallel) when a wsFactory is available.
	* HybridTransport handles WS failures gracefully by speeding up polling, so we
	* don't need to check mint capabilities or WebSocket availability upfront.
	*
	* Falls back to pure PollingTransport only when no wsFactory is provided.
	*/
	getTransport(mintUrl) {
		const injected = this.transportByMint.get("*");
		if (injected) return injected;
		let t = this.transportByMint.get(mintUrl);
		if (t) return t;
		if (this.wsFactory) t = new HybridTransport(this.wsFactory, this.mintAdapter, {
			slowPollingIntervalMs: this.options.slowPollingIntervalMs,
			fastPollingIntervalMs: this.options.fastPollingIntervalMs
		}, this.logger, this.mintQuotePolling);
		else t = new PollingTransport(this.mintAdapter, { intervalMs: this.options.fastPollingIntervalMs }, this.logger, this.mintQuotePolling);
		this.transportByMint.set(mintUrl, t);
		return t;
	}
	getNextId(mintUrl) {
		const next = (this.nextIdByMint.get(mintUrl) ?? 0) + 1;
		this.nextIdByMint.set(mintUrl, next);
		return next;
	}
	ensureMessageListener(mintUrl) {
		if (this.messageHandlerByMint.has(mintUrl)) return;
		const handler = (evt) => {
			try {
				const data = typeof evt.data === "string" ? evt.data : evt.data?.toString?.();
				if (!data) return;
				const parsed = JSON.parse(data);
				this.logger?.debug("Received WS message", {
					mintUrl,
					hasMethod: "method" in parsed,
					method: "method" in parsed ? parsed.method : void 0,
					hasId: "id" in parsed,
					id: "id" in parsed ? parsed.id : void 0,
					hasResult: "result" in parsed,
					hasError: "error" in parsed
				});
				if ("method" in parsed && parsed.method === "subscribe") {
					const subId = parsed.params?.subId;
					const active = subId ? this.subscriptions.get(subId) : void 0;
					if (active && subId) this.deliverSubscriptionPayload(mintUrl, subId, active, parsed.params.payload, evt.normalizedPayload);
				} else if ("error" in parsed && parsed.error) {
					const resp = parsed;
					const respId = Number(resp.id);
					const err = resp.error;
					const pendingMap = this.pendingSubscribeByMint.get(mintUrl);
					const maybeSubId = Number.isFinite(respId) && pendingMap ? pendingMap.get(respId) : void 0;
					if (maybeSubId) {
						pendingMap?.delete(respId);
						this.logger?.error("Subscribe request rejected", {
							mintUrl,
							id: resp.id,
							subId: maybeSubId,
							code: err.code,
							message: err.message
						});
					} else this.logger?.error("WS request error", {
						mintUrl,
						id: resp.id,
						code: err.code,
						message: err.message
					});
				} else if ("result" in parsed && parsed.result) {
					const resp = parsed;
					const respId = Number(resp.id);
					const pendingMap = this.pendingSubscribeByMint.get(mintUrl);
					if (Number.isFinite(respId) && pendingMap && pendingMap.has(respId)) {
						const subId = pendingMap.get(respId);
						pendingMap.delete(respId);
						this.logger?.info("Subscribe request accepted", {
							mintUrl,
							id: resp.id,
							subId: subId || resp.result?.subId
						});
					} else this.logger?.debug("Unmatched subscribe response", {
						mintUrl,
						id: resp.id,
						respId,
						hasPendingMap: !!pendingMap,
						pendingMapSize: pendingMap?.size ?? 0
					});
				}
			} catch (err) {
				this.logger?.error("WS message handling error", {
					mintUrl,
					err
				});
			}
		};
		this.getTransport(mintUrl).on(mintUrl, "message", handler);
		this.messageHandlerByMint.set(mintUrl, handler);
		const onOpen = (_evt) => {
			try {
				if (this.hasOpenedByMint.get(mintUrl) === true) {
					this.logger?.info("WS open detected, re-subscribing active subscriptions", { mintUrl });
					this.reSubscribeMint(mintUrl);
				} else {
					this.hasOpenedByMint.set(mintUrl, true);
					this.logger?.info("WS open detected, initial open - skipping re-subscribe", { mintUrl });
				}
			} catch (err) {
				this.logger?.error("Failed to handle open event", {
					mintUrl,
					err
				});
			}
		};
		this.getTransport(mintUrl).on(mintUrl, "open", onOpen);
		this.openHandlerByMint.set(mintUrl, onOpen);
	}
	async deliverSubscriptionPayload(mintUrl, subId, active, payload, normalizedPayload) {
		let deliveredPayload = payload;
		if (active.kind === "bolt11_mint_quote" && normalizedPayload !== void 0) deliveredPayload = normalizedPayload;
		else if (active.kind === "bolt11_mint_quote") {
			const quoteId = payload && typeof payload === "object" && typeof payload.quote === "string" ? payload.quote : void 0;
			if (!quoteId) return;
			try {
				deliveredPayload = await this.mintAdapter.checkMintQuote(mintUrl, "bolt11", quoteId);
			} catch (err) {
				this.logger?.error("Failed to normalize BOLT11 mint quote subscription payload", {
					mintUrl,
					quoteId,
					err
				});
				return;
			}
		}
		if (this.subscriptions.get(subId) !== active) return;
		for (const cb of active.callbacks) try {
			Promise.resolve(cb(deliveredPayload)).catch((err) => this.logger?.error("Subscription callback error", {
				mintUrl,
				subId,
				err
			}));
		} catch (err) {
			this.logger?.error("Subscription callback error", {
				mintUrl,
				subId,
				err
			});
		}
	}
	async subscribe(mintUrl, kind, filters, onNotification) {
		if (!filters || filters.length === 0) throw new Error("filters must be a non-empty array");
		this.ensureMessageListener(mintUrl);
		const filtersKey = JSON.stringify([...filters].sort());
		for (const [existingSubId, existingSub] of this.subscriptions.entries()) if (existingSub.mintUrl === mintUrl && existingSub.kind === kind && JSON.stringify([...existingSub.filters].sort()) === filtersKey) {
			if (onNotification) {
				existingSub.callbacks.add(onNotification);
				this.logger?.debug("Reusing existing subscription", {
					mintUrl,
					kind,
					subId: existingSubId,
					filterCount: filters.length
				});
			}
			return {
				subId: existingSubId,
				unsubscribe: async () => {
					if (onNotification) this.removeCallback(existingSubId, onNotification);
					if (existingSub.callbacks.size === 0) await this.unsubscribe(mintUrl, existingSubId);
				}
			};
		}
		const id = this.getNextId(mintUrl);
		const subId = generateSubId();
		const req = {
			jsonrpc: "2.0",
			method: "subscribe",
			params: {
				kind,
				subId,
				filters
			},
			id
		};
		const active = {
			subId,
			mintUrl,
			kind,
			filters,
			callbacks: /* @__PURE__ */ new Set()
		};
		if (onNotification) active.callbacks.add(onNotification);
		this.subscriptions.set(subId, active);
		let set = this.activeByMint.get(mintUrl);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			this.activeByMint.set(mintUrl, set);
		}
		set.add(subId);
		let pendingById = this.pendingSubscribeByMint.get(mintUrl);
		if (!pendingById) {
			pendingById = /* @__PURE__ */ new Map();
			this.pendingSubscribeByMint.set(mintUrl, pendingById);
		}
		pendingById.set(id, subId);
		if (this.paused) {
			this.logger?.info("Subscription created while paused, will activate on resume", {
				mintUrl,
				kind,
				subId
			});
			return {
				subId,
				unsubscribe: async () => {
					await this.unsubscribe(mintUrl, subId);
				}
			};
		}
		const t = this.getTransport(mintUrl);
		this.logger?.debug("Sending subscribe request", {
			mintUrl,
			kind,
			subId,
			id,
			filterCount: filters.length
		});
		t.send(mintUrl, req);
		this.logger?.info("Subscribed to NUT-17", {
			mintUrl,
			kind,
			subId,
			filterCount: filters.length
		});
		return {
			subId,
			unsubscribe: async () => {
				await this.unsubscribe(mintUrl, subId);
			}
		};
	}
	addCallback(subId, cb) {
		const active = this.subscriptions.get(subId);
		if (!active) throw new Error("Subscription not found");
		active.callbacks.add(cb);
	}
	removeCallback(subId, cb) {
		const active = this.subscriptions.get(subId);
		if (!active) return;
		active.callbacks.delete(cb);
	}
	async unsubscribe(mintUrl, subId) {
		this.logger?.debug("SubscriptionManager: unsubscribe called", {
			mintUrl,
			subId,
			hasSubscription: this.subscriptions.has(subId),
			activeForMint: this.activeByMint.get(mintUrl)?.size ?? 0
		});
		const id = this.getNextId(mintUrl);
		const req = {
			jsonrpc: "2.0",
			method: "unsubscribe",
			params: { subId },
			id
		};
		const t = this.getTransport(mintUrl);
		this.logger?.debug("SubscriptionManager: sending unsubscribe to transport", {
			mintUrl,
			subId,
			requestId: id
		});
		t.send(mintUrl, req);
		this.subscriptions.delete(subId);
		const set = this.activeByMint.get(mintUrl);
		set?.delete(subId);
		this.logger?.info("Unsubscribed from NUT-17", {
			mintUrl,
			subId,
			remainingSubscriptions: this.subscriptions.size,
			remainingActiveForMint: set?.size ?? 0
		});
	}
	closeAll() {
		const seen = /* @__PURE__ */ new Set();
		for (const t of this.transportByMint.values()) {
			if (seen.has(t)) continue;
			seen.add(t);
			t.closeAll();
		}
		this.subscriptions.clear();
		this.activeByMint.clear();
		this.pendingSubscribeByMint.clear();
		const injectedTransport = this.transportByMint.get("*");
		this.transportByMint.clear();
		if (injectedTransport) this.transportByMint.set("*", injectedTransport);
		this.nextIdByMint.clear();
		this.messageHandlerByMint.clear();
		this.openHandlerByMint.clear();
		this.hasOpenedByMint.clear();
	}
	closeMint(mintUrl) {
		this.logger?.info("Closing all subscriptions for mint", { mintUrl });
		const subIds = this.activeByMint.get(mintUrl);
		if (subIds) for (const subId of subIds) this.subscriptions.delete(subId);
		this.activeByMint.delete(mintUrl);
		this.pendingSubscribeByMint.delete(mintUrl);
		this.nextIdByMint.delete(mintUrl);
		this.messageHandlerByMint.delete(mintUrl);
		this.openHandlerByMint.delete(mintUrl);
		this.hasOpenedByMint.delete(mintUrl);
		const transport = this.transportByMint.get(mintUrl);
		if (transport) {
			transport.closeMint(mintUrl);
			this.transportByMint.delete(mintUrl);
		}
		this.logger?.info("SubscriptionManager closed mint", { mintUrl });
	}
	reSubscribeMint(mintUrl) {
		const set = this.activeByMint.get(mintUrl);
		if (!set || set.size === 0) return;
		for (const subId of set) {
			const active = this.subscriptions.get(subId);
			if (!active) continue;
			const id = this.getNextId(mintUrl);
			const req = {
				jsonrpc: "2.0",
				method: "subscribe",
				params: {
					kind: active.kind,
					subId: active.subId,
					filters: active.filters
				},
				id
			};
			let pendingById = this.pendingSubscribeByMint.get(mintUrl);
			if (!pendingById) {
				pendingById = /* @__PURE__ */ new Map();
				this.pendingSubscribeByMint.set(mintUrl, pendingById);
			}
			pendingById.set(id, subId);
			this.getTransport(mintUrl).send(mintUrl, req);
			this.logger?.info("Re-subscribed to NUT-17 after reconnect", {
				mintUrl,
				kind: active.kind,
				subId: active.subId,
				filterCount: active.filters.length
			});
		}
	}
	pause() {
		this.paused = true;
		const seen = /* @__PURE__ */ new Set();
		for (const t of this.transportByMint.values()) {
			if (seen.has(t)) continue;
			seen.add(t);
			t.pause();
		}
		this.logger?.info("SubscriptionManager paused");
	}
	resume() {
		this.paused = false;
		const seen = /* @__PURE__ */ new Set();
		for (const t of this.transportByMint.values()) {
			if (seen.has(t)) continue;
			seen.add(t);
			t.resume();
		}
		this.logger?.info("SubscriptionManager resumed");
	}
};

//#endregion
//#region infra/handlers/melt/MeltHandlerProvider.ts
/**
* Runtime registry for melt method handlers.
* Keeps wiring concerns out of the core melt domain.
*/
var MeltHandlerProvider = class {
	registry = {};
	constructor(initialHandlers) {
		if (initialHandlers) this.registerMany(initialHandlers);
	}
	register(method, handler) {
		this.set(method, handler);
	}
	registerMany(handlers) {
		for (const method of Object.keys(handlers)) {
			const handler = handlers[method];
			if (handler) this.set(method, handler);
		}
	}
	get(method) {
		const handler = this.registry[method];
		if (!handler) throw new Error(`No melt handler registered for method ${method}`);
		return handler;
	}
	getAll() {
		return this.registry;
	}
	set(method, handler) {
		this.registry[method] = handler;
	}
};

//#endregion
//#region infra/handlers/melt/QuoteMeltHandler.utils.ts
/**
* If the selected proof amount exceeds the required amount by this ratio (10%),
* we perform a swap first to get exact-amount proofs. This avoids sending
* significantly more value to the mint than needed, which could result in
* larger change amounts and potential privacy/fee implications.
*
* Example: If we need 100 sats but selected proofs total 115 sats,
* that's 1.15x (15% over) which exceeds 11/10, so we swap first.
*/
const SWAP_THRESHOLD_NUMERATOR = 11;
const SWAP_THRESHOLD_DENOMINATOR = 10;
/**
* Extract the send proof secrets from serialized swap output data.
* These are the secrets of proofs that were created during the swap
* and will be used as melt inputs.
*/
function getSwapSendSecrets(swapOutputData) {
	return deserializeOutputData(swapOutputData).send.map((o) => new TextDecoder().decode(o.secret));
}
/**
* Build a PAID execution result.
* Used when the melt completed successfully.
*/
function buildPaidResult(operation, finalizeResult) {
	return {
		status: "PAID",
		finalized: {
			...operation,
			state: "finalized",
			updatedAt: Date.now(),
			...finalizeResult
		}
	};
}
/**
* Build a PENDING execution result.
* Used when the melt is in-flight and awaiting confirmation.
*/
function buildPendingResult(operation) {
	return {
		status: "PENDING",
		pending: {
			...operation,
			state: "pending",
			updatedAt: Date.now()
		}
	};
}
/**
* Build a FAILED execution result with optional error message.
* Used when the melt failed and proofs need recovery.
*/
function buildFailedResult(operation, error) {
	return {
		status: "FAILED",
		failed: {
			...operation,
			state: "failed",
			updatedAt: Date.now(),
			error
		}
	};
}

//#endregion
//#region infra/handlers/melt/BaseQuoteMeltHandler.ts
var BaseQuoteMeltHandler = class {
	async createQuote(ctx) {
		return this.toCanonicalQuote(ctx.mintUrl, await this.createRemoteQuote(ctx));
	}
	async fetchRemoteQuote(ctx) {
		return this.toCanonicalQuote(ctx.quote.mintUrl, await this.fetchRemoteMeltQuote(ctx));
	}
	toCanonicalQuote(mintUrl, quote) {
		switch (this.method) {
			case "bolt11": return meltQuoteFromBolt11Response(mintUrl, quote);
			case "bolt12": return meltQuoteFromBolt12Response(mintUrl, quote);
			case "onchain": return meltQuoteFromOnchainResponse(mintUrl, quote);
			default: throw new Error(`Unsupported melt method ${String(this.method)}`);
		}
	}
	/**
	* Calculate change amount and effective fee from melt operation results.
	* These values are derived from the actual melt settlement, not from the quote.
	*
	* changeAmount: Sum of amounts from change proofs returned by the mint
	* effectiveFee: Actual fee paid = meltInputAmount - amount - changeAmount
	*/
	calculateSettlementAmounts(meltInputAmount, meltAmount, changeProofs) {
		const changeAmount = Amount$1.sum(changeProofs?.map((p) => p.amount) ?? []);
		return {
			changeAmount,
			effectiveFee: meltInputAmount.subtract(meltAmount).subtract(changeAmount)
		};
	}
	getPersistedSettlementResponse(quote) {
		if (!quote || quote.state !== "PAID") return null;
		if (!Array.isArray(quote.change)) return null;
		const change = quote.change;
		if (quote.method === "onchain") return {
			state: quote.state,
			change,
			outpoint: quote.outpoint ?? null
		};
		return {
			state: quote.state,
			change,
			payment_preimage: quote.payment_preimage ?? null
		};
	}
	/**
	* Returns the amount of proofs that were actually sent to the melt call.
	* For swap melts this excludes proofs kept locally after the pre-swap.
	*/
	getMeltInputAmount(operation) {
		if (!operation.needsSwap) return operation.inputAmount;
		if (!operation.swapOutputData) throw new Error("Swap was required but swapOutputData is missing");
		return OutputData.sumOutputAmounts(deserializeOutputData(operation.swapOutputData).send);
	}
	/**
	* Prepare a bolt-backed melt operation.
	*
	* This method:
	* 1. Uses the canonical melt quote supplied by the quote lifecycle
	* 2. Selects proofs to cover the quote amount + fee reserve with input fees
	* 3. Determines if a pre-swap is needed (when selected amount >> required)
	* 4. Reserves the input proofs for this operation
	* 5. Creates blank outputs for receiving change
	*
	* @returns Prepared operation ready for execution
	*/
	async prepare(ctx) {
		const { mintUrl, id: operationId } = ctx.operation;
		ctx.logger?.debug(`Preparing ${this.method} melt operation`, {
			operationId,
			mintUrl
		});
		const quote = ctx.quote;
		assertSameUnit(quote.unit, ctx.operation.unit, `Melt quote ${quote.quote}`);
		const { amount } = quote;
		const fee_reserve = this.getFeeReserveForQuote(quote, ctx.operation);
		const quoteData = {
			quote: quote.quote,
			amount,
			fee_reserve,
			unit: quote.unit
		};
		const totalAmount = amount.add(fee_reserve);
		ctx.logger?.debug("Melt quote created", {
			operationId,
			quoteId: quote.quote,
			amount,
			fee_reserve,
			totalAmount
		});
		const selectedProofs = await ctx.proofService.selectProofsToSend(mintUrl, {
			amount: totalAmount,
			unit: ctx.operation.unit
		}, true);
		const selectedAmount = sumProofs(selectedProofs);
		if (selectedAmount.lessThan(totalAmount)) throw new ProofValidationError("Melt amount is not sufficient after fees");
		const swapThreshold = totalAmount.scaledBy(SWAP_THRESHOLD_NUMERATOR, SWAP_THRESHOLD_DENOMINATOR);
		const needsSwap = selectedAmount.greaterThanOrEqual(swapThreshold);
		ctx.logger?.debug("Proofs selected for melt", {
			operationId,
			selectedAmount,
			swapThreshold,
			proofCount: selectedProofs.length,
			needsSwap
		});
		if (!needsSwap) return this.prepareDirectMelt(ctx, quoteData, selectedProofs);
		return this.prepareSwapThenMelt(ctx, quoteData, totalAmount);
	}
	/**
	* Prepare a direct melt (no swap needed).
	* Used when selected proofs are close to the required amount.
	*/
	async prepareDirectMelt(ctx, quote, selectedProofs) {
		const { mintUrl, id: operationId } = ctx.operation;
		const { amount, fee_reserve } = quote;
		const inputSecrets = selectedProofs.map((p) => p.secret);
		const selectedAmount = sumProofs(selectedProofs);
		ctx.logger?.debug("Preparing direct melt (no swap)", {
			operationId,
			selectedAmount
		});
		await ctx.proofService.reserveProofs(mintUrl, inputSecrets, operationId, { unit: ctx.operation.unit });
		const blankOutputs = await this.createChangeOutputs(amount, selectedAmount, ctx);
		ctx.logger?.info("Direct melt prepared", {
			operationId,
			quoteId: quote.quote,
			amount,
			fee_reserve,
			inputAmount: selectedAmount
		});
		return {
			...ctx.operation,
			...ctx.operation.methodData,
			quoteId: quote.quote,
			unit: ctx.operation.unit,
			changeOutputData: serializeOutputData({
				keep: blankOutputs,
				send: []
			}),
			needsSwap: false,
			amount,
			fee_reserve,
			inputAmount: selectedAmount,
			inputProofSecrets: inputSecrets,
			swap_fee: Amount$1.zero(),
			state: "prepared"
		};
	}
	/**
	* Prepare a swap-then-melt operation.
	* Used when selected proofs significantly exceed the required amount.
	*/
	async prepareSwapThenMelt(ctx, quote, totalAmount) {
		const { mintUrl, id: operationId } = ctx.operation;
		const { amount, fee_reserve } = quote;
		ctx.logger?.debug("Preparing swap-then-melt", {
			operationId,
			totalAmount
		});
		const selectedProofs = await ctx.proofService.selectProofsToSend(mintUrl, {
			amount: totalAmount,
			unit: ctx.operation.unit
		}, true);
		const selectedAmount = sumProofs(selectedProofs);
		const inputSecrets = selectedProofs.map((p) => p.secret);
		const swapFee = ctx.wallet.getFeesForProofs(selectedProofs);
		const sendAmount = totalAmount;
		const requiredAmount = sendAmount.add(swapFee);
		if (selectedAmount.lessThan(requiredAmount)) throw new ProofValidationError("Melt amount is not sufficient after fees");
		const keepAmount = selectedAmount.subtract(requiredAmount);
		ctx.logger?.debug("Swap amounts calculated", {
			operationId,
			selectedAmount,
			sendAmount,
			keepAmount,
			swapFee
		});
		await ctx.proofService.reserveProofs(mintUrl, inputSecrets, operationId, { unit: ctx.operation.unit });
		const blankOutputs = await this.createChangeOutputs(amount, sendAmount, ctx);
		const swapOutputData = await ctx.proofService.createOutputsAndIncrementCounters(mintUrl, {
			keep: {
				amount: keepAmount,
				unit: ctx.operation.unit
			},
			send: {
				amount: sendAmount,
				unit: ctx.operation.unit
			}
		}, { includeFees: true });
		ctx.logger?.info("Swap-then-melt prepared", {
			operationId,
			quoteId: quote.quote,
			amount,
			fee_reserve,
			inputAmount: selectedAmount,
			swapFee
		});
		return {
			...ctx.operation,
			...ctx.operation.methodData,
			quoteId: quote.quote,
			unit: ctx.operation.unit,
			swapOutputData: serializeOutputData(swapOutputData),
			changeOutputData: serializeOutputData({
				keep: blankOutputs,
				send: []
			}),
			needsSwap: true,
			swap_fee: swapFee,
			amount,
			fee_reserve,
			inputAmount: selectedAmount,
			inputProofSecrets: inputSecrets,
			state: "prepared"
		};
	}
	/**
	* Create blank outputs to receive change from the melt operation.
	* The change is the difference between what we send and the quote amount.
	*/
	async createChangeOutputs(quoteAmount, sendAmount, ctx) {
		const changeDelta = sendAmount.subtract(quoteAmount);
		return ctx.proofService.createBlankOutputs(ctx.operation.mintUrl, {
			amount: changeDelta,
			unit: ctx.operation.unit
		});
	}
	/**
	* Execute the bolt11 melt operation.
	*
	* This method:
	* 1. Retrieves the reserved input proofs
	* 2. If swap is needed, performs the swap first to get exact-amount proofs
	* 3. Sends the melt request to the mint
	* 4. Handles the response (PAID → finalize, PENDING → wait, UNPAID → restore proofs)
	*/
	async execute(ctx) {
		const { quoteId, mintUrl, changeOutputData: serializedChangeOutputData, id: operationId } = ctx.operation;
		ctx.logger?.debug(`Executing ${this.method} melt`, {
			operationId,
			quoteId,
			needsSwap: ctx.operation.needsSwap
		});
		const inputProofs = await this.getInputProofs(ctx);
		const proofsToMelt = ctx.operation.needsSwap ? await this.executeSwap(ctx, inputProofs) : inputProofs;
		if (!ctx.operation.needsSwap) await ctx.proofService.setProofState(mintUrl, ctx.operation.inputProofSecrets, "inflight");
		ctx.logger?.debug("Sending melt request to mint", {
			operationId,
			quoteId,
			proofCount: proofsToMelt.length
		});
		const changeOutputData = deserializeOutputData(serializedChangeOutputData);
		const res = await this.executeMelt(ctx, proofsToMelt, changeOutputData.keep, quoteId);
		ctx.logger?.info("Melt execution completed", {
			operationId,
			quoteId,
			state: res.state
		});
		return this.handleMeltResponse(ctx, res, proofsToMelt);
	}
	/**
	* Handle the melt response and return the appropriate execution result.
	*/
	async handleMeltResponse(ctx, response, proofsToMelt) {
		const { mintUrl } = ctx.operation;
		const { state, change } = response;
		switch (state) {
			case "PAID": {
				const { amount: meltAmount } = ctx.operation;
				const meltInputAmount = this.getMeltInputAmount(ctx.operation);
				const { changeAmount, effectiveFee } = this.calculateSettlementAmounts(meltInputAmount, meltAmount, change);
				await this.finalizeOperation(ctx, change);
				return buildPaidResult(ctx.operation, {
					changeAmount,
					effectiveFee,
					finalizedData: this.buildFinalizedData(response)
				});
			}
			case "PENDING": return buildPendingResult(ctx.operation);
			case "UNPAID":
				await ctx.proofService.restoreProofsToReady(mintUrl, proofsToMelt.map((p) => p.secret));
				return buildFailedResult(ctx.operation);
			default: throw new Error(`Unexpected melt response state: ${state} for quote ${ctx.operation.quoteId}`);
		}
	}
	/**
	* Retrieve the input proofs reserved for this operation.
	*/
	async getInputProofs(ctx) {
		const { mintUrl, id: operationId } = ctx.operation;
		const proofs = await ctx.proofRepository.getProofsByOperationId(mintUrl, operationId);
		if (proofs.length !== ctx.operation.inputProofSecrets.length) throw new Error("Could not find all input proofs");
		return proofs;
	}
	/**
	* Execute the pre-melt swap to get exact-amount proofs.
	* Returns the "send" proofs from the swap which will be used for the melt.
	*/
	async executeSwap(ctx, inputProofs) {
		const { swapOutputData, inputProofSecrets, id: operationId, mintUrl } = ctx.operation;
		if (!swapOutputData) throw new Error("Swap is required, but swap output data is missing");
		const swapData = deserializeOutputData(swapOutputData);
		const sendAmount = OutputData.sumOutputAmounts(swapData.send);
		const { wallet } = await ctx.walletService.getWalletWithActiveKeysetId(mintUrl, ctx.operation.unit);
		ctx.logger?.debug("Executing pre-melt swap", {
			operationId,
			sendAmount,
			inputProofCount: inputProofs.length
		});
		await ctx.proofService.setProofState(mintUrl, inputProofSecrets, "inflight");
		const outputConfig = {
			send: {
				type: "custom",
				data: swapData.send
			},
			keep: {
				type: "custom",
				data: swapData.keep
			}
		};
		const { send, keep } = await wallet.send(sendAmount, inputProofs, void 0, outputConfig);
		await ctx.proofService.setProofState(mintUrl, inputProofSecrets, "spent");
		const newProofs = [...mapProofToCoreProof(mintUrl, "ready", keep, {
			unit: ctx.operation.unit,
			createdByOperationId: operationId
		}), ...mapProofToCoreProof(mintUrl, "inflight", send, {
			unit: ctx.operation.unit,
			createdByOperationId: operationId
		})];
		await ctx.proofService.saveProofs(mintUrl, newProofs);
		ctx.logger?.debug("Pre-melt swap completed", {
			operationId,
			keepCount: keep.length,
			sendCount: send.length
		});
		return send;
	}
	/**
	* Finalize a pending melt operation that has succeeded.
	* Called by MeltOperationService when checkPending returns 'finalize'.
	* Returns settlement amounts for accurate accounting.
	*/
	async finalize(ctx) {
		const { quoteId, id: operationId, amount: meltAmount } = ctx.operation;
		ctx.logger?.debug("Finalizing pending melt operation", {
			operationId,
			quoteId
		});
		const persistedSettlement = this.getPersistedSettlementResponse(ctx.canonicalQuote);
		if (ctx.canonicalQuote && ctx.canonicalQuote.state !== "PAID") throw new Error(`Cannot finalize: melt quote ${quoteId} is ${ctx.canonicalQuote.state}, expected PAID`);
		const res = persistedSettlement ?? await this.checkMeltQuote(ctx);
		if (res.state !== "PAID") throw new Error(`Cannot finalize: melt quote ${quoteId} is ${res.state}, expected PAID`);
		const meltInputAmount = this.getMeltInputAmount(ctx.operation);
		const { changeAmount, effectiveFee } = this.calculateSettlementAmounts(meltInputAmount, meltAmount, res.change);
		await this.finalizeOperation(ctx, res.change);
		ctx.logger?.info("Pending melt operation finalized with settlement amounts", {
			operationId,
			quoteId,
			changeAmount,
			effectiveFee
		});
		return {
			changeAmount,
			effectiveFee,
			finalizedData: this.buildFinalizedData(res)
		};
	}
	/**
	* Finalize a melt operation by marking input proofs as spent and saving change proofs.
	* Called immediately when melt returns PAID, or later when a pending melt succeeds.
	*/
	async finalizeOperation(ctx, change) {
		const { mintUrl, id: operationId, changeOutputData: serializedChangeOutputData } = ctx.operation;
		const meltInputSecrets = this.getMeltInputSecrets(ctx.operation);
		await ctx.proofService.setProofState(mintUrl, meltInputSecrets, "spent");
		if (change && change.length > 0) {
			const changeOutputData = deserializeOutputData(serializedChangeOutputData).keep;
			await ctx.proofService.unblindAndSaveChangeProofs(mintUrl, changeOutputData, change, {
				unit: ctx.operation.unit,
				createdByOperationId: operationId
			});
		}
		ctx.logger?.info("Melt operation finalized", {
			operationId,
			spentProofCount: meltInputSecrets.length,
			changeProofCount: change?.length ?? 0
		});
	}
	/**
	* Check the state of a pending melt operation.
	* Returns 'finalize' if paid, 'stay_pending' if still pending, 'rollback' if unpaid/failed.
	*/
	async checkPending(ctx) {
		const { quoteId, id: operationId } = ctx.operation;
		ctx.logger?.debug("Checking pending melt operation", {
			operationId,
			quoteId
		});
		const state = ctx.canonicalQuote?.state ?? await this.checkMeltQuoteState(ctx);
		ctx.logger?.debug("Pending melt quote state", {
			operationId,
			quoteId,
			state
		});
		switch (state) {
			case "PAID": return "finalize";
			case "PENDING": return "stay_pending";
			case "UNPAID": return "rollback";
			default: throw new Error(`Unexpected melt quote state: ${state} for quote ${quoteId}`);
		}
	}
	/**
	* Rollback a melt operation by restoring input proofs to ready state.
	*/
	async rollback(ctx) {
		const { id: operationId, mintUrl, needsSwap } = ctx.operation;
		ctx.logger?.debug(`Rolling back ${this.method} melt operation`, {
			operationId,
			needsSwap
		});
		if (needsSwap) {
			const swapSendSecrets = getSwapSendSecrets(ctx.operation.swapOutputData);
			await ctx.proofService.restoreProofsToReady(mintUrl, swapSendSecrets);
			await ctx.proofService.releaseProofs(mintUrl, ctx.operation.inputProofSecrets);
		} else await ctx.proofService.restoreProofsToReady(mintUrl, ctx.operation.inputProofSecrets);
		ctx.logger?.info("Melt operation rolled back, proofs restored", {
			operationId,
			needsSwap,
			proofCount: ctx.operation.inputProofSecrets.length
		});
	}
	/**
	* Recover an executing operation after a crash/restart.
	*
	* Recovery logic:
	* - PAID: Finalize the operation (mark proofs spent, save change)
	* - PENDING: Transition to pending state for continued monitoring
	* - UNPAID: Determine what happened and restore/recover proofs appropriately
	*   - If no swap was needed or swap never happened: release original proofs
	*   - If swap happened and proofs exist locally: restore them to ready
	*   - If swap happened but proofs missing: recover from mint
	*/
	async recoverExecuting(ctx) {
		const { operation } = ctx;
		const { quoteId, needsSwap, id: operationId } = operation;
		ctx.logger?.debug(`Recovering executing ${this.method} melt operation`, {
			operationId,
			quoteId,
			needsSwap
		});
		let state;
		try {
			state = await this.checkMeltQuoteState(ctx);
		} catch (err) {
			if (err instanceof MintOperationError && err.code === 20007) {
				ctx.logger?.info("Melt quote expired during recovery, treating as UNPAID", {
					operationId,
					quoteId
				});
				return this.recoverExecutingUnpaidOperation(ctx);
			}
			throw err;
		}
		ctx.logger?.debug("Melt quote state checked during recovery", {
			operationId,
			quoteId,
			state
		});
		switch (state) {
			case "PAID": return this.recoverExecutingPaidOperation(ctx);
			case "PENDING": return this.recoverExecutingPendingOperation(ctx);
			case "UNPAID": return this.recoverExecutingUnpaidOperation(ctx);
			default: throw new Error(`Unexpected melt response state: ${state} for quote ${quoteId}`);
		}
	}
	/**
	* Recover an executing operation that was actually paid.
	* Fetches change signatures and finalizes the operation.
	* Returns execution result with actual settlement amounts.
	*/
	async recoverExecutingPaidOperation(ctx) {
		const { quoteId, id: operationId, amount: meltAmount } = ctx.operation;
		ctx.logger?.debug("Recovering executing operation as paid, fetching change", {
			operationId,
			quoteId
		});
		const res = await this.checkMeltQuote(ctx);
		const meltInputAmount = this.getMeltInputAmount(ctx.operation);
		const { changeAmount, effectiveFee } = this.calculateSettlementAmounts(meltInputAmount, meltAmount, res.change);
		await this.finalizeOperation(ctx, res.change);
		ctx.logger?.info("Recovered and finalized paid melt operation", {
			operationId,
			quoteId,
			changeAmount,
			effectiveFee
		});
		return buildPaidResult(ctx.operation, {
			changeAmount,
			effectiveFee,
			finalizedData: this.buildFinalizedData(res)
		});
	}
	/**
	* Recover an executing operation that is now pending.
	* Transitions to pending state for continued monitoring.
	*/
	async recoverExecutingPendingOperation(ctx) {
		ctx.logger?.info("Recovered executing operation as pending", {
			operationId: ctx.operation.id,
			quoteId: ctx.operation.quoteId
		});
		return buildPendingResult(ctx.operation);
	}
	/**
	* Recover an executing operation that is unpaid.
	* Determines the appropriate recovery path based on whether a swap occurred.
	*/
	async recoverExecutingUnpaidOperation(ctx) {
		const { needsSwap, id: operationId } = ctx.operation;
		if (!needsSwap || !await this.checkSwapHappened(ctx)) {
			ctx.logger?.debug("Unpaid quote recovery: no swap occurred", { operationId });
			return this.recoverExecutingWithoutSwap(ctx);
		}
		ctx.logger?.debug("Unpaid quote recovery: swap occurred, checking local proofs", { operationId });
		const localSwapProofs = await this.findLocalSwapSendProofs(ctx);
		if (localSwapProofs.length > 0) return this.recoverExecutingWithLocalSwapProofs(ctx, localSwapProofs);
		return this.recoverExecutingSwapProofsFromMint(ctx);
	}
	/**
	* Recover when swap happened and proofs exist locally.
	* Restores the swap send proofs to ready state.
	*/
	async recoverExecutingWithLocalSwapProofs(ctx, swapSendProofs) {
		const { operation } = ctx;
		const { mintUrl, id: operationId } = operation;
		const swappedSecrets = swapSendProofs.map((p) => p.secret);
		await ctx.proofService.restoreProofsToReady(mintUrl, swappedSecrets);
		ctx.logger?.info("Recovered swap proofs, melt failed", {
			operationId,
			recoveredProofCount: swapSendProofs.length
		});
		return buildFailedResult(operation, "Recovered: Swap happened but melt failed / never executed");
	}
	/**
	* Recover when swap happened but proofs weren't saved locally.
	* This can happen if the app crashed after the swap but before saving proofs.
	* Recovers proofs from the mint using the swap output data.
	*/
	async recoverExecutingSwapProofsFromMint(ctx) {
		const { operation } = ctx;
		const { swapOutputData, id: operationId, mintUrl } = operation;
		if (!swapOutputData) throw new Error("Swap was required but swapOutputData is missing");
		ctx.logger?.debug("Swap proofs not found locally, recovering from mint", { operationId });
		await ctx.proofService.recoverProofsFromOutputData(mintUrl, swapOutputData, {
			unit: operation.unit,
			createdByOperationId: operationId
		});
		try {
			await ctx.proofService.setProofState(mintUrl, operation.inputProofSecrets, "spent");
		} catch {
			ctx.logger?.warn("Failed to mark input proofs as spent", { operationId });
		}
		ctx.logger?.info("Recovered proofs from mint after swap", { operationId });
		return buildFailedResult(operation, "Recovered: Swap happened, proofs restored from mint");
	}
	/**
	* Recover when no swap occurred - restore original proofs to ready.
	*/
	async recoverExecutingWithoutSwap(ctx) {
		const { operation } = ctx;
		const { mintUrl, inputProofSecrets, id: operationId } = operation;
		await ctx.proofService.restoreProofsToReady(mintUrl, inputProofSecrets);
		ctx.logger?.info("Restored proofs after failed melt (no swap occurred)", {
			operationId,
			proofCount: inputProofSecrets.length
		});
		return buildFailedResult(operation, "Recovered: Swap never executed, released original proofs");
	}
	/**
	* Check if the swap was executed by verifying if input proofs are spent.
	*/
	async checkSwapHappened(ctx) {
		const { operation, mintAdapter } = ctx;
		const { inputProofSecrets, mintUrl } = operation;
		const Ys = computeYHexForSecrets(inputProofSecrets);
		return (await mintAdapter.checkProofStates(mintUrl, Ys)).some((proofState) => proofState.state === "SPENT");
	}
	/**
	* Find swap send proofs that were saved locally during the swap.
	* Returns empty array if proofs don't exist (crash before save).
	*/
	async findLocalSwapSendProofs(ctx) {
		const { swapOutputData, id: operationId, mintUrl } = ctx.operation;
		if (!swapOutputData) return [];
		const swapSendSecrets = getSwapSendSecrets(swapOutputData);
		return (await ctx.proofRepository.getProofsByOperationId(mintUrl, operationId)).filter((p) => swapSendSecrets.includes(p.secret));
	}
	/**
	* Get the secrets of proofs that were sent to the melt operation.
	* For direct melt: these are the original input proofs.
	* For swap-then-melt: these are the swap send proofs (derived from swapOutputData).
	*/
	getMeltInputSecrets(operation) {
		if (!operation.needsSwap) return operation.inputProofSecrets;
		if (!operation.swapOutputData) throw new Error("Swap was required but swapOutputData is missing");
		return getSwapSendSecrets(operation.swapOutputData);
	}
};

//#endregion
//#region infra/handlers/melt/MeltBolt11Handler.ts
var MeltBolt11Handler = class extends BaseQuoteMeltHandler {
	method = "bolt11";
	createRemoteQuote(ctx) {
		const amountMsat = ctx.methodData.amountSats === void 0 ? void 0 : ctx.methodData.amountSats.multiplyBy(1e3);
		return ctx.wallet.createMeltQuoteBolt11(ctx.methodData.invoice, amountMsat);
	}
	fetchRemoteMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuote(ctx.quote.mintUrl, ctx.quote.quoteId);
	}
	executeMelt(ctx, proofsToMelt, changeOutputs, quoteId) {
		return ctx.mintAdapter.customMeltBolt11(ctx.operation.mintUrl, proofsToMelt, changeOutputs, quoteId);
	}
	checkMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuote(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	checkMeltQuoteState(ctx) {
		return ctx.mintAdapter.checkMeltQuoteState(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	getFeeReserveForQuote(quote, _operation) {
		return quote.fee_reserve;
	}
	buildFinalizedData(response) {
		return response.payment_preimage == null ? void 0 : { preimage: response.payment_preimage };
	}
};

//#endregion
//#region infra/handlers/melt/MeltBolt12Handler.ts
var MeltBolt12Handler = class extends BaseQuoteMeltHandler {
	method = "bolt12";
	createRemoteQuote(ctx) {
		const amountMsat = ctx.methodData.amountSats === void 0 ? void 0 : ctx.methodData.amountSats.multiplyBy(1e3);
		return ctx.wallet.createMeltQuoteBolt12(ctx.methodData.offer, amountMsat);
	}
	fetchRemoteMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuoteBolt12(ctx.quote.mintUrl, ctx.quote.quoteId);
	}
	executeMelt(ctx, proofsToMelt, changeOutputs, quoteId) {
		return ctx.mintAdapter.customMeltBolt12(ctx.operation.mintUrl, proofsToMelt, changeOutputs, quoteId);
	}
	checkMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuoteBolt12(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	checkMeltQuoteState(ctx) {
		return ctx.mintAdapter.checkMeltQuoteBolt12State(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	getFeeReserveForQuote(quote, _operation) {
		return quote.fee_reserve;
	}
	buildFinalizedData(response) {
		return response.payment_preimage == null ? void 0 : { preimage: response.payment_preimage };
	}
};

//#endregion
//#region infra/handlers/melt/MeltOnchainHandler.ts
var MeltOnchainHandler = class extends BaseQuoteMeltHandler {
	method = "onchain";
	createRemoteQuote(ctx) {
		return ctx.wallet.createMeltQuoteOnchain(ctx.methodData.address, ctx.methodData.amountSats);
	}
	fetchRemoteMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuoteOnchain(ctx.quote.mintUrl, ctx.quote.quoteId);
	}
	executeMelt(ctx, proofsToMelt, changeOutputs, quoteId) {
		const feeIndex = ctx.operation.methodData.feeIndex;
		if (feeIndex === void 0) throw new Error(`Cannot execute onchain melt operation ${ctx.operation.id}: feeIndex missing`);
		return ctx.mintAdapter.customMeltOnchain(ctx.operation.mintUrl, proofsToMelt, changeOutputs, quoteId, feeIndex);
	}
	checkMeltQuote(ctx) {
		return ctx.mintAdapter.checkMeltQuoteOnchain(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	checkMeltQuoteState(ctx) {
		return ctx.mintAdapter.checkMeltQuoteOnchainState(ctx.operation.mintUrl, ctx.operation.quoteId);
	}
	getFeeReserveForQuote(quote, operation) {
		const feeIndex = operation.methodData.feeIndex;
		if (feeIndex === void 0) throw new Error(`Onchain melt operation ${operation.id} does not include feeIndex`);
		const feeOption = quote.fee_options.find((option) => option.fee_index === feeIndex);
		if (!feeOption) throw new Error(`Onchain melt quote ${quote.quote} does not include fee option ${feeIndex}`);
		return feeOption.fee_reserve;
	}
	buildFinalizedData(response) {
		return response.outpoint == null ? void 0 : { outpoint: response.outpoint };
	}
};

//#endregion
//#region infra/handlers/send/DefaultSendHandler.ts
/** Local policy for standard unlocked token sends. */
var DefaultSendHandler = class {
	canReclaim = true;
	prepare(ctx) {
		return { forceSwap: Boolean(ctx.operation.methodData.forceSwap) };
	}
};

//#endregion
//#region keypairs/P2pkSigner.ts
/** Canonical NUT-11 signer identity: lowercase x-coordinate without 02/03 parity. */
function canonicalP2pkKeyX(publicKey) {
	const normalized = publicKey.toLowerCase();
	const x = normalized.length === 66 && (normalized.startsWith("02") || normalized.startsWith("03")) ? normalized.slice(2) : normalized;
	if (!/^[0-9a-f]{64}$/.test(x)) throw new ProofValidationError("Invalid P2PK public key");
	try {
		secp256k1.Point.fromHex(`02${x}`);
	} catch {
		throw new ProofValidationError("Invalid P2PK public key");
	}
	return x;
}
/** Validate a NUT-11 condition key's compressed wire form before reducing it to x-only identity. */
function canonicalP2pkWireKeyX(publicKey) {
	const normalized = publicKey.toLowerCase();
	if (!/^[0-9a-f]{66}$/.test(normalized) || !normalized.startsWith("02") && !normalized.startsWith("03")) throw new ProofValidationError("P2PK condition key must be a compressed secp256k1 key");
	try {
		secp256k1.Point.fromHex(normalized);
	} catch {
		throw new ProofValidationError("P2PK condition key is not a valid secp256k1 point");
	}
	return normalized.slice(2);
}
var KeypairP2pkSigner = class {
	constructor(keys) {
		this.keys = keys;
	}
	async signProof(proof, publicKey) {
		if (!proof.secret || typeof proof.secret !== "string") throw new Error("Proof secret is required and must be a string");
		const requestedX = canonicalP2pkKeyX(publicKey);
		const keyPair = (await this.keys.getAllPersistedKeyPairs("p2pk")).find((candidate) => {
			try {
				return canonicalP2pkKeyX(candidate.publicKeyHex) === requestedX;
			} catch {
				return false;
			}
		});
		if (!keyPair) throw new ProofValidationError("No persisted refund authority matches the proof condition");
		if (bytesToHex(schnorr.getPublicKey(keyPair.secretKey)) !== requestedX) throw new ProofValidationError("Persisted refund authority does not match its private key");
		const signature = schnorr.sign(sha256(new TextEncoder().encode(proof.secret)), keyPair.secretKey);
		return {
			...proof,
			witness: JSON.stringify({ signatures: [bytesToHex(signature)] })
		};
	}
};

//#endregion
//#region operations/send/SendMethodHandler.ts
function resolveP2pkOptions(methodData) {
	if ("options" in methodData && methodData.options) {
		if (methodData.options.hashlock !== void 0) throw new ProofValidationError("P2PK send does not support hashlock/HTLC options");
		if ("kind" in methodData.options) {
			if (methodData.options.kind !== "P2PK") throw new ProofValidationError("P2PK send does not support hashlock/HTLC options");
			return methodData.options;
		}
		const [data, ...additionalPubkeys] = Array.isArray(methodData.options.pubkey) ? methodData.options.pubkey : [methodData.options.pubkey];
		if (!data) throw new ProofValidationError("P2PK send requires at least one lock pubkey");
		const { pubkey: _pubkey, hashlock: _hashlock, ...conditions } = methodData.options;
		return {
			kind: "P2PK",
			data,
			...conditions,
			...additionalPubkeys.length > 0 ? { pubkeys: additionalPubkeys } : {}
		};
	}
	if ("pubkey" in methodData && methodData.pubkey) return {
		kind: "P2PK",
		data: methodData.pubkey
	};
	throw new ProofValidationError("P2PK send requires P2PK options or a pubkey in methodData");
}

//#endregion
//#region infra/handlers/send/P2pkSendHandler.ts
/** Local output policy for tokens locked to a recipient's NUT-11 P2PK condition. */
var P2pkSendHandler = class {
	canReclaim = true;
	constructor(signer, nowSeconds = () => Math.floor(Date.now() / 1e3)) {
		this.signer = signer;
		this.nowSeconds = nowSeconds;
	}
	prepare(ctx) {
		const options = resolveP2pkOptions(ctx.operation.methodData);
		if (ctx.mintInfo.nuts?.["11"]?.supported !== true) throw new ProofValidationError(`NUT-11 support is required for P2PK send but is not advertised by mint ${ctx.operation.mintUrl}`);
		return {
			forceSwap: true,
			fixedSendOutputs: ctx.outputDataCreator.createP2PKData(options, ctx.operation.amount, ctx.activeKeys)
		};
	}
	async prepareReclaim(ctx) {
		if (!this.signer) throw new ProofValidationError("P2PK refund signer is unavailable");
		if (ctx.inputProofs.length === 0) throw new ProofValidationError("P2PK refund requires operation-owned proofs");
		const conditions = ctx.inputProofs.map((proof) => parseRefundCondition(proof));
		const expected = conditions[0];
		if (this.nowSeconds() <= expected.locktime) throw new ProofValidationError("P2PK refund locktime has not strictly expired");
		if (conditions.some((condition) => condition.fingerprint !== expected.fingerprint)) throw new ProofValidationError("P2PK refund proofs have heterogeneous conditions");
		const inputProofs = [];
		for (const proof of ctx.inputProofs) {
			const signed = await this.signer.signProof({
				...proof,
				witness: void 0
			}, expected.refundX);
			const signatures = getP2PKWitnessSignatures(signed.witness);
			if (signatures.length !== 1 || !schnorrVerifyMessage(signatures[0], proof.secret, expected.refundX)) throw new ProofValidationError("P2PK refund signer returned an invalid witness");
			inputProofs.push(signed);
		}
		return {
			inputProofs,
			spendingPath: "refund",
			conditionFingerprint: expected.fingerprint,
			refundPublicKeyX: expected.refundX
		};
	}
};
const ACCEPTED_TAGS = new Set([
	"locktime",
	"refund",
	"n_sigs",
	"n_sigs_refund",
	"sigflag"
]);
function parseRefundCondition(proof) {
	if (proof.p2pk_e !== void 0) throw new ProofValidationError("P2PK refund does not support blinded signer keys");
	let secret;
	try {
		secret = parseP2PKSecret(proof.secret);
	} catch {
		throw new ProofValidationError("Malformed P2PK refund condition");
	}
	if (secret[0] !== "P2PK") throw new ProofValidationError("Refund proof is not P2PK");
	const data = secret[1];
	const tags = data.tags ?? [];
	if (tags.some((tag) => !ACCEPTED_TAGS.has(tag[0] ?? ""))) throw new ProofValidationError("P2PK refund condition contains unsupported tags");
	const byName = new Map(tags.map((tag) => [tag[0], tag]));
	const exactScalar = (name) => {
		const tag = byName.get(name);
		if (!tag) return void 0;
		if (tag.length !== 2 || !tag[1]) throw new ProofValidationError(`Malformed P2PK ${name} tag`);
		return tag[1];
	};
	const locktimeRaw = exactScalar("locktime");
	const refundRaw = exactScalar("refund");
	if (!locktimeRaw || !refundRaw) throw new ProofValidationError("P2PK refund requires one locktime and one refund key");
	const locktime = Number(locktimeRaw);
	if (!Number.isSafeInteger(locktime) || locktime <= 0 || String(locktime) !== locktimeRaw) throw new ProofValidationError("P2PK refund locktime is invalid");
	if ((exactScalar("n_sigs") ?? "1") !== "1") throw new ProofValidationError("P2PK refund supports only n_sigs = 1");
	if ((exactScalar("n_sigs_refund") ?? "1") !== "1") throw new ProofValidationError("P2PK refund supports only n_sigs_refund = 1");
	if ((exactScalar("sigflag") ?? "SIG_INPUTS") !== "SIG_INPUTS") throw new ProofValidationError("P2PK refund supports only SIG_INPUTS");
	const recipientX = canonicalP2pkWireKeyX(data.data);
	const refundX = canonicalP2pkWireKeyX(refundRaw);
	if (recipientX === refundX) throw new ProofValidationError("P2PK recipient and refund keys must differ");
	const canonical = {
		version: 1,
		kind: "P2PK",
		recipientX,
		refundX,
		locktime,
		nSigs: 1,
		nSigsRefund: 1,
		sigflag: "SIG_INPUTS"
	};
	return {
		locktime,
		refundX,
		fingerprint: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(canonical))))
	};
}

//#endregion
//#region infra/handlers/mint/MintHandlerProvider.ts
/**
* Runtime registry for mint method handlers.
*/
var MintHandlerProvider = class {
	registry = {};
	constructor(initialHandlers) {
		if (initialHandlers) this.registerMany(initialHandlers);
	}
	register(method, handler) {
		this.set(method, handler);
	}
	registerMany(handlers) {
		for (const method of Object.keys(handlers)) {
			const handler = handlers[method];
			if (handler) this.set(method, handler);
		}
	}
	get(method) {
		const handler = this.registry[method];
		if (!handler) throw new Error(`No mint handler registered for method ${method}`);
		return handler;
	}
	getAll() {
		return this.registry;
	}
	set(method, handler) {
		this.registry[method] = handler;
	}
};

//#endregion
//#region infra/handlers/mint/MintBolt11Handler.ts
var MintBolt11Handler = class {
	constructor(keyRingService) {
		this.keyRingService = keyRingService;
	}
	async createQuote(ctx) {
		const { amount, locked, ownedPubkey } = ctx.createQuoteData;
		const shouldLock = locked === true || ownedPubkey !== void 0;
		if (shouldLock) await ctx.mintService.assertNutSupported(ctx.mintUrl, 20, "locked BOLT11 mint quote");
		const lockPubkey = shouldLock && !ownedPubkey ? (await this.keyRingService.generateMintQuoteKeyPair()).publicKeyHex : ownedPubkey;
		if (lockPubkey && ownedPubkey) await this.requireQuoteKey(lockPubkey);
		const remoteQuote = lockPubkey ? await ctx.wallet.createLockedMintQuote(amount.amount, lockPubkey) : await ctx.wallet.createMintQuoteBolt11(amount.amount);
		if (lockPubkey && remoteQuote.pubkey !== lockPubkey) throw new MintQuoteValidationError("Mint returned a BOLT11 quote with an unexpected NUT-20 public key");
		return mintQuoteFromBolt11Response(ctx.mintUrl, remoteQuote);
	}
	async fetchRemoteQuote(ctx) {
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(ctx.quote.mintUrl, "bolt11", ctx.quote.quoteId);
		return mintQuoteObservationFromBolt11Response(ctx.quote.mintUrl, remoteQuote);
	}
	async prepare(ctx) {
		const quote = ctx.importedQuote;
		if (!quote) throw new Error(`Mint quote ${ctx.operation.quoteId ?? "(missing)"} was not provided`);
		if (!quote.amount || quote.amount.isZero()) throw new MintQuoteValidationError(`Mint quote ${quote.quote} has invalid amount`);
		if (ctx.operation.quoteId !== quote.quote) throw new MintQuoteValidationError(`Mint quote ${quote.quote} does not match operation quote ${ctx.operation.quoteId}`);
		if (!quote.amount.equals(ctx.operation.amount)) throw new MintQuoteValidationError(`Mint quote ${quote.quote} amount ${quote.amount} does not match requested amount ${ctx.operation.amount}`);
		assertSameUnit(quote.unit, ctx.operation.unit, `Mint quote ${quote.quote}`);
		await this.requireQuoteKey(quote.pubkey);
		const outputData = await ctx.proofService.createOutputsAndIncrementCounters(ctx.operation.mintUrl, {
			keep: {
				amount: quote.amount,
				unit: ctx.operation.unit
			},
			send: {
				amount: Amount$1.zero(),
				unit: ctx.operation.unit
			}
		}, {});
		if (outputData.keep.length === 0) throw new Error("Failed to create deterministic outputs for mint operation");
		return {
			...ctx.operation,
			quoteId: quote.quote,
			amount: quote.amount,
			unit: ctx.operation.unit,
			request: quote.request,
			expiry: quote.expiry,
			pubkey: quote.pubkey,
			outputData: serializeOutputData({
				keep: outputData.keep,
				send: []
			}),
			state: "pending"
		};
	}
	async execute(ctx) {
		const outputData = deserializeOutputData(ctx.operation.outputData);
		const signingOptions = await this.getMintQuoteSigningOptions(ctx.operation.pubkey);
		try {
			return {
				status: "ISSUED",
				proofs: await ctx.wallet.mintProofsBolt11(ctx.operation.amount, ctx.operation.quoteId, signingOptions, {
					type: "custom",
					data: outputData.keep
				})
			};
		} catch (err) {
			if (err instanceof MintOperationError && err.code === 20002) return { status: "ALREADY_ISSUED" };
			if (ctx.operation.pubkey) {
				if (err instanceof MintOperationError) throw err;
				const message = `Locked BOLT11 mint failed: ${err instanceof Error ? err.message : String(err)}`;
				throw new Error(message, { cause: err });
			}
			throw err;
		}
	}
	async recoverExecuting(ctx) {
		const { mintUrl, quoteId } = ctx.operation;
		let remoteQuote;
		try {
			remoteQuote = await ctx.mintAdapter.checkMintQuote(mintUrl, "bolt11", quoteId);
		} catch (error) {
			ctx.logger?.warn("Failed to check mint quote state during recovery", {
				mintUrl,
				quoteId,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
		if ((ctx.operation.pubkey !== void 0 || remoteQuote.pubkey !== void 0) && remoteQuote.pubkey !== ctx.operation.pubkey) return {
			status: "PENDING",
			error: "Recovered BOLT11 mint operation has mismatched NUT-20 quote ownership"
		};
		const assessment = assessMintQuoteClaimability(mintQuoteObservationFromBolt11Response(mintUrl, remoteQuote), {
			...ctx.localClaimabilityFacts,
			requestedAmount: ctx.operation.amount
		});
		if (assessment.status === "invalid") return {
			status: "TERMINAL",
			error: `Recovered: quote ${quoteId} has invalid claimability accounting`
		};
		if (assessment.status === "waiting") return {
			status: "PENDING",
			error: `Recovered: quote ${quoteId} is not yet claimable`
		};
		if (assessment.status === "claimable") {
			const outputData = deserializeOutputData(ctx.operation.outputData);
			try {
				const signingOptions = await this.getMintQuoteSigningOptions(ctx.operation.pubkey);
				const proofs = await ctx.wallet.mintProofsBolt11(ctx.operation.amount, ctx.operation.quoteId, signingOptions, {
					type: "custom",
					data: outputData.keep
				});
				await ctx.proofService.saveProofs(ctx.operation.mintUrl, mapProofToCoreProof(ctx.operation.mintUrl, "ready", proofs, {
					unit: ctx.operation.unit,
					createdByOperationId: ctx.operation.id
				}));
				return { status: "FINALIZED" };
			} catch (err) {
				if (err instanceof MintOperationError) if (err.code === 20002) {} else if (err.code === 20007) return {
					status: "TERMINAL",
					error: `Recovered: quote ${quoteId} expired while executing mint`
				};
				else return {
					status: "PENDING",
					error: err.message
				};
				else return {
					status: "PENDING",
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		try {
			if ((await ctx.proofService.recoverProofsFromOutputData(ctx.operation.mintUrl, ctx.operation.outputData, {
				unit: ctx.operation.unit,
				createdByOperationId: ctx.operation.id
			})).length === 0) return {
				status: "PENDING",
				error: `Recovered: quote ${quoteId} issued remotely but proofs were not recoverable`
			};
			return { status: "FINALIZED" };
		} catch (error) {
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async checkPending(ctx) {
		const { mintUrl, quoteId } = ctx.operation;
		ctx.logger?.info("Checking pending mint operation", {
			mintUrl,
			quoteId
		});
		const quote = await ctx.mintAdapter.checkMintQuote(mintUrl, "bolt11", quoteId);
		const observedAt = Date.now();
		try {
			this.assertPendingQuoteMatchesOperation(quote, ctx.operation);
		} catch (error) {
			return {
				observedAt,
				validationFailure: {
					reason: error instanceof Error ? error.message : String(error),
					code: "invalid_quote",
					retryable: false,
					observedAt
				}
			};
		}
		return {
			observedAt,
			quoteSnapshot: quote
		};
	}
	async validateQuoteForPrepare(quote) {
		await this.requireQuoteKey(quote.pubkey);
	}
	assertPendingQuoteMatchesOperation(quote, operation) {
		if (quote.quote !== operation.quoteId || quote.request !== operation.request) throw new MintQuoteValidationError(`Polled BOLT11 mint quote ${quote.quote} conflicts with pending operation identity`);
		assertSameUnit(quote.unit, operation.unit, `Polled BOLT11 mint quote ${quote.quote}`);
		if (!Amount$1.from(quote.amount).equals(operation.amount)) throw new MintQuoteValidationError(`Polled BOLT11 mint quote ${quote.quote} conflicts with pending operation amount`);
		if ((quote.pubkey ?? void 0) !== (operation.pubkey ?? void 0)) throw new MintQuoteValidationError(`Polled BOLT11 mint quote ${quote.quote} conflicts with pending operation ownership`);
	}
	async requireQuoteKey(pubkey) {
		if (!pubkey) return;
		if (!await this.keyRingService.getMintQuoteKeyPair(pubkey)) throw new MintQuoteKeyError("Missing NUT-20 mint quote key for locked BOLT11 quote");
	}
	async getMintQuoteSigningOptions(pubkey) {
		if (!pubkey) return void 0;
		const key = await this.keyRingService.getMintQuoteKeyPair(pubkey);
		if (!key) throw new MintQuoteKeyError("Missing NUT-20 mint quote key for locked BOLT11 quote");
		return { privkey: bytesToHex(key.secretKey) };
	}
};

//#endregion
//#region infra/handlers/mint/ReusableMintQuoteValidation.ts
/**
* Returns a validation error when a reusable quote response is not attributable to an operation.
*/
function getReusableMintQuoteValidationError(quote, operation) {
	const identityLabel = operation.method === "bolt12" ? "BOLT12" : "onchain";
	const quoteLabel = operation.method === "bolt12" ? "BOLT12" : "Onchain";
	try {
		if (quote.quote !== operation.quoteId || quote.request !== operation.request) throw new MintQuoteValidationError(`Polled ${identityLabel} mint quote ${quote.quote} conflicts with pending operation identity`);
		assertSameUnit(quote.unit, operation.unit, `${quoteLabel} mint quote ${quote.quote}`);
		if (operation.pubkey !== void 0 && quote.pubkey !== operation.pubkey) throw new MintQuoteValidationError(`${quoteLabel} mint quote ${quote.quote} returned pubkey ${quote.pubkey} instead of requested pubkey ${operation.pubkey}`);
		return null;
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error), { cause: error });
	}
}

//#endregion
//#region infra/handlers/mint/MintOnchainHandler.ts
var MintOnchainHandler = class {
	constructor(keyRingService) {
		this.keyRingService = keyRingService;
	}
	async createQuote(ctx) {
		const quoteKey = await this.keyRingService.generateMintQuoteKeyPair();
		const remoteQuote = await this.createRemoteQuote(ctx.wallet, {
			pubkey: quoteKey.publicKeyHex,
			unit: ctx.createQuoteData.unit
		});
		this.assertQuoteMatchesRequest(remoteQuote, quoteKey.publicKeyHex, ctx.createQuoteData.unit);
		return mintQuoteFromOnchainResponse(ctx.mintUrl, remoteQuote);
	}
	async fetchRemoteQuote(ctx) {
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(ctx.quote.mintUrl, "onchain", ctx.quote.quoteId);
		this.assertQuoteMatchesRequest(remoteQuote, ctx.quote.quoteData.pubkey, ctx.quote.unit);
		return mintQuoteObservationFromOnchainResponse(ctx.quote.mintUrl, remoteQuote);
	}
	async validateQuoteForPrepare(quote) {
		await this.requireQuoteKey(quote.quoteData.pubkey);
	}
	async prepare(ctx) {
		const quote = ctx.importedQuote;
		if (!quote) throw new Error(`Mint quote ${ctx.operation.quoteId ?? "(missing)"} was not provided`);
		if (ctx.operation.quoteId !== quote.quote) throw new MintQuoteValidationError(`Mint quote ${quote.quote} does not match operation quote ${ctx.operation.quoteId}`);
		assertSameUnit(quote.unit, ctx.operation.unit, `Onchain mint quote ${quote.quote}`);
		await this.requireQuoteKey(quote.pubkey);
		const outputData = await ctx.proofService.createOutputsAndIncrementCounters(ctx.operation.mintUrl, {
			keep: {
				amount: ctx.operation.amount,
				unit: ctx.operation.unit
			},
			send: {
				amount: Amount$1.zero(),
				unit: ctx.operation.unit
			}
		}, {});
		if (outputData.keep.length === 0) throw new Error("Failed to create deterministic outputs for onchain mint operation");
		return {
			...ctx.operation,
			quoteId: quote.quote,
			request: quote.request,
			expiry: quote.expiry,
			pubkey: quote.pubkey,
			outputData: serializeOutputData({
				keep: outputData.keep,
				send: []
			}),
			state: "pending"
		};
	}
	async execute(ctx) {
		const quoteKey = await this.keyRingService.getMintQuoteKeyPair(ctx.operation.pubkey ?? "");
		if (!quoteKey) throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${ctx.operation.pubkey ?? "(missing)"}`);
		const outputData = deserializeOutputData(ctx.operation.outputData);
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(ctx.operation.mintUrl, "onchain", ctx.operation.quoteId);
		this.assertQuoteMatchesRequest(remoteQuote, ctx.operation.pubkey ?? "", ctx.operation.unit);
		const assessment = assessMintQuoteClaimability(mintQuoteObservationFromOnchainResponse(ctx.operation.mintUrl, remoteQuote), { requestedAmount: ctx.operation.amount });
		if (assessment.status === "invalid") throw new MintQuoteValidationError(`Onchain mint quote ${ctx.operation.quoteId} is not claimable: ${assessment.status}`);
		return {
			status: "ISSUED",
			proofs: await ctx.wallet.mintProofsOnchain(ctx.operation.amount, remoteQuote, bytesToHex(quoteKey.secretKey), void 0, {
				type: "custom",
				data: outputData.keep
			})
		};
	}
	async recoverExecuting(ctx) {
		const restored = await this.recoverSignedOutputs(ctx);
		if (restored) return restored;
		const { operation } = ctx;
		const expectedPubkey = operation.pubkey;
		if (!expectedPubkey) return {
			status: "TERMINAL",
			error: `Recovered: onchain mint operation ${operation.id} is missing NUT-20 quote pubkey`
		};
		let remoteQuote;
		try {
			remoteQuote = await ctx.mintAdapter.checkMintQuote(operation.mintUrl, "onchain", operation.quoteId);
		} catch (error) {
			ctx.logger?.warn("Failed to check onchain mint quote during recovery", {
				mintUrl: operation.mintUrl,
				quoteId: operation.quoteId,
				operationId: operation.id,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
		const validationError = this.getQuoteValidationError(remoteQuote, expectedPubkey, operation.unit);
		if (validationError) return {
			status: "TERMINAL",
			error: validationError.message
		};
		const quoteKey = await this.keyRingService.getMintQuoteKeyPair(expectedPubkey);
		if (!quoteKey) return {
			status: "TERMINAL",
			error: `Missing NUT-20 mint quote key for pubkey ${expectedPubkey}`
		};
		const assessment = assessMintQuoteClaimability(mintQuoteObservationFromOnchainResponse(operation.mintUrl, remoteQuote), {
			...ctx.localClaimabilityFacts,
			requestedAmount: operation.amount
		});
		if (assessment.status === "invalid") return {
			status: "TERMINAL",
			error: `Recovered: onchain quote ${operation.quoteId} has invalid claimability accounting`
		};
		if (assessment.status !== "claimable") return {
			status: "PENDING",
			error: `Recovered: onchain quote ${operation.quoteId} has ${assessment.remoteAvailable} remotely available, requested ${operation.amount}`
		};
		const outputData = deserializeOutputData(operation.outputData);
		try {
			const proofs = await ctx.wallet.mintProofsOnchain(operation.amount, remoteQuote, bytesToHex(quoteKey.secretKey), void 0, {
				type: "custom",
				data: outputData.keep
			});
			await ctx.proofService.saveProofs(operation.mintUrl, mapProofToCoreProof(operation.mintUrl, "ready", proofs, {
				unit: operation.unit,
				createdByOperationId: operation.id
			}));
			return { status: "FINALIZED" };
		} catch (error) {
			if (this.isAlreadyIssuedError(error)) return await this.recoverSignedOutputs(ctx) ?? {
				status: "PENDING",
				error: `Recovered: onchain quote ${operation.quoteId} was already issued but proofs were not recoverable`
			};
			if (error instanceof MintOperationError && error.code === 20007) return {
				status: "TERMINAL",
				error: `Recovered: onchain quote ${operation.quoteId} expired while executing mint`
			};
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async checkPending(ctx) {
		const { operation } = ctx;
		const observedAt = Date.now();
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(operation.mintUrl, "onchain", operation.quoteId);
		const expectedPubkey = operation.pubkey;
		const validationError = getReusableMintQuoteValidationError(remoteQuote, operation);
		if (validationError) return {
			observedAt,
			validationFailure: {
				reason: validationError.message,
				code: "invalid_quote",
				retryable: false,
				observedAt
			}
		};
		if (!expectedPubkey) return {
			observedAt,
			quoteSnapshot: remoteQuote,
			validationFailure: {
				reason: `Onchain mint operation ${operation.id} is missing NUT-20 quote pubkey`,
				code: "missing_quote_pubkey",
				retryable: false,
				observedAt
			}
		};
		return {
			observedAt,
			quoteSnapshot: remoteQuote
		};
	}
	async createRemoteQuote(wallet, payload) {
		const quote = await wallet.createMintQuoteOnchain(payload.pubkey);
		assertSameUnit(quote.unit, payload.unit, `Onchain mint quote ${quote.quote}`);
		return quote;
	}
	async requireQuoteKey(pubkey) {
		if (!await this.keyRingService.getMintQuoteKeyPair(pubkey)) throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${pubkey}`);
	}
	assertQuoteMatchesRequest(quote, expectedPubkey, expectedUnit) {
		if (quote.pubkey !== expectedPubkey) throw new MintQuoteValidationError(`Onchain mint quote ${quote.quote} returned pubkey ${quote.pubkey} instead of requested pubkey ${expectedPubkey}`);
		assertSameUnit(quote.unit, expectedUnit, `Onchain mint quote ${quote.quote}`);
	}
	async recoverSignedOutputs(ctx) {
		try {
			return (await ctx.proofService.recoverProofsFromOutputData(ctx.operation.mintUrl, ctx.operation.outputData, {
				unit: ctx.operation.unit,
				createdByOperationId: ctx.operation.id
			})).length > 0 ? { status: "FINALIZED" } : null;
		} catch (error) {
			ctx.logger?.warn("Failed to recover onchain mint outputs from output data", {
				mintUrl: ctx.operation.mintUrl,
				quoteId: ctx.operation.quoteId,
				operationId: ctx.operation.id,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	getQuoteValidationError(quote, expectedPubkey, expectedUnit) {
		try {
			this.assertQuoteMatchesRequest(quote, expectedPubkey, expectedUnit);
			return null;
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error));
		}
	}
	isAlreadyIssuedError(error) {
		if (error instanceof MintOperationError && (error.code === 20002 || error.code === 11003)) return true;
		const message = error instanceof Error ? error.message : String(error);
		return /already (issued|signed)|outputs? already/i.test(message);
	}
};

//#endregion
//#region infra/handlers/mint/MintBolt12Handler.ts
var MintBolt12Handler = class {
	constructor(keyRingService) {
		this.keyRingService = keyRingService;
	}
	async createQuote(ctx) {
		const quoteKey = await this.keyRingService.generateMintQuoteKeyPair();
		const amount = ctx.createQuoteData.amount ? normalizeUnitAmount(ctx.createQuoteData.amount).amount : void 0;
		const remoteQuote = await this.createRemoteQuote(ctx.wallet, {
			pubkey: quoteKey.publicKeyHex,
			unit: ctx.createQuoteData.unit,
			amount,
			description: ctx.createQuoteData.description
		});
		this.assertQuoteMatchesRequest(remoteQuote, quoteKey.publicKeyHex, ctx.createQuoteData.unit, amount);
		return mintQuoteFromBolt12Response(ctx.mintUrl, remoteQuote);
	}
	async fetchRemoteQuote(ctx) {
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(ctx.quote.mintUrl, "bolt12", ctx.quote.quoteId);
		this.assertQuoteMatchesRequest(remoteQuote, ctx.quote.quoteData.pubkey, ctx.quote.unit, ctx.quote.quoteData.amount);
		return mintQuoteObservationFromBolt12Response(ctx.quote.mintUrl, remoteQuote);
	}
	async validateQuoteForPrepare(quote) {
		await this.requireQuoteKey(quote.quoteData.pubkey);
	}
	async prepare(ctx) {
		const quote = ctx.importedQuote;
		if (!quote) throw new Error(`Mint quote ${ctx.operation.quoteId ?? "(missing)"} was not provided`);
		if (ctx.operation.quoteId !== quote.quote) throw new MintQuoteValidationError(`Mint quote ${quote.quote} does not match operation quote ${ctx.operation.quoteId}`);
		assertSameUnit(quote.unit, ctx.operation.unit, `BOLT12 mint quote ${quote.quote}`);
		await this.requireQuoteKey(quote.pubkey);
		const outputData = await ctx.proofService.createOutputsAndIncrementCounters(ctx.operation.mintUrl, {
			keep: {
				amount: ctx.operation.amount,
				unit: ctx.operation.unit
			},
			send: {
				amount: Amount$1.zero(),
				unit: ctx.operation.unit
			}
		}, {});
		if (outputData.keep.length === 0) throw new Error("Failed to create deterministic outputs for BOLT12 mint operation");
		return {
			...ctx.operation,
			quoteId: quote.quote,
			request: quote.request,
			expiry: quote.expiry,
			pubkey: quote.pubkey,
			outputData: serializeOutputData({
				keep: outputData.keep,
				send: []
			}),
			state: "pending"
		};
	}
	async execute(ctx) {
		const quoteKey = await this.keyRingService.getMintQuoteKeyPair(ctx.operation.pubkey ?? "");
		if (!quoteKey) throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${ctx.operation.pubkey ?? "(missing)"}`);
		const outputData = deserializeOutputData(ctx.operation.outputData);
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(ctx.operation.mintUrl, "bolt12", ctx.operation.quoteId);
		this.assertQuoteMatchesRequest(remoteQuote, ctx.operation.pubkey ?? "", ctx.operation.unit);
		const assessment = assessMintQuoteClaimability(mintQuoteObservationFromBolt12Response(ctx.operation.mintUrl, remoteQuote), { requestedAmount: ctx.operation.amount });
		if (assessment.status === "invalid") throw new MintQuoteValidationError(`BOLT12 mint quote ${ctx.operation.quoteId} is not claimable: ${assessment.status}`);
		try {
			return {
				status: "ISSUED",
				proofs: await ctx.wallet.mintProofsBolt12(ctx.operation.amount, remoteQuote, bytesToHex(quoteKey.secretKey), void 0, {
					type: "custom",
					data: outputData.keep
				})
			};
		} catch (error) {
			if (this.isAlreadyIssuedError(error)) return { status: "ALREADY_ISSUED" };
			throw error;
		}
	}
	async recoverExecuting(ctx) {
		const restored = await this.recoverSignedOutputs(ctx);
		if (restored) return restored;
		const { operation } = ctx;
		const expectedPubkey = operation.pubkey;
		if (!expectedPubkey) return {
			status: "TERMINAL",
			error: `Recovered: BOLT12 mint operation ${operation.id} is missing NUT-20 quote pubkey`
		};
		let remoteQuote;
		try {
			remoteQuote = await ctx.mintAdapter.checkMintQuote(operation.mintUrl, "bolt12", operation.quoteId);
		} catch (error) {
			ctx.logger?.warn("Failed to check BOLT12 mint quote during recovery", {
				mintUrl: operation.mintUrl,
				quoteId: operation.quoteId,
				operationId: operation.id,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
		const validationError = this.getQuoteValidationError(remoteQuote, expectedPubkey, operation.unit);
		if (validationError) return {
			status: "TERMINAL",
			error: validationError.message
		};
		const quoteKey = await this.keyRingService.getMintQuoteKeyPair(expectedPubkey);
		if (!quoteKey) return {
			status: "TERMINAL",
			error: `Missing NUT-20 mint quote key for pubkey ${expectedPubkey}`
		};
		const assessment = assessMintQuoteClaimability(mintQuoteObservationFromBolt12Response(operation.mintUrl, remoteQuote), {
			...ctx.localClaimabilityFacts,
			requestedAmount: operation.amount
		});
		if (assessment.status === "invalid") return {
			status: "TERMINAL",
			error: `Recovered: BOLT12 quote ${operation.quoteId} has invalid claimability accounting`
		};
		if (assessment.status !== "claimable") return {
			status: "PENDING",
			error: `Recovered: BOLT12 quote ${operation.quoteId} has ${assessment.remoteAvailable} remotely available, requested ${operation.amount}`
		};
		const outputData = deserializeOutputData(operation.outputData);
		try {
			const proofs = await ctx.wallet.mintProofsBolt12(operation.amount, remoteQuote, bytesToHex(quoteKey.secretKey), void 0, {
				type: "custom",
				data: outputData.keep
			});
			await ctx.proofService.saveProofs(operation.mintUrl, mapProofToCoreProof(operation.mintUrl, "ready", proofs, {
				unit: operation.unit,
				createdByOperationId: operation.id
			}));
			return { status: "FINALIZED" };
		} catch (error) {
			if (this.isAlreadyIssuedError(error)) return await this.recoverSignedOutputs(ctx) ?? {
				status: "PENDING",
				error: `Recovered: BOLT12 quote ${operation.quoteId} was already issued but proofs were not recoverable`
			};
			if (error instanceof MintOperationError && error.code === 20007) return {
				status: "TERMINAL",
				error: `Recovered: BOLT12 quote ${operation.quoteId} expired while executing mint`
			};
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async checkPending(ctx) {
		const { operation } = ctx;
		const observedAt = Date.now();
		const remoteQuote = await ctx.mintAdapter.checkMintQuote(operation.mintUrl, "bolt12", operation.quoteId);
		const expectedPubkey = operation.pubkey;
		const validationError = getReusableMintQuoteValidationError(remoteQuote, operation);
		if (validationError) return {
			observedAt,
			validationFailure: {
				reason: validationError.message,
				code: "invalid_quote",
				retryable: false,
				observedAt
			}
		};
		if (!expectedPubkey) return {
			observedAt,
			quoteSnapshot: remoteQuote,
			validationFailure: {
				reason: `BOLT12 mint operation ${operation.id} is missing NUT-20 quote pubkey`,
				code: "missing_quote_pubkey",
				retryable: false,
				observedAt
			}
		};
		return {
			observedAt,
			quoteSnapshot: remoteQuote
		};
	}
	async createRemoteQuote(wallet, payload) {
		const quote = await wallet.createMintQuoteBolt12(payload.pubkey, {
			amount: payload.amount,
			description: payload.description
		});
		assertSameUnit(quote.unit, payload.unit, `BOLT12 mint quote ${quote.quote}`);
		return quote;
	}
	async requireQuoteKey(pubkey) {
		if (!await this.keyRingService.getMintQuoteKeyPair(pubkey)) throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${pubkey}`);
	}
	assertQuoteMatchesRequest(quote, expectedPubkey, expectedUnit, expectedAmount) {
		if (quote.pubkey !== expectedPubkey) throw new MintQuoteValidationError(`BOLT12 mint quote ${quote.quote} returned pubkey ${quote.pubkey} instead of requested pubkey ${expectedPubkey}`);
		assertSameUnit(quote.unit, expectedUnit, `BOLT12 mint quote ${quote.quote}`);
		this.assertQuoteAmount(quote, expectedAmount);
	}
	assertQuoteAmount(quote, expectedAmount) {
		if (expectedAmount === void 0) return;
		if (!quote.amount || !quote.amount.equals(expectedAmount)) {
			const observedAmount = quote.amount ?? "(missing)";
			throw new MintQuoteValidationError(`Mint quote ${quote.quote} amount ${observedAmount} does not match requested amount ${expectedAmount}`);
		}
	}
	async recoverSignedOutputs(ctx) {
		try {
			return (await ctx.proofService.recoverProofsFromOutputData(ctx.operation.mintUrl, ctx.operation.outputData, {
				unit: ctx.operation.unit,
				createdByOperationId: ctx.operation.id
			})).length > 0 ? { status: "FINALIZED" } : null;
		} catch (error) {
			ctx.logger?.warn("Failed to recover BOLT12 mint outputs from output data", {
				mintUrl: ctx.operation.mintUrl,
				quoteId: ctx.operation.quoteId,
				operationId: ctx.operation.id,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				status: "PENDING",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	getQuoteValidationError(quote, expectedPubkey, expectedUnit) {
		try {
			this.assertQuoteMatchesRequest(quote, expectedPubkey, expectedUnit);
			return null;
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error));
		}
	}
	isAlreadyIssuedError(error) {
		if (error instanceof MintOperationError && (error.code === 20002 || error.code === 11003)) return true;
		const message = error instanceof Error ? error.message : String(error);
		return /already (issued|signed)|outputs? already/i.test(message);
	}
};

//#endregion
//#region infra/handlers/paymentRequestReceive/PaymentRequestReceiveTransportHandlerProvider.ts
/**
* Runtime registry for incoming payment request transport handlers.
* Keeps transport wiring concerns out of the receive saga.
*/
var PaymentRequestReceiveTransportHandlerProvider = class {
	registry = /* @__PURE__ */ new Map();
	register(handler) {
		if (this.registry.has(handler.type)) throw new PaymentRequestError(`Payment request receive transport handler '${handler.type}' is already registered`);
		this.registry.set(handler.type, handler);
		return () => {
			if (this.registry.get(handler.type) === handler) this.registry.delete(handler.type);
		};
	}
	get(type) {
		const handler = this.registry.get(type);
		if (!handler) throw new PaymentRequestError(`No payment request receive transport handler registered for '${type}'`);
		return handler;
	}
	getOptional(type) {
		return this.registry.get(type);
	}
};

//#endregion
//#region logging/ConsoleLogger.ts
var ConsoleLogger = class ConsoleLogger {
	prefix;
	level;
	static levelPriority = {
		error: 0,
		warn: 1,
		info: 2,
		debug: 3
	};
	constructor(prefix = "coco", options = {}) {
		this.prefix = prefix;
		this.level = options.level ?? "info";
	}
	shouldLog(level) {
		return ConsoleLogger.levelPriority[level] <= ConsoleLogger.levelPriority[this.level];
	}
	error(message, ...meta) {
		if (!this.shouldLog("error")) return;
		console.error(`[${this.prefix}] ERROR: ${message}`, ...meta);
	}
	warn(message, ...meta) {
		if (!this.shouldLog("warn")) return;
		console.warn(`[${this.prefix}] WARN: ${message}`, ...meta);
	}
	info(message, ...meta) {
		if (!this.shouldLog("info")) return;
		console.info(`[${this.prefix}] INFO: ${message}`, ...meta);
	}
	debug(message, ...meta) {
		if (!this.shouldLog("debug")) return;
		console.debug(`[${this.prefix}] DEBUG: ${message}`, ...meta);
	}
	log(level, message, ...meta) {
		switch (level) {
			case "error":
				this.error(message, ...meta);
				break;
			case "warn":
				this.warn(message, ...meta);
				break;
			case "info":
				this.info(message, ...meta);
				break;
			case "debug":
				this.debug(message, ...meta);
				break;
			default: this.info(message, ...meta);
		}
	}
	child(bindings) {
		return new ConsoleLogger([this.prefix, ...Object.entries(bindings).map(([k, v]) => `${k}=${String(v)}`)].join(" "), { level: this.level });
	}
};

//#endregion
//#region logging/NullLogger.ts
var NullLogger = class {
	error(_message, ..._meta) {}
	warn(_message, ..._meta) {}
	info(_message, ..._meta) {}
	debug(_message, ..._meta) {}
	log(_level, _message, ..._meta) {}
	child(_bindings) {
		return this;
	}
};

//#endregion
//#region api/WalletBalancesApi.ts
var WalletBalancesApi = class {
	proofService;
	constructor(proofService) {
		this.proofService = proofService;
	}
	async byMint(scope) {
		return this.proofService.getBalancesByMint(scope);
	}
	async byMintAndUnit(scope) {
		return this.proofService.getBalancesByMintAndUnit(scope);
	}
	async byUnit(scope) {
		return this.proofService.getBalancesByUnit(scope);
	}
	async total(scope) {
		return this.proofService.getBalanceTotal(scope);
	}
	async totalByUnit(scope) {
		return this.proofService.getBalanceTotalByUnit(scope);
	}
};

//#endregion
//#region api/WalletApi.ts
var WalletApi = class {
	mintService;
	walletService;
	proofService;
	walletRestoreService;
	receiveOperationService;
	tokenService;
	logger;
	balances;
	constructor(mintService, walletService, proofService, walletRestoreService, receiveOperationService, tokenService, logger) {
		this.mintService = mintService;
		this.walletService = walletService;
		this.proofService = proofService;
		this.walletRestoreService = walletRestoreService;
		this.receiveOperationService = receiveOperationService;
		this.tokenService = tokenService;
		this.logger = logger;
		this.balances = new WalletBalancesApi(proofService);
	}
	/**
	* Receive a token in one shot.
	*
	* For a multi-step receive flow (review fees/amounts before committing),
	* use `manager.ops.receive.prepare()` and `manager.ops.receive.execute()`.
	*/
	async receive(token) {
		return this.receiveOperationService.receive(token);
	}
	async restore(mintUrl, options) {
		this.logger?.info("Starting restore", { mintUrl });
		const mint = await this.mintService.addMintByUrl(mintUrl, { trusted: true });
		this.logger?.debug("Mint fetched for restore", {
			mintUrl,
			keysetCount: mint.keysets.length
		});
		const unitFilter = this.getUnitFilter(options?.units);
		const failedKeysetIds = {};
		for (const { keyset, unit } of this.getUnitScopedKeysets(mint.keysets, unitFilter)) try {
			const wallet = await this.walletService.getWallet(mintUrl, unit);
			await this.walletRestoreService.restoreKeyset(mintUrl, wallet, keyset.id, unit);
		} catch (error) {
			this.logger?.error("Keyset restore failed", {
				mintUrl,
				keysetId: keyset.id,
				unit,
				error
			});
			failedKeysetIds[keyset.id] = error;
		}
		if (Object.keys(failedKeysetIds).length > 0) {
			this.logger?.error("Restore completed with failures", {
				mintUrl,
				failedKeysetIds: Object.keys(failedKeysetIds)
			});
			throw new Error("Failed to restore some keysets");
		}
		this.logger?.info("Restore completed successfully", { mintUrl });
	}
	/**
	* Sweeps a mint by sweeping each keyset and adds the swept proofs to the wallet
	* @param mintUrl - The URL of the mint to sweep
	* @param bip39seed - The BIP39 seed of the wallet to sweep
	*/
	async sweep(mintUrl, bip39seed, options) {
		this.logger?.info("Starting sweep", { mintUrl });
		const mint = await this.mintService.addMintByUrl(mintUrl, { trusted: true });
		this.logger?.debug("Mint fetched for sweep", {
			mintUrl,
			keysetCount: mint.keysets.length
		});
		const unitFilter = this.getUnitFilter(options?.units);
		const failedKeysetIds = {};
		for (const { keyset, unit } of this.getUnitScopedKeysets(mint.keysets, unitFilter)) try {
			await this.walletRestoreService.sweepKeyset(mintUrl, keyset.id, bip39seed, unit);
		} catch (error) {
			this.logger?.error("Keyset restore failed", {
				mintUrl,
				keysetId: keyset.id,
				unit,
				error
			});
			failedKeysetIds[keyset.id] = error;
		}
		if (Object.keys(failedKeysetIds).length > 0) {
			this.logger?.error("Restore completed with failures", {
				mintUrl,
				failedKeysetIds: Object.keys(failedKeysetIds)
			});
			throw new Error("Failed to restore some keysets");
		}
		this.logger?.info("Restore completed successfully", { mintUrl });
	}
	/**
	* Decode a token string into a Token object.
	* If mintUrl is provided, decodes token with mint keysets (supports all token formats).
	* If no mintUrl, attempts to decode using wallet's known keysets (may fail for some token formats).
	*
	* Note: For reliable decoding of all token formats, provide a mintUrl.
	*
	* @param tokenString - The encoded token string to decode
	* @param mintUrl - Optional mint URL to use for decoding (provides access to mint keysets for decoding)
	* @returns The decoded Token or array of Proofs
	*/
	async decodeToken(tokenString, mintUrl) {
		if (mintUrl) return await this.tokenService.decodeToken(tokenString, mintUrl);
		const metadata = getTokenMetadata$1(tokenString);
		return this.tokenService.decodeToken(tokenString, metadata.mint);
	}
	/**
	* Encode a token to a string.
	* @param token - The token to encode
	* @param opts - Optional encoding options
	* @returns Encoded token string
	*/
	encodeToken(token, opts) {
		return getEncodedToken$1(token, opts);
	}
	/**
	* Encode a PaymentRequest to a string.
	* @param paymentRequest - The PaymentRequest to encode
	* @param version - Encoding version ('creqA' for base64 text, 'creqB' for bech32m binary). Defaults to 'creqA'.
	* @returns Encoded payment request string
	*/
	encodePaymentRequest(paymentRequest, version) {
		if (version === "creqB") return paymentRequest.toEncodedCreqB();
		return paymentRequest.toEncodedCreqA();
	}
	getUnitFilter(units) {
		const normalizedUnits = normalizeUnitList(units);
		return normalizedUnits ? new Set(normalizedUnits) : void 0;
	}
	getUnitScopedKeysets(keysets, unitFilter) {
		return keysets.map((keyset) => ({
			keyset,
			unit: normalizeUnit(keyset.unit ?? DEFAULT_UNIT, { defaultUnit: DEFAULT_UNIT })
		})).filter(({ unit }) => !unitFilter || unitFilter.has(unit));
	}
};

//#endregion
//#region api/MintApi.ts
var MintApi = class {
	constructor(mintService) {
		this.mintService = mintService;
	}
	async addMint(mintUrl, options) {
		return this.mintService.addMintByUrl(mintUrl, options);
	}
	async getMintInfo(mintUrl) {
		return this.mintService.getMintInfo(mintUrl);
	}
	/** Check whether a mint supports one method/unit pair for minting or melting. */
	async checkPaymentMethodCapability(input) {
		return this.mintService.checkPaymentMethodCapability(input);
	}
	/** List enabled Payment Method Capabilities advertised by NUT-04/NUT-05 mint metadata. */
	async listPaymentMethodCapabilities(input) {
		return this.mintService.listPaymentMethodCapabilities(input);
	}
	async isTrustedMint(mintUrl) {
		return this.mintService.isTrustedMint(mintUrl);
	}
	async getAllMints() {
		return this.mintService.getAllMints();
	}
	async getAllTrustedMints() {
		return this.mintService.getAllTrustedMints();
	}
	async trustMint(mintUrl) {
		return this.mintService.trustMint(mintUrl);
	}
	async untrustMint(mintUrl) {
		return this.mintService.untrustMint(mintUrl);
	}
};

//#endregion
//#region api/KeyRingApi.ts
var KeyRingApi = class {
	constructor(keyRingService) {
		this.keyRingService = keyRingService;
	}
	async generateKeyPair(dumpSecretKey) {
		if (dumpSecretKey === true) return this.keyRingService.generateNewKeyPair({ dumpSecretKey: true });
		return this.keyRingService.generateNewKeyPair({ dumpSecretKey: false });
	}
	/**
	* Adds an existing keypair to the keyring using a secret key.
	* @param secretKey - The 32-byte secret key as Uint8Array
	*/
	async addKeyPair(secretKey) {
		return this.keyRingService.addKeyPair(secretKey);
	}
	/**
	* Removes a keypair from the keyring.
	* @param publicKey - The public key (hex string) of the keypair to remove
	*/
	async removeKeyPair(publicKey) {
		return this.keyRingService.removeKeyPair(publicKey);
	}
	/**
	* Retrieves a specific keypair by its public key.
	* @param publicKey - The public key (hex string) to look up
	* @returns The keypair if found, null otherwise
	*/
	async getKeyPair(publicKey) {
		return this.keyRingService.getKeyPair(publicKey);
	}
	/**
	* Gets the most recently added keypair.
	* @returns The latest keypair if any exist, null otherwise
	*/
	async getLatestKeyPair() {
		return this.keyRingService.getLatestKeyPair();
	}
	/**
	* Gets all keypairs stored in the keyring.
	* @returns Array of all keypairs
	*/
	async getAllKeyPairs() {
		return this.keyRingService.getAllKeyPairs();
	}
};

//#endregion
//#region api/HistoryApi.ts
var HistoryApi = class {
	historyService;
	constructor(historyService) {
		this.historyService = historyService;
	}
	async getPaginatedHistory(offset = 0, limit = 25) {
		return this.historyService.getPaginatedHistory(offset, limit);
	}
	async getHistoryEntryById(id) {
		return this.historyService.getHistoryEntryById(id);
	}
	async getOperationIdForHistoryEntry(id) {
		return this.historyService.getHistoryEntryById(id).then((entry) => {
			const operationId = entry?.operationId?.trim();
			return operationId ? operationId : null;
		});
	}
};

//#endregion
//#region api/AuthApi.ts
/**
* Public API for NUT-21/22 authentication.
*
* Thin wrapper that delegates to AuthService,
* consistent with the other Api → Service pattern.
*/
var AuthApi = class {
	constructor(authService) {
		this.authService = authService;
	}
	async startDeviceAuth(mintUrl) {
		return this.authService.startDeviceAuth(mintUrl);
	}
	async login(mintUrl, tokens) {
		return this.authService.login(mintUrl, tokens);
	}
	async restore(mintUrl) {
		return this.authService.restore(mintUrl);
	}
	async logout(mintUrl) {
		return this.authService.logout(mintUrl);
	}
	async getSession(mintUrl) {
		return this.authService.getSession(mintUrl);
	}
	async hasSession(mintUrl) {
		return this.authService.hasSession(mintUrl);
	}
	getAuthProvider(mintUrl) {
		return this.authService.getAuthProvider(mintUrl);
	}
	getPoolSize(mintUrl) {
		return this.authService.getPoolSize(mintUrl);
	}
};

//#endregion
//#region api/SendOpsApi.ts
/**
* Operation-oriented API for send workflows.
*
* This API exposes the send lifecycle explicitly:
* 1. `prepare()` to create and reserve inputs
* 2. `execute()` to produce the outgoing token
* 3. `refresh()` to re-check pending operations
* 4. `cancel()` or `reclaim()` to roll back when allowed
*/
var SendOpsApi = class {
	/** Recovery helpers for send operations. */
	recovery = {
		run: async () => this.sendOperationService.recoverPendingOperations(),
		inProgress: () => this.sendOperationService.isRecoveryInProgress()
	};
	/** Lightweight diagnostics for send operations. */
	diagnostics = { isLocked: (operationId) => this.sendOperationService.isOperationLocked(operationId) };
	constructor(sendOperationService) {
		this.sendOperationService = sendOperationService;
	}
	/**
	* Creates a prepared send operation without executing it.
	*
	* Use this to inspect the operation, fee impact, and target configuration
	* before producing the outgoing token.
	*/
	async prepare(input) {
		const parsed = parseUnitAmount(input.amount, { explicitUnit: input.unit });
		const initOp = await this.sendOperationService.init(input.mintUrl, parsed, this.getCreateOptions(input));
		return this.sendOperationService.prepare(initOp);
	}
	/**
	* Executes a prepared send operation and returns the shareable token.
	*
	* Accepts either a prepared operation object or its ID. The latest operation
	* state is always reloaded before execution. When provided, `options.memo`
	* is trimmed and persisted on the returned token; whitespace-only memos are omitted.
	*/
	async execute(operationOrId, options) {
		const operation = await this.resolveOperation(operationOrId);
		if (operation.state !== "prepared") throw new Error(`Cannot execute operation in state '${operation.state}'. Expected 'prepared'.`);
		return this.sendOperationService.execute(operation, options);
	}
	/** Returns a send operation by ID, or `null` when it does not exist. */
	async get(operationId) {
		return this.sendOperationService.getOperation(operationId);
	}
	/** Lists send operations that are prepared and ready to execute or cancel. */
	async listPrepared() {
		return this.sendOperationService.getPreparedOperations();
	}
	/** Lists send operations that are currently in flight. */
	async listInFlight() {
		return this.sendOperationService.getPendingOperations();
	}
	/**
	* Re-checks a send operation and returns its latest persisted state.
	*
	* Pending operations are actively checked with the service before the updated
	* operation is returned.
	*/
	async refresh(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state === "pending") {
			await this.sendOperationService.checkPendingOperation(operation);
			return this.requireOperation(operationId);
		}
		return operation;
	}
	/**
	* Cancels a prepared send operation before it has been executed.
	*/
	async cancel(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "prepared") throw new Error(`Cannot cancel operation in state '${operation.state}'. Expected 'prepared'.`);
		await this.sendOperationService.rollback(operation.id);
	}
	async reclaim(operationId, options) {
		if (options) return this.sendOperationService.reclaim(operationId, options);
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "pending") throw new Error(`Cannot reclaim operation in state '${operation.state}'. Expected 'pending'.`);
		await this.sendOperationService.rollback(operation.id);
	}
	/**
	* Finalizes a pending send operation explicitly.
	*
	* Most callers should rely on proof-state watchers when available, but this
	* method remains useful when the caller knows the token has been claimed.
	*/
	async finalize(operationId) {
		await this.sendOperationService.finalize(operationId);
	}
	getCreateOptions({ forceSwap, target }) {
		if (!target) return {
			method: "default",
			methodData: forceSwap ? { forceSwap: true } : {}
		};
		const { type, ...methodData } = target;
		return {
			method: type,
			methodData
		};
	}
	async resolveOperation(operationOrId) {
		if (typeof operationOrId === "string") return this.requireOperation(operationOrId);
		return this.requireOperation(operationOrId.id);
	}
	async requireOperation(operationId) {
		const operation = await this.sendOperationService.getOperation(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		return operation;
	}
};

//#endregion
//#region api/ReceiveOpsApi.ts
/**
* Operation-oriented API for receive workflows.
*
* This API exposes receiving as an explicit lifecycle so callers can inspect,
* resume, and cancel operations instead of relying only on a one-shot receive
* call.
*/
var ReceiveOpsApi = class {
	/** Recovery helpers for receive operations. */
	recovery = {
		run: async () => this.receiveOperationService.recoverPendingOperations(),
		inProgress: () => this.receiveOperationService.isRecoveryInProgress()
	};
	/** Lightweight diagnostics for receive operations. */
	diagnostics = { isLocked: (operationId) => this.receiveOperationService.isOperationLocked(operationId) };
	constructor(receiveOperationService) {
		this.receiveOperationService = receiveOperationService;
	}
	/**
	* Decodes and validates a token, then prepares a receive operation without
	* executing it.
	*/
	async prepare(input) {
		const initOp = await this.receiveOperationService.init(input.token);
		return this.receiveOperationService.prepare(initOp);
	}
	/**
	* Executes a prepared receive operation.
	*
	* Accepts either a prepared operation object or its ID. The latest operation
	* state is always reloaded before execution.
	*/
	async execute(operationOrId) {
		const operation = await this.resolveOperation(operationOrId);
		if (operation.state !== "prepared") throw new Error(`Cannot execute operation in state '${operation.state}'. Expected 'prepared'.`);
		return this.receiveOperationService.execute(operation);
	}
	/** Returns a receive operation by ID, or `null` when it does not exist. */
	async get(operationId) {
		return this.receiveOperationService.getOperation(operationId);
	}
	/** Lists receive operations that are prepared and ready to execute or cancel. */
	async listPrepared() {
		return this.receiveOperationService.getPreparedOperations();
	}
	/** Lists receive operations that are currently in flight. */
	async listInFlight() {
		return this.receiveOperationService.getPendingOperations();
	}
	/**
	* Re-checks a receive operation and returns its latest persisted state.
	*
	* Executing operations are actively recovered before the updated operation is
	* returned.
	*/
	async refresh(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state === "executing") {
			await this.receiveOperationService.recoverExecutingOperation(operation);
			return this.requireOperation(operationId);
		}
		return operation;
	}
	/**
	* Cancels a receive operation that has not completed yet.
	*
	* Only `init` and `prepared` receive operations can be cancelled.
	*/
	async cancel(operationId, reason) {
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "init" && operation.state !== "prepared") throw new Error(`Cannot cancel operation in state '${operation.state}'. Expected 'init' or 'prepared'.`);
		await this.receiveOperationService.rollback(operation.id, reason);
	}
	async resolveOperation(operationOrId) {
		if (typeof operationOrId === "string") return this.requireOperation(operationOrId);
		return this.requireOperation(operationOrId.id);
	}
	async requireOperation(operationId) {
		const operation = await this.receiveOperationService.getOperation(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		return operation;
	}
};

//#endregion
//#region api/MeltOpsApi.ts
/**
* Operation-oriented API for melt workflows.
*
* This API makes the melt lifecycle explicit so callers can prepare a payment,
* execute it, inspect or refresh its state, and recover or roll it back when
* allowed by the underlying method.
*/
var MeltOpsApi = class {
	/** Recovery helpers for melt operations. */
	recovery = {
		run: async () => this.meltOperationService.recoverPendingOperations(),
		inProgress: () => this.meltOperationService.isRecoveryInProgress()
	};
	/** Lightweight diagnostics for melt operations. */
	diagnostics = { isLocked: (operationId) => this.meltOperationService.isOperationLocked(operationId) };
	constructor(meltOperationService) {
		this.meltOperationService = meltOperationService;
	}
	/**
	* Prepares a melt operation against an existing canonical quote without executing it.
	*
	* Use this to inspect the generated operation and any quote-related data
	* before committing to the external payment.
	*/
	async prepare(input) {
		return this.meltOperationService.prepareExistingQuote(input.quote, { feeIndex: input.feeIndex });
	}
	/**
	* Executes a prepared melt operation.
	*
	* Accepts either a prepared operation object or its ID. The latest operation
	* state is always reloaded before execution.
	*/
	async execute(operationOrId) {
		const operation = await this.resolveOperation(operationOrId);
		if (operation.state !== "prepared") throw new Error(`Cannot execute operation in state '${operation.state}'. Expected 'prepared'.`);
		return this.meltOperationService.execute(operation.id);
	}
	/** Returns a melt operation by ID, or `null` when it does not exist. */
	async get(operationId) {
		return this.meltOperationService.getOperation(operationId);
	}
	/** Returns the tracked melt operation for a canonical quote identity, or `null`. */
	async getByQuote(input) {
		return this.meltOperationService.getOperationByQuoteIdentity(input);
	}
	/** Lists melt operations for a mint URL and quote ID. */
	async listByQuote(input) {
		return this.meltOperationService.listOperationsByQuote(input.mintUrl, input.quoteId);
	}
	/** Lists melt operations that are prepared and ready to execute or cancel. */
	async listPrepared() {
		return this.meltOperationService.getPreparedOperations();
	}
	/** Lists melt operations that are currently in flight. */
	async listInFlight() {
		return this.meltOperationService.getPendingOperations();
	}
	/**
	* Re-checks a melt operation and returns its latest persisted state.
	*
	* Pending operations are actively checked with the service before the updated
	* operation is returned. Executing operations are recovered before returning
	* the updated state.
	*/
	async refresh(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state === "pending") {
			await this.meltOperationService.checkPendingOperation(operation.id);
			return this.requireOperation(operationId);
		}
		if (operation.state === "executing") {
			await this.meltOperationService.recoverExecutingOperation(operation);
			return this.requireOperation(operationId);
		}
		return operation;
	}
	/**
	* Cancels a prepared melt operation before payment has entered the pending
	* phase.
	*/
	async cancel(operationId, reason) {
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "prepared") throw new Error(`Cannot cancel operation in state '${operation.state}'. Expected 'prepared'.`);
		await this.meltOperationService.rollback(operation.id, reason);
	}
	/**
	* Attempts to reclaim a pending melt operation.
	*
	* This is intended for in-flight melts whose handler determines that rollback
	* is still safe.
	*/
	async reclaim(operationId, reason) {
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "pending") throw new Error(`Cannot reclaim operation in state '${operation.state}'. Expected 'pending'.`);
		await this.meltOperationService.rollback(operation.id, reason);
	}
	/**
	* Finalizes a pending melt operation explicitly.
	*
	* Most callers should prefer `refresh()` unless they already know the melt is
	* ready to finalize.
	*/
	async finalize(operationId) {
		await this.meltOperationService.finalize(operationId);
	}
	async resolveOperation(operationOrId) {
		if (typeof operationOrId === "string") return this.requireOperation(operationOrId);
		return this.requireOperation(operationOrId.id);
	}
	async requireOperation(operationId) {
		const operation = await this.meltOperationService.getOperation(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		return operation;
	}
};

//#endregion
//#region api/MintOpsApi.ts
/**
* Operation-oriented API for quote-backed mint workflows.
*
* This API makes the mint lifecycle explicit so callers can move a canonical
* quote into a durable pending operation, execute it, and inspect its progress.
*/
var MintOpsApi = class {
	/** Recovery helpers for mint operations. */
	recovery = {
		run: async () => this.mintOperationService.recoverPendingOperations(),
		inProgress: () => this.mintOperationService.isRecoveryInProgress()
	};
	/** Lightweight diagnostics for mint operations. */
	diagnostics = { isLocked: (operationId) => this.mintOperationService.isOperationLocked(operationId) };
	constructor(mintOperationService) {
		this.mintOperationService = mintOperationService;
	}
	/**
	* Prepares a mint operation against an existing canonical quote without executing it.
	*/
	async prepare(input) {
		return this.mintOperationService.prepare(input.quote, Amount$1.from(input.amount));
	}
	/**
	* Executes or resumes a mint operation and returns its latest persisted state.
	*
	* Concurrent calls join active local execution, while terminal outcomes are returned as-is.
	*/
	async execute(operationOrId) {
		const operationId = typeof operationOrId === "string" ? operationOrId : operationOrId.id;
		return this.mintOperationService.execute(operationId);
	}
	/** Returns a mint operation by ID, or `null` when it does not exist. */
	async get(operationId) {
		return this.mintOperationService.getOperation(operationId);
	}
	/** Lists mint operations for a mint URL and quote ID. */
	async listByQuote(input) {
		return this.mintOperationService.listOperationsByQuote(input.mintUrl, input.quoteId);
	}
	/** Lists mint operations that are pending redemption or remote settlement. */
	async listPending() {
		return this.mintOperationService.getPendingOperations();
	}
	/** Lists mint operations that are pending or currently executing. */
	async listInFlight() {
		return this.mintOperationService.getInFlightOperations();
	}
	/**
	* Checks the remote quote state for a pending mint operation.
	* Paid or issued quotes are reconciled immediately.
	*/
	async checkPayment(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state !== "pending") throw new Error(`Cannot check payment in state '${operation.state}'. Expected 'pending'.`);
		return this.mintOperationService.checkPendingOperation(operation.id);
	}
	/**
	* Re-checks a mint operation and returns its latest persisted state.
	*/
	async refresh(operationId) {
		const operation = await this.requireOperation(operationId);
		if (operation.state === "pending") {
			await this.mintOperationService.checkPendingOperation(operation.id);
			return this.requireOperation(operationId);
		}
		if (operation.state === "executing") {
			await this.mintOperationService.recoverExecutingOperation(operation);
			return this.requireOperation(operationId);
		}
		return operation;
	}
	/**
	* Attempts to finalize a mint operation explicitly.
	*
	* Pending operations are executed, executing operations are recovered,
	* and terminal operations are returned as-is.
	*/
	async finalize(operationId) {
		return this.mintOperationService.finalize(operationId);
	}
	async requireOperation(operationId) {
		const operation = await this.mintOperationService.getOperation(operationId);
		if (!operation) throw new Error(`Operation ${operationId} not found`);
		return operation;
	}
};

//#endregion
//#region api/QuoteApi.ts
var MintQuoteApi = class {
	constructor(quoteLifecycle) {
		this.quoteLifecycle = quoteLifecycle;
	}
	async create(input) {
		if (input.method === "bolt11") {
			const parsed = parseUnitAmount(input.amount, { explicitUnit: input.unit });
			return this.quoteLifecycle.createMintQuote(input.mintUrl, input.method, {
				amount: parsed,
				...input.locked === true ? { locked: true } : {}
			});
		}
		if (input.method === "bolt12") {
			const parsed = input.amount !== void 0 ? parseUnitAmount(input.amount, { explicitUnit: input.unit }) : void 0;
			const unit = parsed?.unit ?? normalizeUnit(input.unit, { defaultUnit: DEFAULT_UNIT });
			const createQuoteData = parsed === void 0 ? {
				unit,
				description: input.description
			} : {
				unit,
				amount: parsed,
				description: input.description
			};
			return this.quoteLifecycle.createMintQuote(input.mintUrl, input.method, createQuoteData);
		}
		return this.quoteLifecycle.createMintQuote(input.mintUrl, input.method, { unit: normalizeUnit(input.unit, { defaultUnit: DEFAULT_UNIT }) });
	}
	get(input) {
		return this.quoteLifecycle.getMintQuoteById(input);
	}
	import(input) {
		return this.quoteLifecycle.importMintQuote(input.mintUrl, input.method, input.quote);
	}
	listPending(input = {}) {
		return this.quoteLifecycle.getPendingMintQuotes(input.method);
	}
	refresh(input) {
		return this.quoteLifecycle.refreshMintQuoteById(input);
	}
};
var MeltQuoteApi = class {
	constructor(quoteLifecycle) {
		this.quoteLifecycle = quoteLifecycle;
	}
	create(input) {
		return this.quoteLifecycle.createMeltQuote(input.mintUrl, input.method, input.methodData, input.unit);
	}
	get(input) {
		return this.quoteLifecycle.getMeltQuoteById(input);
	}
	listPending(input = {}) {
		return this.quoteLifecycle.getPendingMeltQuotes(input.method);
	}
	refresh(input) {
		return this.quoteLifecycle.refreshMeltQuoteById(input);
	}
};
/**
* API for durable canonical quote state.
*
* Quote rows are not value movements and are separate from operation history.
*/
var QuoteApi = class {
	mint;
	melt;
	constructor(quoteLifecycle) {
		this.mint = new MintQuoteApi(quoteLifecycle);
		this.melt = new MeltQuoteApi(quoteLifecycle);
	}
};

//#endregion
//#region api/OpsApi.ts
/**
* Unified entry point for operation-based wallet workflows.
*
* This API groups the high-level send, receive, and melt operation APIs under a
* single object so callers can discover and use the new operation-oriented
* lifecycle consistently.
*/
var OpsApi = class {
	/**
	* Send operations for preparing, executing, inspecting, refreshing, and
	* recovering token sends.
	*/
	constructor(send, receive, mint, melt) {
		this.send = send;
		this.receive = receive;
		this.mint = mint;
		this.melt = melt;
	}
};

//#endregion
//#region api/PaymentRequestsApi.ts
/**
* API for parsing, preparing, and executing payment requests.
*/
var PaymentRequestsApi = class {
	paymentRequestService;
	incoming;
	constructor(paymentRequestService, paymentRequestReceiveService) {
		this.paymentRequestService = paymentRequestService;
		this.incoming = {
			create: (input) => {
				const parsed = parseUnitAmount(input.amount, { explicitUnit: input.unit });
				return paymentRequestReceiveService.create({
					...input,
					amount: parsed.amount,
					unit: parsed.unit
				});
			},
			cancel: (operationId, reason) => paymentRequestReceiveService.cancel(operationId, reason),
			get: (operationId) => paymentRequestReceiveService.get(operationId),
			list: (filter) => paymentRequestReceiveService.list(filter),
			claimPayload: (operationOrId, payload, source) => paymentRequestReceiveService.claimPayload(operationOrId, payload, source),
			ingestPayload: (payload, source) => paymentRequestReceiveService.ingestPayload(payload, source),
			recovery: { run: () => paymentRequestReceiveService.recoverPendingAttempts() },
			diagnostics: { isLocked: (operationId) => paymentRequestReceiveService.isOperationLocked(operationId) }
		};
	}
	/**
	* Parse and validate an encoded payment request.
	*/
	async parse(paymentRequest) {
		return this.paymentRequestService.parse(paymentRequest);
	}
	/**
	* Prepare a payment request for execution.
	*/
	async prepare(request, options) {
		return this.paymentRequestService.prepare(request, {
			mintUrl: options.mintUrl,
			amount: options.amount === void 0 ? void 0 : parseUnitAmount(options.amount, {
				defaultUnit: request.unit,
				explicitUnit: request.unit
			})
		});
	}
	/**
	* Execute a prepared payment request.
	*/
	async execute(transaction) {
		return this.paymentRequestService.execute(transaction);
	}
};

//#endregion
//#region plugins/PluginHost.ts
var PluginHost = class {
	plugins = [];
	cleanups = [];
	extensions = {};
	registeredPlugins = /* @__PURE__ */ new WeakSet();
	initializedPlugins = /* @__PURE__ */ new WeakSet();
	readyPlugins = /* @__PURE__ */ new WeakSet();
	initPromises = /* @__PURE__ */ new WeakMap();
	readyPromises = /* @__PURE__ */ new WeakMap();
	lifecyclePromises = /* @__PURE__ */ new Set();
	services;
	initialized = false;
	readyPhase = false;
	disposed = false;
	disposePromise;
	use(plugin) {
		if (this.disposePromise || this.disposed) throw new Error("Cannot register plugin after disposal has started");
		if (this.registeredPlugins.has(plugin)) throw new DuplicatePluginRegistrationError(plugin.name);
		this.registeredPlugins.add(plugin);
		this.plugins.push(plugin);
		if (this.initialized && this.services) {
			const services = this.services;
			this.trackLifecycle(this.initializeRuntimePlugin(plugin, services));
		}
	}
	async init(services) {
		if (this.disposePromise || this.disposed) throw new Error("Cannot initialize plugins after disposal has started");
		this.services = services;
		this.initialized = true;
		for (const p of this.plugins) await this.ensureInitialized(p, services);
	}
	async ready() {
		if (this.disposePromise || this.disposed) throw new Error("Cannot mark plugins ready after disposal has started");
		if (!this.services) return;
		this.readyPhase = true;
		for (const p of this.plugins) await this.ensureReady(p, this.services);
	}
	async dispose() {
		if (this.disposePromise) {
			await this.disposePromise;
			return;
		}
		if (this.disposed) return;
		this.disposePromise = this.runDispose();
		await this.disposePromise;
	}
	async runDispose() {
		await this.waitForLifecycle();
		const errors = [];
		for (const p of this.plugins) try {
			await p.onDispose?.();
		} catch (err) {
			console.error("Plugin dispose error", {
				plugin: p.name,
				err
			});
			errors.push(err);
		}
		while (this.cleanups.length) {
			const fn = this.cleanups.pop();
			try {
				await fn();
			} catch (err) {
				errors.push(err);
			}
		}
		if (errors.length > 0) console.error("One or more plugin dispose/cleanup handlers failed");
		this.disposed = true;
		if (errors.length > 0) throw new AggregateError(errors, "One or more plugin dispose/cleanup handlers failed");
	}
	async initializeRuntimePlugin(plugin, services) {
		await this.ensureInitialized(plugin, services);
		if (this.readyPhase) await this.ensureReady(plugin, services);
	}
	trackLifecycle(promise) {
		this.lifecyclePromises.add(promise);
		promise.then(() => {
			this.lifecyclePromises.delete(promise);
		}, () => {
			this.lifecyclePromises.delete(promise);
		});
		return promise;
	}
	async waitForLifecycle() {
		while (this.lifecyclePromises.size > 0) await Promise.allSettled([...this.lifecyclePromises]);
	}
	/**
	* Get all registered plugin extensions
	*/
	getExtensions() {
		return this.extensions;
	}
	async ensureInitialized(plugin, services) {
		if (this.initializedPlugins.has(plugin)) return;
		const existing = this.initPromises.get(plugin);
		if (existing) {
			await existing;
			return;
		}
		const promise = this.trackLifecycle(this.runInit(plugin, services).then(() => {
			this.initializedPlugins.add(plugin);
		}).finally(() => {
			this.initPromises.delete(plugin);
		}));
		this.initPromises.set(plugin, promise);
		await promise;
	}
	async ensureReady(plugin, services) {
		await this.ensureInitialized(plugin, services);
		if (this.readyPlugins.has(plugin)) return;
		const existing = this.readyPromises.get(plugin);
		if (existing) {
			await existing;
			return;
		}
		const promise = this.trackLifecycle(this.runReady(plugin, services).then(() => {
			this.readyPlugins.add(plugin);
		}).finally(() => {
			this.readyPromises.delete(plugin);
		}));
		this.readyPromises.set(plugin, promise);
		await promise;
	}
	async runInit(plugin, services) {
		const ctx = this.createContext(plugin, services);
		try {
			const cleanup = await plugin.onInit?.(ctx);
			if (typeof cleanup === "function") this.cleanups.push(cleanup);
		} catch (err) {
			if (err instanceof ExtensionRegistrationError) throw err;
			console.error("Plugin init error", {
				plugin: plugin.name,
				err
			});
		}
	}
	async runReady(plugin, services) {
		const ctx = this.createContext(plugin, services);
		try {
			const cleanup = await plugin.onReady?.(ctx);
			if (typeof cleanup === "function") this.cleanups.push(cleanup);
		} catch (err) {
			if (err instanceof ExtensionRegistrationError) throw err;
			console.error("Plugin ready error", {
				plugin: plugin.name,
				err
			});
		}
	}
	createContext(plugin, services) {
		const required = plugin.required ?? [];
		const selected = {};
		for (const k of required) selected[k] = services[k];
		const registerExtension = (key, api) => {
			if (key in this.extensions) throw new ExtensionRegistrationError(plugin.name, key);
			this.extensions[key] = api;
		};
		return {
			services: selected,
			registerExtension
		};
	}
};

//#endregion
//#region quotes/MintQuoteObservation.ts
function withCanonicalCompatibilityProjection(quote) {
	if (!isStatefulMintQuote(quote)) return quote;
	return {
		...quote,
		state: deriveBolt11MintQuoteState(quote.amountPaid, quote.amountIssued)
	};
}
function hasAccountingComponentDecrease(existing, incoming) {
	return incoming.amountPaid.lessThan(existing.amountPaid) || incoming.amountIssued.lessThan(existing.amountIssued);
}
function hasMeaningfulChange(existing, incoming) {
	if (!existing) return true;
	if (existing.method !== incoming.method || existing.quoteId !== incoming.quoteId || existing.request !== incoming.request || existing.unit !== incoming.unit || existing.expiry !== incoming.expiry || (existing.pubkey ?? null) !== (incoming.pubkey ?? null) || existing.reusable !== incoming.reusable || !existing.amountPaid.equals(incoming.amountPaid) || !existing.amountIssued.equals(incoming.amountIssued)) return true;
	if (isStatefulMintQuote(existing) && isStatefulMintQuote(incoming)) return !existing.amount.equals(incoming.amount);
	if (existing.method === "bolt12" && incoming.method === "bolt12") {
		if (existing.amount === void 0 || incoming.amount === void 0) return existing.amount !== incoming.amount;
		return !existing.amount.equals(incoming.amount);
	}
	return false;
}
/** Resolves one canonical Mint Quote Observation without performing lifecycle side effects. */
function resolveMintQuoteObservation(existing, incoming) {
	if (incoming.amountIssued.greaterThan(incoming.amountPaid)) return {
		resolvedQuote: existing ?? withCanonicalCompatibilityProjection(incoming),
		disposition: "ignored-invalid-background"
	};
	if (!existing || existing.method !== incoming.method || existing.quoteId !== incoming.quoteId) return {
		resolvedQuote: withCanonicalCompatibilityProjection(incoming),
		disposition: "accepted-meaningful-change"
	};
	if (existing.remoteUpdatedAt !== null && incoming.remoteUpdatedAt !== null && incoming.remoteUpdatedAt < existing.remoteUpdatedAt) return {
		resolvedQuote: existing,
		disposition: "ignored-stale"
	};
	if (existing.remoteUpdatedAt !== null && incoming.remoteUpdatedAt !== null && incoming.remoteUpdatedAt === existing.remoteUpdatedAt && (!incoming.amountPaid.equals(existing.amountPaid) || !incoming.amountIssued.equals(existing.amountIssued))) return {
		resolvedQuote: existing,
		disposition: "ignored-conflicting-accounting"
	};
	if (isStatefulMintQuote(existing) && isStatefulMintQuote(incoming) && existing.remoteUpdatedAt !== null && incoming.remoteUpdatedAt === null) return {
		resolvedQuote: existing,
		disposition: "ignored-stale"
	};
	if (hasAccountingComponentDecrease(existing, incoming)) return {
		resolvedQuote: existing,
		disposition: "ignored-stale"
	};
	if (existing.remoteUpdatedAt === null || incoming.remoteUpdatedAt === null) {
		if (!incoming.amountPaid.add(incoming.amountIssued).greaterThan(existing.amountPaid.add(existing.amountIssued))) return {
			resolvedQuote: existing,
			disposition: "ignored-stale"
		};
	}
	const resolvedQuote = withCanonicalCompatibilityProjection(existing.remoteUpdatedAt !== null && incoming.remoteUpdatedAt === null ? {
		...incoming,
		remoteUpdatedAt: existing.remoteUpdatedAt
	} : incoming);
	if (hasMeaningfulChange(existing, resolvedQuote)) return {
		resolvedQuote,
		disposition: "accepted-meaningful-change"
	};
	if (existing.remoteUpdatedAt === resolvedQuote.remoteUpdatedAt) return {
		resolvedQuote: existing,
		disposition: "ignored-unchanged"
	};
	return {
		resolvedQuote,
		disposition: "accepted-freshness-only"
	};
}

//#endregion
//#region quotes/QuoteLifecycle.ts
const BUILT_IN_MINT_METHODS = new Set([
	"bolt11",
	"bolt12",
	"onchain"
]);
const DEFINITIVE_BATCH_FAILURE_CATEGORIES = new Set([
	"incompatibility",
	"batch-size",
	"malformed-response",
	"validation"
]);
function hasReusableSettlementAmounts(snapshot) {
	if (!snapshot || typeof snapshot !== "object") return false;
	const settlement = snapshot;
	return settlement.amount_paid !== void 0 && settlement.amount_issued !== void 0;
}
function assertMintQuotePollingSnapshotStructureUnchecked(method, snapshot) {
	if (typeof snapshot.quote !== "string" || snapshot.quote.length === 0 || typeof snapshot.request !== "string" || snapshot.request.length === 0 || typeof snapshot.unit !== "string" || snapshot.unit.trim().length === 0 || snapshot.expiry !== null && snapshot.expiry !== void 0 && !Number.isSafeInteger(snapshot.expiry) || snapshot.pubkey !== void 0 && typeof snapshot.pubkey !== "string") throw new MintQuoteValidationError("Mint quote batch observation has invalid base fields");
	if (method === "bolt11") {
		const bolt11 = snapshot;
		const amount = Amount$1.from(bolt11.amount);
		const hasState = bolt11.state !== void 0;
		const hasAmountPaid = bolt11.amount_paid !== void 0;
		const hasAmountIssued = bolt11.amount_issued !== void 0;
		const hasCompleteAccounting = hasAmountPaid && hasAmountIssued;
		if (amount.isZero() || !hasCompleteAccounting) throw new MintQuoteValidationError("BOLT11 mint quote batch observation is invalid");
		if (hasState && bolt11.state !== "UNPAID" && bolt11.state !== "PAID" && bolt11.state !== "ISSUED") throw new MintQuoteValidationError("BOLT11 mint quote batch observation is invalid");
		if (!hasState) throw new MintQuoteValidationError("BOLT11 mint quote batch observation is invalid");
		if (hasCompleteAccounting) {
			Amount$1.from(bolt11.amount_paid);
			Amount$1.from(bolt11.amount_issued);
		}
		return bolt11;
	}
	const reusable = snapshot;
	if (!hasReusableSettlementAmounts(reusable)) throw new MintQuoteValidationError(`${method} mint quote batch observation lacks settlement data`);
	Amount$1.from(reusable.amount_paid ?? Amount$1.zero());
	Amount$1.from(reusable.amount_issued ?? Amount$1.zero());
	if (method === "bolt12") {
		const amount = snapshot.amount;
		if (amount !== void 0 && amount !== null) Amount$1.from(amount);
	}
	return snapshot;
}
function assertMintQuotePollingSnapshotStructure(method, snapshot) {
	try {
		return assertMintQuotePollingSnapshotStructureUnchecked(method, snapshot);
	} catch (error) {
		if (error instanceof MintQuoteValidationError) throw error;
		throw new MintQuoteValidationError(`${method} mint quote batch observation has invalid amount fields`, error);
	}
}
function isDefinitiveMintQuotePollingValidation(error) {
	return error instanceof MintQuoteValidationError || error instanceof QuoteIdentityConflictError;
}
function equalOptionalAmount(left, right) {
	if (left == null || right == null) return left == null && right == null;
	return Amount$1.from(left).equals(Amount$1.from(right));
}
function areMintQuotePollingSnapshotsEqual(method, left, right) {
	if (left.quote !== right.quote || left.request !== right.request || normalizeUnit(left.unit) !== normalizeUnit(right.unit) || left.expiry !== right.expiry || left.updated_at !== right.updated_at || left.pubkey !== right.pubkey) return false;
	if (method === "bolt11") {
		const leftBolt11 = left;
		const rightBolt11 = right;
		return Amount$1.from(leftBolt11.amount).equals(Amount$1.from(rightBolt11.amount)) && leftBolt11.state === rightBolt11.state && Amount$1.from(leftBolt11.amount_paid).equals(Amount$1.from(rightBolt11.amount_paid)) && Amount$1.from(leftBolt11.amount_issued).equals(Amount$1.from(rightBolt11.amount_issued));
	}
	const leftReusable = left;
	const rightReusable = right;
	if (!Amount$1.from(leftReusable.amount_paid ?? Amount$1.zero()).equals(Amount$1.from(rightReusable.amount_paid ?? Amount$1.zero())) || !Amount$1.from(leftReusable.amount_issued ?? Amount$1.zero()).equals(Amount$1.from(rightReusable.amount_issued ?? Amount$1.zero()))) return false;
	return method !== "bolt12" || equalOptionalAmount(left.amount, right.amount);
}
function normalizePollingError(error) {
	return error instanceof Error ? error : new Error(String(error));
}
function classifyMintQuotePollingFailure(error) {
	if (error instanceof NetworkError) return "network";
	if (error instanceof MintOperationError) {
		if (error.code === 11017) return "batch-size";
		if (error.code === 31004) return "rate-limit";
		if (error.code >= 3e4) return "authentication";
		return "validation";
	}
	if (error instanceof HttpResponseError) {
		if (error.status >= 200 && error.status < 300) return "malformed-response";
		if (error.status === 401 || error.status === 403) return "authentication";
		if (error.status === 429) return "rate-limit";
		if (error.status === 404 || error.status === 405 || error.status === 501) return "incompatibility";
		if (error.status >= 500) return "server";
	}
	if (error && typeof error === "object" && "cause" in error) {
		const cause = error.cause;
		if (cause !== void 0 && cause !== error) return classifyMintQuotePollingFailure(cause);
	}
	if (error instanceof Error && /auth/i.test(error.name)) return "authentication";
	return "validation";
}
function failedMintQuotePollingResult(identities, category, error) {
	const normalizedError = normalizePollingError(error);
	return {
		outcomes: identities.map((identity) => ({
			status: "failed",
			identity,
			failure: {
				category,
				error: normalizedError
			}
		})),
		responseFailures: []
	};
}
function serializeMeltChange(change) {
	return change ?? [];
}
function getMeaningfulMeltQuoteFields(quote) {
	const base = {
		method: quote.method,
		quoteId: quote.quoteId,
		request: quote.request,
		amount: quote.amount.toString(),
		unit: quote.unit,
		expiry: quote.expiry,
		state: quote.state,
		change: serializeMeltChange(quote.change)
	};
	if (quote.method === "onchain") return {
		...base,
		fee_options: quote.fee_options.map((option) => ({
			fee_index: option.fee_index,
			fee_reserve: option.fee_reserve.toString(),
			estimated_blocks: option.estimated_blocks
		})),
		outpoint: quote.outpoint ?? null
	};
	return {
		...base,
		fee_reserve: quote.fee_reserve.toString(),
		payment_preimage: quote.payment_preimage ?? null
	};
}
function getMeltQuoteChange(existing, incoming) {
	if (!existing) return true;
	return JSON.stringify(getMeaningfulMeltQuoteFields(existing)) !== JSON.stringify(getMeaningfulMeltQuoteFields(incoming));
}
function mergePaidMeltQuoteSettlement(existing, incoming) {
	if (existing.state !== "PAID" || incoming.state !== "PAID" || existing.method !== incoming.method) return null;
	let changed = false;
	let merged = {
		...existing,
		lastObservedRemoteState: incoming.lastObservedRemoteState ?? existing.lastObservedRemoteState,
		lastObservedRemoteStateAt: incoming.lastObservedRemoteStateAt ?? existing.lastObservedRemoteStateAt,
		updatedAt: incoming.updatedAt
	};
	if (!Array.isArray(existing.change) && Array.isArray(incoming.change)) {
		merged = {
			...merged,
			change: incoming.change
		};
		changed = true;
	}
	if (existing.method === "onchain" && incoming.method === "onchain") {
		if (existing.outpoint == null && incoming.outpoint != null) {
			merged = {
				...merged,
				outpoint: incoming.outpoint
			};
			changed = true;
		}
	} else if (existing.method !== "onchain" && incoming.method !== "onchain") {
		if (existing.payment_preimage == null && incoming.payment_preimage != null) {
			merged = {
				...merged,
				payment_preimage: incoming.payment_preimage
			};
			changed = true;
		}
	}
	return changed ? merged : null;
}
var QuoteLifecycle = class {
	mintHandlerProvider;
	meltHandlerProvider;
	mintQuoteRepository;
	meltQuoteRepository;
	proofRepository;
	proofService;
	mintService;
	walletService;
	mintAdapter;
	eventBus;
	logger;
	withMintQuoteTransaction;
	mintQuoteObservationLock = new MintScopedLock();
	batchUnavailablePollingMethodsByMint = /* @__PURE__ */ new Map();
	constructor(deps) {
		this.mintHandlerProvider = deps.mintHandlerProvider;
		this.meltHandlerProvider = deps.meltHandlerProvider;
		this.mintQuoteRepository = deps.mintQuoteRepository;
		this.meltQuoteRepository = deps.meltQuoteRepository;
		this.proofRepository = deps.proofRepository;
		this.proofService = deps.proofService;
		this.mintService = deps.mintService;
		this.walletService = deps.walletService;
		this.mintAdapter = deps.mintAdapter;
		this.eventBus = deps.eventBus;
		this.logger = deps.logger;
		this.withMintQuoteTransaction = deps.withMintQuoteTransaction ?? ((fn) => fn(this.mintQuoteRepository));
		this.eventBus.on("mint:metadata-refreshed", ({ mintUrl }) => {
			this.clearBatchUnavailablePollingGroups(mintUrl);
		});
	}
	isBatchUnavailableForPolling(mintUrl, method) {
		return this.batchUnavailablePollingMethodsByMint.get(normalizeMintUrl(mintUrl))?.has(method) === true;
	}
	markBatchUnavailableForPolling(mintUrl, method) {
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		const unavailableMethods = this.batchUnavailablePollingMethodsByMint.get(normalizedMintUrl) ?? /* @__PURE__ */ new Set();
		if (unavailableMethods.has(method)) return;
		unavailableMethods.add(method);
		this.batchUnavailablePollingMethodsByMint.set(normalizedMintUrl, unavailableMethods);
		this.logger?.warn("Disabling batch mint quote polling for the Coco Session", {
			mintUrl: normalizedMintUrl,
			method
		});
	}
	clearBatchUnavailablePollingGroups(mintUrl) {
		this.batchUnavailablePollingMethodsByMint.delete(normalizeMintUrl(mintUrl));
	}
	recordDefinitiveBatchPollingFailure(mintUrl, method, category) {
		if (DEFINITIVE_BATCH_FAILURE_CATEGORIES.has(category)) this.markBatchUnavailableForPolling(mintUrl, method);
	}
	buildDeps() {
		return {
			proofRepository: this.proofRepository,
			proofService: this.proofService,
			walletService: this.walletService,
			mintService: this.mintService,
			mintAdapter: this.mintAdapter,
			eventBus: this.eventBus,
			logger: this.logger
		};
	}
	async refreshResolvedMintQuote(existingQuote) {
		const refreshed = await this.mintHandlerProvider.get(existingQuote.method).fetchRemoteQuote({
			...this.buildDeps(),
			quote: existingQuote
		});
		const { quote, remoteStateChanged } = await this.resolveAndPersistMintQuoteObservation(refreshed);
		await this.emitMintQuoteUpdatedIfNeeded(quote, remoteStateChanged);
		return quote;
	}
	async refreshResolvedMeltQuote(existingQuote) {
		const refreshed = await this.meltHandlerProvider.get(existingQuote.method).fetchRemoteQuote({
			...this.buildDeps(),
			quote: existingQuote
		});
		return await this.recordMeltQuoteObservation(refreshed);
	}
	async createMintQuote(mintUrl, methodOrIntent, createQuoteDataOrMethod) {
		const method = typeof methodOrIntent === "string" ? methodOrIntent : typeof createQuoteDataOrMethod === "string" ? createQuoteDataOrMethod : "bolt11";
		const createQuoteData = typeof methodOrIntent === "string" ? createQuoteDataOrMethod : { amount: normalizeUnitAmount(methodOrIntent) };
		const parsed = "amount" in createQuoteData && createQuoteData.amount !== void 0 ? normalizeUnitAmount(createQuoteData.amount) : void 0;
		const unit = parsed?.unit ?? normalizeUnit("unit" in createQuoteData ? createQuoteData.unit : void 0, { defaultUnit: DEFAULT_UNIT });
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		if (parsed?.amount.isZero()) throw new ProofValidationError("Amount must be a positive number");
		await this.mintService.assertMethodUnitSupported(mintUrl, 4, method, parsed ?? unit);
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, unit);
		const quote = await this.mintHandlerProvider.get(method).createQuote({
			...this.buildDeps(),
			mintUrl,
			createQuoteData,
			wallet
		});
		await this.mintQuoteRepository.upsertMintQuote(quote);
		const persistedQuote = await this.mintQuoteRepository.getMintQuote(mintUrl, method, quote.quoteId) ?? quote;
		this.logger?.info("Mint quote created", {
			mintUrl: persistedQuote.mintUrl,
			quoteId: persistedQuote.quoteId,
			method,
			amount: getMintQuoteAmount(persistedQuote)?.toString(),
			unit: persistedQuote.unit
		});
		await this.eventBus.emit("mint-quote:updated", {
			mintUrl: persistedQuote.mintUrl,
			method: persistedQuote.method,
			quoteId: persistedQuote.quoteId,
			quote: persistedQuote
		});
		return persistedQuote;
	}
	getMintQuote(mintUrl, method, quoteId) {
		return this.mintQuoteRepository.getMintQuote(mintUrl, method, quoteId);
	}
	getMintQuoteById(identity) {
		return this.mintQuoteRepository.getMintQuoteById(identity);
	}
	getPendingMintQuotes(method) {
		return this.mintQuoteRepository.getPendingMintQuotes(method);
	}
	/** Returns the advertised and safety-capped size for one Background Watcher opportunity. */
	async getMintQuotePollingLimit(mintUrl, method) {
		if (this.isBatchUnavailableForPolling(mintUrl, method)) return 1;
		return this.mintService.getNut29MintQuoteCheckLimit(mintUrl, method);
	}
	/**
	* Checks selected mint quotes through the lifecycle polling seam.
	*
	* NUT-29 is used when advertised, with identity-based response attribution and
	* one explicit outcome for every selected quote. Attributable observations are
	* persisted before any update events are emitted, even when other response
	* elements are missing, duplicated, extra, malformed, or conflict with canonical
	* quote data. A single selection falls back to the existing single-quote endpoint
	* when NUT-29 is unavailable; multiple selections never fan out implicitly.
	*/
	async checkMintQuotesForPolling(method, identities) {
		if (identities.length === 0) return {
			outcomes: [],
			responseFailures: []
		};
		const normalizedIdentities = identities.map((identity) => ({
			mintUrl: normalizeMintUrl(identity.mintUrl),
			quoteId: identity.quoteId
		}));
		const mintUrl = normalizedIdentities[0].mintUrl;
		const uniqueMintUrls = new Set(normalizedIdentities.map((identity) => identity.mintUrl));
		const uniqueQuoteIds = new Set(normalizedIdentities.map((identity) => identity.quoteId));
		if (uniqueMintUrls.size !== 1 || uniqueQuoteIds.size !== normalizedIdentities.length || normalizedIdentities.some((identity) => identity.quoteId.length === 0)) return failedMintQuotePollingResult(normalizedIdentities, "validation", new MintQuoteValidationError("Mint quote polling selections require one mint and unique non-empty quote identities"));
		if (!BUILT_IN_MINT_METHODS.has(method)) return failedMintQuotePollingResult(normalizedIdentities, "validation", new MintQuoteValidationError(`Unsupported built-in mint quote polling method ${method}`));
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		let useBatch;
		try {
			useBatch = !this.isBatchUnavailableForPolling(mintUrl, method) && await this.mintService.supportsNut29MintQuoteCheck(mintUrl, method);
		} catch (error) {
			return failedMintQuotePollingResult(normalizedIdentities, classifyMintQuotePollingFailure(error), error);
		}
		if (!useBatch && normalizedIdentities.length > 1) return failedMintQuotePollingResult(normalizedIdentities, "incompatibility", new MintQuoteValidationError(`Mint ${mintUrl} does not advertise NUT-29 quote checks for ${method}`));
		let response;
		try {
			response = useBatch ? await this.mintAdapter.checkMintQuoteBatch(mintUrl, method, normalizedIdentities.map((identity) => identity.quoteId)) : [await this.mintAdapter.checkMintQuote(mintUrl, method, normalizedIdentities[0].quoteId)];
		} catch (error) {
			const category = classifyMintQuotePollingFailure(error);
			if (useBatch) this.recordDefinitiveBatchPollingFailure(mintUrl, method, category);
			return failedMintQuotePollingResult(normalizedIdentities, category, error);
		}
		if (!Array.isArray(response)) {
			if (useBatch) this.recordDefinitiveBatchPollingFailure(mintUrl, method, "malformed-response");
			return failedMintQuotePollingResult(normalizedIdentities, "malformed-response", new MintQuoteValidationError("Mint quote batch check returned a non-array response"));
		}
		const snapshots = response;
		const selectedQuoteIds = new Set(normalizedIdentities.map((identity) => identity.quoteId));
		const snapshotsByQuoteId = /* @__PURE__ */ new Map();
		const responseFailures = [];
		for (const [responseIndex, snapshot] of snapshots.entries()) {
			if (!snapshot || typeof snapshot !== "object") {
				responseFailures.push({
					category: "malformed-response",
					error: new MintQuoteValidationError(`Mint quote batch response element ${responseIndex} has no identity`),
					responseIndex
				});
				continue;
			}
			const responseQuoteId = snapshot.quote;
			if (typeof responseQuoteId !== "string" || responseQuoteId.length === 0) {
				responseFailures.push({
					category: "malformed-response",
					error: new MintQuoteValidationError(`Mint quote batch response element ${responseIndex} has no identity`),
					responseIndex
				});
				continue;
			}
			if (!selectedQuoteIds.has(responseQuoteId)) {
				responseFailures.push({
					category: "malformed-response",
					error: new MintQuoteValidationError(`Mint quote batch response contains unselected quote ${responseQuoteId}`),
					responseIndex,
					responseQuoteId
				});
				continue;
			}
			const candidates = snapshotsByQuoteId.get(responseQuoteId) ?? [];
			candidates.push({
				snapshot: {
					...snapshot,
					pubkey: snapshot.pubkey ?? void 0
				},
				responseIndex
			});
			snapshotsByQuoteId.set(responseQuoteId, candidates);
		}
		let hasDefinitiveBatchFailure = responseFailures.length > 0;
		const persisted = [];
		const failedByQuoteId = /* @__PURE__ */ new Map();
		for (const identity of normalizedIdentities) {
			const candidates = snapshotsByQuoteId.get(identity.quoteId) ?? [];
			if (candidates.length === 0) {
				hasDefinitiveBatchFailure = true;
				failedByQuoteId.set(identity.quoteId, {
					category: "malformed-response",
					error: new MintQuoteValidationError(`Mint quote batch response is missing quote ${identity.quoteId}`),
					responseQuoteId: identity.quoteId
				});
				continue;
			}
			const validCandidates = [];
			const invalidCandidates = [];
			for (const candidate of candidates) try {
				const snapshot = await this.assertAttributableMintQuotePollingSnapshot(mintUrl, method, identity.quoteId, candidate.snapshot);
				validCandidates.push({
					...candidate,
					snapshot
				});
			} catch (error) {
				const normalizedError = normalizePollingError(error);
				invalidCandidates.push({
					error: normalizedError,
					responseIndex: candidate.responseIndex,
					definitive: isDefinitiveMintQuotePollingValidation(normalizedError)
				});
			}
			if (validCandidates.length === 0) {
				if (invalidCandidates.some(({ definitive }) => definitive)) hasDefinitiveBatchFailure = true;
				const [firstFailure, ...additionalFailures] = invalidCandidates;
				failedByQuoteId.set(identity.quoteId, {
					category: "validation",
					error: firstFailure.error,
					responseQuoteId: identity.quoteId
				});
				responseFailures.push(...additionalFailures.map(({ error, responseIndex }) => ({
					category: "validation",
					error,
					responseIndex,
					responseQuoteId: identity.quoteId
				})));
				continue;
			}
			const firstValid = validCandidates[0];
			if (validCandidates.some(({ snapshot }) => !areMintQuotePollingSnapshotsEqual(method, firstValid.snapshot, snapshot))) {
				hasDefinitiveBatchFailure = true;
				failedByQuoteId.set(identity.quoteId, {
					category: "malformed-response",
					error: new MintQuoteValidationError(`Mint quote batch response contains conflicting duplicates for quote ${identity.quoteId}`),
					responseQuoteId: identity.quoteId
				});
				continue;
			}
			if (validCandidates.length > 1 || invalidCandidates.some(({ definitive }) => definitive)) hasDefinitiveBatchFailure = true;
			responseFailures.push(...validCandidates.slice(1).map(({ responseIndex }) => ({
				category: "malformed-response",
				error: new MintQuoteValidationError(`Mint quote batch response contains duplicate quote ${identity.quoteId}`),
				responseIndex,
				responseQuoteId: identity.quoteId
			})), ...invalidCandidates.map(({ error, responseIndex }) => ({
				category: "validation",
				error,
				responseIndex,
				responseQuoteId: identity.quoteId
			})));
			try {
				const result = await this.resolveAndPersistMintQuoteSnapshot(mintUrl, method, firstValid.snapshot);
				persisted.push({
					identity,
					...result
				});
			} catch (error) {
				failedByQuoteId.set(identity.quoteId, {
					category: "validation",
					error: normalizePollingError(error),
					responseQuoteId: identity.quoteId
				});
			}
		}
		for (const result of persisted) await this.emitMintQuoteUpdatedIfNeeded(result.quote, result.remoteStateChanged);
		const persistedByQuoteId = new Map(persisted.map(({ identity, quote }) => [identity.quoteId, quote]));
		const result = {
			outcomes: normalizedIdentities.map((identity) => {
				const quote = persistedByQuoteId.get(identity.quoteId);
				if (quote) return {
					status: "updated",
					identity,
					quote
				};
				return {
					status: "failed",
					identity,
					failure: failedByQuoteId.get(identity.quoteId)
				};
			}),
			responseFailures
		};
		if (useBatch && hasDefinitiveBatchFailure) this.markBatchUnavailableForPolling(mintUrl, method);
		return result;
	}
	async assertAttributableMintQuotePollingSnapshot(mintUrl, method, quoteId, snapshot) {
		snapshot = assertMintQuotePollingSnapshotStructure(method, snapshot);
		const existing = await this.mintQuoteRepository.getMintQuoteById({
			mintUrl,
			quoteId
		});
		if (!existing) throw new MintQuoteValidationError(`Mint quote ${quoteId} batch observation has no canonical quote`);
		if (existing.method !== method) throw new QuoteIdentityConflictError("mint", mintUrl, quoteId, [method, existing.method]);
		if (snapshot.quote !== quoteId || snapshot.request !== existing.request || normalizeUnit(snapshot.unit) !== existing.unit || (snapshot.pubkey ?? void 0) !== (existing.pubkey ?? void 0)) throw new MintQuoteValidationError(`Mint quote ${quoteId} batch observation conflicts with canonical identity fields`);
		if (existing.method === "bolt11") {
			if (!Amount$1.from(snapshot.amount).equals(existing.amount)) throw new MintQuoteValidationError(`Mint quote ${quoteId} batch observation conflicts with canonical amount`);
			return snapshot;
		}
		if (existing.method === "bolt12") {
			const incomingAmount = snapshot.amount;
			const existingAmount = existing.quoteData.amount;
			if (incomingAmount == null !== (existingAmount === void 0) || incomingAmount != null && existingAmount !== void 0 && !Amount$1.from(incomingAmount).equals(existingAmount)) throw new MintQuoteValidationError(`Mint quote ${quoteId} batch observation conflicts with canonical amount`);
		}
		return snapshot;
	}
	async refreshMintQuote(mintUrl, method, quoteId) {
		const existingQuote = await this.mintQuoteRepository.getMintQuote(mintUrl, method, quoteId);
		if (!existingQuote) throw new Error(`Mint quote ${quoteId} for ${method} at ${mintUrl} was not found`);
		return this.refreshResolvedMintQuote(existingQuote);
	}
	async refreshMintQuoteById(identity) {
		const existingQuote = await this.mintQuoteRepository.getMintQuoteById(identity);
		if (!existingQuote) throw new Error(`Mint quote ${identity.quoteId} at ${identity.mintUrl} was not found`);
		return this.refreshResolvedMintQuote(existingQuote);
	}
	async requireMintQuoteForPrepare(mintUrl, method, quoteId, expectedUnit) {
		const quote = await this.mintQuoteRepository.getMintQuote(mintUrl, method, quoteId);
		if (!quote) throw new Error(`Mint quote ${quoteId} for ${method} at ${mintUrl} was not found`);
		if (expectedUnit && quote.unit !== expectedUnit.toLowerCase()) throw new Error(`Mint quote ${quoteId} unit ${quote.unit} does not match requested unit ${expectedUnit}`);
		this.assertMintQuoteCanPrepare(quote, `mint quote ${quoteId}`);
		return quote;
	}
	async requireMintQuoteRefForPrepare(ref) {
		const quote = await this.mintQuoteRepository.getMintQuoteById({
			mintUrl: ref.mintUrl,
			quoteId: ref.quoteId
		});
		if (!quote) throw new Error(`Mint quote ${ref.quoteId} at ${ref.mintUrl} was not found`);
		if (quote.method !== ref.method) throw new QuoteIdentityConflictError("mint", quote.mintUrl, quote.quoteId, [ref.method, quote.method], `Mint quote ${quote.quoteId} at ${quote.mintUrl} resolved to method ${quote.method}, not requested method ${ref.method}`);
		this.assertMintQuoteCanPrepare(quote, `mint quote ${ref.quoteId}`);
		return quote;
	}
	async loadMintQuoteSnapshotForOperation(op) {
		if (!op.quoteId) throw new Error(`Cannot prepare operation ${op.id}: no mint quote ID is attached`);
		const quote = await this.mintQuoteRepository.getMintQuote(op.mintUrl, op.method, op.quoteId);
		if (!quote) throw new Error(`Cannot prepare operation ${op.id}: mint quote ${op.quoteId} for ${op.method} at ${op.mintUrl} was not found`);
		this.assertMintQuoteCanPrepare(quote, `operation ${op.id} mint quote ${op.quoteId}`);
		const quoteAmount = getMintQuoteAmount(quote);
		if (quoteAmount && !quoteAmount.equals(op.amount)) throw new Error(`Cannot prepare operation ${op.id}: mint quote ${op.quoteId} amount ${quoteAmount} does not match requested amount ${op.amount}`);
		if (quote.unit !== op.unit) throw new Error(`Cannot prepare operation ${op.id}: mint quote ${op.quoteId} unit ${quote.unit} does not match requested unit ${op.unit}`);
		return mintQuoteToMethodSnapshot(quote);
	}
	async importMintQuote(mintUrl, method, quote) {
		const normalizedMintUrl = normalizeMintUrl(mintUrl);
		if (!await this.mintService.isTrustedMint(normalizedMintUrl)) throw new UnknownMintError(`Mint ${normalizedMintUrl} is not trusted`);
		const { quote: imported, remoteStateChanged } = await this.resolveAndPersistMintQuoteSnapshot(normalizedMintUrl, method, this.normalizeImportedMintQuoteSnapshot(method, quote), {
			beforePersist: (resolvedQuote) => this.assertMintQuoteCapabilities(resolvedQuote),
			validateAccounting: true
		});
		await this.emitMintQuoteUpdatedIfNeeded(imported, remoteStateChanged);
		return imported;
	}
	normalizeImportedMintQuoteSnapshot(method, quote) {
		const reportedMethod = quote.method;
		if (reportedMethod !== void 0 && reportedMethod !== method) throw new MintQuoteValidationError(`Mint quote ${quote.quote} reports method ${String(reportedMethod)} instead of ${method}`);
		const updatedAt = quote.updated_at;
		if (updatedAt !== void 0 && updatedAt !== null && (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt))) throw new MintQuoteValidationError(`Mint quote ${quote.quote} has invalid updated_at`);
		if (method === "bolt11") {
			const bolt11Quote = quote;
			const rawAmount = bolt11Quote.amount;
			if (rawAmount === void 0 || rawAmount === null) throw new MintQuoteValidationError("Mint quote " + bolt11Quote.quote + " has invalid amount");
			const amount = Amount$1.from(rawAmount);
			if (amount.isZero()) throw new MintQuoteValidationError("Mint quote " + bolt11Quote.quote + " has invalid amount");
			const hasAmountPaid = bolt11Quote.amount_paid !== void 0;
			const hasAmountIssued = bolt11Quote.amount_issued !== void 0;
			if (hasAmountPaid !== hasAmountIssued) throw new MintQuoteValidationError(`Mint quote ${bolt11Quote.quote} has incomplete accounting`);
			let amountPaid;
			let amountIssued;
			if (hasAmountPaid && hasAmountIssued) {
				amountPaid = Amount$1.from(bolt11Quote.amount_paid);
				amountIssued = Amount$1.from(bolt11Quote.amount_issued);
			} else if (bolt11Quote.state === "UNPAID") {
				amountPaid = Amount$1.zero();
				amountIssued = Amount$1.zero();
			} else if (bolt11Quote.state === "PAID") {
				amountPaid = amount;
				amountIssued = Amount$1.zero();
			} else if (bolt11Quote.state === "ISSUED") {
				amountPaid = amount;
				amountIssued = amount;
			} else throw new MintQuoteValidationError(`Mint quote ${bolt11Quote.quote} lacks accounting and compatibility state`);
			if (amountIssued.greaterThan(amountPaid)) throw new MintQuoteValidationError(`Mint quote ${bolt11Quote.quote} has amount_issued greater than amount_paid`);
			const state = deriveBolt11MintQuoteState(amountPaid, amountIssued);
			return {
				...bolt11Quote,
				method: "bolt11",
				amount,
				amount_paid: amountPaid,
				amount_issued: amountIssued,
				updated_at: updatedAt ?? null,
				state
			};
		}
		return {
			...quote,
			method,
			updated_at: updatedAt ?? null
		};
	}
	async resolveAndPersistMintQuoteSnapshot(mintUrl, method, quote, options = {}) {
		const canonicalQuote = this.mintQuoteFromSnapshot(mintUrl, method, quote, options.validateAccounting ?? false);
		const resolution = await this.resolveAndPersistMintQuoteObservation(canonicalQuote, options.beforePersist);
		return {
			quote: resolution.quote,
			remoteStateChanged: resolution.remoteStateChanged
		};
	}
	mintQuoteFromSnapshot(mintUrl, method, quote, validateAccounting) {
		if (method === "bolt11") {
			const bolt11Quote = quote;
			const rawAmount = bolt11Quote.amount;
			if (rawAmount === void 0 || rawAmount === null) throw new MintQuoteValidationError("Mint quote " + bolt11Quote.quote + " has invalid amount");
			const amount = Amount$1.from(rawAmount);
			if (amount.isZero()) throw new MintQuoteValidationError("Mint quote " + bolt11Quote.quote + " has invalid amount");
			const response = {
				...bolt11Quote,
				amount
			};
			return validateAccounting ? mintQuoteFromBolt11Response(mintUrl, response) : mintQuoteObservationFromBolt11Response(mintUrl, response);
		}
		if (method === "onchain") {
			const onchainQuote = quote;
			return validateAccounting ? mintQuoteFromOnchainResponse(mintUrl, onchainQuote) : mintQuoteObservationFromOnchainResponse(mintUrl, onchainQuote);
		}
		if (method === "bolt12") {
			const bolt12Quote = quote;
			return validateAccounting ? mintQuoteFromBolt12Response(mintUrl, bolt12Quote) : mintQuoteObservationFromBolt12Response(mintUrl, bolt12Quote);
		}
		throw new Error(`Unsupported mint quote import method ${String(method)}`);
	}
	async resolveAndPersistMintQuoteObservation(canonicalQuote, beforePersist) {
		await beforePersist?.(canonicalQuote);
		return this.resolveAndPersistMintQuoteObservationUnderLock(canonicalQuote, () => canonicalQuote);
	}
	async resolveAndPersistMintQuoteObservationUnderLock(ref, buildObservation) {
		const observationKey = [
			ref.mintUrl,
			ref.method,
			ref.quoteId
		].join("::");
		const release = await this.mintQuoteObservationLock.acquire(observationKey);
		try {
			return await this.withMintQuoteTransaction(async (repository) => {
				const existing = await repository.getMintQuote(ref.mintUrl, ref.method, ref.quoteId);
				const canonicalQuote = buildObservation(existing);
				const resolution = resolveMintQuoteObservation(existing, canonicalQuote);
				this.warnForIgnoredMintQuoteObservation(resolution.disposition, existing, canonicalQuote);
				if (resolution.disposition === "ignored-stale" || resolution.disposition === "ignored-conflicting-accounting" || resolution.disposition === "ignored-invalid-background" || resolution.disposition === "ignored-unchanged") return {
					quote: resolution.resolvedQuote,
					remoteStateChanged: false,
					existingQuote: existing
				};
				return {
					quote: await this.persistCanonicalMintQuote(repository, resolution.resolvedQuote),
					remoteStateChanged: resolution.disposition === "accepted-meaningful-change",
					existingQuote: existing
				};
			});
		} finally {
			release();
		}
	}
	warnForIgnoredMintQuoteObservation(disposition, existing, incoming) {
		const message = disposition === "ignored-invalid-background" ? "Ignoring Mint Quote Observation with invalid accounting" : disposition === "ignored-conflicting-accounting" ? "Ignoring Mint Quote Observation with conflicting accounting at unchanged Remote Quote Update Time" : null;
		if (!message) return;
		this.logger?.warn(message, {
			mintUrl: incoming.mintUrl,
			method: incoming.method,
			quoteId: incoming.quoteId,
			existingRemoteUpdatedAt: existing?.remoteUpdatedAt ?? null,
			incomingRemoteUpdatedAt: incoming.remoteUpdatedAt,
			existingAmountPaid: existing?.amountPaid.toString(),
			existingAmountIssued: existing?.amountIssued.toString(),
			incomingAmountPaid: incoming.amountPaid.toString(),
			incomingAmountIssued: incoming.amountIssued.toString()
		});
	}
	async recordMintQuoteSnapshot(mintUrl, method, snapshot) {
		const { quote, remoteStateChanged } = await this.resolveAndPersistMintQuoteSnapshot(mintUrl, method, snapshot);
		await this.emitMintQuoteUpdatedIfNeeded(quote, remoteStateChanged);
		return quote;
	}
	async recordMintQuoteObservation(operation, state, observedAt = Date.now()) {
		await this.ensureMintQuoteRecordForOperation(operation);
		const { quote, remoteStateChanged } = await this.resolveAndPersistMintQuoteObservationUnderLock(operation, (existing) => {
			if (!existing) throw new Error(`Cannot record quote observation: mint quote ${operation.quoteId} for ${operation.method} at ${operation.mintUrl} was not found`);
			if (!isStatefulMintQuote(existing)) throw new MintQuoteValidationError(`Cannot record legacy quote state for ${operation.method} mint quote ${operation.quoteId}`);
			return applyBolt11MintQuoteStateFallback(existing, state, observedAt);
		});
		await this.emitMintQuoteUpdatedIfNeeded(quote, remoteStateChanged);
		return quote;
	}
	async createMeltQuote(mintUrl, method, methodData, unit = DEFAULT_UNIT) {
		const normalizedUnit = normalizeUnit(unit, { defaultUnit: DEFAULT_UNIT });
		if (!await this.mintService.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
		const normalizedMethodData = normalizeMeltMethodData(methodData);
		if ("amountSats" in normalizedMethodData && normalizedMethodData.amountSats !== void 0 && normalizedMethodData.amountSats.isZero()) throw new ProofValidationError("Amount must be a positive number");
		await this.mintService.assertMethodUnitSupported(mintUrl, 5, method, normalizedUnit);
		const { wallet } = await this.walletService.getWalletWithActiveKeysetId(mintUrl, normalizedUnit);
		const quote = await this.meltHandlerProvider.get(method).createQuote({
			...this.buildDeps(),
			mintUrl,
			methodData: normalizedMethodData,
			unit: normalizedUnit,
			wallet
		});
		if (quote.unit !== normalizedUnit) throw new ProofValidationError(`Melt quote ${quote.quoteId} unit ${quote.unit} does not match requested unit ${normalizedUnit}`);
		return await this.recordMeltQuoteObservation(quote);
	}
	getMeltQuote(mintUrl, method, quoteId) {
		return this.meltQuoteRepository.getMeltQuote(mintUrl, method, quoteId);
	}
	getMeltQuoteById(identity) {
		return this.meltQuoteRepository.getMeltQuoteById(identity);
	}
	getPendingMeltQuotes(method) {
		return this.meltQuoteRepository.getPendingMeltQuotes(method);
	}
	async refreshMeltQuote(mintUrl, method, quoteId) {
		const existingQuote = await this.meltQuoteRepository.getMeltQuote(mintUrl, method, quoteId);
		if (!existingQuote) throw new Error(`Melt quote ${quoteId} for ${method} at ${mintUrl} was not found`);
		return this.refreshResolvedMeltQuote(existingQuote);
	}
	async refreshMeltQuoteById(identity) {
		const existingQuote = await this.meltQuoteRepository.getMeltQuoteById(identity);
		if (!existingQuote) throw new Error(`Melt quote ${identity.quoteId} at ${identity.mintUrl} was not found`);
		return this.refreshResolvedMeltQuote(existingQuote);
	}
	async requireMeltQuoteForPrepare(mintUrl, method, quoteId, expectedUnit) {
		const quote = await this.meltQuoteRepository.getMeltQuote(mintUrl, method, quoteId);
		if (!quote) throw new Error(`Melt quote ${quoteId} for ${method} at ${mintUrl} was not found`);
		if (expectedUnit && quote.unit !== normalizeUnit(expectedUnit, { defaultUnit: DEFAULT_UNIT })) throw new Error(`Melt quote ${quoteId} unit ${quote.unit} does not match requested unit ${expectedUnit}`);
		this.assertMeltQuoteCanPrepare(quote, `melt quote ${quoteId}`);
		return quote;
	}
	async requireMeltQuoteRefForPrepare(ref) {
		const quote = await this.meltQuoteRepository.getMeltQuoteById({
			mintUrl: ref.mintUrl,
			quoteId: ref.quoteId
		});
		if (!quote) throw new Error(`Melt quote ${ref.quoteId} at ${ref.mintUrl} was not found`);
		if (quote.method !== ref.method) throw new QuoteIdentityConflictError("melt", quote.mintUrl, quote.quoteId, [ref.method, quote.method], `Melt quote ${quote.quoteId} at ${quote.mintUrl} resolved to method ${quote.method}, not requested method ${ref.method}`);
		this.assertMeltQuoteCanPrepare(quote, `melt quote ${ref.quoteId}`);
		return quote;
	}
	async loadMeltQuoteSnapshotForOperation(op) {
		if (!op.quoteId) throw new Error(`Cannot prepare operation ${op.id}: no melt quote ID is attached`);
		const quote = await this.meltQuoteRepository.getMeltQuote(op.mintUrl, op.method, op.quoteId);
		if (!quote) throw new Error(`Cannot prepare operation ${op.id}: melt quote ${op.quoteId} for ${op.method} at ${op.mintUrl} was not found`);
		this.assertMeltQuoteCanPrepare(quote, `operation ${op.id} melt quote ${op.quoteId}`);
		if (quote.unit !== op.unit) throw new Error(`Cannot prepare operation ${op.id}: melt quote ${op.quoteId} unit ${quote.unit} does not match requested unit ${op.unit}`);
		return meltQuoteToMethodSnapshot(quote);
	}
	/**
	* Records a canonical melt quote observation and emits `melt-quote:updated` only when storage
	* changed meaningfully.
	*/
	async recordMeltQuoteObservation(canonicalQuote) {
		const { quote, remoteQuoteChanged } = await this.resolveAndPersistMeltQuoteObservation(canonicalQuote);
		await this.emitMeltQuoteUpdatedIfNeeded(quote, remoteQuoteChanged);
		return quote;
	}
	async resolveAndPersistMeltQuoteObservation(canonicalQuote) {
		const existing = await this.meltQuoteRepository.getMeltQuote(canonicalQuote.mintUrl, canonicalQuote.method, canonicalQuote.quoteId);
		if (existing?.state === "PAID") {
			const enrichedQuote = mergePaidMeltQuoteSettlement(existing, canonicalQuote);
			if (enrichedQuote) return {
				quote: await this.persistCanonicalMeltQuote(enrichedQuote),
				remoteQuoteChanged: true
			};
			return {
				quote: existing,
				remoteQuoteChanged: false
			};
		}
		const remoteQuoteChanged = getMeltQuoteChange(existing, canonicalQuote);
		if (!remoteQuoteChanged && existing) return {
			quote: existing,
			remoteQuoteChanged: false
		};
		return {
			quote: await this.persistCanonicalMeltQuote(canonicalQuote),
			remoteQuoteChanged
		};
	}
	async persistCanonicalMintQuote(repository, canonicalQuote) {
		await repository.upsertMintQuote(canonicalQuote);
		return await repository.getMintQuote(canonicalQuote.mintUrl, canonicalQuote.method, canonicalQuote.quoteId) ?? canonicalQuote;
	}
	async emitMintQuoteUpdatedIfNeeded(quote, remoteStateChanged) {
		if (!remoteStateChanged) return;
		await this.eventBus.emit("mint-quote:updated", {
			mintUrl: quote.mintUrl,
			method: quote.method,
			quoteId: quote.quoteId,
			quote
		});
	}
	async persistCanonicalMeltQuote(canonicalQuote) {
		return this.meltQuoteRepository.upsertMeltQuote(canonicalQuote);
	}
	async emitMeltQuoteUpdatedIfNeeded(quote, remoteQuoteChanged) {
		if (!remoteQuoteChanged) return;
		await this.eventBus.emit("melt-quote:updated", {
			mintUrl: quote.mintUrl,
			method: quote.method,
			quoteId: quote.quoteId,
			quote
		});
	}
	async assertMintQuoteCapabilities(quote) {
		const amount = getMintQuoteAmount(quote);
		await this.mintService.assertMethodUnitSupported(quote.mintUrl, 4, quote.method, amount ? {
			amount,
			unit: quote.unit
		} : quote.unit);
	}
	assertMintQuoteCanPrepare(quote, context) {
		const assessment = assessMintQuoteClaimability(quote);
		if (assessment.status === "complete") throw new Error(`Cannot prepare ${context}: quote is terminal`);
		if (assessment.status === "invalid") throw new Error(`Cannot prepare ${context}: quote accounting is invalid`);
	}
	assertMeltQuoteCanPrepare(quote, context) {
		if (quote.expiry * 1e3 <= Date.now()) throw new Error(`Cannot prepare ${context}: quote is expired`);
		if (quote.state !== "UNPAID") throw new Error(`Cannot prepare ${context}: quote is ${quote.state}`);
	}
	async ensureMintQuoteRecordForOperation(operation) {
		if (await this.mintQuoteRepository.getMintQuote(operation.mintUrl, operation.method, operation.quoteId)) return;
		if (operation.method !== "bolt11") throw new Error(`Cannot create canonical quote record from ${operation.method} operation observation`);
		await this.mintQuoteRepository.upsertMintQuote({
			mintUrl: operation.mintUrl,
			method: operation.method,
			quoteId: operation.quoteId,
			quote: operation.quoteId,
			request: operation.request,
			unit: operation.unit,
			amount: operation.amount,
			expiry: operation.expiry,
			pubkey: operation.pubkey,
			state: "UNPAID",
			reusable: false,
			amountPaid: Amount$1.zero(),
			amountIssued: Amount$1.zero(),
			remoteUpdatedAt: null,
			quoteData: { amount: operation.amount },
			createdAt: operation.createdAt,
			updatedAt: operation.updatedAt
		});
	}
};

//#endregion
//#region repositories/memory/MemoryRepositoryTransaction.ts
/** Internal protocol that lets each memory repository own its transaction-state representation. */
const COPY_MEMORY_REPOSITORY_STATE = Symbol("copyMemoryRepositoryState");
/** Clone the domain values stored by memory repositories without sharing mutable references. */
function cloneMemoryValue(value, seen = /* @__PURE__ */ new Map()) {
	if (typeof value !== "object" || value === null) return value;
	if (seen.has(value)) return seen.get(value);
	if (value instanceof Date) return new Date(value.getTime());
	if (value instanceof Uint8Array) return Uint8Array.prototype.slice.call(value);
	if (Array.isArray(value)) {
		const clone = [];
		seen.set(value, clone);
		for (const item of value) clone.push(cloneMemoryValue(item, seen));
		return clone;
	}
	if (value instanceof Map) {
		const clone = /* @__PURE__ */ new Map();
		seen.set(value, clone);
		for (const [key, item] of value) clone.set(cloneMemoryValue(key, seen), cloneMemoryValue(item, seen));
		return clone;
	}
	if (value instanceof Set) {
		const clone = /* @__PURE__ */ new Set();
		seen.set(value, clone);
		for (const item of value) clone.add(cloneMemoryValue(item, seen));
		return clone;
	}
	const clone = Object.create(Object.getPrototypeOf(value));
	seen.set(value, clone);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if ("value" in descriptor) descriptor.value = cloneMemoryValue(descriptor.value, seen);
		Object.defineProperty(clone, key, descriptor);
	}
	return clone;
}

//#endregion
//#region repositories/memory/MemoryAuthSessionRepository.ts
var MemoryAuthSessionRepository = class {
	sessions = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.sessions = cloneMemoryValue(source.sessions);
	}
	async getSession(mintUrl) {
		return this.sessions.get(mintUrl) ?? null;
	}
	async saveSession(session) {
		this.sessions.set(session.mintUrl, session);
	}
	async deleteSession(mintUrl) {
		this.sessions.delete(mintUrl);
	}
	async getAllSessions() {
		return [...this.sessions.values()];
	}
};

//#endregion
//#region repositories/memory/MemoryCounterRepository.ts
var MemoryCounterRepository = class {
	counters = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.counters = cloneMemoryValue(source.counters);
	}
	key(mintUrl, keysetId) {
		return `${mintUrl}::${keysetId}`;
	}
	async getCounter(mintUrl, keysetId) {
		return this.counters.get(this.key(mintUrl, keysetId)) ?? null;
	}
	async setCounter(mintUrl, keysetId, counter) {
		const key = this.key(mintUrl, keysetId);
		this.counters.set(key, {
			mintUrl,
			keysetId,
			counter
		});
	}
};

//#endregion
//#region repositories/memory/MemoryHistoryRepository.ts
var MemoryHistoryRepository = class {
	legacyEntries = [];
	constructor(operationRepositories = {}) {
		this.operationRepositories = operationRepositories;
	}
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.legacyEntries = cloneMemoryValue(source.legacyEntries);
	}
	async getPaginatedHistoryEntries(limit, offset) {
		return (await this.getProjectedEntries()).slice(offset, offset + limit);
	}
	async getHistoryEntryById(id) {
		const parsed = parseHistoryEntryId(id);
		if (!parsed) return null;
		if (parsed.source === "legacy") return (await this.getProjectedEntries()).find((entry) => entry.id === id && entry.source === "legacy") ?? null;
		return this.projectOperationById(parsed.type, parsed.operationId);
	}
	async addLegacyHistoryEntry(history) {
		const entry = projectLegacyHistoryRow(history);
		this.legacyEntries.push(entry);
		return entry;
	}
	async getSendHistoryEntry(mintUrl, operationId) {
		const operation = await this.operationRepositories.sendOperationRepository?.getById(operationId);
		if (!operation || operation.mintUrl !== mintUrl) return null;
		return projectSendOperation(operation);
	}
	async getReceiveHistoryEntry(mintUrl, operationId) {
		const operation = await this.operationRepositories.receiveOperationRepository?.getById(operationId);
		if (!operation || operation.mintUrl !== mintUrl) return null;
		return projectReceiveOperation(operation);
	}
	async getProjectedEntries() {
		const operationEntries = await this.getOperationEntries();
		const dedupedLegacyEntries = this.dedupeLegacyEntries(operationEntries);
		return [...operationEntries, ...dedupedLegacyEntries].sort(compareHistoryEntries);
	}
	async getOperationEntries() {
		const entries = [];
		const sendOperations = await this.operationRepositories.sendOperationRepository?.getAll();
		for (const operation of sendOperations ?? []) {
			const entry = projectSendOperation(operation);
			if (entry) entries.push(entry);
		}
		const meltOperations = await this.operationRepositories.meltOperationRepository?.getAll();
		for (const operation of meltOperations ?? []) {
			const entry = projectMeltOperation(operation);
			if (entry) entries.push(entry);
		}
		const mintOperations = await this.operationRepositories.mintOperationRepository?.getAll();
		for (const operation of mintOperations ?? []) {
			const entry = await this.projectMintOperation(operation);
			if (entry) entries.push(entry);
		}
		const receiveOperations = await this.operationRepositories.receiveOperationRepository?.getAll();
		for (const operation of receiveOperations ?? []) {
			const entry = projectReceiveOperation(operation);
			if (entry) entries.push(entry);
		}
		return entries;
	}
	async projectOperationById(type, operationId) {
		switch (type) {
			case "send": {
				const operation = await this.operationRepositories.sendOperationRepository?.getById(operationId);
				return operation ? projectSendOperation(operation) : null;
			}
			case "melt": {
				const operation = await this.operationRepositories.meltOperationRepository?.getById(operationId);
				return operation ? projectMeltOperation(operation) : null;
			}
			case "mint": {
				const operation = await this.operationRepositories.mintOperationRepository?.getById(operationId);
				return operation ? this.projectMintOperation(operation) : null;
			}
			case "receive": {
				const operation = await this.operationRepositories.receiveOperationRepository?.getById(operationId);
				return operation ? projectReceiveOperation(operation) : null;
			}
		}
	}
	async projectMintOperation(operation) {
		const entry = projectMintOperation(operation);
		if (!entry) return null;
		const quote = await this.operationRepositories.mintQuoteRepository?.getMintQuote(operation.mintUrl, operation.method, operation.quoteId);
		const remoteState = quote ? getMintQuoteRemoteState(quote) : void 0;
		return remoteState ? {
			...entry,
			remoteState
		} : entry;
	}
	dedupeLegacyEntries(operationEntries) {
		const operationKeys = /* @__PURE__ */ new Set();
		const quoteKeys = /* @__PURE__ */ new Set();
		for (const entry of operationEntries) {
			if (entry.source !== "operation") continue;
			operationKeys.add(this.operationKey(entry.type, entry.operationId));
			if ((entry.type === "mint" || entry.type === "melt") && entry.quoteId) quoteKeys.add(this.quoteKey(entry.type, entry.mintUrl, entry.quoteId));
		}
		return this.legacyEntries.filter((entry) => {
			if (entry.operationId && operationKeys.has(this.operationKey(entry.type, entry.operationId))) return false;
			if ((entry.type === "mint" || entry.type === "melt") && entry.quoteId && quoteKeys.has(this.quoteKey(entry.type, entry.mintUrl, entry.quoteId))) return false;
			return true;
		});
	}
	operationKey(type, operationId) {
		return `${type}:${operationId}`;
	}
	quoteKey(type, mintUrl, quoteId) {
		return `${type}:${mintUrl}:${quoteId}`;
	}
};

//#endregion
//#region repositories/memory/MemoryKeyRingRepository.ts
const DEFAULT_KEYPAIR_PURPOSE = "p2pk";
var MemoryKeyRingRepository = class {
	keyPairs = /* @__PURE__ */ new Map();
	insertionOrder = [];
	highWaterMarks = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.keyPairs = cloneMemoryValue(source.keyPairs);
		this.insertionOrder = cloneMemoryValue(source.insertionOrder);
		this.highWaterMarks = cloneMemoryValue(source.highWaterMarks);
	}
	async getPersistedKeyPair(publicKey, purpose) {
		const keyPair = this.keyPairs.get(publicKey) ?? null;
		if (!keyPair || !purpose) return keyPair;
		return (keyPair.purpose ?? DEFAULT_KEYPAIR_PURPOSE) === purpose ? keyPair : null;
	}
	async setPersistedKeyPair(keyPair) {
		if (!this.keyPairs.has(keyPair.publicKeyHex)) this.insertionOrder.push(keyPair.publicKeyHex);
		const existing = this.keyPairs.get(keyPair.publicKeyHex);
		let derivationIndex = keyPair.derivationIndex;
		if (derivationIndex == null) {
			if (existing?.derivationIndex != null) derivationIndex = existing.derivationIndex;
		}
		this.keyPairs.set(keyPair.publicKeyHex, {
			...keyPair,
			derivationIndex,
			purpose: keyPair.purpose ?? existing?.purpose ?? DEFAULT_KEYPAIR_PURPOSE
		});
	}
	async deletePersistedKeyPair(publicKey, purpose) {
		if (purpose) {
			const existing = this.keyPairs.get(publicKey);
			if (existing && (existing.purpose ?? DEFAULT_KEYPAIR_PURPOSE) !== purpose) return;
		}
		this.keyPairs.delete(publicKey);
		const index = this.insertionOrder.indexOf(publicKey);
		if (index !== -1) this.insertionOrder.splice(index, 1);
	}
	async getAllPersistedKeyPairs(purpose) {
		const values = Array.from(this.keyPairs.values());
		if (!purpose) return values;
		return values.filter((keyPair) => (keyPair.purpose ?? DEFAULT_KEYPAIR_PURPOSE) === purpose);
	}
	async getLatestKeyPair(purpose) {
		for (let i = this.insertionOrder.length - 1; i >= 0; i--) {
			const keyPair = this.keyPairs.get(this.insertionOrder[i]);
			if (!keyPair) continue;
			if (!purpose || (keyPair.purpose ?? DEFAULT_KEYPAIR_PURPOSE) === purpose) return keyPair;
		}
		return null;
	}
	async getLastAllocatedIndex(purpose) {
		return this.highWaterMarks.get(purpose) ?? null;
	}
	async getHighestStoredDerivationIndex(purpose) {
		let highest = null;
		for (const keypair of this.keyPairs.values()) {
			if ((keypair.purpose ?? DEFAULT_KEYPAIR_PURPOSE) !== purpose) continue;
			if (keypair.derivationIndex != null && (highest === null || keypair.derivationIndex > highest)) highest = keypair.derivationIndex;
		}
		return highest;
	}
	async setLastAllocatedIndex(purpose, derivationIndex) {
		this.highWaterMarks.set(purpose, derivationIndex);
	}
};

//#endregion
//#region repositories/memory/MemoryKeysetRepository.ts
var MemoryKeysetRepository = class {
	keysetsByMint = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.keysetsByMint = cloneMemoryValue(source.keysetsByMint);
	}
	getMintMap(mintUrl) {
		if (!this.keysetsByMint.has(mintUrl)) this.keysetsByMint.set(mintUrl, /* @__PURE__ */ new Map());
		return this.keysetsByMint.get(mintUrl);
	}
	async getKeysetsByMintUrl(mintUrl) {
		return Array.from(this.getMintMap(mintUrl).values());
	}
	async getKeysetById(mintUrl, id) {
		return this.getMintMap(mintUrl).get(id) ?? null;
	}
	async updateKeyset(keyset) {
		const mintMap = this.getMintMap(keyset.mintUrl);
		const existing = mintMap.get(keyset.id);
		if (!existing) {
			mintMap.set(keyset.id, {
				...keyset,
				keypairs: {},
				updatedAt: Math.floor(Date.now() / 1e3)
			});
			return;
		}
		mintMap.set(keyset.id, {
			...existing,
			unit: keyset.unit,
			active: keyset.active,
			feePpk: keyset.feePpk,
			updatedAt: Math.floor(Date.now() / 1e3)
		});
	}
	async addKeyset(keyset) {
		this.getMintMap(keyset.mintUrl).set(keyset.id, {
			...keyset,
			updatedAt: Math.floor(Date.now() / 1e3)
		});
	}
	async deleteKeyset(mintUrl, keysetId) {
		this.getMintMap(mintUrl).delete(keysetId);
	}
};

//#endregion
//#region repositories/memory/MemoryMeltOperationRepository.ts
const getOperationQuoteId = (operation) => "quoteId" in operation && operation.quoteId ? operation.quoteId : void 0;
var MemoryMeltOperationRepository = class {
	operations = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.operations = cloneMemoryValue(source.operations);
	}
	async create(operation) {
		if (this.operations.has(operation.id)) throw new Error(`MeltOperation with id ${operation.id} already exists`);
		this.assertNoDuplicateQuoteOperation(operation);
		this.operations.set(operation.id, { ...operation });
	}
	async update(operation) {
		if (!this.operations.has(operation.id)) throw new Error(`MeltOperation with id ${operation.id} not found`);
		this.assertNoDuplicateQuoteOperation(operation);
		this.operations.set(operation.id, {
			...operation,
			updatedAt: Date.now()
		});
	}
	async getById(id) {
		const operation = this.operations.get(id);
		return operation ? { ...operation } : null;
	}
	async getByState(state) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.state === state) results.push({ ...operation });
		return results;
	}
	async getPending() {
		const results = [];
		for (const operation of this.operations.values()) if (operation.state === "executing" || operation.state === "pending") results.push({ ...operation });
		return results;
	}
	async getByMintUrl(mintUrl) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.mintUrl === mintUrl) results.push({ ...operation });
		return results;
	}
	async getByQuoteId(mintUrl, quoteId) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.mintUrl === mintUrl && "quoteId" in operation && operation.quoteId === quoteId) results.push({ ...operation });
		return results;
	}
	async getAll() {
		return Array.from(this.operations.values(), (operation) => ({ ...operation }));
	}
	async delete(id) {
		this.operations.delete(id);
	}
	assertNoDuplicateQuoteOperation(operation) {
		const quoteId = getOperationQuoteId(operation);
		if (!quoteId) return;
		for (const existing of this.operations.values()) if (existing.id !== operation.id && existing.mintUrl === operation.mintUrl && getOperationQuoteId(existing) === quoteId) throw new Error(`MeltOperation already exists for mint ${operation.mintUrl} and quote ${quoteId}`);
	}
};

//#endregion
//#region repositories/memory/MemoryMintQuoteRepository.ts
var MemoryMintQuoteRepository = class {
	quotes = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.quotes = cloneMemoryValue(source.quotes);
	}
	makeKey(mintUrl, method, quoteId) {
		return `${normalizeMintUrl(mintUrl)}::${method}::${quoteId}`;
	}
	async getMintQuoteById(identity) {
		const normalizedMintUrl = normalizeMintUrl(identity.mintUrl);
		const matches = Array.from(this.quotes.values()).filter((quote) => quote.mintUrl === normalizedMintUrl && quote.quoteId === identity.quoteId);
		if (matches.length > 1) throw new QuoteIdentityConflictError("mint", normalizedMintUrl, identity.quoteId, matches.map((quote) => quote.method));
		return matches[0] ? { ...matches[0] } : null;
	}
	async getMintQuote(mintUrl, method, quoteId) {
		const key = this.makeKey(mintUrl, method, quoteId);
		const quote = this.quotes.get(key);
		return quote ? { ...quote } : null;
	}
	async upsertMintQuote(quote) {
		const normalizedMintUrl = normalizeMintUrl(quote.mintUrl);
		const now = Date.now();
		const identityOwner = await this.getMintQuoteById({
			mintUrl: normalizedMintUrl,
			quoteId: quote.quoteId
		});
		if (identityOwner && identityOwner.method !== quote.method) throw new QuoteIdentityConflictError("mint", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Mint quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
		const existing = await this.getMintQuote(normalizedMintUrl, quote.method, quote.quoteId);
		const key = this.makeKey(normalizedMintUrl, quote.method, quote.quoteId);
		const canonicalQuote = isStatefulMintQuote(quote) ? {
			...quote,
			state: deriveBolt11MintQuoteState(quote.amountPaid, quote.amountIssued)
		} : quote;
		this.quotes.set(key, {
			...canonicalQuote,
			mintUrl: normalizedMintUrl,
			quote: quote.quoteId,
			createdAt: existing?.createdAt ?? quote.createdAt,
			updatedAt: now
		});
	}
	async setMintQuoteState(mintUrl, method, quoteId, state, observedAt = Date.now()) {
		const key = this.makeKey(mintUrl, method, quoteId);
		const existing = this.quotes.get(key);
		if (!existing) return;
		if (!isStatefulMintQuote(existing)) return;
		this.quotes.set(key, applyBolt11MintQuoteStateFallback(existing, state, observedAt));
	}
	async getPendingMintQuotes(method) {
		const result = [];
		for (const q of this.quotes.values()) {
			if (method && q.method !== method) continue;
			if (isMintQuotePending(q)) result.push({ ...q });
		}
		return result;
	}
};

//#endregion
//#region repositories/memory/MemoryLegacyMintQuoteRepository.ts
var MemoryLegacyMintQuoteRepository = class {
	quotes = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.quotes = cloneMemoryValue(source.quotes);
	}
	makeKey(mintUrl, method, quoteId) {
		return `${normalizeMintUrl(mintUrl)}::${method}::${quoteId}`;
	}
	async upsertMintQuote(quote) {
		const normalizedMintUrl = normalizeMintUrl(quote.mintUrl);
		const key = this.makeKey(normalizedMintUrl, quote.method, quote.quoteId);
		this.quotes.set(key, {
			...quote,
			mintUrl: normalizedMintUrl,
			quote: quote.quoteId
		});
	}
	async getPendingLegacyMintQuotes(mintUrl) {
		const normalizedMintUrl = mintUrl ? normalizeMintUrl(mintUrl) : void 0;
		const result = [];
		for (const quote of this.quotes.values()) {
			if (normalizedMintUrl && quote.mintUrl !== normalizedMintUrl) continue;
			if (isMintQuotePending(quote)) result.push({ ...quote });
		}
		return result;
	}
};

//#endregion
//#region repositories/memory/MemoryMintRepository.ts
var MemoryMintRepository = class {
	mints = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.mints = cloneMemoryValue(source.mints);
	}
	async isTrustedMint(mintUrl) {
		return this.mints.get(mintUrl)?.trusted ?? false;
	}
	async getMintByUrl(mintUrl) {
		const mint = this.mints.get(mintUrl);
		if (!mint) throw new Error(`Mint not found: ${mintUrl}`);
		return mint;
	}
	async getAllMints() {
		return Array.from(this.mints.values());
	}
	async getAllTrustedMints() {
		return Array.from(this.mints.values()).filter((mint) => mint.trusted);
	}
	async addNewMint(mint) {
		this.mints.set(mint.mintUrl, mint);
	}
	async addOrUpdateMint(mint) {
		this.mints.set(mint.mintUrl, mint);
	}
	async updateMint(mint) {
		this.mints.set(mint.mintUrl, mint);
	}
	async setMintTrusted(mintUrl, trusted) {
		const mint = this.mints.get(mintUrl);
		if (mint) {
			mint.trusted = trusted;
			this.mints.set(mintUrl, mint);
		}
	}
	async deleteMint(mintUrl) {
		this.mints.delete(mintUrl);
	}
};

//#endregion
//#region repositories/memory/MemoryProofRepository.ts
function normalizeProofUnit(proof) {
	return normalizeUnit(proof.unit);
}
function getUnitFilter(filter) {
	const units = [...filter?.units ?? [], ...filter?.unit ? [filter.unit] : []];
	if (units.length === 0) return void 0;
	return new Set(units.map((unit) => normalizeUnit(unit)));
}
function matchesUnit(proof, unitFilter) {
	return !unitFilter || unitFilter.has(normalizeProofUnit(proof));
}
var MemoryProofRepository = class {
	proofsByMint = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.proofsByMint = cloneMemoryValue(source.proofsByMint);
	}
	getMintMap(mintUrl) {
		if (!this.proofsByMint.has(mintUrl)) this.proofsByMint.set(mintUrl, /* @__PURE__ */ new Map());
		return this.proofsByMint.get(mintUrl);
	}
	async saveProofs(mintUrl, proofs) {
		if (!proofs || proofs.length === 0) return;
		const map = this.getMintMap(mintUrl);
		const normalizedProofs = proofs.map((proof) => ({
			...proof,
			unit: normalizeProofUnit(proof)
		}));
		for (const p of normalizedProofs) if (map.has(p.secret)) throw new Error(`Proof with secret already exists: ${p.secret}`);
		for (const p of normalizedProofs) map.set(p.secret, cloneMemoryValue({
			...p,
			mintUrl
		}));
	}
	async getReadyProofs(mintUrl, filter) {
		const map = this.getMintMap(mintUrl);
		const unitFilter = getUnitFilter(filter);
		return Array.from(map.values()).filter((p) => p.state === "ready" && matchesUnit(p, unitFilter)).map((p) => cloneMemoryValue(p));
	}
	async getInflightProofs(mintUrls, filter) {
		const unitFilter = getUnitFilter(filter);
		if (!mintUrls || mintUrls.length === 0) {
			const all = [];
			for (const map of this.proofsByMint.values()) for (const p of map.values()) if (p.state === "inflight" && matchesUnit(p, unitFilter)) all.push(cloneMemoryValue(p));
			return all;
		}
		const mintUrlList = mintUrls.map((url) => url.trim()).filter((url) => url.length > 0);
		if (mintUrlList.length === 0) return [];
		const uniqueMintUrls = Array.from(new Set(mintUrlList));
		const results = [];
		for (const mintUrl of uniqueMintUrls) {
			const map = this.proofsByMint.get(mintUrl);
			if (!map) continue;
			for (const p of map.values()) if (p.state === "inflight" && matchesUnit(p, unitFilter)) results.push(cloneMemoryValue(p));
		}
		return results;
	}
	async getAllReadyProofs(filter) {
		const unitFilter = getUnitFilter(filter);
		const all = [];
		for (const map of this.proofsByMint.values()) for (const p of map.values()) if (p.state === "ready" && matchesUnit(p, unitFilter)) all.push(cloneMemoryValue(p));
		return all;
	}
	async getProofsByKeysetId(mintUrl, keysetId, filter) {
		const map = this.getMintMap(mintUrl);
		const unitFilter = getUnitFilter(filter);
		const results = [];
		for (const p of map.values()) if (p.state === "ready" && p.id === keysetId && matchesUnit(p, unitFilter)) results.push(cloneMemoryValue(p));
		return results;
	}
	async setProofState(mintUrl, secrets, state) {
		const map = this.getMintMap(mintUrl);
		for (const secret of secrets) {
			const p = map.get(secret);
			if (p) map.set(secret, {
				...p,
				state
			});
		}
	}
	async deleteProofs(mintUrl, secrets) {
		const map = this.getMintMap(mintUrl);
		for (const s of secrets) map.delete(s);
	}
	async wipeProofsByKeysetId(mintUrl, keysetId) {
		const map = this.getMintMap(mintUrl);
		for (const [secret, p] of Array.from(map.entries())) if (p.id === keysetId) map.delete(secret);
	}
	async reserveProofs(mintUrl, secrets, operationId) {
		const map = this.getMintMap(mintUrl);
		for (const secret of secrets) {
			const p = map.get(secret);
			if (!p) throw new Error(`Proof with secret not found: ${secret}`);
			if (p.state !== "ready") throw new Error(`Proof is not ready, cannot reserve: ${secret}`);
			if (p.usedByOperationId) throw new Error(`Proof already reserved by operation ${p.usedByOperationId}: ${secret}`);
		}
		for (const secret of secrets) {
			const p = map.get(secret);
			map.set(secret, {
				...p,
				usedByOperationId: operationId
			});
		}
	}
	async releaseProofs(mintUrl, secrets) {
		const map = this.getMintMap(mintUrl);
		for (const secret of secrets) {
			const p = map.get(secret);
			if (p) {
				const { usedByOperationId: _, ...rest } = p;
				map.set(secret, rest);
			}
		}
	}
	async setCreatedByOperation(mintUrl, secrets, operationId) {
		const map = this.getMintMap(mintUrl);
		for (const secret of secrets) {
			const p = map.get(secret);
			if (p) map.set(secret, {
				...p,
				createdByOperationId: operationId
			});
		}
	}
	async getProofBySecret(mintUrl, secret) {
		const proof = this.getMintMap(mintUrl).get(secret);
		return proof ? cloneMemoryValue(proof) : null;
	}
	async getProofsBySecrets(mintUrl, secrets) {
		if (!secrets || secrets.length === 0) return [];
		const map = this.getMintMap(mintUrl);
		const uniqueSecrets = Array.from(new Set(secrets));
		const proofs = [];
		for (const secret of uniqueSecrets) {
			const proof = map.get(secret);
			if (proof) proofs.push(cloneMemoryValue(proof));
		}
		return proofs;
	}
	async getProofsByOperationId(mintUrl, operationId) {
		const map = this.getMintMap(mintUrl);
		const results = [];
		for (const p of map.values()) if (p.usedByOperationId === operationId || p.createdByOperationId === operationId) results.push(cloneMemoryValue(p));
		return results;
	}
	async getAvailableProofs(mintUrl, filter) {
		const map = this.getMintMap(mintUrl);
		const unitFilter = getUnitFilter(filter);
		return Array.from(map.values()).filter((p) => p.state === "ready" && !p.usedByOperationId && matchesUnit(p, unitFilter)).map((p) => cloneMemoryValue(p));
	}
	async getReservedProofs() {
		const all = [];
		for (const map of this.proofsByMint.values()) for (const p of map.values()) if (p.state === "ready" && p.usedByOperationId) all.push(cloneMemoryValue(p));
		return all;
	}
};

//#endregion
//#region repositories/memory/MemoryMeltQuoteRepository.ts
var MemoryMeltQuoteRepository = class {
	quotes = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.quotes = cloneMemoryValue(source.quotes);
	}
	makeKey(mintUrl, method, quoteId) {
		return `${normalizeMintUrl(mintUrl)}::${method}::${quoteId}`;
	}
	async getMeltQuoteById(identity) {
		const normalizedMintUrl = normalizeMintUrl(identity.mintUrl);
		const matches = Array.from(this.quotes.values()).filter((quote) => quote.mintUrl === normalizedMintUrl && quote.quoteId === identity.quoteId);
		if (matches.length > 1) throw new QuoteIdentityConflictError("melt", normalizedMintUrl, identity.quoteId, matches.map((quote) => quote.method));
		return matches[0] ? { ...matches[0] } : null;
	}
	async getMeltQuote(mintUrl, method, quoteId) {
		const quote = this.quotes.get(this.makeKey(mintUrl, method, quoteId));
		return quote ? { ...quote } : null;
	}
	async upsertMeltQuote(quote) {
		const normalizedMintUrl = normalizeMintUrl(quote.mintUrl);
		const now = Date.now();
		const identityOwner = await this.getMeltQuoteById({
			mintUrl: normalizedMintUrl,
			quoteId: quote.quoteId
		});
		if (identityOwner && identityOwner.method !== quote.method) throw new QuoteIdentityConflictError("melt", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Melt quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
		const existing = await this.getMeltQuote(normalizedMintUrl, quote.method, quote.quoteId);
		const persisted = {
			...quote,
			mintUrl: normalizedMintUrl,
			quote: quote.quoteId,
			createdAt: existing?.createdAt ?? quote.createdAt,
			updatedAt: now
		};
		this.quotes.set(this.makeKey(normalizedMintUrl, quote.method, quote.quoteId), persisted);
		return { ...persisted };
	}
	async getPendingMeltQuotes(method) {
		const result = [];
		for (const quote of this.quotes.values()) {
			if (method && quote.method !== method) continue;
			if (quote.state !== "PAID") result.push({ ...quote });
		}
		return result;
	}
};

//#endregion
//#region repositories/memory/MemorySendOperationRepository.ts
var MemorySendOperationRepository = class {
	operations = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.operations = cloneMemoryValue(source.operations);
	}
	async create(operation) {
		if (this.operations.has(operation.id)) throw new Error(`SendOperation with id ${operation.id} already exists`);
		this.operations.set(operation.id, cloneMemoryValue({
			...operation,
			revision: operation.revision ?? 0
		}));
	}
	async update(operation) {
		if (!this.operations.has(operation.id)) throw new Error(`SendOperation with id ${operation.id} not found`);
		this.operations.set(operation.id, cloneMemoryValue({
			...operation,
			revision: operation.revision ?? 0,
			updatedAt: Date.now()
		}));
	}
	async transition(input) {
		const current = this.operations.get(input.operationId);
		if (!current || current.state !== input.expectedState || (current.revision ?? 0) !== input.expectedRevision) return false;
		if (input.next.id !== input.operationId) throw new Error("Send operation transition cannot change the operation id");
		this.operations.set(input.operationId, cloneMemoryValue({
			...input.next,
			revision: input.expectedRevision + 1
		}));
		return true;
	}
	async getById(id) {
		const op = this.operations.get(id);
		return op ? cloneMemoryValue({
			...op,
			revision: op.revision ?? 0
		}) : null;
	}
	async getByState(state) {
		const results = [];
		for (const op of this.operations.values()) if (op.state === state) results.push(cloneMemoryValue(op));
		return results;
	}
	async getPending() {
		const results = [];
		for (const op of this.operations.values()) if (op.state === "executing" || op.state === "pending" || op.state === "rolling_back") results.push(cloneMemoryValue(op));
		return results;
	}
	async getByMintUrl(mintUrl) {
		const results = [];
		for (const op of this.operations.values()) if (op.mintUrl === mintUrl) results.push(cloneMemoryValue(op));
		return results;
	}
	async getAll() {
		return Array.from(this.operations.values(), (operation) => cloneMemoryValue(operation));
	}
	async delete(id) {
		this.operations.delete(id);
	}
};

//#endregion
//#region repositories/memory/MemoryMintOperationRepository.ts
var MemoryMintOperationRepository = class {
	operations = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.operations = cloneMemoryValue(source.operations);
	}
	async create(operation) {
		if (this.operations.has(operation.id)) throw new Error(`MintOperation with id ${operation.id} already exists`);
		this.operations.set(operation.id, { ...operation });
	}
	async update(operation) {
		if (!this.operations.has(operation.id)) throw new Error(`MintOperation with id ${operation.id} not found`);
		this.operations.set(operation.id, {
			...operation,
			updatedAt: Date.now()
		});
	}
	async getById(id) {
		const operation = this.operations.get(id);
		return operation ? { ...operation } : null;
	}
	async getByState(state) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.state === state) results.push({ ...operation });
		return results;
	}
	async getPending() {
		const results = [];
		for (const operation of this.operations.values()) if (operation.state === "pending" || operation.state === "executing") results.push({ ...operation });
		return results;
	}
	async getByMintUrl(mintUrl) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.mintUrl === mintUrl) results.push({ ...operation });
		return results;
	}
	async getByQuoteId(mintUrl, method, quoteId) {
		const results = [];
		for (const operation of this.operations.values()) if (operation.mintUrl === mintUrl && operation.method === method && "quoteId" in operation && operation.quoteId === quoteId) results.push({ ...operation });
		return results.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}
	async getAll() {
		return Array.from(this.operations.values(), (operation) => ({ ...operation }));
	}
	async delete(id) {
		this.operations.delete(id);
	}
};

//#endregion
//#region repositories/memory/MemoryReceiveOperationRepository.ts
var MemoryReceiveOperationRepository = class {
	operations = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.operations = cloneMemoryValue(source.operations);
	}
	async create(operation) {
		if (this.operations.has(operation.id)) throw new Error(`ReceiveOperation with id ${operation.id} already exists`);
		this.operations.set(operation.id, { ...operation });
	}
	async update(operation) {
		if (!this.operations.has(operation.id)) throw new Error(`ReceiveOperation with id ${operation.id} not found`);
		this.operations.set(operation.id, {
			...operation,
			updatedAt: Date.now()
		});
	}
	async getById(id) {
		const op = this.operations.get(id);
		return op ? { ...op } : null;
	}
	async getByState(state) {
		const results = [];
		for (const op of this.operations.values()) if (op.state === state) results.push({ ...op });
		return results;
	}
	async getPending() {
		const results = [];
		for (const op of this.operations.values()) if (op.state === "executing") results.push({ ...op });
		return results;
	}
	async getByMintUrl(mintUrl) {
		const results = [];
		for (const op of this.operations.values()) if (op.mintUrl === mintUrl) results.push({ ...op });
		return results;
	}
	async getByPaymentRequestAttemptId(attemptId) {
		for (const op of this.operations.values()) if (op.source?.type === "payment-request" && op.source.attemptId === attemptId) return { ...op };
		return null;
	}
	async getAll() {
		return Array.from(this.operations.values(), (operation) => ({ ...operation }));
	}
	async delete(id) {
		this.operations.delete(id);
	}
};

//#endregion
//#region repositories/memory/MemoryPaymentRequestReceiveRepository.ts
function cloneOperation(operation) {
	return {
		...operation,
		mints: [...operation.mints]
	};
}
function cloneAttempt(attempt) {
	return {
		...attempt,
		payload: attempt.payload ? {
			...attempt.payload,
			proofs: attempt.payload.proofs.map((proof) => ({ ...proof }))
		} : void 0
	};
}
var MemoryPaymentRequestReceiveOperationRepository = class {
	operations = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.operations = cloneMemoryValue(source.operations);
	}
	async create(operation) {
		if (this.operations.has(operation.id)) throw new Error(`PaymentRequestReceiveOperation with id ${operation.id} already exists`);
		this.operations.set(operation.id, cloneOperation(operation));
	}
	async update(operation) {
		if (!this.operations.has(operation.id)) throw new Error(`PaymentRequestReceiveOperation with id ${operation.id} not found`);
		this.operations.set(operation.id, cloneOperation({
			...operation,
			updatedAt: Date.now()
		}));
	}
	async getById(id) {
		const operation = this.operations.get(id);
		return operation ? cloneOperation(operation) : null;
	}
	async getByState(state) {
		return Array.from(this.operations.values()).filter((operation) => operation.state === state).map(cloneOperation);
	}
	async getActiveByRequestId(requestId) {
		return Array.from(this.operations.values()).filter((operation) => operation.state === "active" && operation.requestId === requestId).map(cloneOperation);
	}
	async list(filter) {
		return Array.from(this.operations.values()).filter((operation) => !filter?.state || operation.state === filter.state).map(cloneOperation);
	}
};
var MemoryPaymentRequestReceiveAttemptRepository = class {
	attempts = /* @__PURE__ */ new Map();
	[COPY_MEMORY_REPOSITORY_STATE](source) {
		this.attempts = cloneMemoryValue(source.attempts);
	}
	async create(attempt) {
		if (this.attempts.has(attempt.id)) throw new Error(`PaymentRequestReceiveAttempt with id ${attempt.id} already exists`);
		if (attempt.transportMessageId && await this.getByTransportMessageId(attempt.transportMessageId)) throw new Error(`PaymentRequestReceiveAttempt with transport message id ${attempt.transportMessageId} already exists`);
		if (await this.getByPayloadHash(attempt.requestOperationId, attempt.payloadHash)) throw new Error(`PaymentRequestReceiveAttempt with payload hash ${attempt.payloadHash} already exists`);
		this.attempts.set(attempt.id, cloneAttempt(attempt));
	}
	async update(attempt) {
		if (!this.attempts.has(attempt.id)) throw new Error(`PaymentRequestReceiveAttempt with id ${attempt.id} not found`);
		this.attempts.set(attempt.id, cloneAttempt({
			...attempt,
			updatedAt: Date.now()
		}));
	}
	async getById(id) {
		const attempt = this.attempts.get(id);
		return attempt ? cloneAttempt(attempt) : null;
	}
	async getByRequestOperationId(requestOperationId) {
		return Array.from(this.attempts.values()).filter((attempt) => attempt.requestOperationId === requestOperationId).map(cloneAttempt);
	}
	async getByReceiveOperationId(receiveOperationId) {
		const attempt = Array.from(this.attempts.values()).find((candidate) => candidate.receiveOperationId === receiveOperationId);
		return attempt ? cloneAttempt(attempt) : null;
	}
	async getByTransportMessageId(transportMessageId) {
		const attempt = Array.from(this.attempts.values()).find((candidate) => candidate.transportMessageId === transportMessageId);
		return attempt ? cloneAttempt(attempt) : null;
	}
	async getByPayloadHash(requestOperationId, payloadHash) {
		const attempt = Array.from(this.attempts.values()).find((candidate) => candidate.requestOperationId === requestOperationId && candidate.payloadHash === payloadHash);
		return attempt ? cloneAttempt(attempt) : null;
	}
	async getByRequestIdAndPayloadHash(requestId, payloadHash) {
		const attempts = Array.from(this.attempts.values()).filter((candidate) => candidate.requestId === requestId && candidate.payloadHash === payloadHash);
		const attempt = attempts.find((candidate) => candidate.state === "finalized") ?? attempts[0];
		return attempt ? cloneAttempt(attempt) : null;
	}
	async getByState(state) {
		return Array.from(this.attempts.values()).filter((attempt) => attempt.state === state).map(cloneAttempt);
	}
	async delete(id) {
		this.attempts.delete(id);
	}
};

//#endregion
//#region repositories/memory/MemoryRepositories.ts
var MemoryRepositories = class {
	mintRepository;
	keyRingRepository;
	counterRepository;
	keysetRepository;
	proofRepository;
	mintQuoteRepository;
	legacyMintQuoteRepository;
	meltQuoteRepository;
	historyRepository;
	sendOperationRepository;
	meltOperationRepository;
	authSessionRepository;
	mintOperationRepository;
	receiveOperationRepository;
	paymentRequestReceiveOperationRepository;
	paymentRequestReceiveAttemptRepository;
	state;
	transactionQueue = Promise.resolve();
	pendingTransactionCount = 0;
	activeRootOperationCount = 0;
	rootOperationsIdle = Promise.resolve();
	releaseRootOperations;
	constructor() {
		this.state = createMemoryRepositoryState();
		this.mintRepository = this.wrapRootRepository(this.state.mintRepository);
		this.keyRingRepository = this.wrapRootRepository(this.state.keyRingRepository);
		this.counterRepository = this.wrapRootRepository(this.state.counterRepository);
		this.keysetRepository = this.wrapRootRepository(this.state.keysetRepository);
		this.proofRepository = this.wrapRootRepository(this.state.proofRepository);
		this.mintQuoteRepository = this.wrapRootRepository(this.state.mintQuoteRepository);
		this.legacyMintQuoteRepository = this.wrapRootRepository(this.state.legacyMintQuoteRepository);
		this.meltQuoteRepository = this.wrapRootRepository(this.state.meltQuoteRepository);
		this.historyRepository = this.wrapRootRepository(this.state.historyRepository);
		this.sendOperationRepository = this.wrapRootRepository(this.state.sendOperationRepository);
		this.meltOperationRepository = this.wrapRootRepository(this.state.meltOperationRepository);
		this.authSessionRepository = this.wrapRootRepository(this.state.authSessionRepository);
		this.mintOperationRepository = this.wrapRootRepository(this.state.mintOperationRepository);
		this.receiveOperationRepository = this.wrapRootRepository(this.state.receiveOperationRepository);
		this.paymentRequestReceiveOperationRepository = this.wrapRootRepository(this.state.paymentRequestReceiveOperationRepository);
		this.paymentRequestReceiveAttemptRepository = this.wrapRootRepository(this.state.paymentRequestReceiveAttemptRepository);
	}
	async init() {}
	async withTransaction(fn) {
		const previousTransaction = this.transactionQueue;
		let releaseTransaction;
		this.transactionQueue = new Promise((resolve) => {
			releaseTransaction = resolve;
		});
		this.pendingTransactionCount++;
		try {
			await previousTransaction;
			await this.rootOperationsIdle;
			const staged = cloneMemoryRepositoryState(this.state);
			const result = await fn(staged);
			copyMemoryRepositoryState(this.state, staged);
			return result;
		} finally {
			this.pendingTransactionCount--;
			releaseTransaction();
		}
	}
	wrapRootRepository(repository) {
		return new Proxy(repository, { get: (target, property) => {
			const value = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			return (...args) => this.runRootOperation(() => Reflect.apply(value, target, args));
		} });
	}
	async runRootOperation(operation) {
		while (this.pendingTransactionCount > 0) await this.transactionQueue;
		this.beginRootOperation();
		try {
			return await operation();
		} finally {
			this.endRootOperation();
		}
	}
	beginRootOperation() {
		if (this.activeRootOperationCount === 0) this.rootOperationsIdle = new Promise((resolve) => {
			this.releaseRootOperations = resolve;
		});
		this.activeRootOperationCount++;
	}
	endRootOperation() {
		this.activeRootOperationCount--;
		if (this.activeRootOperationCount === 0) this.releaseRootOperations();
	}
};
function createMemoryRepositoryState() {
	const sendOperationRepository = new MemorySendOperationRepository();
	const meltOperationRepository = new MemoryMeltOperationRepository();
	const mintOperationRepository = new MemoryMintOperationRepository();
	const receiveOperationRepository = new MemoryReceiveOperationRepository();
	const mintQuoteRepository = new MemoryMintQuoteRepository();
	return {
		mintRepository: new MemoryMintRepository(),
		keyRingRepository: new MemoryKeyRingRepository(),
		counterRepository: new MemoryCounterRepository(),
		keysetRepository: new MemoryKeysetRepository(),
		proofRepository: new MemoryProofRepository(),
		mintQuoteRepository,
		legacyMintQuoteRepository: new MemoryLegacyMintQuoteRepository(),
		meltQuoteRepository: new MemoryMeltQuoteRepository(),
		historyRepository: new MemoryHistoryRepository({
			sendOperationRepository,
			meltOperationRepository,
			mintOperationRepository,
			mintQuoteRepository,
			receiveOperationRepository
		}),
		sendOperationRepository,
		meltOperationRepository,
		authSessionRepository: new MemoryAuthSessionRepository(),
		mintOperationRepository,
		receiveOperationRepository,
		paymentRequestReceiveOperationRepository: new MemoryPaymentRequestReceiveOperationRepository(),
		paymentRequestReceiveAttemptRepository: new MemoryPaymentRequestReceiveAttemptRepository()
	};
}
function cloneMemoryRepositoryState(source) {
	const clone = createMemoryRepositoryState();
	copyMemoryRepositoryState(clone, source);
	return clone;
}
function copyMemoryRepositoryState(target, source) {
	for (const key of Object.keys(source)) target[key][COPY_MEMORY_REPOSITORY_STATE](source[key]);
}

//#endregion
//#region transactions/scoped/mints/ScopedMintMetadataCommands.ts
/** Cache persistence shared by owning transactions; remote metadata cannot change mint trust. */
var RepositoryMintMetadataCommands = class {
	constructor(mints, keysets) {
		this.mints = mints;
		this.keysets = keysets;
	}
	async assertTrusted(mintUrl) {
		if (!await this.mints.isTrustedMint(mintUrl)) throw new UnknownMintError(`Mint ${mintUrl} is not trusted`);
	}
	async applyObservation(observation) {
		const current = (await this.mints.getAllMints()).find((mint) => mint.mintUrl === observation.mintUrl);
		if (current && current.updatedAt >= observation.observedAt) return {
			applied: false,
			metadata: {
				mint: current,
				keysets: (await this.keysets.getKeysetsByMintUrl(current.mintUrl)).filter((keyset) => !isBlsKeyset(keyset.id))
			}
		};
		for (const keyset of observation.keysets) if (await this.keysets.getKeysetById(observation.mintUrl, keyset.id)) await this.keysets.updateKeyset(keyset);
		else await this.keysets.addKeyset(keyset);
		const mint = {
			...current ?? {
				mintUrl: observation.mintUrl,
				name: observation.mintUrl,
				trusted: false,
				createdAt: observation.observedAt
			},
			mintInfo: observation.mintInfo,
			updatedAt: observation.observedAt
		};
		await this.mints.addOrUpdateMint(mint);
		return {
			applied: true,
			metadata: {
				mint,
				keysets: (await this.keysets.getKeysetsByMintUrl(mint.mintUrl)).filter((keyset) => !isBlsKeyset(keyset.id))
			}
		};
	}
};

//#endregion
//#region proofs/ProofSelection.ts
function selectProofInputs(operation, available, keyChain, selectProofs, forceSwap) {
	const unit = normalizeUnit(operation.unit);
	for (const proof of available) assertSameUnit(normalizeUnit(proof.unit), unit, "Send proof selection");
	if (sumProofs(available).lessThan(operation.amount)) throw new ProofValidationError("Not enough proofs to send");
	if (!forceSwap) {
		const exact = selectProofs(available, operation.amount, keyChain, false).send;
		if (sumProofs(exact).equals(operation.amount)) return {
			proofs: exact,
			fee: Amount$1.zero(),
			needsSwap: false
		};
	}
	const selected = selectProofs(available, operation.amount, keyChain, true).send;
	const fee = calculateProofFee(selected, keyChain);
	if (selected.length > 0 && sumProofs(selected).greaterThanOrEqual(operation.amount.add(fee))) return {
		proofs: selected,
		fee,
		needsSwap: true
	};
	throw new ProofValidationError("Send amount is not sufficient after fees");
}
function calculateProofFee(proofs, keyChain) {
	const ppk = proofs.reduce((sum, proof) => {
		let fee;
		try {
			fee = keyChain.getKeyset(proof.id).fee;
		} catch {
			throw new ProofValidationError(`Missing fee preflight for keyset ${proof.id}`);
		}
		return sum + BigInt(fee);
	}, 0n);
	return Amount$1.from((ppk + 999n) / 1000n);
}

//#endregion
//#region transactions/scoped/proofs/ScopedProofCommands.ts
/** Reusable reservation and settlement rules within the owning operation's adapter scope. */
var RepositoryProofCommands = class {
	constructor(proofs, keysets, selectProofs = selectProofsRGLI) {
		this.proofs = proofs;
		this.keysets = keysets;
		this.selectProofs = selectProofs;
	}
	async selectAndReserve(input) {
		const available = await this.proofs.getAvailableProofs(input.mintUrl, { unit: input.unit });
		const keysets = await this.keysets.getKeysetsByMintUrl(input.mintUrl);
		const selected = selectProofInputs(input, available, createKeyChain(input.mintUrl, input.unit, keysets), this.selectProofs, input.forceSwap);
		const secrets = selected.proofs.map((proof) => proof.secret);
		if (new Set(secrets).size !== secrets.length) throw new ProofValidationError("Proof selection contains duplicate inputs");
		await this.proofs.reserveProofs(input.mintUrl, secrets, input.operationId);
		return {
			...selected,
			proofs: selected.proofs
		};
	}
	async getFee(mintUrl, unit, proofs) {
		return calculateProofFee(proofs, createKeyChain(mintUrl, unit, await this.keysets.getKeysetsByMintUrl(mintUrl)));
	}
	async getOwned(input) {
		if (new Set(input.secrets).size !== input.secrets.length) throw new ProofValidationError("Operation contains duplicate input proofs");
		const stored = await this.proofs.getProofsBySecrets(input.mintUrl, input.secrets);
		const bySecret = new Map(stored.map((proof) => [proof.secret, proof]));
		return input.secrets.map((secret) => {
			const proof = bySecret.get(secret);
			const owner = input.ownership === "created" ? proof?.createdByOperationId : proof?.usedByOperationId;
			if (!proof || owner !== input.operationId || !(Array.isArray(input.state) ? input.state.includes(proof.state) : proof.state === input.state) || proof.mintUrl !== input.mintUrl || normalizeUnit(proof.unit) !== normalizeUnit(input.unit)) throw new ProofValidationError(`Proof ${secret} is not ${input.state} and operation-owned`);
			return proof;
		});
	}
	async markInflight(input) {
		if ((await this.getOwned({
			...input,
			state: "ready"
		})).some((proof) => proof.usedByOperationId != null && proof.usedByOperationId !== input.operationId)) throw new ProofValidationError("Cannot mark proofs reserved by another operation inflight");
		await this.proofs.setProofState(input.mintUrl, input.secrets, "inflight");
	}
	async releaseUnsubmitted(input) {
		await this.getOwned({
			...input,
			state: ["ready", "inflight"]
		});
		await this.proofs.setProofState(input.mintUrl, input.secrets, "ready");
		await this.proofs.releaseProofs(input.mintUrl, input.secrets);
	}
	async settleSpend(input) {
		await this.getOwned(input);
		for (const proof of input.outputs) if (proof.mintUrl !== input.mintUrl || normalizeUnit(proof.unit) !== normalizeUnit(input.unit)) throw new ProofValidationError("Settlement outputs have a different mint or unit");
		await this.proofs.saveProofs(input.mintUrl, input.outputs);
		await this.proofs.setProofState(input.mintUrl, input.secrets, "spent");
	}
	async recordSpent(input) {
		await this.getOwned({
			...input,
			state: "inflight"
		});
		await this.proofs.setProofState(input.mintUrl, input.secrets, "spent");
	}
	async releaseOwned(mintUrl, operationId, secrets) {
		const stored = await this.proofs.getProofsBySecrets(mintUrl, secrets);
		if (stored.length !== new Set(secrets).size || stored.some((proof) => proof.usedByOperationId !== operationId)) throw new ProofValidationError("Cannot release proofs owned by another operation");
		await this.proofs.releaseProofs(mintUrl, secrets);
	}
	getProofsByOperationId(mintUrl, operationId) {
		return this.proofs.getProofsByOperationId(mintUrl, operationId);
	}
	getProofsBySecrets(mintUrl, secrets) {
		return this.proofs.getProofsBySecrets(mintUrl, secrets);
	}
	getReservedProofs() {
		return this.proofs.getReservedProofs();
	}
};

//#endregion
//#region transactions/scoped/outputs/ScopedOutputCommands.ts
/** Shared deterministic Output Allocation. Only the owning transition may commit its plan. */
var RepositoryOutputCommands = class {
	constructor(counters, keysets, creator = OutputData) {
		this.counters = counters;
		this.keysets = keysets;
		this.creator = creator;
	}
	async assertActiveKeys(mintUrl, unit, activeKeys) {
		const keyset = await this.keysets.getKeysetById(mintUrl, activeKeys.id);
		if (!keyset || !keyset.active || normalizeUnit(keyset.unit) !== normalizeUnit(unit) || normalizeUnit(activeKeys.unit) !== normalizeUnit(unit) || JSON.stringify(Object.entries(keyset.keypairs).sort()) !== JSON.stringify(Object.entries(activeKeys.keys).sort())) throw new ProofValidationError(`Active keyset ${activeKeys.id} changed after preflight`);
	}
	async allocate(input) {
		await this.assertActiveKeys(input.mintUrl, input.unit, input.activeKeys);
		const current = (await this.counters.getCounter(input.mintUrl, input.activeKeys.id))?.counter ?? 0;
		const keep = input.keepAmount.isZero() ? [] : this.creator.createDeterministicData(input.keepAmount, input.seed, current, input.activeKeys);
		const send = input.fixedSendOutputs ? [...input.fixedSendOutputs] : input.sendAmount.isZero() ? [] : this.creator.createDeterministicData(input.sendAmount, input.seed, current + keep.length, input.activeKeys);
		if (input.fixedSendOutputs && send.length === 0) throw new ProofValidationError("Method preflight did not produce output data");
		const positions = keep.length + (input.fixedSendOutputs ? 0 : send.length);
		const next = current + positions;
		if (!Number.isSafeInteger(next)) throw new ProofValidationError("Output counter exhausted");
		const counter = positions > 0 ? {
			mintUrl: input.mintUrl,
			keysetId: input.activeKeys.id,
			counter: next
		} : void 0;
		if (counter) await this.counters.setCounter(counter.mintUrl, counter.keysetId, counter.counter);
		return {
			outputData: serializeOutputData({
				keep,
				send
			}),
			counter
		};
	}
};

//#endregion
//#region proofs/OutputProofs.ts
function assertOutputProofs(input) {
	const { proofs, state, kind } = input;
	const outputSecrets = getSecretsFromSerializedOutputData(input.outputData);
	const expectedSecrets = kind === "keep" ? outputSecrets.keepSecrets : outputSecrets.sendSecrets;
	if (new Set(expectedSecrets).size !== expectedSecrets.length || new Set(proofs.map((proof) => proof.secret)).size !== proofs.length || proofs.length !== expectedSecrets.length) throw new ProofValidationError(`Swap ${kind} proofs do not match allocated outputs`);
	const allocation = input.outputData[kind];
	const expected = new Map(allocation.map((output, index) => [expectedSecrets[index], {
		id: output.blindedMessage.id,
		amount: Amount$1.from(output.blindedMessage.amount)
	}]));
	for (const proof of proofs) {
		const output = expected.get(proof.secret);
		if (!output || proof.id !== output.id || !Amount$1.from(proof.amount).equals(output.amount) || proof.mintUrl !== input.mintUrl || normalizeUnit(proof.unit) !== normalizeUnit(input.unit) || proof.state !== state || proof.createdByOperationId !== input.createdByOperationId) throw new ProofValidationError(`Swap ${kind} proofs do not match allocated outputs`);
	}
}

//#endregion
//#region transactions/scoped/send/ScopedSendCommands.ts
var RepositorySendCommands = class {
	constructor(sends, proofs, outputs, mints) {
		this.sends = sends;
		this.proofs = proofs;
		this.outputs = outputs;
		this.mints = mints;
	}
	async prepare(input) {
		const operation = input.operation;
		if (await this.sends.getById(operation.id)) throw new SendOperationConflictError(operation.id, `Send operation id ${operation.id} already exists`);
		await this.mints.assertTrusted(operation.mintUrl);
		const selected = await this.proofs.selectAndReserve({
			mintUrl: operation.mintUrl,
			unit: operation.unit,
			operationId: operation.id,
			amount: operation.amount,
			forceSwap: input.forceSwap
		});
		const inputAmount = sumProofs(selected.proofs);
		const inputProofSecrets = selected.proofs.map((proof) => proof.secret);
		let outputData;
		let counterUpdate;
		if (selected.needsSwap) {
			const allocation = await this.outputs.allocate({
				mintUrl: operation.mintUrl,
				unit: operation.unit,
				activeKeys: input.activeKeys,
				seed: input.seed,
				keepAmount: inputAmount.subtract(operation.amount.add(selected.fee)),
				sendAmount: operation.amount,
				fixedSendOutputs: input.fixedSendOutputs
			});
			outputData = allocation.outputData;
			counterUpdate = allocation.counter;
		} else await this.outputs.assertActiveKeys(operation.mintUrl, operation.unit, input.activeKeys);
		const prepared = {
			...operation,
			state: "prepared",
			revision: 0,
			updatedAt: operation.updatedAt,
			needsSwap: selected.needsSwap,
			fee: selected.fee,
			inputAmount,
			inputProofSecrets,
			outputData
		};
		await this.sends.create(prepared);
		return {
			operation: prepared,
			reservation: {
				mintUrl: operation.mintUrl,
				operationId: operation.id,
				secrets: inputProofSecrets,
				amount: inputAmount,
				unit: operation.unit
			},
			counter: counterUpdate
		};
	}
	async executeExact(input) {
		const current = await this.sends.getById(input.operationId);
		const idempotent = getIdempotentExactResult(current, input);
		if (idempotent) return idempotent;
		if (!current || current.state !== "prepared") throw new SendOperationConflictError(input.operationId, "Exact Send execution lost a state or revision conflict");
		if (current.needsSwap || current.method !== "default") throw new ProofValidationError(`Send operation ${input.operationId} requires a mint swap`);
		const proofs = await this.getOwnedReadyInputs(current);
		assertExactInputs(proofs, current);
		const revision = current.revision ?? 0;
		const normalizedMemo = normalizeMemo(input.memo);
		const token = {
			mint: current.mintUrl,
			proofs,
			unit: current.unit,
			...normalizedMemo ? { memo: normalizedMemo } : {}
		};
		const pending = {
			...current,
			state: "pending",
			updatedAt: input.updatedAt,
			token
		};
		await this.proofs.markInflight({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: current.inputProofSecrets
		});
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "prepared",
			expectedRevision: revision,
			next: pending
		})) throw new SendOperationConflictError(current.id, "Exact Send execution lost a state or revision conflict");
		pending.revision = revision + 1;
		return {
			operation: pending,
			token,
			committed: true
		};
	}
	async beginExecution(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current) throw new SendOperationConflictError(input.operationId, "Send operation not found");
		if (current.state !== "prepared") throw new SendOperationConflictError(input.operationId, `Cannot begin Send execution in state ${current.state}`);
		if (!current.needsSwap || !current.outputData) throw new SendOperationConflictError(input.operationId, "Swap execution requires a prepared swap request");
		const inputProofs = await this.getOwnedReadyInputs(current);
		const revision = current.revision ?? 0;
		const executing = {
			...current,
			state: "executing",
			revision: revision + 1,
			updatedAt: input.updatedAt,
			executionMemo: input.memo
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "prepared",
			expectedRevision: revision,
			next: executing
		})) throw new SendOperationConflictError(current.id, "Send execution lost a prepared-state conflict");
		return {
			operation: executing,
			request: {
				mintUrl: executing.mintUrl,
				unit: executing.unit,
				amount: executing.amount,
				inputProofs,
				outputData: current.outputData
			}
		};
	}
	async claimRecovery(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current || current.state !== "executing" || !current.needsSwap || !current.outputData || (current.revision ?? 0) !== input.expectedRevision) throw new SendOperationConflictError(input.operationId, "Send recovery lost an executing-state or revision conflict");
		const inputProofs = await this.proofs.getOwned({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: current.inputProofSecrets,
			state: ["ready", "spent"]
		});
		const claimed = {
			...current,
			revision: input.expectedRevision + 1,
			updatedAt: input.updatedAt
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "executing",
			expectedRevision: input.expectedRevision,
			next: claimed
		})) throw new SendOperationConflictError(current.id, "Send recovery lost an executing-state or revision conflict");
		return {
			operation: claimed,
			request: {
				mintUrl: claimed.mintUrl,
				unit: claimed.unit,
				amount: claimed.amount,
				inputProofs,
				outputData: claimed.outputData
			}
		};
	}
	async recoverLegacyExact(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current || current.state !== "executing" || (current.revision ?? 0) !== 0 || current.method !== "default" || current.needsSwap || current.outputData || "token" in current && current.token) throw new SendOperationConflictError(input.operationId, "Legacy exact Send recovery lost a state or revision conflict");
		const inputs = await this.proofs.getOwned({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: current.inputProofSecrets,
			state: ["ready", "inflight"]
		});
		assertExactInputs(inputs, current);
		await this.proofs.releaseUnsubmitted({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: current.inputProofSecrets
		});
		const operation = {
			...current,
			state: "rolled_back",
			revision: 1,
			updatedAt: input.updatedAt,
			error: "Recovered legacy exact Send interrupted before token delivery"
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "executing",
			expectedRevision: 0,
			next: operation
		})) throw new SendOperationConflictError(current.id, "Legacy exact Send recovery conflicted");
		return {
			operation,
			readyProofSecrets: inputs.filter((proof) => proof.state === "inflight").map((proof) => proof.secret),
			releasedInputSecrets: [...current.inputProofSecrets],
			committed: true
		};
	}
	async applyResult(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current) throw new SendOperationConflictError(input.operationId, "Send operation not found");
		if (current.state === "pending") {
			if (!current.needsSwap || !current.outputData || !current.token || !sameToken(current.token, input.token)) throw new SendOperationConflictError(input.operationId, "Send result conflicts with the persisted pending token");
			assertSwapResult(current, input);
			if (!sameCoreProofSet((await this.proofs.getProofsByOperationId(current.mintUrl, current.id)).filter((proof) => proof.createdByOperationId === current.id), [...input.keepProofs, ...input.sendProofs])) throw new SendOperationConflictError(input.operationId, "Send result conflicts with the persisted pending proofs");
			return {
				operation: current,
				savedProofs: [],
				inflightProofSecrets: [],
				spentInputSecrets: [],
				committed: false
			};
		}
		if (current.state !== "executing" || !current.needsSwap || !current.outputData) throw new SendOperationConflictError(input.operationId, `Cannot apply Send result in state ${current.state}`);
		const revision = current.revision ?? 0;
		assertSwapResult(current, input);
		const outputs = [...input.keepProofs, ...input.sendProofs];
		const existing = await this.proofs.getProofsBySecrets(current.mintUrl, outputs.map((proof) => proof.secret));
		const existingSecrets = new Set(existing.map((proof) => proof.secret));
		if (!sameCoreProofSet(existing, outputs.filter((proof) => existingSecrets.has(proof.secret)))) throw new ProofValidationError("Swap output already exists with conflicting proof data or ownership");
		const sendSecrets = new Set(input.sendProofs.map((proof) => proof.secret));
		const inflightProofSecrets = existing.filter((proof) => sendSecrets.has(proof.secret) && proof.state === "ready").map((proof) => proof.secret);
		if (inflightProofSecrets.length > 0) await this.proofs.markInflight({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: inflightProofSecrets,
			ownership: "created"
		});
		const savedProofs = outputs.filter((proof) => !existingSecrets.has(proof.secret));
		await this.proofs.settleSpend({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: current.inputProofSecrets,
			state: ["ready", "spent"],
			outputs: savedProofs
		});
		const pending = {
			...current,
			state: "pending",
			revision: (current.revision ?? 0) + 1,
			updatedAt: input.updatedAt,
			token: input.token
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "executing",
			expectedRevision: revision,
			next: pending
		})) throw new SendOperationConflictError(current.id, "Send result lost an executing-state conflict");
		return {
			operation: pending,
			savedProofs,
			inflightProofSecrets,
			spentInputSecrets: [...current.inputProofSecrets],
			committed: true
		};
	}
	async failExecution(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current) throw new SendOperationConflictError(input.operationId, "Send operation not found");
		if (current.state === "rolled_back" && current.error === input.error) return {
			operation: current,
			releasedInputSecrets: [],
			committed: false
		};
		if (current.state !== "executing" || !current.needsSwap) throw new SendOperationConflictError(input.operationId, `Cannot fail Send execution in state ${current.state}`);
		const revision = current.revision ?? 0;
		if (revision !== input.expectedRevision) throw new SendOperationConflictError(input.operationId, "Send failure lost an executing revision conflict");
		await this.getOwnedReadyInputs(current);
		await this.proofs.releaseOwned(current.mintUrl, current.id, current.inputProofSecrets);
		const failed = {
			...current,
			state: "rolled_back",
			revision: (current.revision ?? 0) + 1,
			updatedAt: input.updatedAt,
			error: input.error
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "executing",
			expectedRevision: revision,
			next: failed
		})) throw new SendOperationConflictError(current.id, "Send failure lost an executing-state conflict");
		return {
			operation: failed,
			releasedInputSecrets: [...current.inputProofSecrets],
			committed: true
		};
	}
	async cancelPrepared(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current) throw new SendOperationConflictError(input.operationId, "Send operation not found");
		if (current.state === "rolled_back" && current.error === input.reason) return {
			operation: current,
			releasedInputSecrets: [],
			committed: false
		};
		if (current.state !== "prepared") throw new SendOperationConflictError(input.operationId, "Send cancellation lost a prepared-state or revision conflict");
		const revision = current.revision ?? 0;
		await this.getOwnedReadyInputs(current);
		await this.proofs.releaseOwned(current.mintUrl, current.id, current.inputProofSecrets);
		const rolledBack = {
			...current,
			state: "rolled_back",
			revision: revision + 1,
			updatedAt: input.updatedAt,
			error: input.reason
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "prepared",
			expectedRevision: revision,
			next: rolledBack
		})) throw new SendOperationConflictError(current.id, "Send cancellation lost a prepared-state or revision conflict");
		return {
			operation: rolledBack,
			releasedInputSecrets: [...current.inputProofSecrets],
			committed: true
		};
	}
	async completePending(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current) throw new SendOperationConflictError(input.operationId, "Send operation not found");
		if (current.state === "finalized") return {
			operation: current,
			spentProofSecrets: [],
			releasedInputSecrets: [],
			committed: false
		};
		if (current.state !== "pending") throw new SendOperationConflictError(input.operationId, "Send completion lost a pending-state or revision conflict");
		const revision = current.revision ?? 0;
		const expectedSecrets = getSendProofSecrets(current);
		if (expectedSecrets.length === 0 || new Set(expectedSecrets).size !== expectedSecrets.length) throw new ProofValidationError(`Send operation ${current.id} has invalid send proof data`);
		const observedSecrets = input.spentProofSecrets ?? [];
		if (new Set(observedSecrets).size !== observedSecrets.length) throw new ProofValidationError("Send completion contains duplicate proof observations");
		const expectedSet = new Set(expectedSecrets);
		for (const secret of observedSecrets) if (!expectedSet.has(secret)) throw new ProofValidationError(`Proof ${secret} does not belong to Send operation`);
		const legacyObservation = input.legacyP2pkOutputObservation;
		if (legacyObservation && (!isLegacyTokenlessP2pkSend(current) || legacyObservation.expectedRevision !== revision || legacyObservation.mintUrl !== current.mintUrl || legacyObservation.unit !== current.unit || JSON.stringify(legacyObservation.outputData) !== JSON.stringify(current.outputData) || observedSecrets.length !== expectedSecrets.length)) throw new ProofValidationError("Cannot complete legacy P2PK Send: stale or incomplete observation");
		const sendProofs = await this.proofs.getProofsBySecrets(current.mintUrl, expectedSecrets);
		const sendBySecret = new Map(sendProofs.map((proof) => [proof.secret, proof]));
		if (!legacyObservation && sendBySecret.size !== expectedSecrets.length) throw new ProofValidationError("Cannot complete Send operation: missing send proof metadata");
		if (!legacyObservation && (!current.token || current.token.mint !== current.mintUrl || normalizeUnit(current.token.unit) !== normalizeUnit(current.unit) || !sameProofSet(current.token.proofs, sendProofs))) throw new ProofValidationError("Send proofs do not match the persisted token");
		for (const secret of expectedSecrets) {
			const proof = sendBySecret.get(secret);
			if (legacyObservation) {
				if (!proof) continue;
				const output = legacyObservation.outputData.send[expectedSecrets.indexOf(secret)];
				if (proof.id !== output.blindedMessage.id || !Amount$1.from(proof.amount).equals(Amount$1.from(output.blindedMessage.amount))) throw new ProofValidationError("Legacy P2PK proof does not match allocated output");
			}
			const owned = current.needsSwap ? proof?.createdByOperationId === current.id : proof && canCompleteWithInput(proof, current.id);
			if (!proof || !owned || proof.mintUrl !== current.mintUrl || normalizeUnit(proof.unit) !== normalizeUnit(current.unit) || proof.state !== "inflight" && proof.state !== "spent") throw new ProofValidationError(`Send proof ${secret} is not inflight and operation-owned`);
		}
		const newlySpent = observedSecrets.filter((secret) => sendBySecret.get(secret)?.state === "inflight");
		if (newlySpent.length > 0) await this.proofs.recordSpent({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets: newlySpent,
			ownership: current.needsSwap ? "created" : "used"
		});
		if (!expectedSecrets.every((secret) => observedSecrets.includes(secret) || sendBySecret.get(secret)?.state === "spent")) return {
			operation: current,
			spentProofSecrets: newlySpent,
			releasedInputSecrets: [],
			committed: newlySpent.length > 0
		};
		const inputs = await this.proofs.getProofsBySecrets(current.mintUrl, current.inputProofSecrets);
		const inputBySecret = new Map(inputs.map((proof) => [proof.secret, proof]));
		if (inputBySecret.size !== current.inputProofSecrets.length) throw new ProofValidationError("Cannot complete Send operation: missing input proof metadata");
		for (const secret of current.inputProofSecrets) {
			const proof = inputBySecret.get(secret);
			if (!proof || !canCompleteWithInput(proof, current.id) || proof.mintUrl !== current.mintUrl || normalizeUnit(proof.unit) !== normalizeUnit(current.unit) || proof.state !== "spent") throw new ProofValidationError(`Send input ${secret} is not spent and operation-owned`);
		}
		const releasedInputSecrets = inputs.filter((proof) => proof.usedByOperationId === current.id).map((proof) => proof.secret);
		if (releasedInputSecrets.length > 0) await this.proofs.releaseOwned(current.mintUrl, current.id, releasedInputSecrets);
		const finalized = {
			...current,
			state: "finalized",
			revision: revision + 1,
			updatedAt: input.updatedAt
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "pending",
			expectedRevision: revision,
			next: finalized
		})) throw new SendOperationConflictError(current.id, "Send completion lost a pending-state or revision conflict");
		return {
			operation: finalized,
			spentProofSecrets: newlySpent,
			releasedInputSecrets,
			committed: true
		};
	}
	async cleanupLegacyInit(operationId) {
		const current = await this.sends.getById(operationId);
		if (!current || current.state !== "init") throw new SendOperationConflictError(operationId, "Legacy Send init operation not found");
		const ownedSecrets = (await this.proofs.getProofsByOperationId(current.mintUrl, current.id)).filter((proof) => proof.usedByOperationId === current.id).map((proof) => proof.secret);
		if (ownedSecrets.length > 0) await this.proofs.releaseOwned(current.mintUrl, current.id, ownedSecrets);
		await this.sends.delete(current.id);
		return {
			operationId: current.id,
			mintUrl: current.mintUrl,
			releasedProofSecrets: ownedSecrets
		};
	}
	async cleanupOrphanedReservations() {
		const reservedProofs = await this.proofs.getReservedProofs();
		const reservedByMint = /* @__PURE__ */ new Map();
		for (const proof of reservedProofs) {
			if (!proof.usedByOperationId) continue;
			const proofs = reservedByMint.get(proof.mintUrl) ?? [];
			proofs.push(proof);
			reservedByMint.set(proof.mintUrl, proofs);
		}
		const released = [];
		for (const [mintUrl, reserved] of reservedByMint) {
			const operations = await this.sends.getByMintUrl(mintUrl);
			const operationById = new Map(operations.map((operation) => [operation.id, operation]));
			const secrets = reserved.filter((proof) => {
				const operation = operationById.get(proof.usedByOperationId);
				return operation !== void 0 && isTerminalOperation$1(operation);
			}).map((proof) => proof.secret);
			if (secrets.length > 0) released.push({
				mintUrl,
				secrets
			});
		}
		for (const group of released) {
			const reserved = reservedByMint.get(group.mintUrl);
			const owners = new Set(reserved.filter((proof) => group.secrets.includes(proof.secret)).map((proof) => proof.usedByOperationId));
			for (const owner of owners) await this.proofs.releaseOwned(group.mintUrl, owner, reserved.filter((proof) => proof.usedByOperationId === owner && group.secrets.includes(proof.secret)).map((proof) => proof.secret));
		}
		return {
			released,
			count: released.reduce((count, group) => count + group.secrets.length, 0)
		};
	}
	async beginReclaim(input) {
		const current = await this.sends.getById(input.operationId);
		const refund = input.spendingPath === "refund";
		if (!current || current.state !== "pending" || (refund ? current.method !== "p2pk" : current.method !== "default") || refund && (current.revision ?? 0) !== input.expectedRevision) throw new SendOperationConflictError(input.operationId, "Pending Send reclaim lost a state or revision conflict");
		const sendSecrets = getSendProofSecrets(current);
		if (new Set(sendSecrets).size !== sendSecrets.length) throw new ProofValidationError("Send reclaim inputs must be unique");
		if (refund && (input.expectedInputProofSecrets.length !== sendSecrets.length || input.expectedInputProofSecrets.some((secret, index) => secret !== sendSecrets[index]))) throw new SendOperationConflictError(current.id, "P2PK refund input binding no longer matches the Send operation");
		const secrets = (await this.proofs.getProofsByOperationId(current.mintUrl, current.id)).filter((proof) => sendSecrets.includes(proof.secret) && proof.state === "inflight").map((proof) => proof.secret);
		const inputProofs = await this.proofs.getOwned({
			mintUrl: current.mintUrl,
			unit: current.unit,
			operationId: current.id,
			secrets,
			state: "inflight",
			ownership: current.needsSwap ? "created" : "used"
		});
		if (refund && (inputProofs.length !== sendSecrets.length || !sendSecrets.every((secret) => inputProofs.some((proof) => proof.secret === secret)))) throw new SendOperationConflictError(current.id, "P2PK refund requires every exact operation-owned inflight proof");
		const orderedInputProofs = refund ? sendSecrets.map((secret) => inputProofs.find((proof) => proof.secret === secret)) : inputProofs;
		const total = sumProofs(orderedInputProofs);
		const fee = await this.proofs.getFee(current.mintUrl, current.unit, orderedInputProofs);
		const skippedForFees = orderedInputProofs.length > 0 && total.lessThanOrEqual(fee);
		if (refund && (orderedInputProofs.length === 0 || skippedForFees)) throw new ProofValidationError("P2PK refund cannot allocate a reclaim output after fees");
		const allocation = orderedInputProofs.length > 0 && !skippedForFees ? await this.outputs.allocate({
			mintUrl: current.mintUrl,
			unit: current.unit,
			activeKeys: input.activeKeys,
			seed: input.seed,
			keepAmount: total.subtract(fee),
			sendAmount: Amount$1.zero()
		}) : void 0;
		const revision = current.revision ?? 0;
		const reclaimData = allocation ? refund ? {
			inputProofSecrets: [...input.expectedInputProofSecrets],
			outputData: allocation.outputData,
			spendingPath: "refund",
			conditionFingerprint: input.conditionFingerprint,
			refundPublicKeyX: input.refundPublicKeyX
		} : {
			inputProofSecrets: secrets,
			outputData: allocation.outputData
		} : void 0;
		const rollingBack = {
			...current,
			state: "rolling_back",
			revision: revision + 1,
			updatedAt: input.updatedAt,
			reclaimData
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "pending",
			expectedRevision: revision,
			next: rollingBack
		})) throw new SendOperationConflictError(current.id, "Pending Send reclaim lost a state or revision conflict");
		return {
			operation: rollingBack,
			inputProofs: orderedInputProofs,
			counter: allocation?.counter,
			skippedForFees
		};
	}
	async completeReclaim(input) {
		const current = await this.sends.getById(input.operationId);
		if (!current || current.state !== "rolling_back") throw new SendOperationConflictError(input.operationId, "Pending Send reclaim completion lost a state or revision conflict");
		const allocation = current.reclaimData;
		const spentProofSecrets = allocation?.inputProofSecrets ?? [];
		if (allocation) {
			assertOutputProofs({
				mintUrl: current.mintUrl,
				unit: current.unit,
				outputData: allocation.outputData,
				kind: "keep",
				state: "ready",
				proofs: input.proofs
			});
			await this.proofs.settleSpend({
				mintUrl: current.mintUrl,
				unit: current.unit,
				operationId: current.id,
				secrets: spentProofSecrets,
				state: ["inflight", "spent"],
				ownership: current.needsSwap ? "created" : "used",
				outputs: input.proofs
			});
		} else if (input.proofs.length > 0) throw new ProofValidationError("Reclaimed proofs have no committed output plan");
		const associated = await this.proofs.getProofsByOperationId(current.mintUrl, current.id);
		const releaseCandidates = new Set([...current.inputProofSecrets, ...getKeepProofSecrets(current)]);
		const releasedProofSecrets = associated.filter((proof) => proof.usedByOperationId === current.id && releaseCandidates.has(proof.secret)).map((proof) => proof.secret);
		await this.proofs.releaseOwned(current.mintUrl, current.id, releasedProofSecrets);
		const revision = current.revision ?? 0;
		const rolledBack = {
			...current,
			state: "rolled_back",
			revision: revision + 1,
			updatedAt: input.updatedAt,
			error: input.reason
		};
		if (!await this.sends.transition({
			operationId: current.id,
			expectedState: "rolling_back",
			expectedRevision: revision,
			next: rolledBack
		})) throw new SendOperationConflictError(current.id, "Pending Send reclaim completion lost a state or revision conflict");
		return {
			operation: rolledBack,
			savedProofs: input.proofs,
			spentProofSecrets,
			releasedProofSecrets
		};
	}
	async getOwnedReadyInputs(operation) {
		return this.proofs.getOwned({
			mintUrl: operation.mintUrl,
			unit: operation.unit,
			operationId: operation.id,
			secrets: operation.inputProofSecrets,
			state: "ready"
		});
	}
};
/** Completion can resume after an old finalizer released already-spent inputs before crashing. */
function canCompleteWithInput(proof, operationId) {
	return proof.usedByOperationId === operationId || proof.usedByOperationId == null && proof.state === "spent";
}
function getIdempotentExactResult(current, input) {
	if (!current || current.state !== "pending" || current.needsSwap || !current.token) return;
	if (!isEquivalentExactToken(current, current.token, input)) throw new SendOperationConflictError(input.operationId, "Exact Send result differs from the already committed operation");
	return {
		operation: current,
		token: current.token,
		committed: false
	};
}
function isEquivalentExactToken(operation, token, input) {
	return token.mint === operation.mintUrl && normalizeUnit(token.unit) === normalizeUnit(operation.unit) && normalizeMemo(token.memo) === normalizeMemo(input.memo) && token.proofs.length === operation.inputProofSecrets.length && token.proofs.every((proof, index) => proof.secret === operation.inputProofSecrets[index]);
}
function assertExactInputs(resolved, operation) {
	if (!sumProofs(resolved).equals(operation.amount) || !operation.inputAmount.equals(operation.amount) || !operation.fee.isZero()) throw new ProofValidationError(`Send operation ${operation.id} is not an exact proof match`);
}
function normalizeMemo(memo) {
	const trimmed = memo?.trim();
	return trimmed ? trimmed : void 0;
}
function assertSwapResult(operation, input) {
	assertOutputProofs({
		...operation,
		outputData: operation.outputData,
		createdByOperationId: operation.id,
		proofs: input.keepProofs,
		state: "ready",
		kind: "keep"
	});
	assertOutputProofs({
		...operation,
		outputData: operation.outputData,
		createdByOperationId: operation.id,
		proofs: input.sendProofs,
		state: "inflight",
		kind: "send"
	});
	if (input.token.mint !== operation.mintUrl || normalizeUnit(input.token.unit) !== normalizeUnit(operation.unit) || input.token.memo !== operation.executionMemo || !sameProofSet(input.token.proofs, input.sendProofs)) throw new ProofValidationError("Swap token does not match the persisted Send request");
}
function sameToken(left, right) {
	return left.mint === right.mint && normalizeUnit(left.unit) === normalizeUnit(right.unit) && left.memo === right.memo && sameProofSet(left.proofs, right.proofs);
}
function sameCoreProofSet(left, right) {
	return sameProofSet(left, right) && left.every((proof) => {
		const candidate = right.find((item) => item.secret === proof.secret);
		return candidate?.mintUrl === proof.mintUrl && normalizeUnit(candidate.unit) === normalizeUnit(proof.unit) && candidate.createdByOperationId === proof.createdByOperationId;
	});
}
function sameProofSet(left, right) {
	if (left.length !== right.length || new Set(left.map((proof) => proof.secret)).size !== left.length || new Set(right.map((proof) => proof.secret)).size !== right.length) return false;
	const rightBySecret = new Map(right.map((proof) => [proof.secret, proof]));
	return left.every((proof) => {
		const candidate = rightBySecret.get(proof.secret);
		return candidate ? sameProof(proof, candidate) : false;
	});
}
function sameProof(left, right) {
	return left.id === right.id && left.secret === right.secret && left.C === right.C && Amount$1.from(left.amount).equals(Amount$1.from(right.amount)) && left.witness === right.witness && JSON.stringify(left.dleq) === JSON.stringify(right.dleq);
}

//#endregion
//#region transactions/scoped/keypairs/ScopedKeypairCommands.ts
const MAX_DERIVATION_INDEX = 2147483647;
var RepositoryKeypairCommands = class {
	constructor(repository) {
		this.repository = repository;
	}
	async allocate(input) {
		const lastAllocatedIndex = await this.repository.getLastAllocatedIndex(input.purpose);
		const highestStoredIndex = await this.repository.getHighestStoredDerivationIndex(input.purpose);
		const previousIndex = Math.max(lastAllocatedIndex ?? -1, highestStoredIndex ?? -1);
		if (previousIndex >= MAX_DERIVATION_INDEX) throw new DerivationIndexExhaustedError(input.purpose);
		const derivationIndex = previousIndex + 1;
		const keypair = {
			...input.derive(derivationIndex),
			derivationIndex,
			purpose: input.purpose
		};
		await this.repository.setPersistedKeyPair(keypair);
		await this.repository.setLastAllocatedIndex(input.purpose, derivationIndex);
		return keypair;
	}
	importP2pk(keypair) {
		return this.repository.setPersistedKeyPair(keypair);
	}
	deleteP2pk(publicKey) {
		return this.repository.deletePersistedKeyPair(publicKey, "p2pk");
	}
};

//#endregion
//#region transactions/scoped/TransactionLifetime.ts
/**
* Owns asynchronous commands and repository calls for one transaction attempt. Failure revokes
* further work; calls already executing settle before the adapter may roll back or retry.
* This helper has no authority to open, commit, or roll back a transaction.
*/
var TransactionLifetime = class {
	pending = /* @__PURE__ */ new Set();
	failure;
	closed = false;
	/** Wrap modules on access, preserving inherited bindings and each getter's original receiver. */
	bind(modules) {
		const bound = /* @__PURE__ */ new WeakMap();
		return new Proxy(Object.create(modules), { get: (_target, property) => {
			const module = Reflect.get(modules, property, modules);
			if (typeof module !== "object" || module === null) return module;
			if (!bound.has(module)) bound.set(module, this.bindModule(module));
			return bound.get(module);
		} });
	}
	async run(work) {
		let result;
		try {
			try {
				result = await work();
			} catch (error) {
				this.fail(error);
			}
			while (this.pending.size > 0) await Promise.all([...this.pending]);
			if (this.failure) throw this.failure.error;
			return result;
		} finally {
			this.closed = true;
		}
	}
	bindModule(module) {
		const methods = /* @__PURE__ */ new Map();
		return new Proxy(Object.create(module), { get: (_target, property) => {
			const value = Reflect.get(module, property, module);
			if (typeof value !== "function") return value;
			if (!methods.has(property)) methods.set(property, (...args) => this.invoke(() => Reflect.apply(value, module, args)));
			return methods.get(property);
		} });
	}
	invoke(call) {
		let result;
		try {
			if (this.closed) throw new Error("Wallet transaction scope is closed");
			if (this.failure) throw this.failure.error;
			result = Promise.resolve(call());
		} catch (error) {
			this.fail(error);
			result = Promise.reject(error);
		}
		const observed = result.then((value) => value, (error) => {
			this.fail(error);
			throw error;
		});
		const settled = observed.then(() => {
			this.pending.delete(settled);
		}, () => {
			this.pending.delete(settled);
		});
		this.pending.add(settled);
		return observed;
	}
	fail(error) {
		this.failure ??= { error };
	}
};

//#endregion
//#region transactions/CoreTransaction.ts
const MAX_TRANSACTION_ATTEMPTS = 3;
/** Internal adapter-backed transaction runner owned by the composition root. */
var RepositoryCoreTransactionRunner = class {
	constructor(repositories, outputDataCreator = OutputData) {
		this.repositories = repositories;
		this.outputDataCreator = outputDataCreator;
	}
	async run(work) {
		for (let attempt = 1;; attempt++) try {
			return await this.repositories.withTransaction((repositories) => {
				const lifetime = new TransactionLifetime();
				return lifetime.run(() => work(lifetime.bind(this.createTransaction(lifetime.bind(repositories)))));
			});
		} catch (error) {
			if (!(error instanceof RepositoryTransactionConflictError) || attempt >= MAX_TRANSACTION_ATTEMPTS) throw error;
			await new Promise((resolve) => setTimeout(resolve, attempt * 5));
		}
	}
	createTransaction(repositories) {
		const mintMetadata = new RepositoryMintMetadataCommands(repositories.mintRepository, repositories.keysetRepository);
		const proofs = new RepositoryProofCommands(repositories.proofRepository, repositories.keysetRepository);
		const outputs = new RepositoryOutputCommands(repositories.counterRepository, repositories.keysetRepository, this.outputDataCreator);
		return {
			mintMetadata,
			keypairs: new RepositoryKeypairCommands(repositories.keyRingRepository),
			proofs,
			outputs,
			sends: new RepositorySendCommands(repositories.sendOperationRepository, proofs, outputs, mintMetadata)
		};
	}
};

//#endregion
//#region transactions/send/SendTransactions.ts
var CoreSendTransactions = class {
	constructor(runner) {
		this.runner = runner;
	}
	prepare(input) {
		return this.runner.run((transaction) => transaction.sends.prepare(input));
	}
	executeExact(input) {
		return this.runner.run((transaction) => transaction.sends.executeExact(input));
	}
	beginExecution(input) {
		return this.runner.run((transaction) => transaction.sends.beginExecution(input));
	}
	claimRecovery(input) {
		return this.runner.run((transaction) => transaction.sends.claimRecovery(input));
	}
	recoverLegacyExact(input) {
		return this.runner.run((transaction) => transaction.sends.recoverLegacyExact(input));
	}
	applyResult(input) {
		return this.runner.run((transaction) => transaction.sends.applyResult(input));
	}
	failExecution(input) {
		return this.runner.run((transaction) => transaction.sends.failExecution(input));
	}
	cancelPrepared(input) {
		return this.runner.run((transaction) => transaction.sends.cancelPrepared(input));
	}
	completePending(input) {
		return this.runner.run((transaction) => transaction.sends.completePending(input));
	}
	cleanupOrphanedReservations() {
		return this.runner.run((transaction) => transaction.sends.cleanupOrphanedReservations());
	}
	cleanupLegacyInit(operationId) {
		return this.runner.run((transaction) => transaction.sends.cleanupLegacyInit(operationId));
	}
	beginReclaim(input) {
		return this.runner.run((transaction) => transaction.sends.beginReclaim(input));
	}
	completeReclaim(input) {
		return this.runner.run((transaction) => transaction.sends.completeReclaim(input));
	}
};

//#endregion
//#region transactions/keypairs/KeyRingTransactions.ts
var CoreKeyRingTransactions = class {
	constructor(runner) {
		this.runner = runner;
	}
	allocate(input) {
		return this.runner.run((transaction) => transaction.keypairs.allocate(input));
	}
	importP2pkKey(keypair) {
		return this.runner.run((transaction) => transaction.keypairs.importP2pk(keypair));
	}
	deleteP2pkKey(publicKey) {
		return this.runner.run((transaction) => transaction.keypairs.deleteP2pk(publicKey));
	}
};

//#endregion
//#region keypairs/KeypairDerivation.ts
const DERIVATION_PURPOSES = {
	p2pk: 10,
	nut20_mint_quote: 20
};
/** Shared preflight capability. Loading the seed must not mutate Wallet storage. */
var KeypairDerivation = class {
	constructor(loadSeed) {
		this.loadSeed = loadSeed;
	}
	async prepare(purpose) {
		const hdKey = HDKey.fromMasterSeed(await this.loadSeed());
		const derivationPurpose = DERIVATION_PURPOSES[purpose];
		return {
			purpose,
			derive(derivationIndex) {
				const { privateKey: secretKey } = hdKey.derive(`m/129373'/${derivationPurpose}'/0'/0'/${derivationIndex}`);
				if (!secretKey) throw new Error("Failed to derive secret key");
				return {
					publicKeyHex: purpose === "nut20_mint_quote" ? bytesToHex(secp256k1.getPublicKey(secretKey, true)) : "02" + bytesToHex(schnorr.getPublicKey(secretKey)),
					secretKey
				};
			}
		};
	}
};

//#endregion
//#region Manager.ts
/**
* Reports a failed `initializeCoco()` call and whether its partially initialized Manager was
* disposed successfully.
*/
var CocoInitializationError = class extends Error {
	constructor(message, cleanupState, cause) {
		super(message, { cause });
		this.cleanupState = cleanupState;
		this.name = "CocoInitializationError";
	}
};
/**
* Initializes and configures a new Coco Cashu manager instance
* @param config - Configuration options including repositories, seed, and optional features
* @returns A fully initialized Manager instance
*/
async function initializeCoco(config) {
	await config.repo.init();
	const coco = new Manager(config.repo, config.seedGetter, config.logger, config.webSocketFactory, config.plugins, config.watchers, config.processors, config.subscriptions, config.outputDataCreator);
	try {
		await coco.initPlugins();
		await coco.reconcileLegacyMintQuotes();
		const mintOperationWatcherConfig = config.watchers?.mintOperationWatcher;
		if (!mintOperationWatcherConfig?.disabled) await coco.enableMintOperationWatcher(mintOperationWatcherConfig);
		const proofStateWatcherConfig = config.watchers?.proofStateWatcher;
		if (!proofStateWatcherConfig?.disabled) await coco.enableProofStateWatcher(proofStateWatcherConfig);
		const meltQuoteWatcherConfig = config.watchers?.meltQuoteWatcher;
		if (!meltQuoteWatcherConfig?.disabled) await coco.enableMeltQuoteWatcher(meltQuoteWatcherConfig);
		const mintOperationProcessorConfig = config.processors?.mintOperationProcessor;
		if (!mintOperationProcessorConfig?.disabled) await coco.enableMintOperationProcessor(mintOperationProcessorConfig);
		const meltSettlementProcessorConfig = config.processors?.meltSettlementProcessor;
		if (!meltSettlementProcessorConfig?.disabled) await coco.enableMeltSettlementProcessor(meltSettlementProcessorConfig);
		await coco.ops.send.recovery.run();
		await coco.ops.melt.recovery.run();
		await coco.recoverPendingPaymentRequestReceiveAttempts();
		await coco.recoverPendingMintOperations();
		return coco;
	} catch (error) {
		try {
			await coco.dispose();
		} catch (cleanupError) {
			throw new CocoInitializationError("Coco initialization failed and cleanup could not be confirmed", "unconfirmed", new AggregateError([error, cleanupError]));
		}
		throw new CocoInitializationError("Coco initialization failed", "confirmed", error);
	}
}
var Manager = class {
	mint;
	wallet;
	keyring;
	history;
	auth;
	ops;
	quotes;
	paymentRequests;
	ext;
	mintService;
	walletService;
	proofService;
	walletRestoreService;
	keyRingService;
	eventBus;
	logger;
	subscriptions;
	mintOperationWatcher;
	mintOperationProcessor;
	meltQuoteWatcher;
	meltSettlementProcessor;
	legacyMintQuoteRepository;
	quoteLifecycle;
	proofStateWatcher;
	historyService;
	seedService;
	counterService;
	tokenService;
	paymentRequestService;
	paymentRequestReceiveService;
	authSessionService;
	authService;
	sendOperationService;
	sendOperationRepository;
	meltOperationService;
	meltOperationRepository;
	mintOperationService;
	mintOperationRepository;
	receiveOperationService;
	receiveOperationRepository;
	paymentRequestReceiveOperationRepository;
	paymentRequestReceiveAttemptRepository;
	proofRepository;
	pluginHost = new PluginHost();
	subscriptionsPaused = false;
	originalWatcherConfig;
	originalProcessorConfig;
	mintRequestProvider;
	mintAdapter;
	disposed = false;
	disposePromise;
	outputDataCreator;
	constructor(repositories, seedGetter, logger, webSocketFactory, plugins, watchers, processors, subscriptions, outputDataCreator) {
		this.logger = logger ?? new NullLogger();
		this.eventBus = this.createEventBus();
		this.outputDataCreator = outputDataCreator;
		this.mintRequestProvider = new MintRequestProvider({
			capacity: 20,
			refillPerMinute: 20,
			logger: this.getChildLogger("RequestRateLimiter")
		});
		this.mintAdapter = new MintAdapter(this.mintRequestProvider);
		this.originalWatcherConfig = watchers;
		this.originalProcessorConfig = processors;
		if (plugins && plugins.length > 0) for (const p of plugins) this.pluginHost.use(p);
		const core = this.buildCoreServices(repositories, seedGetter);
		this.mintService = core.mintService;
		this.walletService = core.walletService;
		this.proofService = core.proofService;
		this.walletRestoreService = core.walletRestoreService;
		this.keyRingService = core.keyRingService;
		this.seedService = core.seedService;
		this.counterService = core.counterService;
		this.legacyMintQuoteRepository = core.legacyMintQuoteRepository;
		this.historyService = core.historyService;
		this.paymentRequestService = core.paymentRequestService;
		this.sendOperationService = core.sendOperationService;
		this.tokenService = core.tokenService;
		this.sendOperationRepository = core.sendOperationRepository;
		this.receiveOperationService = core.receiveOperationService;
		this.receiveOperationRepository = core.receiveOperationRepository;
		this.paymentRequestReceiveService = core.paymentRequestReceiveService;
		this.paymentRequestReceiveOperationRepository = core.paymentRequestReceiveOperationRepository;
		this.paymentRequestReceiveAttemptRepository = core.paymentRequestReceiveAttemptRepository;
		this.meltOperationService = core.meltOperationService;
		this.meltOperationRepository = core.meltOperationRepository;
		this.quoteLifecycle = core.quoteLifecycle;
		this.authSessionService = core.authSessionService;
		this.authService = core.authService;
		this.mintOperationService = core.mintOperationService;
		this.mintOperationRepository = core.mintOperationRepository;
		this.proofRepository = repositories.proofRepository;
		this.subscriptions = this.createSubscriptionManager(webSocketFactory, subscriptions);
		const apis = this.buildApis();
		this.mint = apis.mint;
		this.wallet = apis.wallet;
		this.keyring = apis.keyring;
		this.history = apis.history;
		this.ops = apis.ops;
		this.quotes = apis.quotes;
		this.auth = apis.auth;
		this.paymentRequests = apis.paymentRequests;
		this.ext = this.pluginHost.getExtensions();
		this.eventBus.on("mint:untrusted", ({ mintUrl }) => {
			this.logger.info("Mint untrusted, closing subscriptions", { mintUrl });
			this.subscriptions.closeMint(mintUrl);
		});
		const clearWalletCache = ({ mintUrl }) => {
			this.walletService.clearCache(mintUrl);
		};
		this.eventBus.on("auth-session:updated", clearWalletCache);
		this.eventBus.on("auth-session:deleted", clearWalletCache);
	}
	on(event, handler) {
		return this.eventBus.on(event, handler);
	}
	once(event, handler) {
		return this.eventBus.once(event, handler);
	}
	use(plugin) {
		this.pluginHost.use(plugin);
	}
	/**
	* Initialize the plugin system.
	* This is called automatically by `initializeCoco()`.
	* Only call this directly if you instantiate Manager without using the factory.
	*/
	async initPlugins() {
		const services = {
			mintService: this.mintService,
			walletService: this.walletService,
			proofService: this.proofService,
			keyRingService: this.keyRingService,
			seedService: this.seedService,
			walletRestoreService: this.walletRestoreService,
			paymentRequestService: this.paymentRequestService,
			counterService: this.counterService,
			meltOperationService: this.meltOperationService,
			mintOperationService: this.mintOperationService,
			quotes: this.quotes,
			historyService: this.historyService,
			sendOperationService: this.sendOperationService,
			receiveOperationService: this.receiveOperationService,
			paymentRequestReceiveService: this.paymentRequestReceiveService,
			tokenService: this.tokenService,
			subscriptions: this.subscriptions,
			eventBus: this.eventBus,
			logger: this.logger
		};
		await this.pluginHost.init(services);
		await this.pluginHost.ready();
	}
	async dispose() {
		if (this.disposePromise) {
			await this.disposePromise;
			return;
		}
		if (this.disposed) return;
		this.disposePromise = this.disposeOwnedResources();
		await this.disposePromise;
	}
	async disposeOwnedResources() {
		this.disposed = true;
		this.subscriptionsPaused = true;
		await this.disableMintOperationWatcher();
		await this.disableProofStateWatcher();
		await this.disableMeltSettlementProcessor();
		await this.disableMeltQuoteWatcher();
		await this.disableMintOperationProcessor();
		await this.pluginHost.dispose();
		this.subscriptions.closeAll();
	}
	off(event, handler) {
		return this.eventBus.off(event, handler);
	}
	async enableMintOperationWatcher(options) {
		if (this.disposed) return;
		if (this.mintOperationWatcher?.isRunning()) return;
		const watcherLogger = this.logger.child ? this.logger.child({ module: "MintOperationWatcherService" }) : this.logger;
		this.mintOperationWatcher = new MintOperationWatcherService(this.subscriptions, this.mintService, this.mintOperationService, this.quoteLifecycle, this.eventBus, watcherLogger, {
			watchExistingPendingOnStart: options?.watchExistingPendingOnStart ?? true,
			watchExistingPendingQuotesOnStart: options?.watchExistingPendingQuotesOnStart ?? true
		});
		await this.mintOperationWatcher.start();
	}
	async disableMintOperationWatcher() {
		if (!this.mintOperationWatcher) return;
		await this.mintOperationWatcher.stop();
		this.mintOperationWatcher = void 0;
	}
	async enableMintOperationProcessor(options) {
		if (this.disposed) return false;
		if (this.mintOperationProcessor?.isRunning()) return false;
		const processorLogger = this.logger.child ? this.logger.child({ module: "MintOperationProcessor" }) : this.logger;
		this.mintOperationProcessor = new MintOperationProcessor(this.mintOperationService, this.quoteLifecycle, this.eventBus, processorLogger, options);
		await this.mintOperationProcessor.start();
		return true;
	}
	async disableMintOperationProcessor() {
		if (!this.mintOperationProcessor) return;
		await this.mintOperationProcessor.stop();
		this.mintOperationProcessor = void 0;
	}
	async enableMeltQuoteWatcher(options) {
		if (this.disposed) return;
		if (this.meltQuoteWatcher?.isRunning()) {
			await this.meltSettlementProcessor?.setInterestRegistrar(this.meltQuoteWatcher);
			return;
		}
		const watcherLogger = this.logger.child ? this.logger.child({ module: "MeltQuoteWatcherService" }) : this.logger;
		this.meltQuoteWatcher = new MeltQuoteWatcherService(this.subscriptions, this.mintService, this.quoteLifecycle, this.eventBus, watcherLogger, { watchExistingPendingQuotesOnStart: options?.watchExistingPendingQuotesOnStart ?? true });
		await this.meltQuoteWatcher.start();
		await this.meltSettlementProcessor?.setInterestRegistrar(this.meltQuoteWatcher);
	}
	async disableMeltQuoteWatcher() {
		if (!this.meltQuoteWatcher) return;
		await this.meltSettlementProcessor?.setInterestRegistrar(void 0);
		await this.meltQuoteWatcher.stop();
		this.meltQuoteWatcher = void 0;
	}
	async enableMeltSettlementProcessor(options) {
		if (this.disposed) return false;
		if (this.meltSettlementProcessor?.isRunning()) return false;
		const processorLogger = this.logger.child ? this.logger.child({ module: "MeltSettlementProcessor" }) : this.logger;
		this.meltSettlementProcessor = new MeltSettlementProcessor(this.meltOperationService, this.eventBus, processorLogger, {
			initializeExistingPendingOperationsOnStart: options?.initializeExistingPendingOperationsOnStart ?? true,
			interestRegistrar: this.meltQuoteWatcher
		});
		await this.meltSettlementProcessor.start();
		return true;
	}
	async disableMeltSettlementProcessor() {
		if (!this.meltSettlementProcessor) return;
		await this.meltSettlementProcessor.stop();
		this.meltSettlementProcessor = void 0;
	}
	async waitForMintOperationProcessor() {
		if (!this.mintOperationProcessor) return;
		await this.mintOperationProcessor.waitForCompletion();
	}
	async enableProofStateWatcher(options) {
		if (this.disposed) return;
		if (this.proofStateWatcher?.isRunning()) return;
		const watcherLogger = this.logger.child ? this.logger.child({ module: "ProofStateWatcherService" }) : this.logger;
		this.proofStateWatcher = new ProofStateWatcherService(this.subscriptions, this.mintService, this.proofService, this.proofRepository, this.eventBus, watcherLogger, { watchExistingInflightOnStart: options?.watchExistingInflightOnStart ?? true });
		this.proofStateWatcher.setSendOperationService(this.sendOperationService);
		await this.proofStateWatcher.start();
	}
	async disableProofStateWatcher() {
		if (!this.proofStateWatcher) return;
		await this.proofStateWatcher.stop();
		this.proofStateWatcher = void 0;
	}
	async recoverPendingMintOperations() {
		await this.mintOperationService.recoverPendingOperations();
	}
	async recoverPendingPaymentRequestReceiveAttempts() {
		await this.paymentRequestReceiveService.recoverPendingAttempts();
	}
	async reconcileLegacyMintQuotes(mintUrl) {
		const reconciled = [];
		const skipped = [];
		const quotes = await this.legacyMintQuoteRepository.getPendingLegacyMintQuotes(mintUrl);
		for (const quote of quotes) {
			if (!isStatefulMintQuote(quote)) {
				skipped.push(quote.quote);
				continue;
			}
			if (assessMintQuoteClaimability(quote).status === "complete") {
				skipped.push(quote.quote);
				continue;
			}
			if (!await this.mintService.isTrustedMint(quote.mintUrl)) {
				this.logger.debug("Skipping legacy mint quote reconciliation for untrusted mint", {
					mintUrl: quote.mintUrl,
					quoteId: quote.quote
				});
				skipped.push(quote.quote);
				continue;
			}
			const existing = await this.mintOperationService.getOperationByQuote(quote.mintUrl, quote.method, quote.quoteId);
			if (existing && existing.state !== "init") {
				skipped.push(quote.quote);
				continue;
			}
			try {
				const imported = await this.quoteLifecycle.importMintQuote(quote.mintUrl, "bolt11", mintQuoteToMethodSnapshot(quote));
				const amount = getMintQuoteAmount(imported);
				if (!amount) throw new Error(`Legacy mint quote ${imported.quoteId} does not have a fixed amount`);
				const operation = await this.mintOperationService.prepare(imported, amount);
				reconciled.push(operation.quoteId);
			} catch (err) {
				this.logger.warn("Failed to reconcile legacy mint quote", {
					mintUrl: quote.mintUrl,
					quoteId: quote.quote,
					err
				});
				skipped.push(quote.quote);
			}
		}
		this.logger.info("Legacy mint quote reconciliation completed", {
			mintUrl,
			reconciled: reconciled.length,
			skipped: skipped.length
		});
		return {
			reconciled,
			skipped
		};
	}
	async pauseSubscriptions() {
		if (this.subscriptionsPaused) {
			this.logger.debug("Subscriptions already paused");
			return;
		}
		this.subscriptionsPaused = true;
		this.logger.info("Pausing subscriptions");
		this.subscriptions.pause();
		await this.disableMintOperationWatcher();
		await this.disableProofStateWatcher();
		await this.disableMeltSettlementProcessor();
		await this.disableMeltQuoteWatcher();
		await this.disableMintOperationProcessor();
		this.logger.info("Subscriptions paused");
		await this.eventBus.emit("subscriptions:paused", void 0);
	}
	async resumeSubscriptions() {
		if (this.disposed) {
			this.logger.debug("Cannot resume subscriptions after manager disposal");
			return;
		}
		this.subscriptionsPaused = false;
		this.logger.info("Resuming subscriptions");
		await this.eventBus.emit("subscriptions:resumed", void 0);
		this.subscriptions.resume();
		const mintOperationWatcherConfig = this.originalWatcherConfig?.mintOperationWatcher;
		if (!mintOperationWatcherConfig?.disabled) await this.enableMintOperationWatcher(mintOperationWatcherConfig);
		const proofStateWatcherConfig = this.originalWatcherConfig?.proofStateWatcher;
		if (!proofStateWatcherConfig?.disabled) await this.enableProofStateWatcher(proofStateWatcherConfig);
		const meltQuoteWatcherConfig = this.originalWatcherConfig?.meltQuoteWatcher;
		if (!meltQuoteWatcherConfig?.disabled) await this.enableMeltQuoteWatcher(meltQuoteWatcherConfig);
		const mintOperationProcessorConfig = this.originalProcessorConfig?.mintOperationProcessor;
		if (!mintOperationProcessorConfig?.disabled) await this.enableMintOperationProcessor(mintOperationProcessorConfig);
		const meltSettlementProcessorConfig = this.originalProcessorConfig?.meltSettlementProcessor;
		if (!meltSettlementProcessorConfig?.disabled) await this.enableMeltSettlementProcessor(meltSettlementProcessorConfig);
		await this.recoverPendingMintOperations();
		this.logger.info("Subscriptions resumed");
	}
	getChildLogger(moduleName) {
		return this.logger.child ? this.logger.child({ module: moduleName }) : this.logger;
	}
	async requeuePaidMintQuotes(mintUrl) {
		const requeued = [];
		const pendingOperations = await this.mintOperationService.getPendingOperations();
		for (const operation of pendingOperations) {
			if (mintUrl && operation.mintUrl !== mintUrl) continue;
			const assessment = await this.mintOperationService.getMintQuoteClaimability(operation.mintUrl, operation.method, operation.quoteId, {
				requestedAmount: operation.amount,
				targetOperationId: operation.id
			});
			if (!assessment || assessment.status !== "claimable" && assessment.status !== "complete") continue;
			if (!await this.mintService.isTrustedMint(operation.mintUrl)) continue;
			await this.eventBus.emit("mint-op:requeue", {
				mintUrl: operation.mintUrl,
				operationId: operation.id,
				operation
			});
			requeued.push(operation.quoteId);
		}
		return { requeued };
	}
	createEventBus() {
		const eventLogger = this.getChildLogger("EventBus");
		return new EventBus({ onError: (args) => {
			eventLogger.error("Event handler error", args);
		} });
	}
	createSubscriptionManager(webSocketFactory, subscriptionOptions) {
		const wsLogger = this.getChildLogger("SubscriptionManager");
		const defaultFactory = typeof globalThis.WebSocket !== "undefined" ? (url) => new globalThis.WebSocket(url) : void 0;
		const wsFactoryToUse = webSocketFactory ?? defaultFactory;
		const options = {
			slowPollingIntervalMs: subscriptionOptions?.slowPollingIntervalMs ?? 2e4,
			fastPollingIntervalMs: subscriptionOptions?.fastPollingIntervalMs ?? 5e3
		};
		if (!wsFactoryToUse) return new SubscriptionManager(new PollingTransport(this.mintAdapter, { intervalMs: options.fastPollingIntervalMs }, wsLogger, this.quoteLifecycle), this.mintAdapter, wsLogger, options);
		return new SubscriptionManager(wsFactoryToUse, this.mintAdapter, wsLogger, options, this.quoteLifecycle);
	}
	buildCoreServices(repositories, seedGetter) {
		const mintLogger = this.getChildLogger("MintService");
		const walletLogger = this.getChildLogger("WalletService");
		const counterLogger = this.getChildLogger("CounterService");
		const proofLogger = this.getChildLogger("ProofService");
		const walletRestoreLogger = this.getChildLogger("WalletRestoreService");
		const keyRingLogger = this.getChildLogger("KeyRingService");
		const historyLogger = this.getChildLogger("HistoryService");
		const tokenLogger = this.getChildLogger("TokenService");
		const seedService = new SeedService(seedGetter);
		const coreTransactionRunner = new RepositoryCoreTransactionRunner(repositories, this.outputDataCreator);
		const mintQueries = new StoredMintQueries(repositories.mintRepository, repositories.keysetRepository);
		const mintService = new MintService(repositories.mintRepository, repositories.keysetRepository, this.mintAdapter, {
			queries: mintQueries,
			transactions: new CoreMintMetadataTransactions(coreTransactionRunner)
		}, mintLogger, this.eventBus);
		const keyRingTransactions = new CoreKeyRingTransactions(coreTransactionRunner);
		const keypairDerivation = new KeypairDerivation(() => seedService.getSeed());
		const p2pkSigner = new KeypairP2pkSigner(repositories.keyRingRepository);
		const keyRingService = new KeyRingService(repositories.keyRingRepository, keyRingTransactions, keypairDerivation, p2pkSigner, keyRingLogger);
		const walletService = new WalletService(mintService, seedService, this.mintRequestProvider, walletLogger, (mintUrl) => this.mintAdapter.getAuthProvider(mintUrl), this.outputDataCreator);
		const counterService = new CounterService(repositories.counterRepository, counterLogger, this.eventBus);
		const proofService = new ProofService(counterService, repositories.proofRepository, walletService, mintService, p2pkSigner, seedService, proofLogger, this.eventBus, this.outputDataCreator);
		const walletRestoreService = new WalletRestoreService(proofService, counterService, walletService, this.mintRequestProvider, walletRestoreLogger, this.outputDataCreator);
		const mintScopedLock = new MintScopedLock();
		const sendOperationLogger = this.getChildLogger("SendOperationService");
		const sendHandlerProvider = new SendHandlerProvider({
			default: new DefaultSendHandler(),
			p2pk: new P2pkSendHandler(p2pkSigner)
		});
		const sendTransactions = new CoreSendTransactions(coreTransactionRunner);
		const sendOperationService = new SendOperationService({
			operationQueries: repositories.sendOperationRepository,
			proofQueries: repositories.proofRepository,
			transactions: sendTransactions,
			mintQueries: repositories.mintRepository,
			mintMetadataQueries: mintQueries,
			mintMetadataRefresh: mintService,
			remote: new CashuSendRemote(this.mintAdapter, this.mintRequestProvider, this.outputDataCreator),
			loadSeed: () => seedService.getSeed(),
			eventBus: this.eventBus,
			handlerProvider: sendHandlerProvider,
			outputDataCreator: this.outputDataCreator,
			logger: sendOperationLogger,
			mintScopedLock
		});
		const sendOperationRepository = repositories.sendOperationRepository;
		const tokenService = new TokenService(mintService, tokenLogger);
		const receiveOperationLogger = this.getChildLogger("ReceiveOperationService");
		const receiveOperationService = new ReceiveOperationService(repositories.receiveOperationRepository, repositories.proofRepository, proofService, mintService, walletService, this.mintAdapter, tokenService, this.eventBus, receiveOperationLogger, mintScopedLock);
		const receiveOperationRepository = repositories.receiveOperationRepository;
		const paymentRequestReceiveOperationRepository = repositories.paymentRequestReceiveOperationRepository;
		const paymentRequestReceiveAttemptRepository = repositories.paymentRequestReceiveAttemptRepository;
		const meltOperationLogger = this.getChildLogger("MeltOperationService");
		const quoteLifecycleLogger = this.getChildLogger("QuoteLifecycle");
		const meltHandlerProvider = new MeltHandlerProvider({
			bolt11: new MeltBolt11Handler(),
			bolt12: new MeltBolt12Handler(),
			onchain: new MeltOnchainHandler()
		});
		const mintHandlerProvider = new MintHandlerProvider({
			bolt11: new MintBolt11Handler(keyRingService),
			onchain: new MintOnchainHandler(keyRingService),
			bolt12: new MintBolt12Handler(keyRingService)
		});
		const quoteLifecycle = new QuoteLifecycle({
			mintHandlerProvider,
			meltHandlerProvider,
			mintQuoteRepository: repositories.mintQuoteRepository,
			meltQuoteRepository: repositories.meltQuoteRepository,
			proofRepository: repositories.proofRepository,
			proofService,
			mintService,
			walletService,
			mintAdapter: this.mintAdapter,
			eventBus: this.eventBus,
			logger: quoteLifecycleLogger,
			withMintQuoteTransaction: (fn) => repositories.withTransaction(({ mintQuoteRepository }) => fn(mintQuoteRepository))
		});
		const meltOperationService = new MeltOperationService(meltHandlerProvider, repositories.meltOperationRepository, quoteLifecycle, repositories.proofRepository, proofService, mintService, walletService, this.mintAdapter, this.eventBus, meltOperationLogger, mintScopedLock);
		const meltOperationRepository = repositories.meltOperationRepository;
		const mintOperationLogger = this.getChildLogger("MintOperationService");
		const mintOperationService = new MintOperationService(mintHandlerProvider, repositories.mintOperationRepository, quoteLifecycle, repositories.proofRepository, proofService, mintService, walletService, this.mintAdapter, this.eventBus, mintOperationLogger, mintScopedLock);
		const mintOperationRepository = repositories.mintOperationRepository;
		const historyService = new HistoryService(repositories.historyRepository, this.eventBus, historyLogger);
		const legacyMintQuoteRepository = repositories.legacyMintQuoteRepository;
		const paymentRequestService = new PaymentRequestService(sendOperationService, proofService, mintService, this.getChildLogger("PaymentRequestService"));
		const paymentRequestReceiveLogger = this.getChildLogger("PaymentRequestReceiveService");
		const paymentRequestReceiveService = new PaymentRequestReceiveService(paymentRequestReceiveOperationRepository, paymentRequestReceiveAttemptRepository, receiveOperationService, receiveOperationRepository, mintService, new PaymentRequestReceiveTransportHandlerProvider(), paymentRequestReceiveLogger);
		const authSessionLogger = this.getChildLogger("AuthSessionService");
		const authSessionService = new AuthSessionService(repositories.authSessionRepository, this.eventBus, authSessionLogger);
		const authServiceLogger = this.getChildLogger("AuthService");
		return {
			mintService,
			seedService,
			walletService,
			counterService,
			proofService,
			tokenService,
			walletRestoreService,
			keyRingService,
			legacyMintQuoteRepository,
			quoteLifecycle,
			historyService,
			paymentRequestService,
			sendOperationService,
			sendOperationRepository,
			receiveOperationService,
			receiveOperationRepository,
			paymentRequestReceiveService,
			paymentRequestReceiveOperationRepository,
			paymentRequestReceiveAttemptRepository,
			meltOperationService,
			meltOperationRepository,
			authSessionService,
			authService: new AuthService(authSessionService, this.mintAdapter, authServiceLogger),
			mintOperationService,
			mintOperationRepository
		};
	}
	buildApis() {
		const walletApiLogger = this.getChildLogger("WalletApi");
		return {
			mint: new MintApi(this.mintService),
			wallet: new WalletApi(this.mintService, this.walletService, this.proofService, this.walletRestoreService, this.receiveOperationService, this.tokenService, walletApiLogger),
			keyring: new KeyRingApi(this.keyRingService),
			history: new HistoryApi(this.historyService),
			ops: new OpsApi(new SendOpsApi(this.sendOperationService), new ReceiveOpsApi(this.receiveOperationService), new MintOpsApi(this.mintOperationService), new MeltOpsApi(this.meltOperationService)),
			quotes: new QuoteApi(this.quoteLifecycle),
			auth: new AuthApi(this.authService),
			paymentRequests: new PaymentRequestsApi(this.paymentRequestService, this.paymentRequestReceiveService)
		};
	}
};

//#endregion
export { Amount, AuthApi, AuthSessionError, AuthSessionExpiredError, CocoInitializationError, ConsoleLogger, DEFAULT_UNIT, DerivationIndexExhaustedError, HistoryApi, HttpResponseError, KeyRingApi, KeysetSyncError, Manager, MeltOpsApi, MeltQuoteApi, MemoryRepositories, MintApi, MintFetchError, MintOperationError, MintOpsApi, MintQuoteApi, MintQuoteKeyError, MintQuoteValidationError, NetworkError, OperationInProgressError, OpsApi, PaymentRequestError, PaymentRequestsApi, ProofOperationError, ProofValidationError, QuoteApi, QuoteIdentityConflictError, ReceiveOpsApi, SendOperationConflictError, SendOpsApi, TokenValidationError, UnitMismatchError, UnitValidationError, UnknownMintError, WalletApi, WalletBalancesApi, applyBolt11MintQuoteStateFallback, assertSameUnit, assertUnitAmount, compareHistoryEntries, deriveBolt11MintQuoteState, getDecodedToken, getEncodedToken, getMintQuoteAmount, getMintQuoteAvailableAmount, getMintQuoteRemoteState, getTokenMetadata, initializeCoco, isLegacyHistoryEntry, isMintQuotePending, isOperationHistoryEntry, isStatefulMintQuote, isUnitAmountLikeObject, legacyHistoryId, meltQuoteFromBolt11Response, meltQuoteFromBolt12Response, meltQuoteFromOnchainResponse, meltQuoteToMethodSnapshot, mintQuoteFromBolt11Response, mintQuoteFromBolt12Response, mintQuoteFromOnchainResponse, mintQuoteToMethodSnapshot, normalizeMintUrl, normalizeUnit, normalizeUnitAmount, normalizeUnitList, operationHistoryId, parseHistoryEntryId, parseMintSwapOperation, parseUnitAmount, projectLegacyHistoryRow, projectMeltOperation, projectMintOperation, projectOperationToHistoryEntry, projectReceiveOperation, projectSendOperation, resolveOnchainMeltFeeOption, sameUnitAmount, sumAmounts, toAmount };