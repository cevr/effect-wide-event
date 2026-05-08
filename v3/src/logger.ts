import type { Layer } from "effect";
import { HashMap, Logger, MutableRef } from "effect";

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
 * - `Capture` — Testing: captures events into a `MutableRef`
 * - `Silent` — No output
 */
export const WideEventLogger = {
  /**
   * Production logger: flat JSON object per log line to stdout.
   * Reads annotations and spans and flattens them into a single JSON object.
   */
  Json: Logger.replace(
    Logger.defaultLogger,
    Logger.make<unknown, void>(({ annotations, cause, date, logLevel, message, spans }) => {
      const entry: Record<string, unknown> = {
        timestamp: date.toISOString(),
        level: logLevel.label.toUpperCase(),
        message,
      };

      // Flatten annotations into the entry
      for (const [key, value] of HashMap.toEntries(annotations)) {
        entry[key] = value;
      }

      // Add span info
      let current = spans;
      const spanEntries: Array<readonly [string, number]> = [];
      while (current._tag === "Cons") {
        spanEntries.push([current.head.label, current.head.startTime]);
        current = current.tail;
      }
      if (spanEntries.length > 0) {
        const latestSpan = spanEntries[0];
        if (latestSpan !== undefined) {
          entry["spanLabel"] = latestSpan[0];
          entry["spanDuration"] = date.getTime() - latestSpan[1];
        }
      }

      // Add cause if present
      if (cause._tag !== "Empty") {
        entry["cause"] = cause.toString();
      }

      // biome-ignore lint/suspicious/noConsole: logger output
      console.log(JSON.stringify(entry));
    }),
  ),

  /**
   * Development logger: Effect's built-in pretty printer with colors and grouping.
   */
  Pretty: Logger.replace(Logger.defaultLogger, Logger.prettyLoggerDefault),

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
    Logger.replace(
      Logger.defaultLogger,
      Logger.make<unknown, void>(
        ({ annotations, cause: _cause, date, logLevel, message, spans }) => {
          const annotationsRecord: Record<string, unknown> = {};
          for (const [key, value] of HashMap.toEntries(annotations)) {
            annotationsRecord[key] = value;
          }

          const spanEntries: Array<readonly [string, number]> = [];
          let current = spans;
          while (current._tag === "Cons") {
            spanEntries.push([current.head.label, current.head.startTime]);
            current = current.tail;
          }

          const event: LogEvent = {
            timestamp: date,
            level: logLevel.label.toUpperCase(),
            message,
            annotations: annotationsRecord,
            spans: spanEntries,
          };

          MutableRef.set(captured, [...MutableRef.get(captured), event]);
        },
      ),
    ),

  /**
   * Silent logger: no output.
   */
  Silent: Logger.remove(Logger.defaultLogger),
} as const;
