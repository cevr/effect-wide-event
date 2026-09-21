# effect-wide-event

## 0.4.0

### Minor Changes

- [`54dc3e2`](https://github.com/cevr/effect-wide-event/commit/54dc3e224ce7fd42453cc34e62dc3df560544775) Thanks [@cevr](https://github.com/cevr)! - Add `WideEvent.setOptional`, which merges fields when a boundary is present and does nothing when there is none.

  `WideEvent.set` requires `WideEventRef`, so shared code that annotates an event forces every caller into a boundary. `setOptional` carries no requirement, so a library or a cross-cutting concern (error reporting, a cache, an instrumented client) can enrich the event where one exists without constraining callers that run outside one. It writes into the nearest enclosing boundary, matching `set`.

## 0.3.0

### Minor Changes

- [`b72862b`](https://github.com/cevr/effect-wide-event/commit/b72862b8116816431466999c16a9972623b4f1a1) Thanks [@cevr](https://github.com/cevr)! - Add semantic outcome helpers and reusable boundary context factories. `status`
  continues to describe transport/effect success while the new `outcome`,
  `outcomeType`, and `outcomeMessage` fields describe domain failures or warnings.

## 0.2.2

### Patch Changes

- [`1d5ea75`](https://github.com/cevr/effect-wide-event/commit/1d5ea75a31369d626338b538a7f373cefb2bd52b) Thanks [@cevr](https://github.com/cevr)! - Update the native Effect v4 entrypoint to support Effect 4.0.0-beta.66.

- [`8dccd7d`](https://github.com/cevr/effect-wide-event/commit/8dccd7dae2ee92fe2d9da5d34e3f120a784629b8) Thanks [@cevr](https://github.com/cevr)! - Make `effect` peer-only so consumers keep a single Effect runtime identity.

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
