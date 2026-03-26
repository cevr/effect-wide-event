---
name: wide-events
description: >
  Wide event logging patterns with effect-wide-event. Use when implementing request-scoped
  structured logging, wide events, canonical log lines, or using WideEvent/withWideEvent APIs.
  Triggers on: wide event, canonical log line, request logging, WideEvent.set, withWideEvent.
allowed-tools: Bash, Read, Grep, Glob
---

# Wide Events

Patterns for `effect-wide-event` — one structured event per request per service.

## Quick Reference

| API                            | What                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `WideEvent.set(fields)`        | Merge fields into accumulator (shallow, last-writer-wins) |
| `WideEvent.get`                | Read current accumulated fields                           |
| `WideEvent.reset`              | Clear accumulator                                         |
| `withWideEvent(ctx)`           | Boundary combinator — wraps effect, emits one event       |
| `WideEventLogger.Json`         | Flat JSON to stdout (prod)                                |
| `WideEventLogger.Pretty`       | Effect pretty logger (dev)                                |
| `WideEventLogger.Capture(ref)` | `MutableRef<LogEvent[]>` capture (test)                   |
| `WideEventLogger.Silent`       | No output                                                 |

## Pattern

```ts
import { WideEvent, withWideEvent, WideEventLogger } from "effect-wide-event";
// v3: import from "effect-wide-event/v3"

// Sprinkle set() throughout your request handler
const handler = Effect.gen(function* () {
  yield* WideEvent.set({ userId: user.id, plan: user.plan });
  const result = yield* doWork();
  yield* WideEvent.set({ resultCount: result.length });
  return result;
}).pipe(withWideEvent({ service: "my-svc", method: "GET", path: "/api/items" }));
```

## Boundary Behavior

- **Isolated** — each `withWideEvent` creates a fresh `Ref`. Concurrent and nested boundaries are independent.
- **Uninterruptible emission** — the whole boundary is `Effect.uninterruptible`, user effect runs inside `Effect.interruptible`. Event always emits.
- **Envelope fields** — always present in final event, take precedence over user fields:
  `service`, `method`, `path`, `actor`, `requestId`, `timestamp`, `durationMs`, `status`, `traceId`, `spanId`, `spanName`, `errorType`, `errorMessage`

## Error Extraction

| Cause                       | `errorType`        | `errorMessage`                  |
| --------------------------- | ------------------ | ------------------------------- |
| Tagged failure (`{ _tag }`) | `_tag` value       | `.message` or `String(failure)` |
| Error instance              | `ClassName`        | `.message`                      |
| Defect                      | `Defect:ClassName` | `.message`                      |
| Interruption                | `Interrupted`      | `"Fiber interrupted"`           |

## Testing

```ts
import { MutableRef } from "effect";

const captured = MutableRef.make<Array<LogEvent>>([]);
yield *
  myEffect.pipe(
    withWideEvent({ service: "test" }),
    Effect.provide(WideEventLogger.Capture(captured)),
  );
const events = MutableRef.get(captured);
expect(events).toHaveLength(1);
expect(events[0].annotations["status"]).toBe("ok");
```

## v3 vs v4 Internals

| Concern            | v4                                               | v3                              |
| ------------------ | ------------------------------------------------ | ------------------------------- |
| Accumulator tag    | `ServiceMap.Service`                             | `Context.Tag`                   |
| Logger wiring      | `Logger.layer([...])`                            | `Logger.replace(...)`           |
| Silent logger      | `Logger.layer([])`                               | `Logger.remove(defaultLogger)`  |
| Pretty logger      | `Logger.consolePretty()`                         | `Logger.prettyLoggerDefault`    |
| Logger annotations | `fiber.getRef(References.CurrentLogAnnotations)` | `options.annotations` (HashMap) |

## Gotchas

- `WideEvent.set()` must be called inside a `withWideEvent` boundary — there is no global accumulator
- User fields named `status`, `service`, `timestamp` etc. get overwritten by envelope
- Shallow merge only — nested objects replace, not deep-merge
- `WideEvent.get` returns the live mutable record; don't hold references across yields
