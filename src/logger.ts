import { Layer, Logger, MutableRef, References } from "effect";

/**
 * A captured log event for testing.
 */
export interface LogEvent {
  readonly timestamp: Date;
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Record<string, unknown>;
  readonly spans: ReadonlyArray<readonly [label: string, startTime: number]>;
}

/**
 * Logger layers for wide event output.
 *
 * - `Json` — Production: flat JSON to stdout
 * - `Pretty` — Development: Effect's built-in pretty logger
 * - `Capture` — Testing: captures events into a `Ref`
 * - `Silent` — No output
 */
export const WideEventLogger = {
  /**
   * Production logger: flat JSON object per log line to stdout.
   * Reads annotations and spans from fiber context and flattens them
   * into a single JSON object.
   */
  Json: Logger.layer([
    Logger.make<unknown, void>(({ cause, date, fiber, logLevel, message }) => {
      const annotations = fiber.getRef(References.CurrentLogAnnotations);
      const spans = fiber.getRef(References.CurrentLogSpans);

      const entry: Record<string, unknown> = {
        timestamp: date.toISOString(),
        level: logLevel.toUpperCase(),
        message,
      };

      // Flatten annotations into the entry
      for (const [key, value] of Object.entries(annotations)) {
        entry[key] = value;
      }

      // Add span info
      if (spans.length > 0) {
        const currentSpan = spans[spans.length - 1]!;
        entry["spanLabel"] = currentSpan[0];
        entry["spanDuration"] = Date.now() - currentSpan[1];
      }

      // Add cause if present
      if (cause.reasons.length > 0) {
        entry["cause"] = cause.toString();
      }

      // biome-ignore lint/suspicious/noConsole: logger output
      console.log(JSON.stringify(entry));
    }),
  ]),

  /**
   * Development logger: Effect's built-in pretty printer with colors and grouping.
   */
  Pretty: Logger.layer([Logger.consolePretty()]),

  /**
   * Test logger: captures log events into a MutableRef for assertions.
   *
   * ```ts
   * const captured = MutableRef.make<Array<LogEvent>>([])
   * yield* myEffect.pipe(Effect.provide(WideEventLogger.Capture(captured)))
   * const events = MutableRef.get(captured)
   * ```
   */
  Capture: (captured: MutableRef.MutableRef<Array<LogEvent>>): Layer.Layer<never> =>
    Logger.layer([
      Logger.make<unknown, void>(({ cause: _cause, date, fiber, logLevel, message }) => {
        const annotations = fiber.getRef(References.CurrentLogAnnotations);
        const spans = fiber.getRef(References.CurrentLogSpans);

        const event: LogEvent = {
          timestamp: date,
          level: logLevel.toUpperCase(),
          message,
          annotations: { ...annotations },
          spans: [...spans],
        };

        MutableRef.set(captured, [...MutableRef.get(captured), event]);
      }),
    ]),

  /**
   * Silent logger: no output.
   */
  Silent: Logger.layer([]),
} as const;
