import { Cause, Clock, DateTime, Effect, Exit, Ref } from "effect";
import type { LogLevel } from "effect";
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
 * Log level for the wide event emission.
 */
export type WideEventLevel = LogLevel.Severity;

/**
 * Custom error extractor. Return the fields to merge into the envelope.
 */
export type ErrorExtractor = (cause: Cause.Cause<unknown>) => {
  errorType: string;
  errorMessage: string;
};

/**
 * Transport-level context for a wide event boundary.
 */
export interface WideEventContext {
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

const defaultExtractError: ErrorExtractor = (cause) => {
  for (const reason of cause.reasons) {
    if (reason._tag === "Fail") {
      const failure = reason.error;
      if (typeof failure === "object" && failure !== null && "_tag" in failure) {
        const tagged = failure as { _tag: string; message?: string };
        return {
          errorType: tagged._tag,
          errorMessage: tagged.message ?? stringifyUnknown(failure),
        };
      }
      if (failure instanceof Error) {
        return {
          errorType: failure.constructor.name,
          errorMessage: failure.message,
        };
      }
      return { errorType: "Unknown", errorMessage: stringifyUnknown(failure) };
    }
    if (reason._tag === "Die") {
      const defect = reason.defect;
      if (defect instanceof Error) {
        return {
          errorType: `Defect:${defect.constructor.name}`,
          errorMessage: defect.message,
        };
      }
      return { errorType: "Defect", errorMessage: stringifyUnknown(defect) };
    }
    if (reason._tag === "Interrupt") {
      return { errorType: "Interrupted", errorMessage: "Fiber interrupted" };
    }
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

const buildTransportFields = (context: WideEventContext): Record<string, unknown> => {
  const fields: Record<string, unknown> = { service: context.service };
  if (context.method !== undefined) fields["method"] = context.method;
  if (context.path !== undefined) fields["path"] = context.path;
  if (context.actor !== undefined) fields["actor"] = context.actor;
  if (context.requestId !== undefined) fields["requestId"] = context.requestId;
  return fields;
};

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
 *
 * // With options
 * pipe(
 *   myEffect,
 *   withWideEvent({
 *     service: "health",
 *     level: "Debug",
 *     envelope: { environment: "prod", region: "us-east-1" },
 *   }),
 * )
 * ```
 */
export const withWideEvent: {
  (
    context: WideEventContext,
  ): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, WideEventRef>>;
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    context: WideEventContext,
  ): Effect.Effect<A, E, Exclude<R, WideEventRef>>;
} = dual(
  2,
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    context: WideEventContext,
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
        const ref = Ref.makeUnsafe<Record<string, unknown>>(initialFields);

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

        // Read accumulated user fields (safe — ref is boundary-local)
        const userFields = Ref.getUnsafe(ref);

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

        // Emit at the configured log level
        const level = context.level ?? "Info";
        yield* Effect.logWithLevel(level)("wide-event").pipe(Effect.annotateLogs(finalEvent));

        // Run onEmit hook if provided
        if (context.onEmit !== undefined) {
          yield* context.onEmit(finalEvent);
        }

        // Re-surface the original exit
        return yield* exit;
      }),
    ).pipe(Effect.withSpan("withWideEvent")) as Effect.Effect<A, E, Exclude<R, WideEventRef>>,
);
