# Task Widgets — Architecture (mobile + macOS)

**Updated:** 2026-06-13
**Status:** View-model + snapshot logic shipped (`@repo/shared/widgetData.ts`, 8 tests).
Native targets pending — they require Xcode / Android Studio / an EAS build on the
developer's machine and cannot be built or verified headlessly.

## Goal
Show to-do tasks in a home-screen widget (iOS + Android) and a macOS widget. From the
widget: mark complete, add a task to a chosen list, sort by priority and by time, and
filter — quickly.

## The encryption decision (important)
Widgets run in a **separate process, outside the app's biometric-unlock boundary**, so
they cannot prompt for unlock and must not hold the v3 `dataKey`. Therefore:

- The app writes a **plaintext-but-OS-protected snapshot** of only what the widget shows
  — **task titles + priority + due date + list names, never note bodies or descriptions**
  (`buildWidgetSnapshot` already strips everything else).
- Storage is the OS **shared container**, itself protected at rest by the platform:
  - iOS/macOS: **App Group** container file + `kSecAttrAccessibleAfterFirstUnlock` (the
    snapshot is only written while the app is unlocked; the widget reads the last one).
  - Android: **EncryptedSharedPreferences** (Jetpack Security) in a shared prefs file.
- This honours "no sensitive content unencrypted at rest": note bodies stay E2E-encrypted
  and never reach the widget; only low-sensitivity task titles do, inside an
  OS-encrypted container, refreshed only when the user is unlocked.
- **Write-back** (complete / add from widget) does **not** mutate encrypted storage
  directly. It appends an intent to a small **action queue** in the shared container; the
  app drains it on next foreground/unlock and runs the real (encrypted, synced) mutation.

## Data flow
```
app (unlocked) ──buildWidgetSnapshot(tasks,lists,now,query)──▶ shared container (snapshot.json)
                                                                      │ read
widget ◀──────────────────────────────────────────────────────────────┘  render rows
widget action (complete/add) ──append──▶ shared container (actions.json)
app (next foreground) ──drain──▶ store mutation (encrypted + synced) ──▶ rewrite snapshot
```

## Shared, already implemented (`@repo/shared/widgetData.ts`)
- `toWidgetTasks(tasks, { listId, sort: 'priority'|'time', includeCompleted, limit })`
  — the exact sort/filter the widget exposes (priority high→low then due; or due then
  priority; undated last; soft-deleted dropped). Fully unit-tested.
- `buildWidgetSnapshot(tasks, lists, generatedAt, query)` — versioned
  (`WIDGET_SNAPSHOT_VERSION`) payload carrying only widget fields.

## Native work remaining (needs developer machine)
1. **iOS + macOS (WidgetKit, Swift).** Recommended: `@bittingz/expo-widgets` or
   `expo-apple-targets` config plugin to add a Widget Extension + App Group. Timeline
   provider reads `snapshot.json`; intents (`AppIntent`) append to `actions.json`. macOS
   widget shares the same Swift target.
2. **Android (App Widget, Kotlin).** `RemoteViews` + `AppWidgetProvider`, or
   `react-native-android-widget`. Read EncryptedSharedPreferences; `PendingIntent` for
   complete/add appends to the action queue.
3. **App bridge (JS/native module).** `services/widgets/`:
   - `writeWidgetSnapshot()` — call after unlock and on task changes; serialises
     `buildWidgetSnapshot(...)` to the shared container (native module: App Group file /
     EncryptedSharedPreferences) and calls `WidgetCenter.reloadAllTimelines()` /
     `AppWidgetManager.updateAppWidget`.
   - `drainWidgetActions()` — on foreground, read + clear `actions.json`, apply via the
     existing store (`toggleTask`, `createTask`), then rewrite the snapshot.
4. **EAS config** — App Group entitlement (iOS/macOS), widget target in `app.json`
   plugins, provisioning. Validate with a development build.

## Suggested next steps
- Add `services/widgets/snapshotWriter.ts` (pure serialise + a thin native-store
  interface) so the JS side is testable before the native module lands.
- Then scaffold the iOS target behind a config plugin and iterate on a dev build.
