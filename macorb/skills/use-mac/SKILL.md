---
name: use-mac
description: >
  Acquire a real macOS machine with Xcode and Simulator and run the user's work
  there. Use when the task needs macOS, Xcode, iOS Simulator, code signing,
  .xcworkspace/.xcodeproj, SwiftUI previews on device, or the user asks to
  build/test/run something on a Mac.
builtin-tools:
  - macorb_acquire
  - macorb_status
  - macorb_stop
---

# Use a Mac

MacOrb provisions a Namespace Mac and registers an Amp runner on it. **You do not create the runner thread from a plugin tool.** Amp rejects that:

```text
Plugin agent threads spawned from tools cannot use an Orb or runner executor
because recursive tool exclusion is not supported there
```

## Required sequence

1. Call `macorb_acquire` with the repository the Mac should clone (`github.com/owner/name`), or omit it for a blank project directory. Do not retry a non-retryable failure.
2. The tool returns `runnerId`, `sessionId`, `registeredAt`, `ttlDeadline`, and `nextAction`. Readiness is the `registeredAt` timestamp, never elapsed time.
3. Use Amp's **first-party** Agent-to-Agent / thread-creation tool to start a **child thread on that exact runner id**. Pass this thread as the parent. Preserve the user's requested mode. Ask the child to report its result back here when it finishes.
4. Do not call `macorb_acquire` again for the same work. `macorb_status` if you need state; `macorb_stop` only when the user is done.

## What the Mac child must return

- The outcome (pass/fail) and the commands it ran.
- For UI work: one representative Simulator screenshot, inspected in-thread.
- `.xcresult`, archives, recordings and large logs stay on the Mac or in artifact storage — do not dump them into this thread.
- The child thread URL so the user can watch and steer it from ampcode.com, iOS, or macOS.

Do not promise Amp Portals or Multiplayer on a runner thread; Amp documents neither for runners.

## Failures

If `macorb_acquire` returns `ok: false`, tell the user the `code` and `message`. If `retryable` is false, do not retry. Common codes:

- `UNAUTHENTICATED` — they need `macorb login` (or `MACORB_TOKEN`).
- `AMP_KEY_NOT_SET` — they need to store an Amp API key (`PUT /me/amp-key` or the CLI).
- `GITHUB_TOKEN_NOT_SET` — they named a repository but have no GitHub token on file.
- `CAPACITY_REACHED` — they already hold a live Mac on a different project.

The command **MacOrb: Run on the Mac** is the escape hatch if this composition fails. Do not invent a third dispatch path.
