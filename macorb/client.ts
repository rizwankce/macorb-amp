// Thin MacOrb API client used by the plugin (and mirrored by the CLI).
//
// Auth is the session JWT `mintSessionToken` already issues, sent as
// `Authorization: Bearer`. It is NOT stored in `amp.configuration` — that is
// ordinary config, not a credential store. The file at ~/.config/macorb/token
// is mode 0600 and is written only by `macorb login`.

export const DEFAULT_ORIGIN = "https://api.macorb.dev";

export interface MacorbErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}

export interface RunnerView {
  runnerId: string;
  sessionId: string;
  gitOrigin: string;
  projectRoot: string;
  requestedAt: string;
  registeredAt: string | null;
  readyReceivedAt: string | null;
}

export interface SessionView {
  id: string;
  userId: string;
  state: string;
  namespaceInstanceId: string | null;
  createdAt: string;
  ttlDeadline: string;
  runningAt: string | null;
  destructionCause: string | null;
  runner: RunnerView | null;
  runners: RunnerView[];
}

export interface CreateSessionResult {
  session: { id: string; state: string; ttlDeadline: string };
  sessionId: string;
  runnerId: string;
  instanceId: string;
  projectRoot: string;
  gitOrigin: string;
  ttlDeadline: string;
  bootDeadline: string;
}

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

export type ApiResult<T> = { ok: true; status: number; body: T } | ApiFailure;

export interface MacorbClient {
  origin: string;
  getMe(): Promise<ApiResult<{ token: string; user: { userId: string; githubLogin: string } }>>;
  getAmpKey(): Promise<ApiResult<{ present: boolean }>>;
  getGithubToken(): Promise<ApiResult<{ present: boolean }>>;
  listSessions(): Promise<ApiResult<{ sessions: SessionView[] }>>;
  getSession(id: string): Promise<ApiResult<SessionView>>;
  waitForRunning(id: string, timeoutSeconds?: number): Promise<ApiResult<SessionView>>;
  createSession(body: {
    repository?: string;
    projectDir?: string;
    ttlSeconds?: number;
  }): Promise<ApiResult<CreateSessionResult>>;
  destroySession(id: string): Promise<ApiResult<{ sessionId: string; changed: boolean }>>;
  minutes(): Promise<ApiResult<{ measuredMinutes: number; sessions: Array<{ sessionId: string; measuredMinutes: number }> }>>;
}

export function resolveOrigin(env: Record<string, string | undefined> = defaultEnv()): string {
  return (env.MACORB_ORIGIN || env.MACORB_API_BASE_URL || DEFAULT_ORIGIN).replace(/\/+$/, "");
}

export async function resolveToken(
  env: Record<string, string | undefined> = defaultEnv(),
  readFile?: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const fromEnv = env.MACORB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = env.HOME || env.USERPROFILE;
  if (!home || !readFile) return null;
  const text = await readFile(`${home}/.config/macorb/token`);
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function createClient(opts: {
  origin: string;
  token: string;
  fetch?: typeof fetch;
}): MacorbClient {
  const fetchImpl = opts.fetch ?? fetch;
  const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> => {
    let response: Response;
    try {
      response = await fetchImpl(`${opts.origin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${opts.token}`,
          accept: "application/json",
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        code: "NETWORK",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!response.ok) {
      const body = isRecord(parsed) ? (parsed as MacorbErrorBody) : {};
      return {
        ok: false,
        status: response.status,
        code: body.error?.code ?? `HTTP_${response.status}`,
        message: body.error?.message ?? `MacOrb API ${response.status}`,
        retryable: body.error?.retryable === true || response.status === 504 || response.status >= 500,
      };
    }
    return { ok: true, status: response.status, body: parsed as T };
  };

  return {
    origin: opts.origin,
    getMe: () => request("/auth/session"),
    getAmpKey: () => request("/me/amp-key"),
    getGithubToken: () => request("/me/github-token"),
    listSessions: () => request("/sessions"),
    getSession: (id) => request(`/sessions/${id}`),
    waitForRunning: (id, timeoutSeconds = 20) =>
      request(`/sessions/${id}/wait?timeoutSeconds=${timeoutSeconds}`),
    createSession: (body) =>
      request("/sessions", { method: "POST", body: JSON.stringify(body) }),
    destroySession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),
    minutes: () => request("/me/minutes"),
  };
}

/**
 * Poll wait until the session is running, or a terminal/auth failure.
 *
 * One wait request caps at ~20 s so a Worker isolate is not held for the
 * whole boot. 504 retryable means "ask again"; anything else is final.
 */
export async function waitUntilRunning(
  client: MacorbClient,
  sessionId: string,
  opts: { deadlineMs: number; sleep?: (ms: number) => Promise<void> } = {
    deadlineMs: Date.now() + 300_000,
  },
): Promise<ApiResult<SessionView>> {
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  while (true) {
    const waited = await client.waitForRunning(sessionId);
    if (waited.ok) return waited;
    if (waited.status === 504 && waited.retryable && Date.now() < opts.deadlineMs) {
      await sleep(1_000);
      continue;
    }
    if (waited.status === 409) return waited;
    // The session may already be running and wait raced a transient; read once.
    const latest = await client.getSession(sessionId);
    if (latest.ok && latest.body.state === "running") return latest;
    return waited;
  }
}

function defaultEnv(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
