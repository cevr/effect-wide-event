import { Effect, Fiber, MutableRef } from "effect";
import { describe, expect, it } from "effect-bun-test/v3";
import { WideEvent, WideEventLogger, withWideEvent } from "../src/index.js";
import type { LogEvent } from "../src/index.js";

describe("WideEvent", () => {
  it.live("accumulates fields across multiple set() calls", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ userId: "123" });
        yield* WideEvent.set({ plan: "pro" });
        yield* WideEvent.set({ cart: { items: 3 } });
      }).pipe(
        withWideEvent({ service: "test" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);
      const annotations = events[0]!.annotations;
      expect(annotations["userId"]).toBe("123");
      expect(annotations["plan"]).toBe("pro");
      expect(annotations["cart"]).toEqual({ items: 3 });
    }),
  );

  it.live("last writer wins on key collision", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ status: "pending" });
        yield* WideEvent.set({ status: "completed" });
      }).pipe(
        withWideEvent({ service: "test" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const annotations = events[0]!.annotations;
      // Envelope's status takes precedence over user's status
      expect(annotations["status"]).toBe("ok");
    }),
  );

  it.live("reset clears user fields but envelope restores transport fields", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ before: true });
        yield* WideEvent.reset;
        yield* WideEvent.set({ after: true });
      }).pipe(
        withWideEvent({ service: "test" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const annotations = events[0]!.annotations;
      expect(annotations["before"]).toBeUndefined();
      expect(annotations["after"]).toBe(true);
      // Envelope always includes service from context
      expect(annotations["service"]).toBe("test");
    }),
  );
});

describe("withWideEvent", () => {
  it.live("emits exactly one log event with envelope fields", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ userId: "123" });
      }).pipe(
        withWideEvent({ service: "checkout", method: "POST", path: "/api/checkout" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.level).toBe("INFO");

      const a = event.annotations;
      expect(a["service"]).toBe("checkout");
      expect(a["method"]).toBe("POST");
      expect(a["path"]).toBe("/api/checkout");
      expect(a["status"]).toBe("ok");
      expect(a["userId"]).toBe("123");
      expect(typeof a["timestamp"]).toBe("string");
      expect(typeof a["durationMs"]).toBe("number");
      expect(typeof a["traceId"]).toBe("string");
      expect(typeof a["spanId"]).toBe("string");
      expect(a["spanName"]).toBe("POST /api/checkout");
    }),
  );

  it.live("captures tagged error on failure", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ orderId: "456" });
        return yield* Effect.fail({ _tag: "NotFound", message: "Order not found" });
      }).pipe(
        withWideEvent({ service: "orders" }),
        Effect.catchAll(() => Effect.void),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);

      const a = events[0]!.annotations;
      expect(a["status"]).toBe("error");
      expect(a["errorType"]).toBe("NotFound");
      expect(a["errorMessage"]).toBe("Order not found");
      expect(a["orderId"]).toBe("456");
    }),
  );

  it.live("captures Error instance on failure", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        return yield* Effect.fail(new TypeError("bad input"));
      }).pipe(
        withWideEvent({ service: "validation" }),
        Effect.catchAll(() => Effect.void),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const a = events[0]!.annotations;
      expect(a["status"]).toBe("error");
      expect(a["errorType"]).toBe("TypeError");
      expect(a["errorMessage"]).toBe("bad input");
    }),
  );

  it.live("captures defects", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        return yield* Effect.die(new RangeError("stack overflow"));
      }).pipe(
        withWideEvent({ service: "compute" }),
        Effect.catchAllDefect(() => Effect.void),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const a = events[0]!.annotations;
      expect(a["status"]).toBe("error");
      expect(a["errorType"]).toBe("Defect:RangeError");
      expect(a["errorMessage"]).toBe("stack overflow");
    }),
  );

  it.live("transport fields survive early failure", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.fail({ _tag: "Boom", message: "instant death" }).pipe(
        withWideEvent({ service: "fragile", method: "GET", path: "/boom" }),
        Effect.catchAll(() => Effect.void),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const a = events[0]!.annotations;
      expect(a["service"]).toBe("fragile");
      expect(a["method"]).toBe("GET");
      expect(a["path"]).toBe("/boom");
      expect(a["status"]).toBe("error");
    }),
  );

  it.live("nested boundaries emit separate events without clobbering", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ outer: true });

        // Inner boundary
        yield* Effect.gen(function* () {
          yield* WideEvent.set({ inner: true });
        }).pipe(withWideEvent({ service: "inner-svc" }));

        // After inner boundary, outer fields should still be intact
        const fields = yield* WideEvent.get;
        expect(fields["outer"]).toBe(true);
        expect(fields["inner"]).toBeUndefined();
      }).pipe(
        withWideEvent({ service: "outer-svc" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(2);

      // Inner emits first
      const innerEvent = events[0]!.annotations;
      expect(innerEvent["service"]).toBe("inner-svc");
      expect(innerEvent["inner"]).toBe(true);
      expect(innerEvent["outer"]).toBeUndefined();

      // Outer emits second
      const outerEvent = events[1]!.annotations;
      expect(outerEvent["service"]).toBe("outer-svc");
      expect(outerEvent["outer"]).toBe(true);
      expect(outerEvent["inner"]).toBeUndefined();
    }),
  );

  it.live("return value passes through on success", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      const result = yield* Effect.succeed(42).pipe(
        withWideEvent({ service: "compute" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      expect(result).toBe(42);
    }),
  );

  it.live("optional context fields are omitted when undefined", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.void.pipe(
        withWideEvent({ service: "minimal" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      const a = events[0]!.annotations;
      expect(a["service"]).toBe("minimal");
      expect(a["method"]).toBeUndefined();
      expect(a["path"]).toBeUndefined();
      expect(a["actor"]).toBeUndefined();
      expect(a["requestId"]).toBeUndefined();
      expect(a["spanName"]).toBe("minimal");
    }),
  );

  it.live("concurrent boundaries do not corrupt each other", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      // Two concurrent boundaries running in parallel
      yield* Effect.all(
        [
          Effect.gen(function* () {
            yield* WideEvent.set({ req: "A", marker: "svc-a" });
            yield* Effect.sleep("10 millis");
          }).pipe(withWideEvent({ service: "svc-a" })),

          Effect.gen(function* () {
            yield* WideEvent.set({ req: "B", marker: "svc-b" });
            yield* Effect.sleep("5 millis");
          }).pipe(withWideEvent({ service: "svc-b" })),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(WideEventLogger.Capture(captured)));

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(2);

      // Each event should only contain its own fields — no cross-contamination
      const eventA = events.find((e) => e.annotations["service"] === "svc-a")!;
      const eventB = events.find((e) => e.annotations["service"] === "svc-b")!;

      expect(eventA.annotations["req"]).toBe("A");
      expect(eventA.annotations["marker"]).toBe("svc-a");

      expect(eventB.annotations["req"]).toBe("B");
      expect(eventB.annotations["marker"]).toBe("svc-b");
    }),
  );

  it.live("wide event emits even when fiber is interrupted", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      const fiber = yield* Effect.gen(function* () {
        yield* WideEvent.set({ important: "context" });
        yield* Effect.sleep("1 second"); // will be interrupted
      }).pipe(
        withWideEvent({ service: "slow-svc" }),
        Effect.provide(WideEventLogger.Capture(captured)),
        Effect.fork,
      );

      // Give it time to start, then interrupt
      yield* Effect.sleep("10 millis");
      yield* Fiber.interrupt(fiber);
      yield* Effect.sleep("10 millis"); // let emission complete

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);

      const a = events[0]!.annotations;
      expect(a["service"]).toBe("slow-svc");
      expect(a["important"]).toBe("context");
      expect(a["status"]).toBe("error");
      expect(a["errorType"]).toBe("Interrupted");
    }),
  );

  it.live("sequential boundaries on same fiber do not leak state", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      // First boundary
      yield* WideEvent.set({ first: true }).pipe(
        withWideEvent({ service: "first" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      // Second boundary — should not see "first"
      yield* WideEvent.set({ second: true }).pipe(
        withWideEvent({ service: "second" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(2);

      const firstEvent = events[0]!.annotations;
      expect(firstEvent["first"]).toBe(true);
      expect(firstEvent["second"]).toBeUndefined();

      const secondEvent = events[1]!.annotations;
      expect(secondEvent["second"]).toBe(true);
      expect(secondEvent["first"]).toBeUndefined();
    }),
  );

  it.live("defect in user code still emits exactly one event", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.gen(function* () {
        yield* WideEvent.set({ beforeDefect: true });
        return yield* Effect.die(new Error("boom"));
      }).pipe(
        withWideEvent({ service: "defecting" }),
        Effect.catchAllDefect(() => Effect.void),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      // Exactly one event, not zero, not two
      expect(events).toHaveLength(1);

      const a = events[0]!.annotations;
      expect(a["beforeDefect"]).toBe(true);
      expect(a["status"]).toBe("error");
      expect(a["errorType"]).toBe("Defect:Error");
    }),
  );
});
