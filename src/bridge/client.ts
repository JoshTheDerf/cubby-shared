/**
 * Browser side of the MCP bridge: one WebSocket from this tab to the
 * local `cubby-mcp` process on 127.0.0.1, answering tool calls with the app's
 * handlers.
 *
 * Opt-in only. Nothing connects until the user pairs from the app's
 * "Connect an AI agent" dialog; `resume()` reconnects on reload only when
 * the user left "Reconnect automatically" on, and Disconnect clears it.
 *
 * The token the server issues on pairing lives in localStorage, so it is per
 * origin (CubbyCAD and the slicer share one on cubbycad.com). The per-tab
 * instance id lives in sessionStorage so a reload keeps its tab id.
 *
 * Chrome's Local Network Access: an https page reaching 127.0.0.1 needs the
 * "local network" permission. `connect()` first fetches the probe URL with
 * `targetAddressSpace: 'loopback'` (from the user's click) so the prompt
 * shows, then opens the socket.
 */
import {
  DEFAULT_PORT, PROBE_PATH, PROTOCOL_VERSION, WS_PATH, parsePairingInput, parseServerMsg,
  type AppKind, type ClientMsg, type ServerMsg, type ToolResultValue, type ToolSpec,
} from './protocol';

export interface ToolCallContext {
  /** Report progress (forwarded to the agent as MCP progress). */
  progress(progress: number, total?: number, message?: string): void;
  /** Aborted when the server cancels the call or the socket closes. */
  signal: AbortSignal;
}

export interface BridgeTool extends ToolSpec {
  run(args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolResultValue | void> | ToolResultValue | void;
}

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'needs-code' | 'error';

export interface BridgeState {
  status: BridgeStatus;
  /** Server-assigned tab id ("slicer-1") while connected. */
  tab: string | null;
  port: number;
  /** A token is stored for this origin. */
  paired: boolean;
  autoReconnect: boolean;
  error: string | null;
  /** Last tool the agent called, for the status indicator. */
  lastTool: { name: string; at: number; ok: boolean | null } | null;
  /** Calls running now. */
  busy: number;
}

export interface ConfirmRequest {
  /** Groups confirms for "allow without asking" (e.g. 'print'). */
  key: string;
  title: string;
  message: string;
  confirmLabel?: string;
}

export interface BridgeClientOptions {
  app: AppKind;
  appName: string;
  /** The tools, or a loader (lazy chunk) run on first connect. */
  tools: BridgeTool[] | (() => Promise<BridgeTool[]>);
  /** Show a confirm dialog. `always` = the user ticked "allow without asking this session". */
  confirm: (req: ConfirmRequest) => Promise<{ ok: boolean; always: boolean }>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  session?: Pick<Storage, 'getItem' | 'setItem'> | null;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  fetchImpl?: typeof fetch;
  /** Title reported for the tab list. */
  title?: () => string;
  /** Page URL reported for the tab list. */
  url?: () => string;
}

/** The subset of WebSocket the client uses (tests pass a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
}

export const STORAGE_KEYS = {
  /** Per origin: CubbyCAD and the slicer share it on cubbycad.com. */
  token: 'cubby-bridge.token',
  port: 'cubby-bridge.port',
  /** Per app: `cubby-bridge.auto.<app>`, so opting in on one app doesn't connect the other. */
  auto: 'cubby-bridge.auto',
  instance: 'cubby-bridge.instance',
} as const;

const OPEN = 1;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try { return (globalThis as Record<string, unknown>)[kind] as Storage ?? null; } catch { return null; }
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** `targetAddressSpace` value this browser accepts for 127.0.0.1, if any. */
export function loopbackAddressSpace(): string | null {
  if (typeof Request === 'undefined') return null;
  // Current Chrome: 'loopback'. Older Private Network Access builds called loopback 'local'.
  for (const v of ['loopback', 'local']) {
    try { new Request('http://127.0.0.1/', { targetAddressSpace: v } as RequestInit); return v; } catch { /* unknown value */ }
  }
  return null;
}

/** Local Network Access permission state, when the browser exposes it. */
export async function localNetworkPermission(): Promise<PermissionState | null> {
  const perms = (globalThis as { navigator?: Navigator }).navigator?.permissions;
  if (!perms?.query) return null;
  for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
    try { return (await perms.query({ name } as unknown as PermissionDescriptor)).state; } catch { /* unknown name */ }
  }
  return null;
}

export class BridgeClient {
  private readonly opts: BridgeClientOptions;
  private readonly storage: BridgeClientOptions['storage'];
  private readonly session: BridgeClientOptions['session'];
  private ws: WebSocketLike | null = null;
  private tools = new Map<string, BridgeTool>();
  private toolsLoaded: Promise<void> | null = null;
  private inflight = new Map<string, AbortController>();
  private listeners = new Set<(s: BridgeState) => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The user asked for a connection (connect/resume) and hasn't disconnected. */
  private wanted = false;
  private pendingCode: string | null = null;
  private sessionAllowed = new Set<string>();
  private readonly autoKey: string;
  private _state: BridgeState;

  constructor(opts: BridgeClientOptions) {
    this.opts = opts;
    this.storage = opts.storage === undefined ? safeStorage('localStorage') : opts.storage;
    this.session = opts.session === undefined ? safeStorage('sessionStorage') : opts.session;
    this.autoKey = `${STORAGE_KEYS.auto}.${opts.app}`;
    const port = Number(this.read(STORAGE_KEYS.port)) || DEFAULT_PORT;
    const w = globalThis as { addEventListener?: (t: string, f: () => void) => void };
    for (const ev of ['focus', 'blur']) w.addEventListener?.(ev, this.sendState);
    this._state = {
      status: 'off', tab: null, port, paired: !!this.read(STORAGE_KEYS.token),
      autoReconnect: this.read(this.autoKey) === '1', error: null, lastTool: null, busy: 0,
    };
  }

  get state(): BridgeState { return this._state; }

  subscribe(fn: (s: BridgeState) => void): () => void {
    this.listeners.add(fn);
    fn(this._state);
    return () => { this.listeners.delete(fn); };
  }

  /**
   * Connect from the user's click. `input` is the pairing code the MCP server
   * printed (may carry `@port`); omit it to reuse the stored token.
   */
  async connect(opts: { input?: string; port?: number; autoReconnect?: boolean } = {}): Promise<void> {
    let port = opts.port ?? this._state.port;
    this.pendingCode = null;
    if (opts.input?.trim()) {
      const parsed = parsePairingInput(opts.input);
      if (!parsed) { this.set({ status: 'error', error: 'That doesn’t look like a pairing code. It is 8 letters and digits, like K7QD-93XM.' }); return; }
      this.pendingCode = parsed.code;
      if (!opts.port) port = parsed.port;
    } else if (!this.read(STORAGE_KEYS.token)) {
      this.set({ status: 'needs-code', error: null });
      return;
    }
    if (opts.autoReconnect !== undefined) {
      this.write(this.autoKey, opts.autoReconnect ? '1' : null);
      this.set({ autoReconnect: opts.autoReconnect });
    }
    this.write(STORAGE_KEYS.port, port === DEFAULT_PORT ? null : String(port));
    this.set({ port });
    this.wanted = true;
    this.retry = 0;
    await this.open(true);
  }

  /** On page load: reconnect only if the user opted in earlier. */
  resume(): void {
    if (this._state.autoReconnect && this.read(STORAGE_KEYS.token) && !this.wanted) {
      this.wanted = true;
      void this.open(false);
    }
  }

  /** Close and stop reconnecting on reload. Keeps the token (see `forget`). */
  disconnect(): void {
    this.wanted = false;
    this.write(this.autoKey, null);
    this.clearRetry();
    this.closeSocket();
    this.sessionAllowed.clear();
    this.set({ status: 'off', tab: null, error: null, autoReconnect: false });
  }

  /** Disconnect and drop this origin's token (pair again next time). */
  forget(): void {
    this.disconnect();
    this.write(STORAGE_KEYS.token, null);
    this.set({ paired: false });
  }

  /**
   * Ask the user before a sensitive tool runs, unless they allowed `key`
   * without asking for this session (until disconnect or reload).
   */
  async confirm(req: ConfirmRequest): Promise<boolean> {
    if (this.sessionAllowed.has(req.key)) return true;
    const r = await this.opts.confirm(req);
    if (r.ok && r.always) this.sessionAllowed.add(req.key);
    return r.ok;
  }

  isSessionAllowed(key: string): boolean { return this.sessionAllowed.has(key); }
  revokeSessionAllow(key: string): void { this.sessionAllowed.delete(key); }

  // ---- internals ------------------------------------------------------------------

  private set(patch: Partial<BridgeState>): void {
    this._state = { ...this._state, ...patch };
    for (const fn of this.listeners) fn(this._state);
  }

  private read(key: string): string | null {
    try { return (key === STORAGE_KEYS.instance ? this.session : this.storage)?.getItem(key) ?? null; } catch { return null; }
  }

  private write(key: string, value: string | null): void {
    try {
      const s = key === STORAGE_KEYS.instance ? this.session : this.storage;
      if (value === null) (s as Storage | null | undefined)?.removeItem?.(key);
      else s?.setItem(key, value);
    } catch { /* storage blocked */ }
  }

  private instanceId(): string {
    let id = this.read(STORAGE_KEYS.instance);
    if (!id) { id = randomId(); this.write(STORAGE_KEYS.instance, id); }
    return id;
  }

  private async loadTools(): Promise<void> {
    if (!this.toolsLoaded) {
      this.toolsLoaded = (async () => {
        const list = typeof this.opts.tools === 'function' ? await this.opts.tools() : this.opts.tools;
        this.tools = new Map(list.map((t) => [t.name, t]));
      })();
      this.toolsLoaded.catch(() => { this.toolsLoaded = null; });
    }
    await this.toolsLoaded;
  }

  /** Trigger the Local Network Access prompt and check the server is there. */
  private async probe(port: number): Promise<'ok' | 'down' | 'denied'> {
    const f = this.opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) return 'ok';
    const init: RequestInit & { targetAddressSpace?: string } = { mode: 'cors', cache: 'no-store', credentials: 'omit' };
    const space = loopbackAddressSpace();
    if (space) init.targetAddressSpace = space;
    try {
      const r = await f(`http://127.0.0.1:${port}${PROBE_PATH}`, init);
      return r.ok || r.status === 403 ? 'ok' : 'down';
    } catch {
      return (await localNetworkPermission()) === 'denied' ? 'denied' : 'down';
    }
  }

  private async open(interactive: boolean): Promise<void> {
    this.clearRetry();
    this.closeSocket();
    this.set({ status: 'connecting', error: interactive ? null : this._state.error });
    try { await this.loadTools(); } catch (e) {
      this.set({ status: 'error', error: `Couldn’t load the app’s tools: ${(e as Error)?.message ?? e}` });
      return;
    }
    const port = this._state.port;
    const probe = await this.probe(port);
    if (!this.wanted) return;
    if (probe === 'denied') {
      this.wanted = false;
      this.set({ status: 'error', error: 'The browser blocked access to this computer (127.0.0.1). Allow “Local network access” for this site in the address bar’s site settings, then connect again.' });
      return;
    }
    if (probe === 'down') {
      // Keep trying quietly: the agent may start in a moment.
      this.set({ status: 'connecting', error: `Nothing is listening on 127.0.0.1:${port} yet. Start your AI agent with the cubby MCP server added. Retrying…` });
      this.scheduleRetry();
      return;
    }
    const Ws = this.opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (u: string) => WebSocketLike }).WebSocket;
    let ws: WebSocketLike;
    try { ws = new Ws(`ws://127.0.0.1:${port}${WS_PATH}`); } catch (e) {
      this.set({ status: 'error', error: (e as Error)?.message ?? String(e) });
      return;
    }
    this.ws = ws;
    let welcomed = false;
    ws.onopen = () => {
      const token = this.pendingCode ? undefined : this.read(STORAGE_KEYS.token) ?? undefined;
      this.send({
        t: 'hello', v: PROTOCOL_VERSION, app: this.opts.app, appName: this.opts.appName,
        title: this.opts.title?.() ?? (globalThis as { document?: Document }).document?.title ?? '',
        url: this.opts.url?.() ?? (globalThis as { location?: Location }).location?.href ?? '',
        instance: this.instanceId(), token, code: this.pendingCode ?? undefined,
      });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      const m = parseServerMsg(ev.data);
      if (!m) return;
      if (m.t === 'welcome') welcomed = true;
      this.onServerMsg(m);
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.abortAll();
      // An auth / origin error already stopped us (wanted = false).
      if (!this.wanted) return;
      this.set({ status: 'connecting', tab: null, error: welcomed ? 'Connection lost. Reconnecting…' : this._state.error ?? (ev.reason || null) });
      this.scheduleRetry();
    };
  }

  private onServerMsg(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        if (m.token) this.write(STORAGE_KEYS.token, m.token);
        this.pendingCode = null;
        this.retry = 0;
        this.set({ status: 'connected', tab: m.tab, error: null, paired: true });
        this.send({ t: 'tools', tools: [...this.tools.values()].map(toSpec) });
        this.sendState();
        return;
      case 'error':
        if (m.code === 'bad-token') {
          this.write(STORAGE_KEYS.token, null);
          this.set({ status: 'needs-code', paired: false, error: 'This site’s pairing was revoked or expired. Enter a new code.' });
        } else if (m.code === 'bad-code') {
          this.set({ status: 'needs-code', error: m.message });
        } else {
          this.set({ status: 'error', error: m.message });
        }
        this.wanted = m.code === 'busy' ? this.wanted : false;
        return;
      case 'call':
        void this.runCall(m.id, m.tool, m.args);
        return;
      case 'cancel':
        this.inflight.get(m.id)?.abort();
        return;
      case 'ping':
        this.send({ t: 'pong' });
        return;
      default:
        return;
    }
  }

  private async runCall(id: string, name: string, args: Record<string, unknown>): Promise<void> {
    const tool = this.tools.get(name);
    if (!tool) { this.send({ t: 'result', id, ok: false, error: `Unknown tool "${name}".` }); return; }
    const ac = new AbortController();
    this.inflight.set(id, ac);
    this.set({ busy: this._state.busy + 1, lastTool: { name, at: Date.now(), ok: null } });
    let ok = false;
    try {
      const ctx: ToolCallContext = {
        signal: ac.signal,
        progress: (progress, total, message) => this.send({ t: 'progress', id, progress, total, message }),
      };
      const value = (await tool.run(args ?? {}, ctx)) ?? { data: { ok: true } };
      this.send({ t: 'result', id, ok: true, value: toPlain(value) as ToolResultValue });
      ok = true;
    } catch (e) {
      this.send({ t: 'result', id, ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.inflight.delete(id);
      this.set({ busy: Math.max(0, this._state.busy - 1), lastTool: { name, at: Date.now(), ok } });
    }
  }

  /** Tell the server this tab's title and focus (it lists tabs by them). */
  private sendState = (): void => {
    const doc = (globalThis as { document?: Document }).document;
    this.send({ t: 'state', title: this.opts.title?.() ?? doc?.title, focused: doc?.hasFocus?.() ?? false });
  };

  private send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(m));
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer) return;
    const ms = BACKOFF_MS[Math.min(this.retry, BACKOFF_MS.length - 1)];
    this.retry++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.wanted) void this.open(false); }, ms);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.abortAll();
    if (ws) { try { ws.close(1000, 'bye'); } catch { /* already closed */ } }
  }

  private abortAll(): void {
    for (const ac of this.inflight.values()) ac.abort();
    this.inflight.clear();
  }
}

function toSpec(t: BridgeTool): ToolSpec {
  const { name, description, inputSchema, fileInput, fileOutput, timeoutMs } = t;
  return { name, description, inputSchema, fileInput, fileOutput, timeoutMs };
}

/** De-proxy Vue reactive data and drop functions before JSON encoding. */
function toPlain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null));
}

// ---- helpers for tool handlers ------------------------------------------------------

/** Base64 of bytes, chunked so large models don't overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Throw a readable error unless `v` is a string. */
export function argString(args: Record<string, unknown>, key: string, opts: { optional?: boolean } = {}): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) { if (opts.optional) return undefined; throw new Error(`Missing "${key}".`); }
  if (typeof v !== 'string') throw new Error(`"${key}" must be a string.`);
  return v;
}

export function argNumber(args: Record<string, unknown>, key: string, opts: { optional?: boolean } = {}): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) { if (opts.optional) return undefined; throw new Error(`Missing "${key}".`); }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${key}" must be a number.`);
  return v;
}

export function argVec3(args: Record<string, unknown>, key: string): [number, number, number] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new Error(`"${key}" must be [x, y, z].`);
  }
  return [v[0], v[1], v[2]];
}
