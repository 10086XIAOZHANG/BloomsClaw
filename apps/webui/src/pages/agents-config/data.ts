export type AgentItem = {
  id: string;
  name: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  enabled: boolean;
  toolIds: string[];
};

export type ModelItem = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  useEnvApiKey: boolean;
  temperature: number;
  enabled: boolean;
};

export type McpTransport = 'stdio' | 'streamableHttp' | 'sse';

export type McpConfig = {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
};

export type ToolItem = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  /** 仅 MCP 自定义工具填写，代表一个 MCP Server */
  mcp?: McpConfig | null;
};

export type RemoteMcpToolMeta = {
  name: string;
  description: string;
};

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  installCommand: string;
  installedAt: string;
};

export const MODEL_PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Qwen', value: 'qwen' },
];

export const MCP_TRANSPORT_OPTIONS = [
  { label: 'stdio（本地进程）', value: 'stdio' },
  { label: 'streamableHttp（远程 HTTP）', value: 'streamableHttp' },
  { label: 'sse（兼容老服务）', value: 'sse' },
];

export const createEmptyAgent = (): AgentItem => ({
  id: '',
  name: '',
  description: '',
  modelId: '',
  systemPrompt: '',
  enabled: true,
  toolIds: [],
});

export const createEmptyModel = (): ModelItem => ({
  id: '',
  name: '',
  provider: 'openai',
  model: '',
  baseUrl: '',
  apiKey: '',
  useEnvApiKey: true,
  temperature: 0.7,
  enabled: true,
});

export const createEmptyTool = (): ToolItem => ({
  id: '',
  name: '',
  description: '',
  builtin: false,
  enabled: true,
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    env: {},
  },
});

export const parseEnvText = (text: string): Record<string, string> => {
  const result: Record<string, string> = {};
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index <= 0) {
        return;
      }
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) {
        result[key] = value;
      }
    });
  return result;
};

export const stringifyEnvRecord = (env?: Record<string, string>): string =>
  Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

export const parseMultilineText = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export const parseHeadersText = (text: string): Record<string, string> => {
  const result: Record<string, string> = {};
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .forEach((line) => {
      const index = line.indexOf(':');
      if (index <= 0) {
        return;
      }
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) {
        result[key] = value;
      }
    });
  return result;
};

export const stringifyHeadersRecord = (headers?: Record<string, string>): string =>
  Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
