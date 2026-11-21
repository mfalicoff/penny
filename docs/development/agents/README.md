# Agent pipeline

Claude Code works through Linear issues on its own, in bundles that each ship as one pull request:

```
Linear Todo + agent-ready
  → orchestrator (a long-lived session on worker, woken hourly and after every merge)
  → a bundle of up to 5 issues per platform, one member dev session per issue, in parallel on fearful (Mac) or worker and fear (Linux)
  → each member pushes its branch; one integrator session merges them into bundle/<id>
  → one pull request for the bundle
  → Claude review workflow (sets the claude-review status)
  → dev session fixes review comments and CI failures
  → dev session squash-merges once every check is green
  → Linear moves the issue to Done; the dev session wakes the orchestrator
```

| Part | Where it lives |
| --- | --- |
| Orchestrator | A long-lived Claude Code session named "Penny orchestrator" on worker (Linux), woken by a scheduled task bound to it. See [orchestrator.md](orchestrator.md). |
| Dev worker | A Claude Code session on a bridge machine, following [dev-worker.md](dev-worker.md) |
| Reviewer | [`.github/workflows/claude-review.yml`](../../../.github/workflows/claude-review.yml), following [reviewer.md](reviewer.md) |

## Using it

1. Write the issue in the **MAZ** team, in the **Penny** or **Penny Cloud** project.
2. Add the **Platform** labels it touches: `ios`, `web`, `backend` or `infra`. If you leave them off, the orchestrator guesses and adds them.
3. Move it to **Todo** and add **`agent-ready`**.

The orchestrator only picks up Todo issues labelled `agent-ready`. It skips issues labelled `needs-human` and issues blocked by an issue that is still open. It finishes the Penny project before starting Penny Cloud. Within a project it goes by priority, then by the oldest issue first.

## Routing

| Worker | Machine | Runs |
| --- | --- | --- |
| `worker:fearful` | fearful, the Mac | any issue labelled `ios`, including mixed iOS + backend issues |
| `worker:worker` | worker, Linux | everything else |
| `worker:fear` | fear, a larger Linux desktop, not always online | everything else, alongside worker; the heavier issue when both are free |

Each machine runs one issue at a time. A machine is busy while an issue carrying its `worker:*` label is In Progress or In Review. iOS work is never sent to Linux: it waits until the Mac is free and online. When fear is offline, starting its session fails, the orchestrator puts the issue back in Todo, and worker takes it. Worker and fear never work at the same time on issues that change the same screens or shared contract files.

## Bundles

Each platform pool (iOS on fearful; web, backend and infra on worker and fear) has at most one bundle open at a time: up to 5 issues that don't clash (not the same screens or feature folder, at most one touching shared contracts). Member sessions work their issues in parallel and push branches without pull requests. When every member is ready or handed over, the orchestrator starts an integrator session that merges the branches into `bundle/<id>`, runs the checks, opens one pull request with a `Fixes` line per issue, handles the review and merges it. A member that can't be integrated is handed over on its own; the rest still ship.

Several sessions can run on one machine at once: fearful 2, worker 2, fear 3. Each session gets its own web test ports and test API, and its own iOS simulators, so they don't get in each other's way.

## Follow-ups

A dev worker does related work in its own pull request instead of leaving it for later. It posts a `Follow-up:` comment on its issue ([format](dev-worker.md#follow-ups)) only for what it can't do there: a design decision, another platform, a backend or contract change the issue doesn't cover, or work much bigger than the issue. On its next run the orchestrator handles each new follow-up in one of three ways:

- **Adds it to an existing issue** that covers the same area, and comments on that issue with the extra context. This is the first choice.
- **Creates an issue** only when no open issue fits: in the same project, in **Backlog**, with the Platform labels, linked to the original issue as related. The new issue is never labelled `agent-ready`: you review it, then move it to Todo and add the label yourself.
- **Skips it** if it isn't worth tracking, and replies with the reason.

Either way the orchestrator replies under the follow-up (`Orchestrator: …`), so each follow-up is handled once.

## Design cards

On a screen with a redesign card, the goal is parity: the card's verdict is `matches`. Agents never approve a deviation from a card. A dev worker that can't close a difference posts a `Design decision:` follow-up, and the orchestrator files it with the `needs-design-decision` label, never `agent-ready`. You decide: change the card, approve the deviation (apply `design-approved` to the issue and record it in [redesign.md](../../reference/redesign.md#approved-deviations-maz-122)), or ask for the fix. The reviewer requests changes on any pull request that approves its own deviation ([dev-worker.md](dev-worker.md#design-cards)).

New screens are designed before they're built. A dev worker never invents a screen that no card covers. It hands the issue over instead ([dev-worker.md](dev-worker.md#screens-with-no-card)). For a planned feature, file a `Design cards:` issue first and mark the feature blocked by it. An agent drafts the cards, and you review them in the pull request before they become the target.

## When it stops

The pipeline adds `needs-human`, comments on the issue and stops when:

- the reviewer requests changes three times;
- CI keeps failing after three attempts to fix it;
- the change needs a human-only path (see [dev-worker.md](dev-worker.md#human-only-changes));
- the dev session ends without a merged pull request.

To retry, fix whatever stopped it, remove `needs-human` and the `worker:*` label, and move the issue back to Todo.

## Setup it needs

- The `CLAUDE_CODE_OAUTH_TOKEN` repository secret for the review workflow. Create it with `claude setup-token`, then run `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.
- The GitHub `agent` label, which the dev worker puts on its pull requests. Only pull requests with this label are reviewed.
- The bridge machines online, with Remote Control running in their `penny` checkouts (fear may be offline; the orchestrator works around it). The orchestrator runs on worker, so nothing new is assigned while worker is offline.
