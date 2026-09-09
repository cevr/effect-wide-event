---
"effect-wide-event": minor
---

Add `WideEvent.setOptional`, which merges fields when a boundary is present and does nothing when there is none.

`WideEvent.set` requires `WideEventRef`, so shared code that annotates an event forces every caller into a boundary. `setOptional` carries no requirement, so a library or a cross-cutting concern (error reporting, a cache, an instrumented client) can enrich the event where one exists without constraining callers that run outside one. It writes into the nearest enclosing boundary, matching `set`.
