import Dexie, { Transaction } from "dexie";
import { AuthSession, AuthSessionRepository, CoreProof, Counter, CounterRepository, HistoryEntry, HistoryRepository, KeyRingRepository, Keypair, KeypairPurpose, Keyset, KeysetRepository, LegacyMintQuoteRepository, MeltOperationRepository, MeltQuote, MeltQuoteRepository, Mint, MintMethodRemoteState, MintOperationRepository, MintQuote, MintQuoteRepository, MintRepository, PaymentRequestReceiveAttempt, PaymentRequestReceiveAttemptRepository, PaymentRequestReceiveAttemptState, PaymentRequestReceiveOperation, PaymentRequestReceiveOperationRepository, PaymentRequestReceiveState, ProofRepository, ProofState, ProofUnitFilter, QuoteIdentity, ReceiveOperation, ReceiveOperationRepository, ReceiveOperationState, Repositories, RepositoryTransactionScope, SendOperation, SendOperationRepository, SendOperationState } from "@cashu/coco-core/adapter";

//#region src/lib/db.d.ts
interface IdbDbOptions {
  name?: string;
}
/**
 * Wrapper around Dexie providing transaction management for IndexedDB.
 *
 * Transaction behavior:
 * - Nested transactions within the same Dexie transaction context are reused
 * - Concurrent transactions are queued and executed serially
 * - Dexie handles automatic commit/rollback based on promise resolution/rejection
 */
declare class IdbDb extends Dexie {
  /** Promise chain used to serialize concurrent transactions */
  private transactionQueue;
  /** Currently active Dexie transaction (null if no transaction) */
  private activeTransaction;
  constructor(options?: IdbDbOptions);
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
  runTransaction<T>(mode: 'r' | 'rw', stores: string[], fn: (txDb: Transaction) => Promise<T>): Promise<T>;
  get currentTransaction(): Transaction | null;
  /** Whether this call context already belongs to this logical IndexedDB database. */
  get hasAmbientTransaction(): boolean;
}
//#endregion
//#region src/lib/schema.d.ts
declare function ensureSchema(db: IdbDb): Promise<void>;
//#endregion
//#region src/repositories/MintRepository.d.ts
declare class IdbMintRepository implements MintRepository {
  private readonly db;
  constructor(db: IdbDb);
  isTrustedMint(mintUrl: string): Promise<boolean>;
  getMintByUrl(mintUrl: string): Promise<Mint>;
  getAllMints(): Promise<Mint[]>;
  getAllTrustedMints(): Promise<Mint[]>;
  addNewMint(mint: Mint): Promise<void>;
  addOrUpdateMint(mint: Mint): Promise<void>;
  updateMint(mint: Mint): Promise<void>;
  setMintTrusted(mintUrl: string, trusted: boolean): Promise<void>;
  deleteMint(mintUrl: string): Promise<void>;
}
//#endregion
//#region src/repositories/KeysetRepository.d.ts
declare class IdbKeysetRepository implements KeysetRepository {
  private readonly db;
  constructor(db: IdbDb);
  getKeysetsByMintUrl(mintUrl: string): Promise<Keyset[]>;
  getKeysetById(mintUrl: string, id: string): Promise<Keyset | null>;
  updateKeyset(keyset: Omit<Keyset, 'keypairs' | 'updatedAt'>): Promise<void>;
  addKeyset(keyset: Omit<Keyset, 'updatedAt'>): Promise<void>;
  deleteKeyset(mintUrl: string, keysetId: string): Promise<void>;
}
//#endregion
//#region src/repositories/KeyRingRepository.d.ts
declare class IdbKeyRingRepository implements KeyRingRepository {
  private readonly db;
  constructor(db: IdbDb);
  getPersistedKeyPair(publicKey: string, purpose?: KeypairPurpose): Promise<Keypair | null>;
  setPersistedKeyPair(keyPair: Keypair): Promise<void>;
  deletePersistedKeyPair(publicKey: string, purpose?: KeypairPurpose): Promise<void>;
  getAllPersistedKeyPairs(purpose?: KeypairPurpose): Promise<Keypair[]>;
  getLatestKeyPair(purpose?: KeypairPurpose): Promise<Keypair | null>;
  getLastAllocatedIndex(purpose: KeypairPurpose): Promise<number | null>;
  getHighestStoredDerivationIndex(purpose: KeypairPurpose): Promise<number | null>;
  setLastAllocatedIndex(purpose: KeypairPurpose, derivationIndex: number): Promise<void>;
}
//#endregion
//#region src/repositories/CounterRepository.d.ts
declare class IdbCounterRepository implements CounterRepository {
  private readonly db;
  constructor(db: IdbDb);
  getCounter(mintUrl: string, keysetId: string): Promise<Counter | null>;
  setCounter(mintUrl: string, keysetId: string, counter: number): Promise<void>;
}
//#endregion
//#region src/repositories/ProofRepository.d.ts
declare class IdbProofRepository implements ProofRepository {
  private readonly db;
  constructor(db: IdbDb);
  saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void>;
  getReadyProofs(mintUrl: string, filter?: ProofUnitFilter): Promise<CoreProof[]>;
  getInflightProofs(mintUrls?: string[], filter?: ProofUnitFilter): Promise<CoreProof[]>;
  getAllReadyProofs(filter?: ProofUnitFilter): Promise<CoreProof[]>;
  getProofsByKeysetId(mintUrl: string, keysetId: string, filter?: ProofUnitFilter): Promise<CoreProof[]>;
  setProofState(mintUrl: string, secrets: string[], state: ProofState): Promise<void>;
  deleteProofs(mintUrl: string, secrets: string[]): Promise<void>;
  wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void>;
  reserveProofs(mintUrl: string, secrets: string[], operationId: string): Promise<void>;
  releaseProofs(mintUrl: string, secrets: string[]): Promise<void>;
  setCreatedByOperation(mintUrl: string, secrets: string[], operationId: string): Promise<void>;
  getProofBySecret(mintUrl: string, secret: string): Promise<CoreProof | null>;
  getProofsBySecrets(mintUrl: string, secrets: string[]): Promise<CoreProof[]>;
  getProofsByOperationId(mintUrl: string, operationId: string): Promise<CoreProof[]>;
  getAvailableProofs(mintUrl: string, filter?: ProofUnitFilter): Promise<CoreProof[]>;
  getReservedProofs(): Promise<CoreProof[]>;
}
//#endregion
//#region src/repositories/MeltQuoteRepository.d.ts
declare class IdbMeltQuoteRepository implements MeltQuoteRepository {
  private readonly db;
  constructor(db: IdbDb);
  getMeltQuoteById(identity: QuoteIdentity): Promise<MeltQuote | null>;
  getMeltQuote(mintUrl: string, method: string, quoteId: string): Promise<MeltQuote | null>;
  upsertMeltQuote(quote: MeltQuote): Promise<MeltQuote>;
  getPendingMeltQuotes(method?: string): Promise<MeltQuote[]>;
}
//#endregion
//#region src/repositories/MintQuoteRepository.d.ts
declare class IdbMintQuoteRepository implements MintQuoteRepository {
  private readonly db;
  constructor(db: IdbDb);
  getMintQuoteById(identity: QuoteIdentity): Promise<MintQuote | null>;
  getMintQuote(mintUrl: string, method: string, quoteId: string): Promise<MintQuote | null>;
  upsertMintQuote(quote: MintQuote): Promise<void>;
  setMintQuoteState(mintUrl: string, method: string, quoteId: string, state: MintMethodRemoteState, observedAt?: number): Promise<void>;
  getPendingMintQuotes(method?: string): Promise<MintQuote[]>;
}
//#endregion
//#region src/repositories/LegacyMintQuoteRepository.d.ts
declare class IdbLegacyMintQuoteRepository implements LegacyMintQuoteRepository {
  private readonly db;
  constructor(db: IdbDb);
  getPendingLegacyMintQuotes(mintUrl?: string): Promise<MintQuote[]>;
}
//#endregion
//#region src/repositories/HistoryRepository.d.ts
declare class IdbHistoryRepository implements HistoryRepository {
  private readonly db;
  constructor(db: IdbDb);
  getPaginatedHistoryEntries(limit: number, offset: number): Promise<HistoryEntry[]>;
  getHistoryEntryById(id: string): Promise<HistoryEntry | null>;
  private readRecentOperationRows;
  private readRecentRows;
  private readMintRemoteStateByOperationId;
  private getMintQuoteRowForOperation;
  private readVisibleLegacyRows;
  private sendRowToEntry;
  private meltRowToEntry;
  private mintRowToEntry;
  private receiveRowToEntry;
  private legacyRowToEntry;
  private legacyRowToInput;
  private legacyIsDeduped;
  private getOperationRow;
  private operationIsHistoryEligible;
  private hasOperationForQuote;
}
//#endregion
//#region src/repositories/SendOperationRepository.d.ts
declare class IdbSendOperationRepository implements SendOperationRepository {
  private readonly db;
  private readonly storeName;
  constructor(db: IdbDb);
  create(operation: SendOperation): Promise<void>;
  update(operation: SendOperation): Promise<void>;
  transition(input: {
    operationId: string;
    expectedState: SendOperationState;
    expectedRevision: number;
    next: SendOperation;
  }): Promise<boolean>;
  getById(id: string): Promise<SendOperation | null>;
  getByState(state: SendOperationState): Promise<SendOperation[]>;
  getPending(): Promise<SendOperation[]>;
  getByMintUrl(mintUrl: string): Promise<SendOperation[]>;
  delete(id: string): Promise<void>;
}
//#endregion
//#region src/repositories/MeltOperationRepository.d.ts
type MeltOperation = NonNullable<Awaited<ReturnType<MeltOperationRepository['getById']>>>;
type MeltOperationState = Parameters<MeltOperationRepository['getByState']>[0];
declare class IdbMeltOperationRepository implements MeltOperationRepository {
  private readonly db;
  constructor(db: IdbDb);
  create(operation: MeltOperation): Promise<void>;
  update(operation: MeltOperation): Promise<void>;
  getById(id: string): Promise<MeltOperation | null>;
  getByState(state: MeltOperationState): Promise<MeltOperation[]>;
  getPending(): Promise<MeltOperation[]>;
  getByMintUrl(mintUrl: string): Promise<MeltOperation[]>;
  getByQuoteId(mintUrl: string, quoteId: string): Promise<MeltOperation[]>;
  delete(id: string): Promise<void>;
}
//#endregion
//#region src/repositories/AuthSessionRepository.d.ts
declare class IdbAuthSessionRepository implements AuthSessionRepository {
  private readonly db;
  constructor(db: IdbDb);
  getSession(mintUrl: string): Promise<AuthSession | null>;
  saveSession(session: AuthSession): Promise<void>;
  deleteSession(mintUrl: string): Promise<void>;
  getAllSessions(): Promise<AuthSession[]>;
}
//#endregion
//#region src/repositories/MintOperationRepository.d.ts
type MintOperation = NonNullable<Awaited<ReturnType<MintOperationRepository['getById']>>>;
type MintOperationState = Parameters<MintOperationRepository['getByState']>[0];
declare class IdbMintOperationRepository implements MintOperationRepository {
  private readonly db;
  constructor(db: IdbDb);
  create(operation: MintOperation): Promise<void>;
  update(operation: MintOperation): Promise<void>;
  getById(id: string): Promise<MintOperation | null>;
  getByState(state: MintOperationState): Promise<MintOperation[]>;
  getPending(): Promise<MintOperation[]>;
  getByMintUrl(mintUrl: string): Promise<MintOperation[]>;
  getByQuoteId(mintUrl: string, method: string, quoteId: string): Promise<MintOperation[]>;
  delete(id: string): Promise<void>;
}
//#endregion
//#region src/repositories/ReceiveOperationRepository.d.ts
declare class IdbReceiveOperationRepository implements ReceiveOperationRepository {
  private readonly db;
  constructor(db: IdbDb);
  create(operation: ReceiveOperation): Promise<void>;
  update(operation: ReceiveOperation): Promise<void>;
  getById(id: string): Promise<ReceiveOperation | null>;
  getByState(state: ReceiveOperationState): Promise<ReceiveOperation[]>;
  getPending(): Promise<ReceiveOperation[]>;
  getByMintUrl(mintUrl: string): Promise<ReceiveOperation[]>;
  getByPaymentRequestAttemptId(attemptId: string): Promise<ReceiveOperation | null>;
  delete(id: string): Promise<void>;
}
//#endregion
//#region src/repositories/PaymentRequestReceiveRepository.d.ts
declare class IdbPaymentRequestReceiveOperationRepository implements PaymentRequestReceiveOperationRepository {
  private readonly db;
  constructor(db: IdbDb);
  create(operation: PaymentRequestReceiveOperation): Promise<void>;
  update(operation: PaymentRequestReceiveOperation): Promise<void>;
  getById(id: string): Promise<PaymentRequestReceiveOperation | null>;
  getByState(state: PaymentRequestReceiveState): Promise<PaymentRequestReceiveOperation[]>;
  getActiveByRequestId(requestId: string): Promise<PaymentRequestReceiveOperation[]>;
  list(filter?: {
    state?: PaymentRequestReceiveState;
  }): Promise<PaymentRequestReceiveOperation[]>;
}
declare class IdbPaymentRequestReceiveAttemptRepository implements PaymentRequestReceiveAttemptRepository {
  private readonly db;
  constructor(db: IdbDb);
  create(attempt: PaymentRequestReceiveAttempt): Promise<void>;
  update(attempt: PaymentRequestReceiveAttempt): Promise<void>;
  getById(id: string): Promise<PaymentRequestReceiveAttempt | null>;
  getByRequestOperationId(requestOperationId: string): Promise<PaymentRequestReceiveAttempt[]>;
  getByReceiveOperationId(receiveOperationId: string): Promise<PaymentRequestReceiveAttempt | null>;
  getByTransportMessageId(transportMessageId: string): Promise<PaymentRequestReceiveAttempt | null>;
  getByPayloadHash(requestOperationId: string, payloadHash: string): Promise<PaymentRequestReceiveAttempt | null>;
  getByRequestIdAndPayloadHash(requestId: string, payloadHash: string): Promise<PaymentRequestReceiveAttempt | null>;
  getByState(state: PaymentRequestReceiveAttemptState): Promise<PaymentRequestReceiveAttempt[]>;
  delete(id: string): Promise<void>;
}
//#endregion
//#region src/index.d.ts
interface IndexedDbRepositoriesOptions extends IdbDbOptions {}
declare class IndexedDbRepositories implements Repositories {
  readonly mintRepository: MintRepository;
  readonly keyRingRepository: KeyRingRepository;
  readonly counterRepository: CounterRepository;
  readonly keysetRepository: KeysetRepository;
  readonly proofRepository: ProofRepository;
  readonly meltQuoteRepository: MeltQuoteRepository;
  readonly mintQuoteRepository: MintQuoteRepository;
  readonly legacyMintQuoteRepository: LegacyMintQuoteRepository;
  readonly historyRepository: IdbHistoryRepository;
  readonly sendOperationRepository: SendOperationRepository;
  readonly meltOperationRepository: MeltOperationRepository;
  readonly authSessionRepository: AuthSessionRepository;
  readonly mintOperationRepository: MintOperationRepository;
  readonly receiveOperationRepository: ReceiveOperationRepository;
  readonly paymentRequestReceiveOperationRepository: PaymentRequestReceiveOperationRepository;
  readonly paymentRequestReceiveAttemptRepository: PaymentRequestReceiveAttemptRepository;
  readonly db: IdbDb;
  private initialized;
  constructor(options: IndexedDbRepositoriesOptions);
  init(): Promise<void>;
  withTransaction<T>(fn: (repos: RepositoryTransactionScope) => Promise<T>): Promise<T>;
}
//#endregion
export { IdbAuthSessionRepository, IdbCounterRepository, IdbDb, IdbHistoryRepository, IdbKeyRingRepository, IdbKeysetRepository, IdbLegacyMintQuoteRepository, IdbMeltOperationRepository, IdbMeltQuoteRepository, IdbMintOperationRepository, IdbMintQuoteRepository, IdbMintRepository, IdbPaymentRequestReceiveAttemptRepository, IdbPaymentRequestReceiveOperationRepository, IdbProofRepository, IdbReceiveOperationRepository, IdbSendOperationRepository, IndexedDbRepositories, IndexedDbRepositoriesOptions, ensureSchema };