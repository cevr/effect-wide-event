# effect-wide-event

## 0.2.0

### Minor Changes

- [`b603b1e`](https://github.com/cevr/effect-wide-event/commit/b603b1e752487220b3055bafe75f25cdb84942e4) Thanks [@cevr](https://github.com/cevr)! - Wide event logging for Effect — one structured event per request per service.
  - `WideEvent.set/get/reset` accumulator with per-boundary isolation
  - `withWideEvent` boundary combinator with uninterruptible emission, tracing, and error extraction
  - `WideEventLogger` layers: Json, Pretty, Capture, Silent
  - Extensible: custom log level, envelope fields, error extractor, onEmit hook
  - Dual v3/v4 build
