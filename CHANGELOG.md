# effect-wide-event

## 0.2.1

### Patch Changes

- [`e47e994`](https://github.com/cevr/effect-wide-event/commit/e47e9944acf3b16627893ded01c495540b781cce) Thanks [@cevr](https://github.com/cevr)! - Upgrade to effect 4.0.0-beta.47: ServiceMap.Service → Context.Service

- [`5544ec2`](https://github.com/cevr/effect-wide-event/commit/5544ec28038a3d90c50e388b6298294fd5128c30) Thanks [@cevr](https://github.com/cevr)! - Modernize the toolchain around `@effect/tsgo` and upgrade Effect v4 support to `4.0.0-beta.64`.

## 0.2.0

### Minor Changes

- [`b603b1e`](https://github.com/cevr/effect-wide-event/commit/b603b1e752487220b3055bafe75f25cdb84942e4) Thanks [@cevr](https://github.com/cevr)! - Wide event logging for Effect — one structured event per request per service.
  - `WideEvent.set/get/reset` accumulator with per-boundary isolation
  - `withWideEvent` boundary combinator with uninterruptible emission, tracing, and error extraction
  - `WideEventLogger` layers: Json, Pretty, Capture, Silent
  - Extensible: custom log level, envelope fields, error extractor, onEmit hook
  - Dual v3/v4 build
