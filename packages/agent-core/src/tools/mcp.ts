import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tool } from '@langchain/core/tools';
import fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { resolveConfigPath } from '../readConfig';

export type McpTransportKind = 'stdio' | 'streamableHttp' | 'sse';

export interface McpServerConfig {
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpToolBinding {
  serverName: string;
  serverConfig: McpServerConfig;
}

export interface LoadedMcpTools {
  tools: Array<ReturnType<typeof tool>>;
  close: () => Promise<void>;
}

interface RootConfigFile {
  agents?: Record<string, Record<string, unknown>>;
  tools?: Record<string, Record<string, unknown>>;
}

function getConfigPath(userId?: string): string {
  return resolveConfigPath(userId);
}

function readRootConfig(userId?: string): RootConfigFile | null {
  try {
    return JSON.parse(
      fs.readFileSync(getConfigPath(userId)).toString(),
    ) as RootConfigFile;
  } catch (error) {
    console.error('[mcp] 读取全局配置失败', error);
    return null;
  }
}

function isToolActive(value: Record<string, unknown> | undefined): boolean {
  if (!value) {
    return false;
  }
  if (value.active === 0 || value.active === false) {
    return false;
  }
  return true;
}

function parseMcpServerConfig(name: string, value: Record<string, unknown>): McpServerConfig | null {
  const raw = value.mcp;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const transport = candidate.transport;
  if (transport !== 'stdio' && transport !== 'streamableHttp' && transport !== 'sse') {
    console.error(`[mcp] ${name} 的 mcp.transport 非法: ${String(transport)}`);
    return null;
  }
  if (transport === 'stdio') {
    if (typeof candidate.command !== 'string' || !candidate.command.trim()) {
      console.error(`[mcp] ${name} 缺少 mcp.command`);
      return null;
    }
    return {
      transport,
      command: candidate.command.trim(),
      args: Array.isArray(candidate.args)
        ? candidate.args.filter((item): item is string => typeof item === 'string')
        : [],
      env:
        typeof candidate.env === 'object' && candidate.env !== null && !Array.isArray(candidate.env)
          ? (candidate.env as Record<string, string>)
          : undefined,
      cwd: typeof candidate.cwd === 'string' && candidate.cwd.trim() ? candidate.cwd.trim() : undefined,
    };
  }
  if (typeof candidate.url !== 'string' || !/^https?:\/\//i.test(candidate.url.trim())) {
    console.error(`[mcp] ${name} 的 mcp.url 非法`);
    return null;
  }
  return {
    transport,
    url: candidate.url.trim(),
    headers:
      typeof candidate.headers === 'object' && candidate.headers !== null && !Array.isArray(candidate.headers)
        ? (candidate.headers as Record<string, string>)
        : undefined,
  };
}

/** 读取某个 agent 绑定的、且全局 active 的 MCP Servers */
export function listMcpBindingsForAgent(agentName: string, userId?: string): McpToolBinding[] {
  const config = readRootConfig(userId);
  if (!config) {
    return [];
  }
  const agentConfig = (config.agents ?? {})[agentName];
  if (!agentConfig) {
    return [];
  }
  const boundNames = Array.isArray(agentConfig.tools)
    ? agentConfig.tools.filter((item): item is string => typeof item === 'string')
    : [];
  if (boundNames.length === 0) {
    return [];
  }
  const toolsConfig = config.tools ?? {};
  const bindings: McpToolBinding[] = [];
  for (const name of boundNames) {
    const toolConfig = toolsConfig[name];
    if (!toolConfig || !isToolActive(toolConfig)) {
      continue;
    }
    // 内置工具不是 MCP，直接跳过（由 runtime 其他逻辑加载）
    if (toolConfig.builtin === 1 || toolConfig.builtin === true) {
      continue;
    }
    // 老数据无 mcp：跳过，前端会提示删除重建
    if (toolConfig.mcp == null) {
      console.error(`[mcp] ${name} 缺少 mcp 配置，请在 WebUI 删除重建为 MCP 工具`);
      continue;
    }
    const serverConfig = parseMcpServerConfig(name, toolConfig);
    if (!serverConfig) {
      continue;
    }
    bindings.push({ serverName: name, serverConfig });
  }
  return bindings;
}

function buildTransport(serverConfig: McpServerConfig) {
  if (serverConfig.transport === 'stdio') {
    return new StdioClientTransport({
      command: serverConfig.command as string,
      args: serverConfig.args ?? [],
      ...(serverConfig.env ? { env: serverConfig.env } : {}),
      ...(serverConfig.cwd ? { cwd: serverConfig.cwd } : {}),
      stderr: 'ignore',
    });
  }
  if (serverConfig.transport === 'sse') {
    return new SSEClientTransport(new URL(serverConfig.url as string), {
      requestInit: serverConfig.headers ? { headers: serverConfig.headers } : undefined,
    });
  }
  return new StreamableHTTPClientTransport(new URL(serverConfig.url as string), {
    requestInit: serverConfig.headers ? { headers: serverConfig.headers } : undefined,
  });
}

function formatMcpResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((block) => {
        if (typeof block === 'string') {
          return block;
        }
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '');
        }
        if (block && typeof block === 'object' && 'data' in block) {
          return JSON.stringify(block);
        }
        return JSON.stringify(block);
      })
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function sanitizeToolName(serverName: string, remoteName: string): string {
  const raw = `${serverName}__${remoteName}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return raw.slice(0, 64) || `${serverName}__tool`;
}

/**
 * 为指定 agent 加载其绑定的 MCP 远端工具。
 * 每个远端 tool 被包装成独立的 langchain tool：`<server>__<tool>`，
 * 调用时按需建连（stdio 拉起子进程 / http 建会话），callTool 后即关闭。
 */
export async function loadMcpToolsForAgent(agentName: string, userId?: string): Promise<LoadedMcpTools> {
  const bindings = listMcpBindingsForAgent(agentName, userId);
  if (bindings.length === 0) {
    return { tools: [], close: async () => {} };
  }

  const tools: Array<ReturnType<typeof tool>> = [];
  const errors: string[] = [];

  for (const binding of bindings) {
    let client: Client | undefined;
    let transport: ReturnType<typeof buildTransport> | undefined;
    try {
      client = new Client({ name: `blooms-claw-${binding.serverName}`, version: '1.0.0' });
      transport = buildTransport(binding.serverConfig);
      await client.connect(transport);
      const listed = await client.listTools();
      const remoteTools = listed.tools ?? [];
      try {
        await client.close();
      } catch {
        // ignore
      }
      try {
        await transport.close();
      } catch {
        // ignore
      }
      client = undefined;
      transport = undefined;

      for (const remote of remoteTools) {
        const toolName = sanitizeToolName(binding.serverName, remote.name);
        const description = `[MCP:${binding.serverName}] ${remote.description ?? remote.name}`;
        const inputSchema = (remote.inputSchema ?? {
          type: 'object',
          properties: {},
        }) as Record<string, unknown>;
        const serverConfig = binding.serverConfig;
        const remoteName = remote.name;
        const serverName = binding.serverName;
        tools.push(
          tool(
            async (input: Record<string, unknown>) => {
              const callClient = new Client({ name: `blooms-claw-${serverName}-call`, version: '1.0.0' });
              const callTransport = buildTransport(serverConfig);
              try {
                await callClient.connect(callTransport);
                const result = await callClient.callTool({
                  name: remoteName,
                  arguments: (input ?? {}) as Record<string, unknown>,
                });
                return formatMcpResult(result);
              } catch (error) {
                return `MCP 工具调用失败 [${serverName}.${remoteName}]: ${error instanceof Error ? error.message : '未知错误'}`;
              } finally {
                try {
                  await callClient.close();
                } catch {
                  // ignore
                }
                try {
                  await callTransport.close();
                } catch {
                  // ignore
                }
              }
            },
            {
              name: toolName,
              description,
              schema: inputSchema as never,
            },
          ),
        );
      }
    } catch (error) {
      errors.push(
        `[${binding.serverName}] ${error instanceof Error ? error.message : '未知错误'}`,
      );
      try {
        await client?.close();
      } catch {
        // ignore
      }
      try {
        await transport?.close();
      } catch {
        // ignore
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[mcp] 部分 MCP Server 连接失败: ${errors.join('；')}`);
  }

  return { tools, close: async () => {} };
}
