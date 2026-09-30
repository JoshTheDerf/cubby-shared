/**
 * How to add the cubby MCP server to an agent, for the apps' "Connect an AI
 * agent" dialogs. Any MCP client works; these are the common setups, each a
 * copyable snippet. The first entry is the plain command every client runs.
 */
export interface McpSetupExample {
  /** Stable id (tab key, test hook). */
  id: string;
  /** Short tab/select label. */
  label: string;
  /** What to copy: a shell command or a config fragment. */
  snippet: string;
  /** One line shown under the snippet. */
  note?: string;
}

/** The stdio command every MCP client launches. */
export const MCP_SERVER_COMMAND = 'npx -y cubby-mcp';

export const MCP_SETUP: McpSetupExample[] = [
  {
    id: 'command',
    label: 'Any client',
    snippet: MCP_SERVER_COMMAND,
    note: 'Add this as a stdio MCP server named “cubby” in your agent’s settings.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    snippet: `claude mcp add --scope user cubby -- ${MCP_SERVER_COMMAND}`,
    note: 'Run once in a terminal, then start a new session.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    snippet: `codex mcp add cubby -- ${MCP_SERVER_COMMAND}`,
    note: 'Run once in a terminal, then start Codex.',
  },
  {
    id: 'json',
    label: 'JSON config',
    snippet: '{ "mcpServers": { "cubby": { "command": "npx", "args": ["-y", "cubby-mcp"] } } }',
    note: 'For clients with an mcpServers config file: Cursor, Windsurf, Claude Desktop and others.',
  },
];
