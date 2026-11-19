# Agent pipeline

Claude Code works through Linear issues on its own, one issue per machine at a time:

```
Linear Todo + agent-ready
  → orchestrator (a long-lived session on worker, woken hourly and after every merge)
  → dev session on fearful (Mac) or worker (Linux)
  → pull request
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

Each machine runs one issue at a time. A machine is busy while an issue carrying its `worker:*` label is In Progress or In Review. iOS work is never sent to Linux: it waits until the Mac is free and online.

## Follow-ups

When a dev worker leaves something out of scope, it posts a `Follow-up:` comment on its issue ([format](dev-worker.md#follow-ups)). On its next run the orchestrator handles each new follow-up in one of three ways:

- **Creates an issue** in the same project, in **Backlog**, with the Platform labels, linked to the original issue as related. The new issue is never labelled `agent-ready`: you review it, then move it to Todo and add the label yourself.
- **Links an existing issue** if one already covers it, and comments on that issue with the extra context.
- **Skips it** if it isn't worth tracking, and replies with the reason.

Either way the orchestrator replies under the follow-up (`Orchestrator: …`), so each follow-up is handled once.

## Design cards

On a screen with a redesign card, the goal is parity: the card's verdict is `matches`. Agents never approve a deviation from a card. A dev worker that can't close a difference posts a `Design decision:` follow-up, and the orchestrator files it with the `needs-design-decision` label, never `agent-ready`. You decide: change the card, approve the deviation (apply `design-approved` to the issue and record it in [redesign.md](../../reference/redesign.md#approved-deviations-maz-122)), or ask for the fix. The reviewer requests changes on any pull request that approves its own deviation ([dev-worker.md](dev-worker.md#design-cards)).

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
- Both bridge machines online, with Remote Control running in their `penny` checkouts. The orchestrator runs on worker, so nothing new is assigned while worker is offline.
