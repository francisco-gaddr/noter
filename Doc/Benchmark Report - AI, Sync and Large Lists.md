# Benchmark Report - AI, Sync and Large Lists

## Scope

This report covers the latest performance-focused changes across:

- mobile AI chat rendering
- mobile startup instrumentation
- web AI sidebar rendering
- Electron startup and AI instrumentation
- mobile startup, background refresh and persistence throughput
- Electron/web startup deduplication and fetch concurrency control
- mobile offline sync queue behavior
- web large-list rendering in SidebarTree
- mobile AI sidebar project/chat list rendering
- mobile note tree traversal and task timeline storage work
- web editor lookup efficiency and sidebar search reuse

## Change Summary

### 1. AI streaming and message rendering

#### Mobile

- Streaming writes are already batched.
- Message rows are now rendered through memoized row components.
- Tool messages use a separate memoized row with collapsed-state control.
- The sidebar list for projects and conversations now renders through `FlatList`.

#### Web

- Streaming writes are already batched.
- Chat rows are now rendered through memoized components for normal messages and tool rows.
- Large assistant/tool blocks use `content-visibility: auto` with intrinsic size hints.

## 2. Startup and background loading

### Mobile

- Startup now reads SecureStore and AsyncStorage preferences in parallel.
- Local notes and local tasks now load in parallel during bootstrap.
- Initial remote note/task refresh now runs in parallel after local state is ready.
- Background refresh now fetches notes and tasks in parallel and persists them in yielding batches instead of long serial write chains.

### Electron / Renderer

- Web store note fetches are now deduplicated while one refresh is already in flight.
- Web store task fetches are also deduplicated per scope.
- SidebarTree no longer triggers an extra `fetchNotes()` on mount when the store hydration path already owns startup loading.
- This removes duplicate startup work in Electron-rendered sessions and reduces avoidable cache/server churn.

## 3. Offline queue granularity

### Mobile

- Offline updates for temp-created notes/tasks now merge into the queued `CREATE` entry instead of adding extra `UPDATE` entries.
- Offline deletes for temp-created notes/tasks now remove the queued `CREATE` entry instead of creating a separate `DELETE`.
- This reduces queue length, redundant encryption work and replay work during reconnect.

## 4. Large-list rendering

### Mobile

- AI sidebar project/chat navigation is list-driven instead of map-driven scroll rendering.

### Web

- Sidebar list mode keeps the 500-item safety cap.
- Within that cap, rendered rows are windowed based on scroll position.
- Current windowing parameters:
  - estimated row height: 40 px
  - overscan: 12 rows

## 5. Tree, editor and navigation-path efficiency

### Mobile

- `NoteTree` now builds from indexed parent→children maps instead of repeated `filter`/`some` scans over the same note set.
- Effective parent lookups now use an id map instead of repeated linear scans.
- `TaskTimeline` no longer performs duplicate AsyncStorage reads/writes for the same mode state.

### Electron / Renderer

- `NoteEditor` now reuses memoized note-id lookups and a single memoized security map instead of repeated full-array scans in critical editor state paths.
- `SidebarTree` now reuses a memoized Fuse search index instead of rebuilding the search index for every search render pass.

## Before/After Impact

| Area | Before | After | Expected effect |
|---|---|---|---|
| Mobile AI row rendering | Inline row rendering in main screen list | Memoized chat/tool rows | Fewer rerenders during streaming and tool updates |
| Web AI row rendering | Inline JSX for each row/tool block | Memoized row components + content visibility | Lower repaint/layout cost on large chats |
| Mobile AI sidebar | Scroll view + mapped items | FlatList-based rendering | Better scaling with many projects/chats |
| Mobile offline queue | Temp create + later update/delete produced extra queue work | Update merges into create, delete removes create | Shorter queue and less sync replay |
| Web sidebar list mode | Up to 500 items rendered at once | Windowed rendering inside 500-item cap | Lower DOM size and faster scrolling |
| Mobile bootstrap I/O | Preference and local collection reads mostly serial | Preference, local notes and local tasks read in parallel | Faster first usable state |
| Mobile background refresh | Notes/tasks fetched and written in long serial chains | Parallel fetch + yielding batched persistence | Less UI blocking during refresh |
| Electron renderer startup | Hydration path plus SidebarTree could trigger extra note refreshes | In-flight dedupe + removed duplicate SidebarTree fetch | Less duplicate loading and faster startup stability |
| Mobile note tree traversal | Repeated parent/child scans over the whole visible note set | Indexed parent-child traversal and id lookups | Faster tree flattening and navigation in larger note sets |
| Task timeline mode persistence | Duplicate AsyncStorage effects for the same mode | Single storage read/write path | Less storage churn on timeline navigation |
| Web editor/security lookups | Repeated `find` and security-map rebuilds in editor state paths | Memoized note map and security map reuse | Lower editor overhead during note switches and locked-note checks |

## Concrete Mechanical Savings

- AI stream flush interval remains about 80 ms instead of per-token UI writes.
- Web list mode now renders only the visible slice plus overscan, not the full first 500 rows.
- Mobile startup removes several avoidable serial waits by overlapping preference reads, local collection reads and initial remote refresh.
- Mobile background refresh now yields between batched writes instead of monopolizing the JS thread for long save loops.
- Electron/web now suppress duplicate in-flight note/task refreshes instead of starting overlapping network + decrypt + cache work.
- Mobile note tree flattening avoids repeated whole-array parent and child scans.
- Web editor and sidebar reuse memoized indexes instead of rebuilding hot lookup structures on every relevant pass.
- Temp entity offline flows can collapse from:
  - `CREATE + UPDATE` to `CREATE`
  - `CREATE + DELETE` to no queued item

## Instrumentation Surfaces

### Mobile

- `apps/mobile/services/perfMetrics.ts` now keeps in-memory counters for:
  - app ready since launch
  - startup bootstrap runs and named init stages
  - AI row render counts
  - AI generation duration, token count, flush count and tool-message count
  - sync queue enqueue, merge, remove and drain statistics
- `apps/mobile/services/startup.ts` records bootstrap duration and success/failure.
- `apps/mobile/stores/useStore.ts` records init-stage durations and sync-drain batches.
- `apps/mobile/app/(tabs)/ai.tsx` records row renders and generation samples.

### Electron

- `electron-noter/src/perfMetrics.js` now keeps in-memory counters for:
  - app ready, window creation, load start, did-finish-load and first show
  - renderer recovery count and failed-load count
  - settings queue enqueue/flush/coalescing behavior
  - AI download duration and progress event count
  - AI chat duration and token count
- `electron-noter/main.js` records startup, settings queue and AI IPC timing.
- `electron-noter/preload.js` exposes read-only performance snapshot/reset calls for test and diagnostics access.

## Debug Views

### Mobile

- Settings > Developer now links to a dedicated performance snapshot screen.
- The screen shows:
  - app-ready timing
  - startup stage aggregates
  - AI render/generation counters
  - sync queue counters
  - raw JSON snapshot for diagnostics

### Electron

- The AI System Dashboard now includes a dedicated `Performance` tab in Electron.
- The tab shows:
  - startup timing and recovery counters
  - settings queue activity
  - AI download/chat counters
  - raw snapshot JSON from the Electron process
- In browser-only mode, the tab degrades safely instead of exposing fake data.

## Verification Evidence

### Mobile

- `npm run check-types`
- `npx jest tests/perf-metrics.test.ts tests/performance-snapshots-screen.test.tsx tests/task-settings-persistence.e2e.test.tsx tests/note-content-decryption.e2e.test.tsx tests/settings-press-feedback.e2e.test.tsx tests/startup-bootstrap.test.ts tests/store-init-resilience.test.ts tests/database-at-rest.test.ts __tests__/store.test.ts tests/ai-e2e.test.ts tests/ai-tool-use-e2e.test.ts tests/ai-settings-structure.test.tsx --runInBand`

### Electron / Renderer

- `npm run check-types`
- `npx jest __tests__/store.test.ts __tests__/SidebarTree.test.tsx __tests__/AISidebar.test.tsx __tests__/performance-stability.test.tsx --runInBand`
- `npm run build`
- `npm test -- tests/perf-metrics.test.js tests/preload-security.test.js tests/release-readiness.test.js`
- `npm run test:e2e`

## Interpreting the Results

- The strongest measurable reduction is in unnecessary work:
  - fewer React rerenders
  - fewer DOM nodes in web list mode
  - fewer sync queue entries for temp objects
  - fewer local writes during sync
- The latest pass also reduces duplicate and blocking work:
  - fewer overlapping startup fetches in Electron/web
  - fewer long serial write phases in mobile background refresh
  - fewer serial waits during mobile bootstrap
- The current pass now adds real counters for startup, AI and queue behavior in mobile and Electron without storing user content.
- The report still intentionally avoids invented timing numbers until sample runs are collected from devices and packaged Electron builds.

## Recommended Next Benchmark Pass

- Collect real-device mobile snapshots before and after long AI sessions.
- Capture Electron packaged-build startup snapshots instead of only test-mode startup.
- Add browser-based measurement for SidebarTree scroll FPS and DOM node count.
- Add a 1k/5k/10k message synthetic chat benchmark for web and mobile.
