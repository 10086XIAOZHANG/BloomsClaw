import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'blooms-claw-demo', version: '1.0.0' });

server.tool(
  'echo',
  '回声测试：原样返回输入文本，用于验证 MCP 链路是否连通',
  { text: z.string().describe('要回显的文本') },
  async ({ text }) => ({
    content: [{ type: 'text', text: `echo:${text}` }],
  }),
);

server.tool(
  'add',
  '加法测试：返回 a + b，用于验证数字参数透传',
  {
    a: z.number().describe('加数 a'),
    b: z.number().describe('加数 b'),
  },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
);

server.tool(
  'now',
  '时间测试：返回服务器当前时间（ISO 字符串），无参数',
  {},
  async () => ({
    content: [{ type: 'text', text: new Date().toISOString() }],
  }),
);

await server.connect(new StdioServerTransport());
