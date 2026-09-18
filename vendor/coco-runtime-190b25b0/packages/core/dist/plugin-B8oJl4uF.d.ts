import { An as QuoteIdentity, Ct as MeltOperationService, Dn as SubscriptionManager, Dt as PaymentRequestReceiveService, Ei as Logger, En as QuoteLifecycle, Er as SeedService, Ft as ReceiveOperationService, It as TokenService, Kr as UnitAmountLike, Mn as MeltQuote, On as MeltQuoteRef, St as CoreEvents, Tn as MintOperationService, Tr as WalletService, Un as MintService, Xn as MintMethodQuoteImportSnapshot, Yt as PaymentRequestService, bt as ProofService, gt as MeltMethodInputData, ii as EventBus, it as FinalizedMeltOperation, lt as PendingMeltOperation, mt as MeltMethod, nn as HistoryService, nr as MintQuote, st as MeltOperation, tn as SendOperationService, ut as PreparedMeltOperation, wn as KeyRingService, wt as WalletRestoreService, xt as CounterService } from "./index-CbuugzL4.js";

//#region api/MeltOpsApi.d.ts
/** Melt methods supported by the default `Manager` wiring. */
type DefaultSupportedMeltMethod = 'bolt11' | 'bolt12' | 'onchain';
type PrepareMeltInput<TSupported extends MeltMethod = DefaultSupportedMeltMethod> = { [M in TSupported]: {
  /** Existing canonical melt quote or structural quote reference. */quote: MeltQuoteRef<M>;
} & (M extends 'onchain' ? {
  feeIndex: number;
} : {
  feeIndex?: number;
}) }[TSupported];
interface MeltRecoveryApi {
  /** Runs the startup-style recovery sweep for melt operations. */
  run(): Promise<void>;
  /** Returns true while a recovery sweep is running. */
  inProgress(): boolean;
}
interface MeltDiagnosticsApi {
  /** Returns true while an operation is currently locked by the service. */
  isLocked(operationId: string): boolean;
}
/**
 * Operation-oriented API for melt workflows.
 *
 * This API makes the melt lifecycle explicit so callers can prepare a payment,
 * execute it, inspect or refresh its state, and recover or roll it back when
 * allowed by the underlying method.
 */
declare class MeltOpsApi<TSupported extends MeltMethod = DefaultSupportedMeltMethod> {
  private readonly meltOperationService;
  /** Recovery helpers for melt operations. */
  readonly recovery: MeltRecoveryApi;
  /** Lightweight diagnostics for melt operations. */
  readonly diagnostics: MeltDiagnosticsApi;
  constructor(meltOperationService: MeltOperationService);
  /**
   * Prepares a melt operation against an existing canonical quote without executing it.
   *
   * Use this to inspect the generated operation and any quote-related data
   * before committing to the external payment.
   */
  prepare(input: PrepareMeltInput<TSupported>): Promise<PreparedMeltOperation>;
  /**
   * Executes a prepared melt operation.
   *
   * Accepts either a prepared operation object or its ID. The latest operation
   * state is always reloaded before execution.
   */
  execute(operationOrId: MeltOperation | string): Promise<PendingMeltOperation | FinalizedMeltOperation>;
  /** Returns a melt operation by ID, or `null` when it does not exist. */
  get(operationId: string): Promise<MeltOperation | null>;
  /** Returns the tracked melt operation for a canonical quote identity, or `null`. */
  getByQuote(input: QuoteIdentity): Promise<MeltOperation | null>;
  /** Lists melt operations for a mint URL and quote ID. */
  listByQuote(input: QuoteIdentity): Promise<MeltOperation[]>;
  /** Lists melt operations that are prepared and ready to execute or cancel. */
  listPrepared(): Promise<PreparedMeltOperation[]>;
  /** Lists melt operations that are currently in flight. */
  listInFlight(): Promise<MeltOperation[]>;
  /**
   * Re-checks a melt operation and returns its latest persisted state.
   *
   * Pending operations are actively checked with the service before the updated
   * operation is returned. Executing operations are recovered before returning
   * the updated state.
   */
  refresh(operationId: string): Promise<MeltOperation>;
  /**
   * Cancels a prepared melt operation before payment has entered the pending
   * phase.
   */
  cancel(operationId: string, reason?: string): Promise<void>;
  /**
   * Attempts to reclaim a pending melt operation.
   *
   * This is intended for in-flight melts whose handler determines that rollback
   * is still safe.
   */
  reclaim(operationId: string, reason?: string): Promise<void>;
  /**
   * Finalizes a pending melt operation explicitly.
   *
   * Most callers should prefer `refresh()` unless they already know the melt is
   * ready to finalize.
   */
  finalize(operationId: string): Promise<void>;
  private resolveOperation;
  private requireOperation;
}
//#endregion
//#region api/QuoteApi.d.ts
type DefaultSupportedMintQuoteMethod = 'bolt11' | 'onchain' | 'bolt12';
type CreateMintQuoteInput = {
  mintUrl: string;
  method: 'bolt11';
  amount: UnitAmountLike;
  unit?: string; /** Create a NUT-20 quote locked to a fresh, persisted wallet key. */
  locked?: boolean;
} | {
  mintUrl: string;
  method: 'onchain';
  unit?: string;
} | {
  mintUrl: string;
  method: 'bolt12';
  unit?: string;
  amount?: UnitAmountLike;
  description?: string;
};
type ImportMintQuoteInput = {
  /** Mint that issued the existing quote. */mintUrl: string; /** Existing quote snapshot to persist as canonical quote state. */
  quote: MintMethodQuoteImportSnapshot<'bolt11'>; /** Mint method for the quote snapshot. */
  method: 'bolt11';
};
type ListPendingMintQuotesInput = {
  method?: DefaultSupportedMintQuoteMethod;
};
type CreateMeltQuoteInput<TSupported extends DefaultSupportedMeltMethod = DefaultSupportedMeltMethod> = { [M in TSupported]: {
  mintUrl: string;
  method: M;
  methodData: MeltMethodInputData<M>;
  unit?: string;
} }[TSupported];
type ListPendingMeltQuotesInput = {
  method?: DefaultSupportedMeltMethod;
};
declare class MintQuoteApi {
  private readonly quoteLifecycle;
  constructor(quoteLifecycle: QuoteLifecycle);
  create(input: CreateMintQuoteInput): Promise<MintQuote>;
  get(input: QuoteIdentity): Promise<MintQuote | null>;
  import(input: ImportMintQuoteInput): Promise<MintQuote>;
  listPending(input?: ListPendingMintQuotesInput): Promise<MintQuote[]>;
  refresh(input: QuoteIdentity): Promise<MintQuote>;
}
declare class MeltQuoteApi {
  private readonly quoteLifecycle;
  constructor(quoteLifecycle: QuoteLifecycle);
  create<M extends DefaultSupportedMeltMethod>(input: CreateMeltQuoteInput<M>): Promise<MeltQuote<M>>;
  get(input: QuoteIdentity): Promise<MeltQuote | null>;
  listPending(input?: ListPendingMeltQuotesInput): Promise<MeltQuote[]>;
  refresh(input: QuoteIdentity): Promise<MeltQuote>;
}
/**
 * API for durable canonical quote state.
 *
 * Quote rows are not value movements and are separate from operation history.
 */
declare class QuoteApi {
  readonly mint: MintQuoteApi;
  readonly melt: MeltQuoteApi;
  constructor(quoteLifecycle: QuoteLifecycle);
}
//#endregion
//#region plugins/types.d.ts
type ServiceKey = keyof ServiceMap;
/**
 * Stable service surface available to plugin authors through PluginContext.services.
 *
 * Plugins opt into individual services by listing their keys in Plugin.required. Removing,
 * renaming, or narrowing a key in this map is a public plugin API change.
 */
interface ServiceMap {
  mintService: MintService;
  walletService: WalletService;
  proofService: ProofService;
  keyRingService: KeyRingService;
  seedService: SeedService;
  walletRestoreService: WalletRestoreService;
  counterService: CounterService;
  tokenService: TokenService;
  historyService: HistoryService;
  sendOperationService: SendOperationService;
  receiveOperationService: ReceiveOperationService;
  meltOperationService: MeltOperationService;
  mintOperationService: MintOperationService;
  quotes: QuoteApi;
  paymentRequestService: PaymentRequestService;
  paymentRequestReceiveService: PaymentRequestReceiveService;
  subscriptions: SubscriptionManager;
  eventBus: EventBus<CoreEvents>;
  logger: Logger;
}
interface PluginContext<Req extends readonly ServiceKey[] = readonly ServiceKey[]> {
  services: Pick<ServiceMap, Req[number]>;
  /**
   * Register an API extension accessible via manager.ext.<key>
   * @param key - Unique identifier for this extension
   * @param api - The API object to expose
   * @throws ExtensionRegistrationError if key is already registered
   */
  registerExtension<K extends string>(key: K, api: unknown): void;
}
type CleanupFn = () => void | Promise<void>;
type Cleanup = void | CleanupFn | Promise<void | CleanupFn>;
interface Plugin<Req extends readonly ServiceKey[] = readonly ServiceKey[]> {
  name: string;
  required: Req;
  optional?: readonly ServiceKey[];
  onInit?(ctx: PluginContext<Req>): Cleanup;
  onReady?(ctx: PluginContext<Req>): Cleanup;
  onDispose?(): void | Promise<void>;
}
/**
 * Base interface for plugin extensions.
 * Plugin authors should augment this interface via module augmentation:
 *
 * @example
 * declare module '@cashu/coco-core/plugin' {
 *   interface PluginExtensions {
 *     myPlugin: MyPluginApi;
 *   }
 * }
 */
interface PluginExtensions {}
/**
 * Error thrown when a plugin attempts to register an extension key that is already registered.
 */
declare class ExtensionRegistrationError extends Error {
  constructor(pluginName: string, key: string);
}
/**
 * Error thrown when the same plugin instance is registered more than once.
 */
declare class DuplicatePluginRegistrationError extends Error {
  constructor(pluginName: string);
}
//#endregion
//#region plugin.d.ts
type PluginEventBus = ServiceMap['eventBus'];
//#endregion
export { MeltRecoveryApi as C, MeltOpsApi as S, MeltQuoteApi as _, ExtensionRegistrationError as a, DefaultSupportedMeltMethod as b, PluginExtensions as c, CreateMeltQuoteInput as d, CreateMintQuoteInput as f, ListPendingMintQuotesInput as g, ListPendingMeltQuotesInput as h, DuplicatePluginRegistrationError as i, ServiceKey as l, ImportMintQuoteInput as m, Cleanup as n, Plugin as o, DefaultSupportedMintQuoteMethod as p, CleanupFn as r, PluginContext as s, PluginEventBus as t, ServiceMap as u, MintQuoteApi as v, PrepareMeltInput as w, MeltDiagnosticsApi as x, QuoteApi as y };