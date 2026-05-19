# Polish Pass — Mobile

[← Index](./index.md)

## 1. Haptics selectionAsync on list taps

**Files:** `components/NoteItem.tsx`, `components/TaskItem.tsx`,
`components/ProjectSelector.tsx`, `components/NoteTree.tsx`

Added `Haptics.selectionAsync()` to the `onPress` of every list row so
selecting an item gives a subtle tactile cue. Swapped the existing
`impactAsync(Light)` on `DraggableFlatList.onDragBegin` to `selectionAsync()` —
selectionAsync is purpose-built for "I'm selecting between things" feedback
and is lighter on battery than impact.

Drag-engage (`onLongPress`) keeps `impactAsync(Medium)` because that's a
heavier, intentional gesture that benefits from a stronger cue.

## 2. KV abstraction with MMKV-ready adapter

**Files:** `services/storage/kv.ts`, `services/storage/index.ts`,
`app/_layout.tsx` (bootstrap call)

`kv` exports five methods (`getString`, `setString`, `delete`, `getAllKeys`,
`getStringSync`) and resolves to an AsyncStorage adapter today. The
`buildMmkvAdapter()` factory tries `require('react-native-mmkv')` at runtime,
silently returns `null` if the dep isn't installed, and only activates
when `USE_MMKV_WHEN_AVAILABLE` is flipped.

`runKvMigrationIfNeeded()` runs as the first step of the app bootstrap.
Today it's a no-op (AsyncStorage IS the store). When MMKV is later activated:

1. Reads all keys from AsyncStorage in batches of 32.
2. For each batch: `await new Promise(r => setTimeout(r, 0))` to yield to
   the event loop. This is the "runOnUI worklet" intent — the JS thread
   stays responsive during cold-start migration.
3. Writes a sentinel (`__noter_kv_migration_v1__`) once done so subsequent
   boots no-op.

**Activation:** `npx expo install react-native-mmkv` then flip
`USE_MMKV_WHEN_AVAILABLE = true` in `kv.ts`.

## 3. Explicit `enableScreens(true)`

**File:** `app/_layout.tsx`

`react-native-screens` is on v4.16.0 where `enableScreens()` is the default,
but we call it explicitly at the top of the entrypoint so a future React
Navigation upgrade can never silently disable native screen primitives.
Idempotent on hot-reload.

## 4. useReduceMotion hook

**File:** `hooks/useReduceMotion.ts`

Subscribes to `AccessibilityInfo.isReduceMotionEnabled()` and emits the
current state. Initial value is `false` (conservative — animate by default,
but listen for the pref so we flip to reduced once we know).

Used by `NoteItem` to gate the FadeIn animation. New animations elsewhere
should adopt this hook on the same principle.

## 5. Reanimated FadeIn on NoteItem mount

**File:** `components/NoteItem.tsx`

`Animated.View` wraps the existing `TouchableOpacity` with
`entering={FadeIn.duration(140)}`. FlashList recycles components, so the
animation fires when fresh tiles scroll into view — which is exactly what
we want. When `useReduceMotion` returns `true`, `entering` is `undefined`
and no animation runs.

We deliberately didn't add `itemLayoutAnimation` to FlashList v2.0.2 because
that prop isn't on its public TypeScript surface. Once Shopify ships full
reanimated v4 integration we can revisit.

## Not done (and why)

- **MMKV full adoption** — adopted today as scaffolding only. Native rebuild
  and EAS dev-client refresh required to install the dep.
- **expo-image** — no `<Image>` components in the codebase to migrate.
  Adopt when image-attachment features land.
- **expo-document-picker** — no document picking flow exists today; only
  `expo-image-picker` is used.
- **Sentry profiling** — `@sentry/react-native` isn't installed.

## Verification

See [testing.md → mobile](./testing.md#mobile).
