import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient, STORAGE_KEYS, type BridgeClientOptions, type WebSocketLike } from './client';
import { parseClientMsg, type ClientMsg } from './protocol';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

class FakeWs implements WebSocketLike {
  static last: FakeWs | null = null;
  readyState = 0;
  sent: ClientMsg[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(public url: string) { FakeWs.last = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
  send(d: string) { const m = parseClientMsg(d); if (!m) throw new Error(`client sent a bad frame: ${d}`); this.sent.push(m); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  serve(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

const okFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
const flush = () => new Promise((r) => setTimeout(r, 0));

function make(over: Partial<BridgeClientOptions> = {}) {
  const storage = new MemStorage();
  const session = new MemStorage();
  const confirm = vi.fn(async () => ({ ok: true, always: false }));
  const client = new BridgeClient({
    app: 'slicer', appName: 'CubbySlicer', storage, session, confirm,
    WebSocketImpl: FakeWs, fetchImpl: okFetch, title: () => 'Slicer', url: () => 'http://localhost:5393/slicer/',
    tools: [
      { name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, run: (a) => ({ data: { echo: a.x } }) },
      { name: 'boom', description: 'Fails', inputSchema: { type: 'object' }, run: () => { throw new Error('nope'); } },
    ],
    ...over,
  });
  return { client, storage, session, confirm };
}

describe('BridgeClient', () => {
  beforeEach(() => { FakeWs.last = null; });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing until asked (no auto-connect)', async () => {
    const { client } = make();
    client.resume();
    await flush();
    expect(FakeWs.last).toBeNull();
    expect(client.state.status).toBe('off');
  });

  it('asks for a code when there is no token', async () => {
    const { client } = make();
    await client.connect();
    expect(client.state.status).toBe('needs-code');
    expect(FakeWs.last).toBeNull();
  });

  it('rejects a malformed code without connecting', async () => {
    const { client } = make();
    await client.connect({ input: 'hello' });
    expect(client.state.status).toBe('error');
    expect(FakeWs.last).toBeNull();
  });

  it('pairs with a code, stores the token and registers tools', async () => {
    const { client, storage } = make();
    await client.connect({ input: 'k7qd-93xm@18720', autoReconnect: true });
    await flush();
    const ws = FakeWs.last!;
    expect(ws.url).toBe('ws://127.0.0.1:18720/cubby-bridge/ws');
    const hello = ws.sent[0];
    expect(hello).toMatchObject({ t: 'hello', app: 'slicer', code: 'K7QD93XM' });
    expect((hello as { token?: string }).token).toBeUndefined();
    ws.serve({ t: 'welcome', v: 1, tab: 'slicer-1', token: 'tok123', server: { name: 'cubby-mcp', version: '0' } });
    expect(client.state).toMatchObject({ status: 'connected', tab: 'slicer-1', paired: true, port: 18720 });
    expect(storage.getItem(STORAGE_KEYS.token)).toBe('tok123');
    expect(storage.getItem(`${STORAGE_KEYS.auto}.slicer`)).toBe('1');
    expect(ws.sent[1]).toMatchObject({ t: 'tools' });
    expect((ws.sent[1] as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(['echo', 'boom']);
  });

  it('answers calls, reports errors and unknown tools', async () => {
    const { client } = make();
    await client.connect({ input: 'K7QD-93XM' });
    await flush();
    const ws = FakeWs.last!;
    ws.serve({ t: 'welcome', v: 1, tab: 'slicer-1', token: 't', server: { name: 'x', version: '0' } });
    ws.serve({ t: 'call', id: 'a', tool: 'echo', args: { x: 5 } });
    ws.serve({ t: 'call', id: 'b', tool: 'boom', args: {} });
    ws.serve({ t: 'call', id: 'c', tool: 'missing', args: {} });
    await flush();
    const results = ws.sent.filter((m) => m.t === 'result');
    expect(results).toContainEqual({ t: 'result', id: 'a', ok: true, value: { data: { echo: 5 } } });
    expect(results).toContainEqual({ t: 'result', id: 'b', ok: false, error: 'nope' });
    expect(results.find((r) => r.id === 'c')).toMatchObject({ ok: false });
  });

  it('reuses the stored token, and resume() only reconnects after opt-in', async () => {
    const { client, storage } = make();
    storage.setItem(STORAGE_KEYS.token, 'saved');
    client.resume(); // token but no opt-in
    await flush();
    expect(FakeWs.last).toBeNull();

    storage.setItem(`${STORAGE_KEYS.auto}.cad`, '1'); // another app's opt-in doesn't count
    const other = make({ storage: storage as unknown as Storage });
    other.client.resume();
    await flush();
    expect(FakeWs.last).toBeNull();
    storage.setItem(`${STORAGE_KEYS.auto}.slicer`, '1');
    const again = make({ storage: storage as unknown as Storage });
    again.client.resume();
    await flush(); await flush();
    expect(FakeWs.last!.sent[0]).toMatchObject({ t: 'hello', token: 'saved' });
    expect((FakeWs.last!.sent[0] as { code?: string }).code).toBeUndefined();
  });

  it('drops a revoked token and asks for a new code', async () => {
    const { client, storage } = make();
    storage.setItem(STORAGE_KEYS.token, 'old');
    await client.connect();
    await flush();
    FakeWs.last!.serve({ t: 'error', code: 'bad-token', message: 'no' });
    FakeWs.last!.close();
    expect(client.state.status).toBe('needs-code');
    expect(storage.getItem(STORAGE_KEYS.token)).toBeNull();
  });

  it('disconnect clears the opt-in; forget clears the token', async () => {
    const { client, storage } = make();
    await client.connect({ input: 'K7QD-93XM', autoReconnect: true });
    await flush();
    FakeWs.last!.serve({ t: 'welcome', v: 1, tab: 'slicer-1', token: 't', server: { name: 'x', version: '0' } });
    client.disconnect();
    expect(client.state.status).toBe('off');
    expect(storage.getItem(`${STORAGE_KEYS.auto}.slicer`)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.token)).toBe('t');
    client.forget();
    expect(storage.getItem(STORAGE_KEYS.token)).toBeNull();
  });

  it('reports the server as down and retries quietly', async () => {
    vi.useFakeTimers();
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const { client } = make({ fetchImpl: down });
    await client.connect({ input: 'K7QD-93XM' });
    expect(client.state.status).toBe('connecting');
    expect(client.state.error).toContain('Nothing is listening');
    await vi.advanceTimersByTimeAsync(1100);
    expect(down).toHaveBeenCalledTimes(2);
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60000);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('confirm: asks each time unless allowed for the session', async () => {
    const { client, confirm } = make();
    confirm.mockResolvedValueOnce({ ok: false, always: false });
    expect(await client.confirm({ key: 'print', title: 't', message: 'm' })).toBe(false);
    confirm.mockResolvedValueOnce({ ok: true, always: true });
    expect(await client.confirm({ key: 'print', title: 't', message: 'm' })).toBe(true);
    expect(await client.confirm({ key: 'print', title: 't', message: 'm' })).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    client.disconnect(); // the session ends
    await client.confirm({ key: 'print', title: 't', message: 'm' });
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});
