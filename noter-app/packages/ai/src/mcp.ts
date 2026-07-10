export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}

/** Abortable fetch with a hard deadline — a hung MCP server (accepts the TCP connection but
 *  never responds) must never hang the agent loop/AI chat forever. Manual AbortController +
 *  timer so it works in browsers, Node and Hermes alike. */
const fetchWithDeadline = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const LIST_TOOLS_TIMEOUT_MS = 10_000;
const CALL_TOOL_TIMEOUT_MS = 60_000; // tools may legitimately be slow (searches, file ops)

export class MCPClient {
  constructor(private url: string) {}

  async listTools(): Promise<MCPTool[]> {
    try {
      const response = await fetchWithDeadline(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listTools', id: 1 })
      }, LIST_TOOLS_TIMEOUT_MS);
      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error('MCP ListTools Error:', error);
      return [];
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      const response = await fetchWithDeadline(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'callTool', params: { name, args }, id: 2 })
      }, CALL_TOOL_TIMEOUT_MS);
      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('MCP CallTool Error:', error);
      throw error;
    }
  }
}
