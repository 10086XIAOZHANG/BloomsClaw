import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ConfigEntry,
  ConfigFileService,
  RootConfig,
} from '../shared/config-file.service';
import { McpConfigDto, RemoteMcpToolMeta, ToolDto } from './tools.types';

type RawToolConfig = ConfigEntry;
type ToolMap = Record<string, RawToolConfig>;

const TOOL_NOT_FOUND = 'TOOL_NOT_FOUND';
const TOOL_ALREADY_EXISTS = 'TOOL_ALREADY_EXISTS';
const INVALID_TOOL_PAYLOAD = 'INVALID_TOOL_PAYLOAD';
const INVALID_TOOL_NAME = 'INVALID_TOOL_NAME';
const MCP_UNREACHABLE = 'MCP_UNREACHABLE';

const MCP_CONNECT_TIMEOUT_MS = 15000;

const BUILTIN_TOOLS: Record<string, ToolDto> = {
  FileTools: { name: 'FileTools', description: '文件读写工具', active: 1, builtin: 1 },
  RunCommand: { name: 'RunCommand', description: '命令执行工具', active: 1, builtin: 1 },
  WebSearch: { name: 'WebSearch', description: '网页搜索工具', active: 1, builtin: 1 },
  Calculator: { name: 'Calculator', description: '数学计算工具', active: 1, builtin: 1 },
  SendEmail: { name: 'SendEmail', description: '通过 SMTP 发送邮件工具', active: 1, builtin: 1 },
};

@Injectable()
export class ToolsService {
  constructor(private readonly configFileService: ConfigFileService) {}

  async findAll(userId = 'default'): Promise<ToolDto[]> {
    const config = await this.readRootConfig(userId);
    const tools = {
      ...BUILTIN_TOOLS,
      ...(config.tools ?? {}),
    };
    return Object.entries(tools).map(([name, value]) =>
      this.toToolDto(name, value as any),
    );
  }

  async findOne(name: string, userId = 'default'): Promise<ToolDto> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig(userId);
    const tools = this.getVisibleToolMap(config);
    const tool = tools[normalizedName];

    if (!tool) {
      throw new NotFoundException({
        message: `Tool "${normalizedName}" does not exist.`,
        error: TOOL_NOT_FOUND,
      });
    }

    return this.toToolDto(normalizedName, tool);
  }

  /** 连接 MCP Server 并返回其暴露的工具列表（仅透传 name + description） */
  async listRemoteTools(name: string, userId = 'default'): Promise<RemoteMcpToolMeta[]> {
    const dto = await this.findOne(name, userId);
    if (dto.builtin === 1 || !dto.mcp) {
      throw new BadRequestException({
        message: 'Only MCP tools support remote tool listing.',
        error: INVALID_TOOL_PAYLOAD,
      });
    }
    return this.fetchRemoteTools(dto.mcp);
  }

  /**
   * 仅校验 MCP 配置连通性，不落盘。
   * 给前端“新建前先测试连接”用：参数错 / 连不通直接 400，成功返回远端工具列表。
   */
  async validateMcpConfigAndListTools(
    payload: unknown,
  ): Promise<{ ok: true; tools: RemoteMcpToolMeta[] }> {
    const candidate =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    // 兼容两种传参：整包 { name, description, mcp } 或裸 { mcp } / 裸 mcp
    const mcpRaw = candidate?.mcp ?? candidate?.config ?? payload;
    const mcp = this.validateMcpConfig(mcpRaw);
    const tools = await this.fetchRemoteTools(mcp);
    return { ok: true, tools };
  }

  async create(payload: unknown, userId = 'default'): Promise<ToolDto> {
    const toolConfig = this.validateToolPayload(payload, { isCreate: true });
    const normalizedName = toolConfig.name;
    const config = await this.readRootConfig(userId);
    const tools = this.getToolMap(config);

    if (tools[normalizedName]) {
      throw new ConflictException({
        message: `Tool "${normalizedName}" already exists.`,
        error: TOOL_ALREADY_EXISTS,
      });
    }

    // 自定义工具 = MCP Server：创建前必须能连通并拉到工具列表，否则拒绝落盘
    if (toolConfig.builtin === 0 && toolConfig.mcp) {
      await this.fetchRemoteTools(toolConfig.mcp);
    }

    const storedTool = this.toStoredToolConfig(toolConfig);
    const nextConfig: RootConfig = {
      ...config,
      tools: {
        ...tools,
        [normalizedName]: storedTool,
      },
    };

    await this.writeRootConfig(nextConfig, userId);
    return this.toToolDto(normalizedName, storedTool);
  }

  async update(name: string, payload: unknown, userId = 'default'): Promise<ToolDto> {
    const currentName = this.validateName(name);
    const toolConfig = this.validateToolPayload(payload, { isCreate: false });
    const nextName = toolConfig.name;
    const config = await this.readRootConfig(userId);
    const tools = this.getToolMap(config);

    if (!tools[currentName]) {
      throw new NotFoundException({
        message: `Tool "${currentName}" does not exist.`,
        error: TOOL_NOT_FOUND,
      });
    }

    if (currentName !== nextName && tools[nextName]) {
      throw new ConflictException({
        message: `Tool "${nextName}" already exists.`,
        error: TOOL_ALREADY_EXISTS,
      });
    }

    if (toolConfig.builtin === 0 && toolConfig.mcp) {
      await this.fetchRemoteTools(toolConfig.mcp);
    }

    const storedTool = this.toStoredToolConfig(toolConfig);
    const nextTools = Object.fromEntries(
      Object.entries(tools).map(([toolName, toolValue]) =>
        toolName === currentName ? [nextName, storedTool] : [toolName, toolValue],
      ),
    ) as ToolMap;
    const nextConfig: RootConfig = {
      ...config,
      tools: nextTools,
    };

    await this.writeRootConfig(nextConfig, userId);
    return this.toToolDto(nextName, storedTool);
  }

  async remove(name: string, userId = 'default'): Promise<void> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig(userId);
    const tools = this.getToolMap(config);

    if (!tools[normalizedName]) {
      throw new NotFoundException({
        message: `Tool "${normalizedName}" does not exist.`,
        error: TOOL_NOT_FOUND,
      });
    }

    const { [normalizedName]: _removed, ...restTools } = tools;
    await this.writeRootConfig({
      ...config,
      tools: restTools,
    }, userId);
  }

  private validateName(name: string): string {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new BadRequestException({
        message: 'Tool name must not be empty.',
        error: INVALID_TOOL_NAME,
      });
    }

    return normalizedName;
  }

  private validateToolPayload(payload: unknown, options: { isCreate: boolean }): ToolDto {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException({
        message: 'Tool config must be a JSON object.',
        error: INVALID_TOOL_PAYLOAD,
      });
    }

    const candidate = payload as Record<string, unknown>;
    const builtin = this.validateFlag(candidate.builtin, 'builtin');

    // 内置工具：只允许前端传 name/description/active/builtin，老数据无 mcp 也兼容
    if (builtin === 1) {
      return {
        name: this.validateRequiredString(candidate.name, 'name'),
        description: this.validateRequiredString(candidate.description, 'description'),
        active: 1,
        builtin: 1,
      };
    }

    // 自定义工具：只能是 MCP Server，builtin 强制 0
    return {
      name: this.validateRequiredString(candidate.name, 'name'),
      description: this.validateRequiredString(candidate.description, 'description'),
      active: this.validateFlag(candidate.active, 'active'),
      builtin: 0,
      mcp: this.validateMcpConfig(candidate.mcp),
    };
  }

  private validateMcpConfig(value: unknown): McpConfigDto {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException({
        message: 'MCP tools require a valid "mcp" config object.',
        error: INVALID_TOOL_PAYLOAD,
      });
    }
    const candidate = value as Record<string, unknown>;
    const transport = candidate.transport;
    if (transport !== 'stdio' && transport !== 'streamableHttp' && transport !== 'sse') {
      throw new BadRequestException({
        message: 'Tool field "mcp.transport" must be stdio, streamableHttp or sse.',
        error: INVALID_TOOL_PAYLOAD,
      });
    }

    if (transport === 'stdio') {
      const command = this.validateRequiredString(candidate.command, 'mcp.command');
      const args = this.validateStringArray(candidate.args, 'mcp.args', { allowMissing: true }) ?? [];
      const rawEnv = this.validateStringRecord(candidate.env, 'mcp.env', { allowMissing: true });
      const env = rawEnv && Object.keys(rawEnv).length > 0 ? rawEnv : undefined;
      const cwd = typeof candidate.cwd === 'string' && candidate.cwd.trim()
        ? candidate.cwd.trim()
        : undefined;
      return { transport, command, args, ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) };
    }

    const url = this.validateRequiredString(candidate.url, 'mcp.url');
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException({
        message: 'Tool field "mcp.url" must start with http:// or https://.',
        error: INVALID_TOOL_PAYLOAD,
      });
    }
    const rawHeaders = this.validateStringRecord(candidate.headers, 'mcp.headers', { allowMissing: true });
    const headers =
      rawHeaders && Object.keys(rawHeaders).length > 0 ? rawHeaders : undefined;
    return { transport, url, ...(headers ? { headers } : {}) };
  }

  private async fetchRemoteTools(mcp: McpConfigDto): Promise<RemoteMcpToolMeta[]> {
    const client = new Client({ name: 'blooms-claw-tools-validator', version: '1.0.0' });
    const transport = this.buildMcpTransport(mcp);
    try {
      await this.withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, '连接 MCP Server 超时');
      const result = await this.withTimeout(
        client.listTools(),
        MCP_CONNECT_TIMEOUT_MS,
        '读取 MCP 工具列表超时',
      );
      const remoteTools = (result as { tools?: Array<{ name: string; description?: unknown }> }).tools ?? [];
      return remoteTools.map((item) => ({
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
      }));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        message: `无法连接 MCP Server: ${error instanceof Error ? error.message : '未知错误'}`,
        error: MCP_UNREACHABLE,
      });
    } finally {
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
      try {
        await transport.close();
      } catch {
        // ignore close errors
      }
    }
  }

  private buildMcpTransport(mcp: McpConfigDto) {
    if (mcp.transport === 'stdio') {
      return new StdioClientTransport({
        command: mcp.command as string,
        args: mcp.args ?? [],
        ...(mcp.env ? { env: mcp.env } : {}),
        ...(mcp.cwd ? { cwd: mcp.cwd } : {}),
        stderr: 'ignore',
      });
    }
    if (mcp.transport === 'sse') {
      return new SSEClientTransport(new URL(mcp.url as string), {
        requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
      });
    }
    return new StreamableHTTPClientTransport(new URL(mcp.url as string), {
      requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
    });
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async readRootConfig(userId = 'default'): Promise<RootConfig> {
    try {
      return await this.configFileService.readConfig(userId);
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private async writeRootConfig(config: RootConfig, userId = 'default'): Promise<void> {
    try {
      await this.configFileService.writeConfig(config, userId);
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private wrapConfigError(error: unknown): InternalServerErrorException {
    const message =
      error instanceof Error ? error.message : 'Failed to access config file.';
    return new InternalServerErrorException(message);
  }

  private getVisibleToolMap(config: RootConfig): ToolMap {
    const map = this.getToolMap(config);
    return {
      ...BUILTIN_TOOLS,
      ...map,
    } as ToolMap;
  }

  private getToolMap(config: RootConfig): ToolMap {
    return (config.tools ?? {}) as ToolMap;
  }

  private toToolDto(name: string, raw: RawToolConfig): ToolDto {
    const candidate = raw as Record<string, unknown>;
    const description = this.readString(candidate.description);
    const builtin =
      this.readFlag(candidate.builtin) ?? this.readBooleanAsFlag(candidate.builtin);

    if (!description || builtin === null) {
      throw new InternalServerErrorException(
        `Tool "${name}" has invalid config shape.`,
      );
    }

    // 内置工具强制启用，前端开关置灰不可关闭，后端直接返回 active=1
    if (builtin === 1) {
      return {
        name,
        description,
        active: 1,
        builtin: 1,
      };
    }

    const active =
      this.readFlag(candidate.active) ?? this.readBooleanAsFlag(candidate.enabled);

    if (active === null) {
      throw new InternalServerErrorException(
        `Tool "${name}" has invalid config shape.`,
      );
    }

    const mcp = this.readMcpConfig(candidate.mcp);

    // 老数据（改造前创建的自定义工具）没有 mcp 配置：不直接 500，
    // 返回 mcp=null，前端会提示“缺少 MCP 配置，请删除重建”，agent-core 加载时跳过
    return {
      name,
      description,
      active,
      builtin,
      mcp,
    };
  }

  private toStoredToolConfig(tool: ToolDto): RawToolConfig {
    // 内置工具强制启用，防止通过 PUT 关闭
    if (tool.builtin === 1) {
      return {
        description: tool.description,
        active: 1,
        builtin: tool.builtin,
      };
    }
    return {
      description: tool.description,
      active: tool.active,
      builtin: 0,
      mcp: tool.mcp as unknown as Record<string, unknown>,
    };
  }

  private validateRequiredString(value: unknown, field: string): string {
    const normalizedValue = this.readString(value);

    if (!normalizedValue) {
      throw new BadRequestException({
        message: `Tool field "${field}" must be a non-empty string.`,
        error: INVALID_TOOL_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateStringArray(
    value: unknown,
    field: string,
    options: { allowMissing?: boolean } = {},
  ): string[] | undefined {
    if (value === undefined && options.allowMissing) {
      return undefined;
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new BadRequestException({
        message: `Tool field "${field}" must be a string array.`,
        error: INVALID_TOOL_PAYLOAD,
      });
    }
    return value as string[];
  }

  private validateStringRecord(
    value: unknown,
    field: string,
    options: { allowMissing?: boolean } = {},
  ): Record<string, string> | undefined {
    if (value === undefined && options.allowMissing) {
      return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException({
        message: `Tool field "${field}" must be an object of string values.`,
        error: INVALID_TOOL_PAYLOAD,
      });
    }
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries) {
      if (!key.trim() || typeof item !== 'string') {
        throw new BadRequestException({
          message: `Tool field "${field}" must be an object of string values.`,
          error: INVALID_TOOL_PAYLOAD,
        });
      }
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, item as string]));
  }

  private readMcpConfig(value: unknown): McpConfigDto | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    try {
      return this.validateMcpConfig(value);
    } catch {
      return null;
    }
  }

  private validateFlag(value: unknown, field: string): 0 | 1 {
    const flag = this.readFlag(value);

    if (flag === null) {
      throw new BadRequestException({
        message: `Tool field "${field}" must be 0 or 1.`,
        error: INVALID_TOOL_PAYLOAD,
      });
    }

    return flag;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private readFlag(value: unknown): 0 | 1 | null {
    return value === 0 || value === 1 ? value : null;
  }

  private readBooleanAsFlag(value: unknown): 0 | 1 | null {
    return typeof value === 'boolean' ? (value ? 1 : 0) : null;
  }
}
