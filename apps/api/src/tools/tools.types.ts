export type McpTransport = 'stdio' | 'streamableHttp' | 'sse';

export interface McpConfigDto {
  transport: McpTransport;
  /** stdio 专用：启动命令，例如 npx / uvx / python */
  command?: string;
  /** stdio 专用：启动参数 */
  args?: string[];
  /** stdio 专用：环境变量 */
  env?: Record<string, string>;
  /** stdio 专用：工作目录（可选） */
  cwd?: string;
  /** streamableHttp / sse 专用：服务端地址 */
  url?: string;
  /** streamableHttp / sse 专用：请求头 */
  headers?: Record<string, string>;
}

export interface ToolDto {
  name: string;
  description: string;
  active: 0 | 1;
  builtin: 0 | 1;
  /** 仅自定义工具（builtin=0）需要填写，代表一个 MCP Server */
  mcp?: McpConfigDto | null;
}

export interface RemoteMcpToolMeta {
  name: string;
  description: string;
}
