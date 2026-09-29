import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET, DEFAULT_ORIGINS, DEFAULT_PORT, formatPairingCode, originAllowed, parseClientMsg, parsePairingInput, parseServerMsg,
} from './protocol';

describe('pairing codes', () => {
  it('formats and parses round trip', () => {
    expect(formatPairingCode('K7QD93XM')).toBe('K7QD-93XM');
    expect(formatPairingCode('K7QD93XM', 18712)).toBe('K7QD-93XM@18712');
    expect(parsePairingInput('K7QD-93XM')).toEqual({ code: 'K7QD93XM', port: DEFAULT_PORT });
    expect(parsePairingInput(' k7qd 93xm ')).toEqual({ code: 'K7QD93XM', port: DEFAULT_PORT });
    expect(parsePairingInput('K7QD-93XM@18712')).toEqual({ code: 'K7QD93XM', port: 18712 });
  });

  it('rejects malformed input', () => {
    expect(parsePairingInput('')).toBeNull();
    expect(parsePairingInput('K7QD-93X')).toBeNull(); // too short
    expect(parsePairingInput('K7QD-93XMM')).toBeNull(); // too long
    expect(parsePairingInput('K7QD-93X0')).toBeNull(); // 0 is not in the alphabet
    expect(parsePairingInput('K7QD-93XM@80')).toBeNull(); // privileged port
    expect(parsePairingInput('K7QD-93XM@99999')).toBeNull();
    expect(parsePairingInput('<script>')).toBeNull();
  });

  it('uses an unambiguous alphabet', () => {
    for (const ch of '01ILOU') expect(CODE_ALPHABET).not.toContain(ch);
  });
});

describe('origin allowlist', () => {
  it('allows the site and local dev ports', () => {
    expect(originAllowed('https://cubbycad.com', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://localhost:5393', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5173', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://[::1]:5173', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://localhost', DEFAULT_ORIGINS)).toBe(true);
  });

  it('blocks everything else', () => {
    expect(originAllowed(undefined, DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('null', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('http://cubbycad.com', DEFAULT_ORIGINS)).toBe(false); // not https
    expect(originAllowed('https://cubbycad.com.evil.example', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('https://evil.example', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('http://localhost.evil.example:5393', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('http://localhost:5393/path', DEFAULT_ORIGINS)).toBe(false); // not an origin
    expect(originAllowed('https://localhost:5393', DEFAULT_ORIGINS)).toBe(false);
  });

  it('matches exact custom entries', () => {
    expect(originAllowed('https://slicer.example', ['https://slicer.example'])).toBe(true);
    expect(originAllowed('https://slicer.example:8443', ['https://slicer.example'])).toBe(false);
  });
});

describe('message parsing', () => {
  const hello = { t: 'hello', v: 1, app: 'cad', appName: 'CubbyCAD', title: 't', url: 'http://localhost/', instance: 'abc' };

  it('accepts well-formed client frames', () => {
    expect(parseClientMsg(JSON.stringify(hello))?.t).toBe('hello');
    expect(parseClientMsg(JSON.stringify({ t: 'tools', tools: [{ name: 'get_scene', description: 'd', inputSchema: { type: 'object' } }] }))?.t).toBe('tools');
    expect(parseClientMsg(JSON.stringify({ t: 'result', id: '1', ok: true, value: { data: 1 } }))?.t).toBe('result');
    expect(parseClientMsg(JSON.stringify({ t: 'result', id: '1', ok: false, error: 'x' }))?.t).toBe('result');
  });

  it('rejects malformed client frames', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...hello, app: 'other' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...hello, token: 42 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'tools', tools: [{ name: 'Bad Name', description: 'd', inputSchema: {} }] }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'result', id: '1', ok: true }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify([1, 2]))).toBeNull();
  });

  it('parses server frames', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'welcome', v: 1, tab: 'cad-1', server: { name: 'x', version: '1' } }))?.t).toBe('welcome');
    expect(parseServerMsg(JSON.stringify({ t: 'call', id: '1', tool: 'get_scene', args: {} }))?.t).toBe('call');
    expect(parseServerMsg(JSON.stringify({ t: 'call', id: '1', tool: 'get_scene', args: [] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'error', code: 'bad-code', message: 'm' }))?.t).toBe('error');
  });
});
