---
"effect-wide-event": minor
---

Wide event logging for Effect — one structured event per request per service.

- `WideEvent.set/get/reset` accumulator with per-boundary isolation
- `withWideEvent` boundary combinator with uninterruptible emission, tracing, and error extraction
- `WideEventLogger` layers: Json, Pretty, Capture, Silent
- Extensible: custom log level, envelope fields, error extractor, onEmit hook
- Dual v3/v4 build
