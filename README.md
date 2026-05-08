# effect-wide-event

Wide event logging for [Effect](https://effect.website). One structured event per request — not 17 scattered log lines.

Inspired by [loggingsucks.com](https://loggingsucks.com/) and Stripe's [canonical log lines](https://brandur.org/canonical-log-lines).

## Install

```sh
bun add effect-wide-event
```

## Usage

```ts
import { Effect } from "effect";
import { WideEvent, withWideEvent, WideEventLogger } from "effect-wide-event";
// v3: import from "effect-wide-event/v3"

const handleCheckout = Effect.gen(function* () {
  yield* WideEvent.set({ userId: "123", plan: "pro" });

  const order = yield* processOrder();
  yield* WideEvent.set({ orderId: order.id, total: order.total });

  return order;
}).pipe(withWideEvent({ service: "checkout", method: "POST", path: "/api/checkout" }));

// Run with a logger
const program = handleCheckout.pipe(
  Effect.provide(WideEventLogger.Json), // or .Pretty, .Silent
);
```

Produces one log event:

```json
{
  "service": "checkout",
  "method": "POST",
  "path": "/api/checkout",
  "userId": "123",
  "plan": "pro",
  "orderId": "ord_abc",
  "total": 9999,
  "status": "ok",
  "durationMs": 42,
  "traceId": "...",
  "spanId": "...",
  "timestamp": "2026-03-26T12:00:00.000Z"
}
```

## API

| Export                         | What                                         |
| ------------------------------ | -------------------------------------------- |
| `WideEvent.set(fields)`        | Merge fields into the current event          |
| `WideEvent.get`                | Read accumulated fields                      |
| `WideEvent.reset`              | Clear the accumulator                        |
| `withWideEvent(context)`       | Boundary — wraps an effect, emits one event  |
| `WideEventLogger.Json`         | Flat JSON to stdout                          |
| `WideEventLogger.Pretty`       | Effect's pretty logger                       |
| `WideEventLogger.Capture(ref)` | Capture events into a `MutableRef` (testing) |
| `WideEventLogger.Silent`       | No output                                    |

## Guarantees

- **Isolation** — each boundary gets its own accumulator. Concurrent and nested boundaries cannot corrupt each other.
- **Always emits** — the boundary is uninterruptible after the user effect completes. Interruption, failures, and defects all produce an event.
- **Envelope** — `service`, `status`, `durationMs`, `traceId`, `spanId`, `timestamp`, and error info are always present.

## v3 / v4

Default export is Effect v4. For v3:

```ts
import { WideEvent, withWideEvent, WideEventLogger } from "effect-wide-event/v3";
```

## Development

This repo follows the shared Effect project scaffold: Bun, `@effect/tsgo`,
oxlint, oxfmt, lefthook, changesets, and a v3 compatibility surface.

```sh
bun install
bun run gate
```

## License

MIT
