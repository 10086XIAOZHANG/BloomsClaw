import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigFileService, RootConfig } from '../shared/config-file.service';
import { AgentDto } from './agents.types';

type RawAgentConfig = Record<string, unknown>;
type AgentMap = Record<string, RawAgentConfig>;

const AGENT_NOT_FOUND = 'AGENT_NOT_FOUND';
const AGENT_ALREADY_EXISTS = 'AGENT_ALREADY_EXISTS';
const INVALID_AGENT_PAYLOAD = 'INVALID_AGENT_PAYLOAD';
const INVALID_AGENT_NAME = 'INVALID_AGENT_NAME';

@Injectable()
export class AgentsService {
  constructor(private readonly configFileService: ConfigFileService) {}

  async findAll(): Promise<AgentDto[]> {
    const config = await this.readRootConfig();
    return Object.entries(config.agents ?? {}).map(([name, value]) =>
      this.toAgentDto(name, value),
    );
  }

  async findOne(name: string): Promise<AgentDto> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig();
    const agents = this.getAgentMap(config);
    const agent = agents[normalizedName];

    if (!agent) {
      throw new NotFoundException({
        message: `Agent "${normalizedName}" does not exist.`,
        error: AGENT_NOT_FOUND,
      });
    }

    return this.toAgentDto(normalizedName, agent);
  }

  async create(payload: unknown): Promise<AgentDto> {
    const agentConfig = this.validateAgentPayload(payload);
    const normalizedName = agentConfig.name;
    const config = await this.readRootConfig();
    const agents = this.getAgentMap(config);

    if (agents[normalizedName]) {
      throw new ConflictException({
        message: `Agent "${normalizedName}" already exists.`,
        error: AGENT_ALREADY_EXISTS,
      });
    }

    const storedAgent = this.toStoredAgentConfig(agentConfig);
    const nextConfig: RootConfig = {
      ...config,
      agents: {
        ...agents,
        [normalizedName]: storedAgent,
      },
    };

    await this.writeRootConfig(nextConfig);
    return this.toAgentDto(normalizedName, storedAgent);
  }

  async update(name: string, payload: unknown): Promise<AgentDto> {
    const currentName = this.validateName(name);
    const agentConfig = this.validateAgentPayload(payload);
    const nextName = agentConfig.name;
    const config = await this.readRootConfig();
    const agents = this.getAgentMap(config);

    if (!agents[currentName]) {
      throw new NotFoundException({
        message: `Agent "${currentName}" does not exist.`,
        error: AGENT_NOT_FOUND,
      });
    }

    if (currentName !== nextName && agents[nextName]) {
      throw new ConflictException({
        message: `Agent "${nextName}" already exists.`,
        error: AGENT_ALREADY_EXISTS,
      });
    }

    const storedAgent = this.toStoredAgentConfig(agentConfig);
    const nextAgents = Object.fromEntries(
      Object.entries(agents).map(([agentName, agentValue]) =>
        agentName === currentName
          ? [nextName, storedAgent]
          : [agentName, agentValue],
      ),
    ) as AgentMap;
    const nextConfig: RootConfig = {
      ...config,
      agents: nextAgents,
    };

    await this.writeRootConfig(nextConfig);
    return this.toAgentDto(nextName, storedAgent);
  }

  async remove(name: string): Promise<void> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig();
    const agents = this.getAgentMap(config);

    if (!agents[normalizedName]) {
      throw new NotFoundException({
        message: `Agent "${normalizedName}" does not exist.`,
        error: AGENT_NOT_FOUND,
      });
    }

    const { [normalizedName]: _removed, ...restAgents } = agents;
    await this.writeRootConfig({
      ...config,
      agents: restAgents,
    });
  }

  private validateName(name: string): string {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new BadRequestException({
        message: 'Agent name must not be empty.',
        error: INVALID_AGENT_NAME,
      });
    }

    return normalizedName;
  }

  private validateAgentPayload(payload: unknown): AgentDto {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException({
        message: 'Agent config must be a JSON object.',
        error: INVALID_AGENT_PAYLOAD,
      });
    }

    const candidate = payload as Record<string, unknown>;
    const name = this.validateRequiredString(candidate.name, 'name');
    const model = this.validateRequiredString(candidate.model, 'model');
    const description = this.validateRequiredString(
      candidate.description,
      'description',
    );
    const systemPrompt = this.validateRequiredString(
      candidate.systemPrompt,
      'systemPrompt',
    );
    const tools = this.validateTools(candidate.tools);
    const active = this.validateActive(candidate.active);

    return {
      name,
      model,
      tools,
      description,
      active,
      systemPrompt,
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

  private getAgentMap(config: RootConfig): AgentMap {
    return (config.agents ?? {}) as AgentMap;
  }

  private toAgentDto(name: string, raw: RawAgentConfig): AgentDto {
    const candidate = raw as Record<string, unknown>;
    const model = this.readString(candidate.model) ?? this.readString(candidate.modelId);
    const description = this.readString(candidate.description);
    const systemPrompt = this.readString(candidate.systemPrompt);
    const tools =
      this.readStringArray(candidate.tools) ??
      this.readStringArray(candidate.toolIds);
    const active =
      this.readActive(candidate.active) ?? this.readBooleanAsActive(candidate.enabled);

    if (!model || !description || !systemPrompt || !tools || active === null) {
      throw new InternalServerErrorException(
        `Agent "${name}" has invalid config shape.`,
      );
    }

    return {
      name,
      model,
      tools,
      description,
      active,
      systemPrompt,
    };
  }

  private toStoredAgentConfig(agent: AgentDto): RawAgentConfig {
    return {
      model: agent.model,
      tools: agent.tools,
      description: agent.description,
      active: agent.active,
      systemPrompt: agent.systemPrompt,
    };
  }

  private validateRequiredString(value: unknown, field: string): string {
    const normalizedValue = this.readString(value);

    if (!normalizedValue) {
      throw new BadRequestException({
        message: `Agent field "${field}" must be a non-empty string.`,
        error: INVALID_AGENT_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateTools(value: unknown): string[] {
    const tools = this.readStringArray(value);

    if (!tools) {
      throw new BadRequestException({
        message: 'Agent field "tools" must be a string array.',
        error: INVALID_AGENT_PAYLOAD,
      });
    }

    return tools;
  }

  private validateActive(value: unknown): 0 | 1 {
    const active = this.readActive(value);

    if (active === null) {
      throw new BadRequestException({
        message: 'Agent field "active" must be 0 or 1.',
        error: INVALID_AGENT_PAYLOAD,
      });
    }

    return active;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const normalized = value
      .map((item) => (typeof item === 'string' ? item.trim() : null))
      .filter((item): item is string => Boolean(item));

    return normalized.length === value.length ? normalized : null;
  }

  private readActive(value: unknown): 0 | 1 | null {
    return value === 0 || value === 1 ? value : null;
  }

  private readBooleanAsActive(value: unknown): 0 | 1 | null {
    return typeof value === 'boolean' ? (value ? 1 : 0) : null;
  }
}
