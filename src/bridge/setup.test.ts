import { describe, expect, it } from 'vitest';
import { MCP_SETUP, MCP_SERVER_COMMAND } from './setup';

describe('MCP_SETUP', () => {
  it('has unique ids and every snippet launches cubby-mcp', () => {
    expect(new Set(MCP_SETUP.map((e) => e.id)).size).toBe(MCP_SETUP.length);
    expect(MCP_SETUP[0].snippet).toBe(MCP_SERVER_COMMAND);
    for (const e of MCP_SETUP) expect(e.snippet).toContain('cubby-mcp');
  });
  it('the JSON example parses', () => {
    const json = JSON.parse(MCP_SETUP.find((e) => e.id === 'json')!.snippet);
    expect(json.mcpServers.cubby).toEqual({ command: 'npx', args: ['-y', 'cubby-mcp'] });
  });
});
