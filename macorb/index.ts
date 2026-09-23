import type { PluginAPI } from "@ampcode/plugin";
import {
  createClient,
  resolveOrigin,
  resolveToken,
  waitUntilRunning,
  type ApiFailure,
  type CreateSessionResult,
  type MacorbClient,
  type SessionView,
} from "./client.ts";

export const description =
  "Give Amp a Mac: acquire a Namespace macOS runner with Xcode and Simulator.";

const BOOT_BUDGET_MS = 300_000;

export default async function (amp: PluginAPI) {
  const origin = resolveOrigin();

  amp.registerTool({
    name: "macorb_acquire",
    title: "Starting Mac",
    transcriptGroup: { active: "Starting Mac", complete: "Started Mac" },
    description:
      "Create or reuse a MacOrb macOS session and wait until its Amp runner is " +
      "positively registered. Returns runnerId for Amp's first-party thread tool. " +
      "Do NOT create a runner thread from this tool — Amp forbids that. After this " +
      "returns, use Amp's Agent-to-Agent / thread-creation tool with the runnerId.",
    inputSchema: {
      type: "object",
      properties: {
        repository: {
          type: "string",
          description:
            "GitHub repository to clone, as host/owner/name (e.g. github.com/acme/ios-app). " +
            "Omit for a blank project directory.",
        },
        projectDir: {
          type: "string",
          description: "Absolute project directory override on the Mac.",
        },
      },
    },
    async execute(input) {
      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) return client;

      const body: { repository?: string; projectDir?: string } = {};
      if (typeof input.repository === "string" && input.repository.trim() !== "") {
        body.repository = input.repository.trim();
      }
      if (typeof input.projectDir === "string" && input.projectDir.trim() !== "") {
        body.projectDir = input.projectDir.trim();
      }
      // Compute has no default checkout. A session with neither field is
      // refused 400; a blank Mac still needs a project directory for the
      // runner to bind to.
      if (!body.repository && !body.projectDir) {
        body.projectDir = "/Users/runner/workspaces/macorb";
      }

      const created = await client.createSession(body);
      if (!created.ok) return fail(created);

      const sessionId = created.body.sessionId;
      const waited = await waitUntilRunning(client, sessionId, {
        deadlineMs: Date.now() + BOOT_BUDGET_MS,
      });
      if (!waited.ok) return fail(waited);

      return readyPayload(created.body, waited.body);
    },
  });

  amp.registerTool({
    name: "macorb_status",
    title: "Mac status",
    transcriptGroup: { active: "Checking Mac", complete: "Checked Mac" },
    description:
      "Report the caller's live MacOrb session: provisioning/running state, runner " +
      "id and registration time, hard TTL, and measured minutes. Never infers ready from time.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) return client;

      const listed = await client.listSessions();
      if (!listed.ok) return fail(listed);
      const live = listed.body.sessions.find((session) =>
        ["provisioning", "running", "idle", "destroying"].includes(session.state),
      );
      const usage = await client.minutes();
      return JSON.stringify(
        {
          ok: true,
          origin: client.origin,
          live: live ?? null,
          measuredMinutes: usage.ok ? usage.body.measuredMinutes : null,
          nextAction: live
            ? live.state === "running" && live.runner?.registeredAt
              ? `Use Amp's first-party thread tool with runner id ${live.runner.runnerId}.`
              : "Wait; the Mac is not positively ready yet."
            : "No live Mac. Call macorb_acquire.",
        },
        null,
        2,
      );
    },
  });

  amp.registerTool({
    name: "macorb_stop",
    title: "Stopping Mac",
    transcriptGroup: { active: "Stopping Mac", complete: "Stopped Mac" },
    description:
      "Expire the caller's live MacOrb session. Idempotent: a second call is a no-op.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session to stop. Defaults to the current live session.",
        },
      },
    },
    async execute(input) {
      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) return client;

      let sessionId =
        typeof input.sessionId === "string" && input.sessionId.trim() !== ""
          ? input.sessionId.trim()
          : "";
      if (sessionId === "") {
        const listed = await client.listSessions();
        if (!listed.ok) return fail(listed);
        const live = listed.body.sessions.find((session) =>
          ["provisioning", "running", "idle", "destroying"].includes(session.state),
        );
        if (!live) {
          return JSON.stringify({
            ok: true,
            changed: false,
            note: "No live Mac to stop.",
          });
        }
        sessionId = live.id;
      }

      const stopped = await client.destroySession(sessionId);
      if (!stopped.ok) return fail(stopped);
      return JSON.stringify({
        ok: true,
        sessionId: stopped.body.sessionId,
        changed: stopped.body.changed,
        note: "Repeat calls are safe. Namespace inventory should be empty for this session.",
      });
    },
  });

  await amp.registerSkill({ path: "skills/use-mac" });

  const runCommand = amp.registerCommand(
    "macorb-run",
    {
      title: "Run on the Mac",
      category: "MacOrb",
      description:
        "Acquire a Mac, wait until its runner is registered, and dispatch this prompt there.",
    },
    async (ctx) => {
      const prompt = await ctx.ui.input({
        title: "What should the Mac do?",
        helpText: "Build and test this project in the Simulator, then report back.",
      });
      if (!prompt) return;

      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) {
        await ctx.ui.notify(client);
        return;
      }

      const created = await client.createSession({
        projectDir: "/Users/runner/workspaces/macorb",
      });
      if (!created.ok) {
        await ctx.ui.notify(formatFailure(created));
        return;
      }
      const waited = await waitUntilRunning(client, created.body.sessionId, {
        deadlineMs: Date.now() + BOOT_BUDGET_MS,
      });
      if (!waited.ok) {
        await ctx.ui.notify(formatFailure(waited));
        return;
      }
      const runnerId = waited.body.runner?.runnerId ?? created.body.runnerId;
      if (!waited.body.runner?.registeredAt) {
        await ctx.ui.notify(
          `Mac session ${created.body.sessionId} is ${waited.body.state} but the runner has not registered. Do not dispatch.`,
        );
        return;
      }

      try {
        const agent = await resolveAgent(amp, ctx);
        const thread = await agent.createThread({
          executor: { type: "runner", id: runnerId },
          parentThreadID: ctx.thread?.id,
          show: true,
        });
        await thread.appendUserMessage({
          type: "user-message",
          content:
            `${prompt}\n\nWhen you finish, report the outcome, the commands you ran, ` +
            `and for UI work one Simulator screenshot. Reply in this thread; the parent is watching.`,
        });
        const reply = await thread.waitForResponse({ timeoutMs: 20 * 60 * 1000 });
        const text = reply.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        await ctx.ui.notify(`Mac finished. Thread ${thread.id}`);
        if (ctx.thread && text) {
          await ctx.thread.append([
            {
              type: "user-message",
              content: `Mac child ${thread.id} reported:\n\n${text}`,
            },
          ]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.ui.notify(`Mac dispatch failed: ${message}`);
        amp.logger.log(`macorb-run failed: ${message}`);
      }
    },
  );

  const stopCommand = amp.registerCommand(
    "macorb-stop",
    {
      title: "Stop Mac",
      category: "MacOrb",
      description: "Expire the live MacOrb session.",
      availability: { type: "hidden" },
    },
    async (ctx) => {
      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) {
        await ctx.ui.notify(client);
        return;
      }
      const listed = await client.listSessions();
      if (!listed.ok) {
        await ctx.ui.notify(formatFailure(listed));
        return;
      }
      const live = listed.body.sessions.find((session) =>
        ["provisioning", "running", "idle", "destroying"].includes(session.state),
      );
      if (!live) {
        await ctx.ui.notify("No live Mac.");
        refreshAvailability(client, runCommand, stopCommand, openCommand);
        return;
      }
      const confirmed = await ctx.ui.confirm({
        title: "Stop this Mac?",
        message: `Session ${live.id} will be destroyed. This is billed by the minute until then.`,
      });
      if (!confirmed) return;
      const stopped = await client.destroySession(live.id);
      await ctx.ui.notify(
        stopped.ok ? `Stopped ${live.id}.` : formatFailure(stopped),
      );
      await refreshAvailability(client, runCommand, stopCommand, openCommand);
    },
  );

  const openCommand = amp.registerCommand(
    "macorb-open",
    {
      title: "Open active Mac",
      category: "MacOrb",
      description: "Show the live Mac session id and runner id.",
      availability: { type: "hidden" },
    },
    async (ctx) => {
      const client = await clientOrExplain(amp, origin);
      if (!("origin" in client)) {
        await ctx.ui.notify(client);
        return;
      }
      const listed = await client.listSessions();
      if (!listed.ok) {
        await ctx.ui.notify(formatFailure(listed));
        return;
      }
      const live = listed.body.sessions.find((session) =>
        ["provisioning", "running", "idle", "destroying"].includes(session.state),
      );
      if (!live) {
        await ctx.ui.notify("No live Mac.");
        return;
      }
      await ctx.ui.notify(
        `Session ${live.id} · ${live.state} · runner ${live.runner?.runnerId ?? "(none yet)"}`,
      );
    },
  );

  // Best-effort palette state. Failure here must not block the plugin loading.
  void (async () => {
    const token = await tokenFromDisk();
    if (!token) {
      stopCommand.setAvailability({ type: "hidden" });
      openCommand.setAvailability({ type: "hidden" });
      return;
    }
    const client = createClient({ origin, token });
    await refreshAvailability(client, runCommand, stopCommand, openCommand);
  })();

  amp.logger.log(`macorb plugin ready origin=${origin}`);
}

/**
 * The agent the child Mac thread should run as.
 *
 * `PluginThread.agent()` returns the agent this thread is already using and is
 * documented as "suitable for creating related threads"
 * (https://ampcode.com/docs/plugin-api, checked 2026-09-08). Prefer it, because
 * the bundled skill tells the parent to preserve the mode the user asked for
 * and hardcoding `medium` silently contradicted that: a user working in `high`
 * got their Mac work downgraded, and a custom agent was dropped entirely.
 *
 * Falls back to built-in `medium` when there is no current thread — a command
 * can be invoked without one — or when the handle cannot be read. The fallback
 * is logged, so a silent downgrade is at least visible in the plugin log.
 *
 * ❓ Whether every option of a custom agent follows the handle onto a runner
 * executor is unmeasured; this only stops us from discarding the handle.
 */
async function resolveAgent(amp: PluginAPI, ctx: { thread?: { agent?: () => Promise<unknown> } }) {
  const thread = ctx.thread;
  if (thread && typeof thread.agent === "function") {
    try {
      const inherited = await thread.agent();
      if (inherited) return inherited as ReturnType<PluginAPI["getBuiltinAgent"]>;
      amp.logger.log("macorb-run: thread.agent() was empty; falling back to builtin medium");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      amp.logger.log(`macorb-run: thread.agent() failed (${message}); falling back to builtin medium`);
    }
  } else {
    amp.logger.log("macorb-run: no current thread agent; using builtin medium");
  }
  return amp.getBuiltinAgent("medium");
}

async function clientOrExplain(
  amp: PluginAPI,
  origin: string,
): Promise<MacorbClient | string> {
  const token = await tokenFromDisk();
  if (!token) {
    return (
      "MacOrb is not signed in. Run `macorb login` (or set MACORB_TOKEN) on this machine. " +
      "Do not put the token in amp.configuration — it is not a credential store. " +
      `API origin: ${origin}`
    );
  }
  const client = createClient({ origin, token });
  amp.logger.log(`macorb client origin=${origin}`);
  return client;
}

async function tokenFromDisk(): Promise<string | null> {
  return resolveToken(undefined, async (path) => {
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) return null;
      return await file.text();
    } catch {
      return null;
    }
  });
}

function readyPayload(created: CreateSessionResult, session: SessionView): string {
  const runner = session.runner;
  const runnerId = runner?.runnerId ?? created.runnerId;
  return JSON.stringify(
    {
      ok: true,
      sessionId: session.id,
      runnerId,
      state: session.state,
      registeredAt: runner?.registeredAt ?? null,
      readyReceivedAt: runner?.readyReceivedAt ?? null,
      projectRoot: runner?.projectRoot ?? created.projectRoot,
      ttlDeadline: session.ttlDeadline,
      nextAction:
        `Call Amp's first-party Agent-to-Agent / thread-creation tool with ` +
        `executor runner id "${runnerId}", parent = this thread, preserve the user's mode, ` +
        `and ask the child to report its result back here. Do not call macorb_acquire again. ` +
        `Do not create the child from a plugin tool handler.`,
    },
    null,
    2,
  );
}

function fail(error: ApiFailure): string {
  return JSON.stringify(
    {
      ok: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      status: error.status,
      note: error.retryable
        ? "Safe to retry this call."
        : "Do not retry blindly. Fix the condition named in message.",
    },
    null,
    2,
  );
}

function formatFailure(error: ApiFailure): string {
  return `${error.code}: ${error.message}`;
}

async function refreshAvailability(
  client: MacorbClient,
  _run: { setAvailability(status: { type: "enabled" } | { type: "hidden" }): void },
  stop: { setAvailability(status: { type: "enabled" } | { type: "hidden" }): void },
  open: { setAvailability(status: { type: "enabled" } | { type: "hidden" }): void },
): Promise<void> {
  const listed = await client.listSessions();
  const live =
    listed.ok &&
    listed.body.sessions.some((session) =>
      ["provisioning", "running", "idle", "destroying"].includes(session.state),
    );
  const status = live ? ({ type: "enabled" } as const) : ({ type: "hidden" } as const);
  stop.setAvailability(status);
  open.setAvailability(status);
}
