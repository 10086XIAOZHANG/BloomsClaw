import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3100);

function createServer() {
  const server = new McpServer({ name: 'blooms-claw-demo-http', version: '1.0.0' });

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

  return server;
}

// StreamableHTTP 是有状态会话：每个 session id 对应一个 transport
const transports = new Map();

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

const httpServer = (await import('node:http')).createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, mcp: `http://localhost:${PORT}/mcp` });
  }

  if (url.pathname !== '/mcp') {
    return sendJson(res, 404, { code: 404, data: null, msg: `Cannot ${req.method} ${url.pathname}` });
  }

  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (!sessionId && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => transports.set(id, transport),
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };
        await createServer().connect(transport);
      } else {
        return sendJson(res, 400, {
          code: 400,
          data: null,
          msg: 'Invalid MCP session: missing mcp-session-id',
        });
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !transports.has(sessionId)) {
        return sendJson(res, 400, {
          code: 400,
          data: null,
          msg: 'Invalid or missing session ID',
        });
      }
      const transport = transports.get(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    return sendJson(res, 405, { code: 405, data: null, msg: `Method ${req.method} not allowed` });
  } catch (error) {
    console.error('[mcp-demo-http] request failed:', error);
    if (!res.headersSent) {
      return sendJson(res, 500, {
        code: 500,
        data: null,
        msg: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[mcp-demo-http] listening on http://localhost:${PORT}/mcp`);
  console.log(`[mcp-demo-http] health check: http://localhost:${PORT}/health`);
});
