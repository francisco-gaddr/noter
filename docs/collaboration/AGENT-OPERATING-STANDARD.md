# Agent operating standard

**Portable. This document names no project, product, company or brand, and it
contains nothing specific to the repository it is sitting in.** That is
deliberate: it is copied verbatim between repositories, and anything
repository-specific belongs in `AGENTS.md` or a skill instead.

Version 1.1, 2026-07-27. Sources at the end.

Changes in 1.1: budgets and priority added as section 9 (task types, levels,
ceilings, exits, and the order two colliding tasks are decided in), plus three
ways a green result lies in section 6.4. Both come from measured failures in a
repository running about twenty agents in one shared tree.

---

## 0. What this is for

Several agents, and the people steering them, change a repository over time,
sometimes at the same time. Left to themselves they lose each other's work,
build the same thing twice, and argue with a red test suite that was never about
the code.

This standard is the smallest set of roles, artifacts and rules that stops that.
It is small on purpose. Every rule here was paid for by a specific failure, and
a rule with no failure behind it is ceremony.

**The measured stakes.** Agents achieve roughly **50% lower success rates when
collaborating than when working solo**, and the bottleneck is not coding ability:
it is communicating, keeping commitments, and maintaining an accurate model of
what a partner is doing. Separately, a repository-root instruction file improves
agent task success by around **4%** and reduces agent-generated bugs by
**35 to 55%**. The gap between those two numbers is the whole argument for
writing coordination down.

---

## 1. Roles

Three roles. An agent holds exactly one at a time and says which.

### 1.1 Orchestrator

**There is always exactly one.** The orchestrator owns the outcome of the current
body of work: what gets done, in what order, and whether it is finished.

Responsibilities:

- Decompose the work and decide what is parallelisable
- Assign or accept claims, and resolve collisions between them
- Decide merge order, and own the state of the trunk
- Decide when work is done, using the definition in §5
- Write the handoff, and keep the noticeboard true
- Escalate to a human on anything in §2 that is a human decision

The orchestrator is not the most capable agent, nor the one that writes the most
code. It is the one holding the thread. In the orchestrator-worker pattern the
coordinator commonly uses a stronger model and workers cheaper task-specific
ones, which cuts cost substantially; that is an optimisation, not a requirement.

**Being alone makes you the orchestrator.** A single agent in a repository holds
the role by default and should say so in the noticeboard. The role is not
optional and not ceremonial: it exists so that when a second agent arrives there
is somebody to coordinate with.

### 1.2 Contributor

Executes a claimed slice. Owns correctness inside that slice, its tests, and its
documentation. Reports facts to the orchestrator, not conclusions: measured
numbers and commands, not "should be fine".

A contributor **may refuse** an assignment that would break something in §2 or
§6, and must say why rather than doing it badly.

### 1.3 Acting orchestrator, a temporary co-ownership

Any contributor may take the orchestrator role temporarily when it is vacant or
failing. This is not a coup; it is how the system stays alive when a session ends
without a handoff.

Take it when **any** of these is true:

- The noticeboard shows no orchestrator
- The orchestrator's claim is stale: no commit against it for a working session,
  and the trunk has moved
- You have discovered something that invalidates the current plan, and nobody is
  positioned to re-plan
- Work has stalled on a decision nobody owns

How to take it:

1. Write it on the noticeboard, with **why**, in its own commit
2. Do not silently reverse the previous orchestrator's decisions. Read them, and
   if you reverse one, say so and say why
3. Hold it until the work reaches a pause point, then either hand it back
   explicitly or hand it forward in the handoff

**Two agents both believing they are the orchestrator is worse than none.** The
noticeboard is the single source of truth: whoever's claim is committed and
pushed first holds the role, and the other becomes a contributor without
argument. This is a first-writer-wins rule precisely because negotiation between
agents is the thing that does not work.

### 1.4 What stays with the human

Agents execute; humans steer and own. The delegate-review-own split the industry
has converged on:

| Decision | Owner |
|---|---|
| What to build, and whether it is worth building | Human |
| Architecture, and any trade-off with a real cost | Human decides, agent proposes and argues |
| Implementation, tests, documentation | Agent |
| Whether a change is safe to land | Agent proposes with evidence, the gate decides, human owns the outcome |
| Anything moving money, touching personal data at scale, or changing a legal position | Human, always |
| Anything irreversible | Human, always |

An agent that cannot reach a human in time does **the reversible thing**, states
the assumption plainly, and writes the open question into the handoff. It does
not stall, and it does not quietly choose the irreversible option.

---

## 2. Choosing a topology

Do not default to a swarm because there are several agents available. Pick from
the work, using two axes: **coupling** of the files involved, and **priority**.

| Shape | Use when | Cost |
|---|---|---|
| **Solo** | One coherent change, coupled files, or anything in the human-owns list | No coordination overhead. Slowest wall clock. |
| **Orchestrator plus workers** | Decomposable work with a clear seam, 2 to 4 agents | One coordination hop. The default for anything non-trivial. |
| **Pipeline** | Stages that genuinely must be sequential: design, then build, then verify | Simple, but the slowest stage sets the pace |
| **Hierarchical** | Large enough that one orchestrator cannot hold it, so sub-orchestrators own areas | Only worth it past roughly 5 agents |
| **Swarm or mesh, no coordinator** | Rarely. Exploration where duplicated effort is acceptable | Duplicated work is the normal outcome, not the exception |

**How many agents.** Loosely coupled modules tolerate five or more. A tightly
coupled codebase tops out at two or three, because beyond that merges cost more
than the parallelism saves. **Most repositories are mixed, so count the seams,
not the agents.**

**The test.** If two slices can each be claimed without either naming a file the
other names, they are parallel. If they cannot, they are sequential, whatever the
plan says.

---

## 3. The artifacts

Three files. Agents cannot message each other, so the repository is the channel,
and a channel that is not a committed file does not exist.

| File | Changes | Answers |
|---|---|---|
| **Noticeboard** | Constantly | Who holds which paths, right now, and who is orchestrating |
| **Handoff** | Per pause point | What state things are in, what remains, and the next command for each |
| **This standard plus the repository's `AGENTS.md`** | Rarely | How we work, and what is true about this codebase |

Suggested locations, and any repository may choose others as long as
`AGENTS.md` points at them:

```
docs/collaboration/IN-FLIGHT.md        the noticeboard
docs/agents/HANDOFF.md                 the handoff
docs/collaboration/                    this standard, and the protocol
```

### 3.1 The noticeboard

Read it before your first edit. Write to it before your first edit. Delete your
block when you stop.

```markdown
### <branch, worktree, or session name>
- **Role:** orchestrator | contributor | acting orchestrator (why)
- **Started:** YYYY-MM-DD
- **Goal:** one line, what changes when this is done
- **Holding:** `path/one.ts`, `path/two/`
- **Also touching:** `serialised/file.json`
- **Status:** in progress | blocked on X | ready to merge
```

**Claim paths, not features.** "I am doing the settings page" tells nobody that
the root layout is unsafe. Four statuses, because a shared board needs exactly
those four; done means the block is deleted.

**A stale claim is worse than no claim**, because the next agent works around a
file nobody holds. If a block looks abandoned, check the commits against it and
delete it.

### 3.2 Serialised paths

Every repository has files that every change touches. They cannot be claimed for
long, only passed through quickly. Each repository lists its own in the
noticeboard; the shapes are always the same:

- The route or module registry that every new feature appends to
- Translation or content catalogues
- Lockfiles, and shared tool configuration
- Database migration directories, where **one at a time is absolute**, because
  two agents generating migrations produce a history that replays wrong
- The application shell or root layout
- Anything under a money or auth boundary

### 3.3 The handoff

Written for a reader with none of your conversation. §5 is the checklist.

---

## 4. Working rules

### 4.1 Isolation beats coordination

Get your own worktree, port, and database, and the seams are the only thing left
to coordinate.

```bash
git worktree add <dir>/<name> -b <branch>
```

Gates that walk the filesystem must skip nested worktree directories, or they
report another agent's files as yours.

### 4.2 Three commands before you plan

```bash
git fetch origin && git log --oneline HEAD..origin/<trunk>   # what landed
<the noticeboard>                                            # who is here
git status --short                                           # is this tree clean
```

The middle one is the one people skip and it is the expensive one. **A branch
goes stale in hours, not days.** Two agents solving the same problem
independently is the commonest waste in this model, and it is invisible until
merge time.

### 4.3 In a shared tree

1. **Re-read before you edit.** A "file changed since you read it" signal is real.
2. **Verify your edit landed.** After touching a shared file, grep for what you
   added. This is the only step that catches a silent lost write.
3. **Commit small and often.** An uncommitted edit in a shared tree has no
   protection at all.
4. **Never stash to test a baseline.** It takes the other agent's uncommitted
   work with it.
5. **Never run a destructive git command in a tree you do not own.**
6. **Stage explicit paths** when somebody else has uncommitted work in the tree.
7. **Attribute a red gate before fixing it.** It may be their in-flight edit.

### 4.4 Before merging anything

The instinct to merge every branch so that no code is lost is wrong, and it
deletes code.

| Finding | Action |
|---|---|
| Content already on the trunk | Do not merge. Record as superseded. |
| Already on the trunk, applied **better** | Do not merge. Merging regresses. |
| Predates a structural move, or the tip is a revert | Do not merge. Dead tree, or deleted code. |
| Genuinely unmerged, reviewed, gate green | Merge, and say what you reviewed. |

Merge **sequentially**, then rebase the rest onto the updated trunk, so each
later merge has the context of the earlier ones.

When a hunk conflicts, resolve in favour of whoever did the work properly, **even
when that means deleting your own**, and say what you dropped.

**A conflict can hide a fix.** Before keeping your side, read the commit that
produced the other side. A deliberate removal looks exactly like a missing
feature.

**Nothing is lost by not merging.** A branch is permanent storage. Keep an
inventory with a verdict per branch, and derive the facts from a script rather
than typing them.

---

## 5. Definition of done

A pause point is a state somebody else can resume from without asking a question.

- [ ] Gates green, or a red one explained with which test and why
- [ ] Nothing uncommitted, nothing stashed, no claim of yours on the noticeboard
- [ ] Merged to trunk and pushed, or exactly what is parked and where
- [ ] Proven live, not merely built. A green build is not a deploy and a green
      dashboard is not a served page. Probe a string only the new commit
      produces, and prefer a server-rendered one
- [ ] Status written with **measured** numbers, and the command next to each
- [ ] What remains, ordered, each with its next command and its own done
- [ ] Every workaround and dead end recorded
- [ ] Anything that generalises, folded into a gate, this standard, or a skill

**Numbers, not adjectives.** Every hand-typed count goes stale, usually within
hours, and each stale number sends somebody down a wrong plan. Prefer a script
that derives the number from the thing it describes, and commit the script.

---

## 6. Trustworthy verification

A red suite is worth nothing if it cannot distinguish broken code from a busy
machine.

### 6.1 The host is a shared resource

Agents share a host, and the host runs out before the repository does. Other
agents, other editors, and background builds all count.

**Triage rule, before you debug anything:**

```
failure text says "timed out"   -> suspect the host. Re-run that file alone.
failure text is an assertion    -> a real failure, whatever the load.
```

Measure before you conclude:

```bash
uptime                          # load average against core count
ps -Ao %cpu,comm -r | head      # what is actually consuming the machine
```

Above roughly **1.2x** load per core, a run is slow but honest. Above roughly
**3x**, a failing result is not evidence of anything. A preflight that measures
this and sizes workers accordingly is a small script and belongs in every
repository.

**Do not raise a timeout to make a flaky test pass.** That makes the race less
visible, not less real. Reduce worker count instead: too many workers on a loaded
machine increases contention and makes execution slower.

### 6.2 Quarantine, do not delete

A test that fails non-deterministically and blocks others should be quarantined:
it still runs, its result is still recorded, but it leaves the required set until
it is understood. Tag it with the suspected cause. Re-qualify by running it
many times consecutively before returning it.

Deleting a flaky test removes the signal along with the noise.

### 6.3 The gate the trunk actually runs

A check that only exists in a local convenience script is not a gate. Put it in
whatever the deployment pipeline runs, and verify it is there by reading that
file rather than assuming.

---

### 6.4 Three ways a green result lies

A green result is necessary and not sufficient. Three failures were measured,
and each one looked like success:

1. **The test measured the wrong mechanism.** A test required a client with the
   wrong certificate to be rejected. It passed, but the host never accepted the
   connection, so no certificate was ever sent and the client timed out instead.
   It showed up only on the CLOCK: thirty seconds for three tests that should
   take fractions. For every test that requires a failure, assert the mechanism,
   not just that it failed, and read the durations once per new test file.
2. **The gate only saw the default build.** A dependency-licence gate read the
   dependency graph without optional features, so an entire optional subtree was
   never checked and a documented exception was never exercised. Anything that
   can be switched on belongs in a LIST the gate iterates over, not in the
   gate's code.
3. **The result was measured on a different tree than the one pushed.** A check
   measures a commit, not "now". Cite the commit id with the result, and after a
   cherry-pick or rebase run the check once more on what was actually pushed.
   The trunk moved five commits during one such run, and the red result had
   already been fixed by someone else.

A rescued or cherry-picked commit goes through the same gate as a written one.
Rescue without a gate moves the failure from a branch nobody saw to the trunk
everybody sees; that happened, and the trunk was red for every other agent for
hours.

---

## 7. Learning, so the next agent starts ahead

The point is that the repository gets **smarter** each session, not merely
larger.

| What you learned | Where it goes |
|---|---|
| Something deterministic that can be checked | **A gate.** A script or a test. |
| A rule that caused a bug and applies to any task | The root instruction file |
| Deep procedure for one kind of task | A skill |
| Reasoning, measurements, sources | A document a skill links to |
| What is open right now | The handoff |
| Something true of **every** repository | This standard, then propagate it |

**If you are about to write "always remember to", ask whether a gate can check
it.** Rules that survive are the ones with a gate.

### 7.1 Propagation between repositories

A lesson learned in one repository is worth the same in the others, and the cost
of moving it is a file copy.

- This standard is **identical** in every repository that adopts it. Improve it
  where you find the lesson, then propagate; do not fork it locally.
- Bump the version line and record what changed.
- A skill that is genuinely general belongs alongside it. A skill that names a
  framework, a vendor or a domain does not.
- **Propagation carries the routine, never the content.** Never copy another
  repository's names, products, customers, credentials, or architecture into a
  shared artifact. If a lesson cannot be stated without naming its source, it is
  not yet general enough to share; abstract it until it can.

---

## 8. Budgets and priority

A task with no budget takes the whole pass, and a pass with no priority order
spends it on the least urgent thing. Both were measured; both are cheap to fix.

### 8.1 Three questions before the first change

Answer in one line, then measure the outcome:

1. **What type is this task?** (8.2)
2. **What level is it?** (8.3)
3. **What is the budget, and what happens when it runs out?** (8.4)

Example: `type: slice, level 2, budget 25% of the pass, ceiling 400 lines of
code plus 60 lines of docs, hand over if the ceiling is reached`.

The estimate is a hypothesis, not a promise. The same task can cost thirty times
more in one run than in another, and human-rated difficulty tracks real cost
only weakly. So write the estimate, write the outcome, and let the difference
correct the next estimate. Models are demonstrably able to estimate their own
difficulty tier and allocate near-linearly across tiers, which is why the
estimate belongs to the agent and the frame belongs to the human.

### 8.2 Task types, mandate and share of the pass

| Type | What it is | Share | Mandate |
|---|---|---|---|
| Fix | one fault, one file, one test | 5 to 10% | that file and its test only |
| Slice | one capability with tests and docs | 20 to 40% | own module and tests; one line in shared lists |
| Investigation | measure, compare, decide | 10 to 20% | reads widely, writes ONE document, changes no code |
| Closing | pause point, handover, registers | 10 to 15% | status artifacts only, never new capability |
| Orchestration | split, assign, weigh | at most 5% | delegates; does not write the work itself |

A fix that starts touching architecture is no longer a fix. Change the type
openly and take the heavier rules with it.

### 8.3 Levels

| Level | Scope | Code ceiling | Docs ceiling |
|---|---|---|---|
| 1 | one file plus its test | 150 lines | one index line |
| 2 | two to four files, one module | 400 lines | one section |
| 3 | five files or more, cross-cutting | 900 lines | one document plus index line |

Level 3 is reserved, not the default: try it as a chain of level 2 first.
Ceilings are ceilings, not targets; a 40-line change that solves the problem
beats a 400-line one that also solves it.

### 8.4 When the budget runs out

Three exits, and only three:

1. **Done inside budget** ⇒ ship through the normal gate.
2. **Almost done** ⇒ no extension. Cut it: ship the part that is whole and
   measured, write the rest as a handoff entry.
3. **Stuck** ⇒ after TWO failed repair attempts, restart with fresh context
   instead of spending a third on the old one. This is a cost rule as much as a
   quality rule: ten correction cycles carrying full history can burn fifty
   times a single linear pass.

Never an exit: half-finished code left in the working copy. That is the single
most common reason the next agent ships something broken.

### 8.5 Model class per role

| Role | Model class | Notes |
|---|---|---|
| Orchestrator | strongest | splits and weighs; does not build |
| Contributor | strong enough for the level | builds inside its claimed paths |
| Reviewer | strong, FRESH context | gets the artifact and the acceptance list, never the work history |
| Sweeper | cheap | searches, lists, summarises; does not decide or commit |

The hierarchy is measured, not ideology: a frontier model as lead with cheaper
workers reached 97.7% of full accuracy at about 61% of the cost.

### 8.6 What weighs most when two tasks collide

In order:

1. **Red becomes green.** A red trunk blocks every other agent, so a repair
   outranks any new capability.
2. **Lost work is rescued.** Uncommitted work and branches outside the trunk go
   before anything new: what is not committed can vanish in the next clean.
3. **A started slice is finished.** Half-finished costs double.
4. **What the human asked for.** The request beats the agent's own idea.
5. **What makes the next pass cheaper.** Gates, registers, tests.
6. **New capability.**

Getting 1 wrong is the only priority error that makes every other agent slower.

---

## 9. The short version

```
role      say which one you hold, on the noticeboard, before you edit
topology  count the seams, not the agents
claim     paths, not features. First writer wins. Stale claims get deleted.
plan      fetch and diff the trunk first, every time
edit      re-read before, grep after, commit small
merge     verify it is not already on the trunk, better, before merging
verify    timeout means the host, assertion means the code. Measure, do not guess.
finish    prove it live, write measured numbers, leave the next command
budget    say type, level and ceiling before you start; measure the outcome
priority  red before rescue, rescue before new, request before your own idea
learn     make it a gate, or it will be relearned
```

---

## Sources

- [Agentic Engineering Operating Model: Teams + Agents, Augment Code](https://www.augmentcode.com/guides/agentic-engineering-operating-model)
- [AgentsWay: Software Development Methodology for AI Agents-Based Teams, arXiv 2510.23664](https://arxiv.org/pdf/2510.23664)
- [Scaling Human-AI Coding Collaboration Requires a Governable Consensus Layer, arXiv 2604.17883](https://arxiv.org/pdf/2604.17883)
- [A Taxonomy of Hierarchical Multi-Agent Systems: Design Patterns, Coordination Mechanisms, arXiv 2508.12683](https://arxiv.org/pdf/2508.12683)
- [Orchestral AI: A Framework for Agent Orchestration, arXiv 2601.02577](https://arxiv.org/pdf/2601.02577)
- [Architectural Design Decisions in AI Agent Harnesses, arXiv 2604.18071](https://arxiv.org/pdf/2604.18071)
- [Multi-Agent Orchestration Patterns: Complete Guide 2026, Fast.io](https://fast.io/resources/multi-agent-orchestration-patterns/)
- [Choosing the right orchestration pattern for multi-agent systems, Kore.ai](https://www.kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems)
- [Agent Orchestration Patterns: Swarm vs Mesh vs Hierarchical, Gurusup](https://gurusup.com/blog/agent-orchestration-patterns)
- [Dynamic Role Assignment in Multi-Agent Systems, newline](https://www.newline.co/@zaoyang/dynamic-role-assignment-in-multi-agent-systems--2dbb43ef)
- [The Agent-Native Repo: Why AGENTS.md is the New Standard, Harness](https://www.harness.io/blog/the-agent-native-repo-why-agents-md-is-the-new-standard)
- [AGENTS.md Complete Guide for Engineering Teams (2026), BuildBetter](https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/)
- [Flaky Tests: Detection, Quarantine, Prevention (2026), Scrolltest](https://scrolltest.com/flaky-tests-detection-quarantine-prevention-guide-2026/)
- [Test Quarantine: Stop Flaky Tests From Blocking Merges, Mergify](https://mergify.com/learn/test-quarantine)
- [Parallel Test Execution Causing Flaky Tests, DeFlaky](https://deflaky.com/blog/parallel-test-execution-flaky)
- [Git Worktrees for AI Coding: Run Multiple Agents Without Conflicts, MindStudio](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)

Added in 1.1:

- Token cost of agentic coding tasks, including the thirty-fold spread on the
  same task and the weak link between rated difficulty and real cost:
  <https://arxiv.org/pdf/2604.22750>
- Self-estimated budget allocation across difficulty tiers:
  <https://arxiv.org/pdf/2505.11274>
- Token budgets, model routing and the lead-plus-workers cost result:
  <https://zylos.ai/research/2026-04-12-ai-agent-cost-optimization-token-budget-model-routing/>
