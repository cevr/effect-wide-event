import { Context, Effect, Exit, Option, Ref } from "effect";
import type { OutcomeClassifier, WideEventOutcomeDetails } from "./boundary.js";

/**
 * The service holding the wide event accumulator Ref.
 * Each boundary provides a fresh Ref to its inner effect.
 * @internal — not part of the public API.
 */
export class WideEventRef extends Context.Service<WideEventRef, Ref.Ref<Record<string, unknown>>>()(
  "effect-wide-event/wide-event/WideEventRef",
) {}

/**
 * Wide event accumulator — accumulates structured fields throughout a
 * request lifecycle, emitted as a single event at the boundary.
 *
 * Uses shallow merge. Last writer wins per key.
 *
 * Must be used inside a `withWideEvent` boundary — the boundary provides
 * the accumulator scope.
 */
export const WideEvent = {
  /**
   * Merge fields into the current wide event.
   *
   * ```ts
   * yield* WideEvent.set({ userId: "123", plan: "pro" })
   * yield* WideEvent.set({ cart: { items: 3, total: 9999 } })
   * ```
   */
  set: (fields: Record<string, unknown>): Effect.Effect<void, never, WideEventRef> =>
    Effect.gen(function* () {
      const ref = yield* WideEventRef;
      yield* Ref.update(ref, (current) => ({ ...current, ...fields }));
    }),

  /**
   * Merge fields into the current wide event when a boundary is present, and
   * do nothing when there is none.
   *
   * `set` requires `WideEventRef`, so shared code that annotates an event must
   * force every caller into a boundary. This variant carries no requirement,
   * so a library or a cross-cutting concern (error reporting, a cache, an
   * instrumented client) can enrich the event where one exists without
   * constraining callers that run outside one.
   *
   * ```ts
   * Effect.gen(function* () {
   *   yield* WideEvent.setOptional({ sentryEventId: id })
   * })
   * ```
   */
  setOptional: (fields: Record<string, unknown>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const ref = yield* Effect.serviceOption(WideEventRef);
      if (Option.isNone(ref)) {
        return;
      }
      yield* Ref.update(ref.value, (current) => ({ ...current, ...fields }));
    }),

  failDomain: (
    type: string,
    options: {
      readonly message?: string;
      readonly fields?: Record<string, unknown>;
    } = {},
  ): Effect.Effect<void, never, WideEventRef> =>
    WideEvent.set({
      ...options.fields,
      outcome: "domain_error",
      outcomeType: type,
      ...(options.message !== undefined ? { outcomeMessage: options.message } : {}),
    }),

  warn: (
    type: string,
    options: {
      readonly message?: string;
      readonly fields?: Record<string, unknown>;
    } = {},
  ): Effect.Effect<void, never, WideEventRef> =>
    WideEvent.set({
      ...options.fields,
      outcome: "warning",
      outcomeType: type,
      ...(options.message !== undefined ? { outcomeMessage: options.message } : {}),
    }),

  classifyValue:
    <A>(classifier: (value: A) => WideEventOutcomeDetails | undefined): OutcomeClassifier<A> =>
    (exit) =>
      Exit.isSuccess(exit) ? classifier(exit.value) : undefined,

  /**
   * Read the current accumulated wide event fields.
   */
  get: Effect.gen(function* () {
    const ref = yield* WideEventRef;
    return yield* Ref.get(ref);
  }),

  /**
   * Reset the accumulator to an empty object.
   */
  reset: Effect.gen(function* () {
    const ref = yield* WideEventRef;
    yield* Ref.set(ref, {});
  }),
} as const;
