import { Cause, Clock, DateTime, Effect, Exit, LogLevel, Option, Ref } from "effect";
import { dual } from "effect/Function";
import { WideEventRef } from "./wide-event.js";

/**
 * Canonical fields that every wide event includes.
 * These are populated automatically by the boundary — do not set them manually.
 */
export interface WideEventEnvelope {
  readonly timestamp: string;
  readonly service: string;
  readonly durationMs: number;
  readonly status: "ok" | "error";
  readonly traceId?: string;
  readonly spanId?: string;
  readonly spanName?: string;
  readonly method?: string;
  readonly path?: string;
  readonly actor?: string;
  readonly requestId?: string;
  readonly errorType?: string;
  readonly errorMessage?: string;
}

/**
 * Semantic outcome for work that completed at the transport/effect level.
 * `status` remains the boundary transport status; `outcome` describes domain
 * meaning such as a denied tool, failed business operation, or warning.
 */
export type WideEventOutcome = "ok" | "warning" | "domain_error";

export interface WideEventOutcomeDetails {
  readonly outcome: WideEventOutcome;
  readonly type?: string;
  readonly message?: string;
  readonly fields?: Record<string, unknown>;
}

/**
 * Log level for the wide event emission.
 */
export type WideEventLevel = "Fatal" | "Error" | "Warn" | "Info" | "Debug" | "Trace";

/**
 * Custom error extractor. Return the fields to merge into the envelope.
 */
export type ErrorExtractor = (cause: Cause.Cause<unknown>) => {
  errorType: string;
  errorMessage: string;
};

export type OutcomeClassifier<A = unknown, E = unknown> = (
  exit: Exit.Exit<A, E>,
) => WideEventOutcomeDetails | undefined;

/**
 * Transport-level context for a wide event boundary.
 */
interface WideEventContextBase {
  readonly service: string;
  readonly method?: string;
  readonly path?: string;
  readonly actor?: string;
  readonly requestId?: string;
  /** Log level for the emitted event. Default: "Info" */
  readonly level?: WideEventLevel;
  /** Static fields merged into every event (before user fields). */
  readonly envelope?: Record<string, unknown>;
  /** Custom error extractor. Default: tagged → Error → defect → interrupt. */
  readonly extractError?: ErrorExtractor;
  /** Hook called with the final event after emission. Runs inside the uninterruptible block. */
  readonly onEmit?: (event: Record<string, unknown>) => Effect.Effect<void>;
}

export interface WideEventContext<A = unknown, E = unknown> extends WideEventContextBase {
  /** Classify a successful exit into a semantic outcome. */
  readonly classifyExit?: OutcomeClassifier<A, E>;
}

const levelMap: Record<WideEventLevel, LogLevel.LogLevel> = {
  Fatal: LogLevel.Fatal,
  Error: LogLevel.Error,
  Warn: LogLevel.Warning,
  Info: LogLevel.Info,
  Debug: LogLevel.Debug,
  Trace: LogLevel.Trace,
};

const defaultExtractError: ErrorExtractor = (cause) => {
  // Check for interruption first
  if (Cause.isInterruptedOnly(cause)) {
    return { errorType: "Interrupted", errorMessage: "Fiber interrupted" };
  }

  // Check for typed failures
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    const value = failure.value;
    if (typeof value === "object" && value !== null && "_tag" in value) {
      const tagged = value as { _tag: string; message?: string };
      return {
        errorType: tagged._tag,
        errorMessage: tagged.message ?? stringifyUnknown(value),
      };
    }
    if (value instanceof Error) {
      return {
        errorType: value.constructor.name,
        errorMessage: value.message,
      };
    }
    return { errorType: "Unknown", errorMessage: stringifyUnknown(value) };
  }

  // Check for defects
  const defect = Cause.dieOption(cause);
  if (Option.isSome(defect)) {
    const value = defect.value;
    if (value instanceof Error) {
      return {
        errorType: `Defect:${value.constructor.name}`,
        errorMessage: value.message,
      };
    }
    return { errorType: "Defect", errorMessage: stringifyUnknown(value) };
  }

  return { errorType: "Unknown", errorMessage: Cause.pretty(cause) };
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return "Unserializable object";
    }
  }
  return String(value);
};

const buildTransportFields = (context: WideEventContextBase): Record<string, unknown> => {
  const fields: Record<string, unknown> = { service: context.service };
  if (context.method !== undefined) fields["method"] = context.method;
  if (context.path !== undefined) fields["path"] = context.path;
  if (context.actor !== undefined) fields["actor"] = context.actor;
  if (context.requestId !== undefined) fields["requestId"] = context.requestId;
  return fields;
};

const applyOutcome = (
  event: Record<string, unknown>,
  outcome: WideEventOutcomeDetails | undefined,
  defaultOk: boolean,
): void => {
  if (outcome === undefined) {
    if (defaultOk && event["outcome"] === undefined) {
      event["outcome"] = "ok";
    }
    return;
  }

  event["outcome"] = outcome.outcome;
  if (outcome.type !== undefined) event["outcomeType"] = outcome.type;
  if (outcome.message !== undefined) event["outcomeMessage"] = outcome.message;
  if (outcome.fields !== undefined) {
    Object.assign(event, outcome.fields);
  }
};

interface BoundaryOptions<A = unknown, E = unknown> {
  readonly requestId?: string;
  readonly level?: WideEventLevel;
  readonly envelope?: Record<string, unknown>;
  readonly extractError?: ErrorExtractor;
  readonly classifyExit?: OutcomeClassifier<A, E>;
  readonly onEmit?: (event: Record<string, unknown>) => Effect.Effect<void>;
}

export const WideEventBoundary = {
  rpc: <A = unknown, E = unknown>(
    method: string,
    options: BoundaryOptions<A, E> = {},
  ): WideEventContext<A, E> => ({
    service: "rpc",
    method,
    ...options,
  }),

  actor: <A = unknown, E = unknown>(
    actor: string,
    method: string,
    options: BoundaryOptions<A, E> = {},
  ): WideEventContext<A, E> => ({
    service: "actor",
    actor,
    method,
    ...options,
  }),

  tool: <A = unknown, E = unknown>(
    method: string,
    options: BoundaryOptions<A, E> = {},
  ): WideEventContext<A, E> => ({
    service: "tool",
    method,
    ...options,
  }),

  provider: <A = unknown, E = unknown>(
    method: string,
    options: BoundaryOptions<A, E> = {},
  ): WideEventContext<A, E> => ({
    service: "provider",
    method,
    ...options,
  }),
} as const;

/**
 * Wraps an effect in a wide event boundary. Accumulates all fields set via
 * `WideEvent.set()` during execution, then emits exactly one structured
 * log event containing envelope fields + user fields.
 *
 * Each boundary gets its own isolated accumulator — concurrent and nested
 * boundaries cannot corrupt each other.
 *
 * @example
 * ```ts
 * const handler = pipe(
 *   Effect.gen(function* () {
 *     yield* WideEvent.set({ userId: "123" })
 *     return yield* processRequest()
 *   }),
 *   withWideEvent({ service: "checkout", method: "POST", path: "/api/checkout" }),
 * )
 * ```
 */
export const withWideEvent: {
  (
    context: WideEventContext,
  ): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, WideEventRef>>;
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    context: WideEventContext<A, E>,
  ): Effect.Effect<A, E, Exclude<R, WideEventRef>>;
} = dual(
  2,
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    context: WideEventContext<A, E>,
  ): Effect.Effect<A, E, Exclude<R, WideEventRef>> =>
    // The boundary is uninterruptible so emission always completes.
    // The user effect runs in an interruptible region inside.
    Effect.uninterruptible(
      Effect.gen(function* () {
        // Each boundary gets a fresh, isolated Ref pre-loaded with transport fields
        const initialFields = {
          ...context.envelope,
          ...buildTransportFields(context),
        };
        const ref = Ref.unsafeMake<Record<string, unknown>>(initialFields);

        const spanName =
          context.method !== undefined && context.path !== undefined
            ? `${context.method} ${context.path}`
            : context.service;

        const span = yield* Effect.makeSpan(spanName);
        const startTime = yield* Clock.currentTimeMillis;
        const timestamp = DateTime.formatIso(yield* DateTime.now);

        // Run the user effect interruptibly with an isolated accumulator, capturing the exit
        const exit = yield* effect.pipe(
          Effect.provideService(WideEventRef, ref),
          Effect.withParentSpan(span),
          Effect.interruptible,
          Effect.exit,
        );

        const endTime = yield* Clock.currentTimeMillis;
        const durationMs = endTime - startTime;

        // End the span
        span.end(BigInt(endTime) * 1_000_000n, exit);

        // Read accumulated user fields
        const userFields = yield* Ref.get(ref);

        // Build the final event — envelope always includes transport context
        const envelope: Record<string, unknown> = {
          ...buildTransportFields(context),
          timestamp,
          durationMs,
          status: Exit.isSuccess(exit) ? "ok" : "error",
          traceId: span.traceId,
          spanId: span.spanId,
          spanName,
        };

        if (Exit.isFailure(exit)) {
          const extract = context.extractError ?? defaultExtractError;
          const errorInfo = extract(exit.cause);
          envelope["errorType"] = errorInfo.errorType;
          envelope["errorMessage"] = errorInfo.errorMessage;
        }

        // Merge: envelope fields take precedence over user fields for reserved keys
        const finalEvent = { ...userFields, ...envelope };
        applyOutcome(
          finalEvent,
          Exit.isSuccess(exit) ? context.classifyExit?.(exit) : undefined,
          Exit.isSuccess(exit),
        );

        // Emit at the configured log level
        const level = levelMap[context.level ?? "Info"];
        yield* Effect.logWithLevel(level, "wide-event").pipe(Effect.annotateLogs(finalEvent));

        // Run onEmit hook if provided
        if (context.onEmit !== undefined) {
          yield* context.onEmit(finalEvent);
        }

        // Re-surface the original exit
        return yield* exit;
      }),
    ).pipe(Effect.withSpan("withWideEvent")) as Effect.Effect<A, E, Exclude<R, WideEventRef>>,
);
