import { Context, Effect, Exit, Ref } from "effect";
import type { OutcomeClassifier, WideEventOutcomeDetails } from "./boundary.js";

/**
 * The service holding the wide event accumulator Ref.
 * Each boundary provides a fresh Ref to its inner effect.
 * @internal — not part of the public API.
 */
export class WideEventRef extends Context.Tag("effect-wide-event/wide-event/WideEventRef")<
  WideEventRef,
  Ref.Ref<Record<string, unknown>>
>() {}

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
