/**
 * Wire protocol between a browser tab (CubbyCAD, Cubby Slicer) and the local
 * `cubby-mcp` process. JSON text frames over one WebSocket to 127.0.0.1.
 *
 *   tab    → server  hello   (app, instance id, token or one-time pairing code)
 *   server → tab     welcome (tab id, and a fresh token when paired by code)
 *                    or error + close (bad code / token / origin / version)
 *   tab    → server  tools   (the tab's tool list; may be resent)
 *   server → tab     call    { id, tool, args }
 *   tab    → server  progress { id, progress, total?, message? }  (optional)
 *   tab    → server  result  { id, ok, value | error }
 *   either           ping / pong
 *
 * Pure: no DOM, no Node. Shared by the browser client and the server.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 18711;
/** HTTP path the server answers on (probe + Local Network Access permission). */
export const PROBE_PATH = '/cubby-bridge';
/** WebSocket path. */
export const WS_PATH = '/cubby-bridge/ws';

export type AppKind = 'cad' | 'slicer';
export const APP_KINDS: readonly AppKind[] = ['cad', 'slicer'];

/** JSON Schema for a tool's arguments (an object schema). */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  [k: string]: unknown;
}

export interface ToolSpec {
  /** Unprefixed name, e.g. `get_scene`. The server exposes it as `<app>_<name>`. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /**
   * Takes a model file: the tab reads `dataBase64` + `name`. The server also
   * accepts `path` (a file on this machine) or `url` and fills `dataBase64`.
   */
  fileInput?: boolean;
  /**
   * Returns `file`: the server writes it to `savePath` (or a temp folder) and
   * hands Claude the path, never the bytes.
   */
  fileOutput?: boolean;
  /** Longest the server waits for a result, ms. */
  timeoutMs?: number;
}

export interface FilePayload {
  name: string;
  mimeType: string;
  base64: string;
}

export interface ImagePayload {
  base64: string;
  mimeType: string;
}

/** What a tab's tool handler returns. */
export interface ToolResultValue {
  /** Structured result (sent to Claude as JSON). */
  data?: unknown;
  /** Screenshots and other images. */
  images?: ImagePayload[];
  /** File output (fileOutput tools). */
  file?: FilePayload;
}

export interface HelloMsg {
  t: 'hello';
  v: number;
  app: AppKind;
  /** Human-readable app name ("CubbyCAD"). */
  appName: string;
  /** Page title, for listing tabs. */
  title: string;
  url: string;
  /** Random per-tab id kept in sessionStorage, so a reload keeps its tab id. */
  instance: string;
  token?: string;
  code?: string;
}
export interface ToolsMsg { t: 'tools'; tools: ToolSpec[] }
export interface ResultOkMsg { t: 'result'; id: string; ok: true; value: ToolResultValue }
export interface ResultErrMsg { t: 'result'; id: string; ok: false; error: string }
export interface ProgressMsg { t: 'progress'; id: string; progress: number; total?: number; message?: string }
export interface StateMsg { t: 'state'; title?: string; focused?: boolean }
export interface PingMsg { t: 'ping' }
export interface PongMsg { t: 'pong' }

export type ClientMsg = HelloMsg | ToolsMsg | ResultOkMsg | ResultErrMsg | ProgressMsg | StateMsg | PingMsg | PongMsg;

export interface WelcomeMsg {
  t: 'welcome';
  v: number;
  tab: string;
  /** Set when the tab paired with a code: keep it and send it next time. */
  token?: string;
  server: { name: string; version: string };
}
export type ErrorCode = 'bad-code' | 'bad-token' | 'origin' | 'version' | 'protocol' | 'busy';
export interface ErrorMsg { t: 'error'; code: ErrorCode; message: string }
export interface CallMsg { t: 'call'; id: string; tool: string; args: Record<string, unknown> }
export interface CancelMsg { t: 'cancel'; id: string }

export type ServerMsg = WelcomeMsg | ErrorMsg | CallMsg | CancelMsg | PingMsg | PongMsg;

// ---- parsing ------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;

function validToolSpec(v: unknown): v is ToolSpec {
  if (!isObj(v)) return false;
  return isStr(v.name, 64) && /^[a-z][a-z0-9_]*$/.test(v.name) && isStr(v.description, 8192) && isObj(v.inputSchema);
}

/** Parse a frame from a tab. Returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      if (typeof m.v !== 'number' || !APP_KINDS.includes(m.app as AppKind)) return null;
      if (!isStr(m.appName, 64) || !isStr(m.title, 512) || !isStr(m.url, 2048) || !isStr(m.instance, 64)) return null;
      if (m.token !== undefined && !isStr(m.token, 256)) return null;
      if (m.code !== undefined && !isStr(m.code, 64)) return null;
      return m as unknown as HelloMsg;
    case 'tools':
      if (!Array.isArray(m.tools) || m.tools.length > 200 || !m.tools.every(validToolSpec)) return null;
      return m as unknown as ToolsMsg;
    case 'result':
      if (!isStr(m.id, 64) || typeof m.ok !== 'boolean') return null;
      if (m.ok) return isObj(m.value) ? (m as unknown as ResultOkMsg) : null;
      return isStr(m.error, 65536) ? (m as unknown as ResultErrMsg) : null;
    case 'progress':
      return isStr(m.id, 64) && typeof m.progress === 'number' ? (m as unknown as ProgressMsg) : null;
    case 'state':
      return m as unknown as StateMsg;
    case 'ping': case 'pong':
      return m as unknown as PingMsg | PongMsg;
    default:
      return null;
  }
}

/** Parse a frame from the server. Returns null for anything malformed. */
export function parseServerMsg(raw: string): ServerMsg | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'welcome':
      return typeof m.v === 'number' && isStr(m.tab, 64) ? (m as unknown as WelcomeMsg) : null;
    case 'error':
      return isStr(m.code, 32) && isStr(m.message) ? (m as unknown as ErrorMsg) : null;
    case 'call':
      return isStr(m.id, 64) && isStr(m.tool, 64) && isObj(m.args) ? (m as unknown as CallMsg) : null;
    case 'cancel':
      return isStr(m.id, 64) ? (m as unknown as CancelMsg) : null;
    case 'ping': case 'pong':
      return m as unknown as PingMsg | PongMsg;
    default:
      return null;
  }
}

// ---- pairing codes ------------------------------------------------------------------

/** Crockford-style alphabet without 0/O, 1/I/L, U: easy to read aloud and type. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/** `K7QD93XM` → `K7QD-93XM`; adds `@port` when it isn't the default. */
export function formatPairingCode(code: string, port = DEFAULT_PORT): string {
  const c = normalizeCode(code);
  const pretty = c.length === CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
  return port === DEFAULT_PORT ? pretty : `${pretty}@${port}`;
}

/** Upper-case, drop separators and whitespace. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * What the user pasted: `K7QD-93XM`, `k7qd93xm`, or `K7QD-93XM@18712`.
 * Returns null when it can't be a code.
 */
export function parsePairingInput(input: string): { code: string; port: number } | null {
  const s = input.trim();
  const m = /^([A-Za-z0-9\s-]+?)(?:@(\d{2,5}))?$/.exec(s);
  if (!m) return null;
  const code = normalizeCode(m[1]);
  if (code.length !== CODE_LENGTH || [...code].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { code, port };
}

// ---- origins ------------------------------------------------------------------------

/**
 * Origins allowed to connect by default: the production site and local dev
 * servers on any port. Patterns may use `*` for the port only.
 */
export const DEFAULT_ORIGINS: readonly string[] = [
  'https://cubbycad.com',
  'https://www.cubbycad.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://[::1]:*',
];

/** Whether `origin` matches one of `patterns` (exact, or `scheme://host:*`). */
export function originAllowed(origin: string | undefined | null, patterns: readonly string[]): boolean {
  if (!origin || origin === 'null') return false;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  // An Origin header is scheme://host[:port], nothing more.
  if (u.origin !== origin) return false;
  for (const p of patterns) {
    if (p === origin) return true;
    if (p.endsWith(':*')) {
      const base = p.slice(0, -2);
      if (origin === base) return true;
      const i = origin.lastIndexOf(':');
      if (i > origin.indexOf('://') + 2 && origin.slice(0, i) === base && /^\d+$/.test(origin.slice(i + 1))) return true;
    }
  }
  return false;
}
