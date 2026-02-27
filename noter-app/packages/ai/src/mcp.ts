export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}

export class MCPClient {
  constructor(private url: string) {}

  async listTools(): Promise<MCPTool[]> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listTools', id: 1 })
      });
      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error('MCP ListTools Error:', error);
      return [];
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'callTool', params: { name, args }, id: 2 })
      });
      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('MCP CallTool Error:', error);
      throw error;
    }
  }
}
