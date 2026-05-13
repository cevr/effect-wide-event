// @effect-diagnostics strictEffectProvide:off globalErrorInEffectFailure:off
import { Effect, Fiber, MutableRef, References } from "effect";
import { describe, expect, it } from "effect-bun-test";
import { WideEvent, WideEventBoundary, WideEventLogger, withWideEvent } from "../src/index.js";
import type { LogEvent, WideEventContext } from "../src/index.js";

const catchAll = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      () => true,
      () => Effect.void,
    ),
  );

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

  it.live("records domain failure outcomes without changing transport status", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* WideEvent.failDomain("permission_denied", {
        message: "Permission denied",
        fields: { toolName: "bash" },
      }).pipe(
        withWideEvent(WideEventBoundary.tool("bash")),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const annotations = MutableRef.get(captured)[0]!.annotations;
      expect(annotations["status"]).toBe("ok");
      expect(annotations["outcome"]).toBe("domain_error");
      expect(annotations["outcomeType"]).toBe("permission_denied");
      expect(annotations["outcomeMessage"]).toBe("Permission denied");
      expect(annotations["toolName"]).toBe("bash");
      expect(annotations["service"]).toBe("tool");
      expect(annotations["method"]).toBe("bash");
    }),
  );

  it.live("records warning outcomes without changing transport status", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* WideEvent.warn("result_enrichment_failed", {
        fields: { toolName: "read" },
      }).pipe(
        withWideEvent(WideEventBoundary.tool("read")),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const annotations = MutableRef.get(captured)[0]!.annotations;
      expect(annotations["status"]).toBe("ok");
      expect(annotations["outcome"]).toBe("warning");
      expect(annotations["outcomeType"]).toBe("result_enrichment_failed");
      expect(annotations["toolName"]).toBe("read");
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

      yield* WideEvent.set({ userId: "123" }).pipe(
        withWideEvent({ service: "checkout", method: "POST", path: "/api/checkout" }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.level).toBe("INFO");
      expect(event.message).toEqual(["wide-event"]);

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
        catchAll,
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

      yield* Effect.fail(new TypeError("bad input")).pipe(
        withWideEvent({ service: "validation" }),
        catchAll,
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

      yield* Effect.die(new RangeError("stack overflow")).pipe(
        withWideEvent({ service: "compute" }),
        Effect.catchDefect(() => Effect.void),
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
        catchAll,
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
        yield* WideEvent.set({ inner: true }).pipe(withWideEvent({ service: "inner-svc" }));

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
        Effect.forkDetach,
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
        Effect.catchDefect(() => Effect.void),
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

  it.live("custom log level", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.void.pipe(
        withWideEvent({ service: "health", level: "Debug" }),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const events = MutableRef.get(captured);
      expect(events).toHaveLength(1);
      expect(events[0]!.level).toBe("DEBUG");
    }),
  );

  it.live("envelope fields merged into every event", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* WideEvent.set({ custom: "field" }).pipe(
        withWideEvent({
          service: "my-svc",
          envelope: { environment: "prod", region: "us-east-1" },
        }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const a = MutableRef.get(captured)[0]!.annotations;
      expect(a["environment"]).toBe("prod");
      expect(a["region"]).toBe("us-east-1");
      expect(a["custom"]).toBe("field");
      expect(a["service"]).toBe("my-svc");
    }),
  );

  it.live("custom error extractor", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);

      yield* Effect.fail({ code: "ENOENT", path: "/missing" }).pipe(
        withWideEvent({
          service: "fs",
          extractError: (cause) => {
            for (const reason of cause.reasons) {
              if (reason._tag === "Fail") {
                const err = reason.error as { code: string; path: string };
                return { errorType: err.code, errorMessage: `Not found: ${err.path}` };
              }
            }
            return { errorType: "Unknown", errorMessage: "unknown" };
          },
        }),
        catchAll,
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const a = MutableRef.get(captured)[0]!.annotations;
      expect(a["errorType"]).toBe("ENOENT");
      expect(a["errorMessage"]).toBe("Not found: /missing");
    }),
  );

  it.live("onEmit hook receives final event", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);
      const hookCaptured = MutableRef.make<Array<Record<string, unknown>>>([]);

      yield* WideEvent.set({ userId: "456" }).pipe(
        withWideEvent({
          service: "audit",
          onEmit: (event) =>
            Effect.sync(() => {
              MutableRef.set(hookCaptured, [...MutableRef.get(hookCaptured), event]);
            }),
        }),
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const hookEvents = MutableRef.get(hookCaptured);
      expect(hookEvents).toHaveLength(1);
      expect(hookEvents[0]!["service"]).toBe("audit");
      expect(hookEvents[0]!["userId"]).toBe("456");
      expect(hookEvents[0]!["status"]).toBe("ok");
    }),
  );

  it.live("classifies successful values into semantic outcomes", () =>
    Effect.gen(function* () {
      const captured = MutableRef.make<Array<LogEvent>>([]);
      const context: WideEventContext<{ allowed: boolean; reason: string }> = {
        ...WideEventBoundary.rpc("permission.check"),
        classifyExit: WideEvent.classifyValue<{ allowed: boolean; reason: string }>((value) =>
          value.allowed
            ? undefined
            : {
                outcome: "domain_error",
                type: "permission_denied",
                fields: { reason: value.reason },
              },
        ),
      };

      yield* withWideEvent(Effect.succeed({ allowed: false, reason: "policy" }), context).pipe(
        Effect.provide(WideEventLogger.Capture(captured)),
      );

      const annotations = MutableRef.get(captured)[0]!.annotations;
      expect(annotations["status"]).toBe("ok");
      expect(annotations["outcome"]).toBe("domain_error");
      expect(annotations["outcomeType"]).toBe("permission_denied");
      expect(annotations["reason"]).toBe("policy");
      expect(annotations["service"]).toBe("rpc");
      expect(annotations["method"]).toBe("permission.check");
    }),
  );
});
