# ADR 0005 — Scheduled AI-agent tasks & orchestration

Status: Accepted · Date: 2026-06-14

## Context

Users want to delegate a task to the AI agent (instead of doing it themselves) and
have it run **at a specific time**, from both the mobile and Electron apps. The
agent must use the chosen model source (local / Hermes / API), be able to read and
create notes & tasks, plan short- and long-term, check tasks off, schedule
follow-up work for itself, avoid infinite loops, and **transparently show every
note/list/task/instruction it reads**. Everything must be storable fully locally
and always encrypted.

## Decision

### One shared, tested core; thin per-platform wrappers

- **`@repo/shared/agentTasks`** — the data contract + pure scheduling. A task gets a
  single `aiAgent: AiTaskDelegation` field (`assignee`, `source`, `provider`,
  `model`, `localOnly`, `toolUse`, `instructions`, `status`, `runCount`).
  `selectDueAiTasks(tasks, now, grace)` is a pure selector (ai-assigned, not
  completed/deleted/running/done, due within a grace window). Guards:
  `AGENT_MAX_STEPS`, `AGENT_MAX_RUNS_PER_TASK`.
- **`@repo/ai/agentRunner`** — `runAgentTask({system, goal, deps})` drives the
  plan → tool-call → observe loop with anti-loop (identical tool-call set repeated),
  `maxSteps`, abort, and an `onAccess` hook that surfaces every read. Fully
  dependency-injected (`invokeModel`, `executeTool`) and unit-tested with no
  network. **This is the brain both apps reuse.**

### Delegation stored locally, decoupled from sync

The delegation lives in a local **encrypted map keyed by task id**
(`agentDelegations` — Secure/AsyncStorage on mobile, localStorage on web), NOT as a
synced field. Rationale: it satisfies "local-only, always encrypted", and a sync
round-trip can never strip it. The scheduler merges the map onto the in-memory
tasks (`mergeDelegations`). A per-task **run log** records what the agent did/read.

### Scheduling: foreground-precise, background best-effort

Per Expo docs (June 2026) background execution is best-effort only
(`expo-background-task`, ~15 min+ windows, 30 s budget — not precise). So:

- **Foreground poll** (30 s, single-flight) runs due tasks precisely while the app
  is open. On Electron the renderer is effectively always-on, so this is reliable.
- **Background catch-up**: the existing mobile background-fetch also calls
  `runDueAgentTasks()` so tasks that came due while closed run on the next granted
  window / next open.
- A local notification at the due time (reminder) is the user-facing nudge.

### The agent's hands, memory and orchestration

- **Tools**: a store-backed executor (`agentExecutor`) exposes list/get/create/
  update notes, tasks, projects and task-lists + complete/delete — the same
  operations the chat uses, so an agent action behaves like a user action (and
  broadcasts the same realtime socket events).
- **Memory / instructions / rules / personality**: notes inside a project named
  **"AI-agent"** are injected into the agent's system prompt. The user edits these
  notes to steer the agent — this IS the admin-orchestration surface, editable from
  either app like any note. Sub-notes act as memory the agent can also read/write
  via tools.
- **Self-scheduling**: the agent calls `create_task` with a future `dueDate`; the
  user (or a rule) delegates it, and the scheduler picks it up later — "give myself
  a task in 5 min / next week" composes for free.
- **Transparency**: `onAccess` records each read; the run log is shown in the task
  editor's "Delegera till AI" section (mobile + web) as a plain list.

### Model source

`source` selects local / Hermes / API; `provider`+`model` pick the exact model.
Keys/base-URLs are read from the same encrypted per-provider settings the chat
uses. `localOnly` keeps the task/result off the sync path. (Local on-device
inference is tracked separately — see the local-models work.)

## Consequences

- The hard, reusable part (data model + scheduler + runner) is one tested core;
  each app supplies only `invokeModel` + `executeTool` + UI.
- Precise execution requires the app open (mobile) / running (Electron). Truly
  unattended precise mobile execution is an OS limitation, mitigated by background
  catch-up + notifications.
- Cross-device delegation is per-device today (local map). A future option is to
  add an encrypted `aiAgent` column to the synced task if cross-device hand-off is
  wanted — the shared model already supports it.

## Tested

`agentTasks.test.ts` (parsing + scheduling windows), `agentRunner.test.ts`
(loop/maxSteps/abort/error + access surfacing). Platform wiring is typechecked and
exercised via the existing AISidebar/TaskDetailModal test suites.
