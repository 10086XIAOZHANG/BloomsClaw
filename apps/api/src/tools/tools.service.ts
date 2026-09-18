import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfigEntry,
  ConfigFileService,
  RootConfig,
} from '../shared/config-file.service';
import { ToolDto } from './tools.types';

type RawToolConfig = ConfigEntry;
type ToolMap = Record<string, RawToolConfig>;

const TOOL_NOT_FOUND = 'TOOL_NOT_FOUND';
const TOOL_ALREADY_EXISTS = 'TOOL_ALREADY_EXISTS';
const INVALID_TOOL_PAYLOAD = 'INVALID_TOOL_PAYLOAD';
const INVALID_TOOL_NAME = 'INVALID_TOOL_NAME';

@Injectable()
export class ToolsService {
  constructor(private readonly configFileService: ConfigFileService) {}

  async findAll(): Promise<ToolDto[]> {
    const config = await this.readRootConfig();
    return Object.entries(config.tools ?? {}).map(([name, value]) =>
      this.toToolDto(name, value),
    );
  }

  async findOne(name: string): Promise<ToolDto> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig();
    const tools = this.getToolMap(config);
    const tool = tools[normalizedName];

    if (!tool) {
      throw new NotFoundException({
        message: `Tool "${normalizedName}" does not exist.`,
        error: TOOL_NOT_FOUND,
      });
    }

    return this.toToolDto(normalizedName, tool);
  }

  async create(payload: unknown): Promise<ToolDto> {
    const toolConfig = this.validateToolPayload(payload);
    const normalizedName = toolConfig.name;
    const config = await this.readRootConfig();
    const tools = this.getToolMap(config);

    if (tools[normalizedName]) {
      throw new ConflictException({
        message: `Tool "${normalizedName}" already exists.`,
        error: TOOL_ALREADY_EXISTS,
      });
    }

    const storedTool = this.toStoredToolConfig(toolConfig);
    const nextConfig: RootConfig = {
      ...config,
      tools: {
        ...tools,
        [normalizedName]: storedTool,
      },
    };

    await this.writeRootConfig(nextConfig);
    return this.toToolDto(normalizedName, storedTool);
  }

  async update(name: string, payload: unknown): Promise<ToolDto> {
    const currentName = this.validateName(name);
    const toolConfig = this.validateToolPayload(payload);
    const nextName = toolConfig.name;
    const config = await this.readRootConfig();
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

    await this.writeRootConfig(nextConfig);
    return this.toToolDto(nextName, storedTool);
  }

  async remove(name: string): Promise<void> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig();
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
    });
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

  private validateToolPayload(payload: unknown): ToolDto {
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

    return {
      name: this.validateRequiredString(candidate.name, 'name'),
      description: this.validateRequiredString(candidate.description, 'description'),
      active: this.validateFlag(candidate.active, 'active'),
      builtin: this.validateFlag(candidate.builtin, 'builtin'),
    };
  }

  private async readRootConfig(): Promise<RootConfig> {
    try {
      return await this.configFileService.readConfig();
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private async writeRootConfig(config: RootConfig): Promise<void> {
    try {
      await this.configFileService.writeConfig(config);
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private wrapConfigError(error: unknown): InternalServerErrorException {
    const message =
      error instanceof Error ? error.message : 'Failed to access config file.';
    return new InternalServerErrorException(message);
  }

  private getToolMap(config: RootConfig): ToolMap {
    return (config.tools ?? {}) as ToolMap;
  }

  private toToolDto(name: string, raw: RawToolConfig): ToolDto {
    const candidate = raw as Record<string, unknown>;
    const description = this.readString(candidate.description);
    const active =
      this.readFlag(candidate.active) ?? this.readBooleanAsFlag(candidate.enabled);
    const builtin =
      this.readFlag(candidate.builtin) ?? this.readBooleanAsFlag(candidate.builtin);

    if (!description || active === null || builtin === null) {
      throw new InternalServerErrorException(
        `Tool "${name}" has invalid config shape.`,
      );
    }

    return {
      name,
      description,
      active,
      builtin,
    };
  }

  private toStoredToolConfig(tool: ToolDto): RawToolConfig {
    return {
      description: tool.description,
      active: tool.active,
      builtin: tool.builtin,
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
