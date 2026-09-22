import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigEntry, ConfigFileService, RootConfig } from '../shared/config-file.service';
import { ModelDto } from './models.types';

type RawModelConfig = ConfigEntry;
type ModelMap = Record<string, RawModelConfig>;

const MODEL_NOT_FOUND = 'MODEL_NOT_FOUND';
const MODEL_ALREADY_EXISTS = 'MODEL_ALREADY_EXISTS';
const INVALID_MODEL_PAYLOAD = 'INVALID_MODEL_PAYLOAD';
const INVALID_MODEL_NAME = 'INVALID_MODEL_NAME';

@Injectable()
export class ModelsService {
  constructor(private readonly configFileService: ConfigFileService) {}

  async findAll(userId = 'default'): Promise<ModelDto[]> {
    const config = await this.readRootConfig(userId);
    return Object.entries(config.models ?? {}).map(([name, value]) =>
      this.toModelDto(name, value),
    );
  }

  async findOne(name: string, userId = 'default'): Promise<ModelDto> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig(userId);
    const models = this.getModelMap(config);
    const storageKey = this.findModelStorageKeyByName(models, normalizedName);
    const model = storageKey ? models[storageKey] : undefined;

    if (!model) {
      throw new NotFoundException({
        message: `Model "${normalizedName}" does not exist.`,
        error: MODEL_NOT_FOUND,
      });
    }

    return this.toModelDto(storageKey!, model);
  }

  async create(payload: unknown, userId = 'default'): Promise<ModelDto> {
    const modelConfig = this.validateModelPayload(payload);
    const normalizedName = modelConfig.name;
    const config = await this.readRootConfig(userId);
    const models = this.getModelMap(config);

    if (this.findModelStorageKeyByName(models, normalizedName)) {
      throw new ConflictException({
        message: `Model "${normalizedName}" already exists.`,
        error: MODEL_ALREADY_EXISTS,
      });
    }

    const storedModel = this.toStoredModelConfig(modelConfig);
    const nextConfig: RootConfig = {
      ...config,
      models: {
        ...models,
        [normalizedName]: storedModel,
      },
    };

    await this.writeRootConfig(nextConfig, userId);
    return this.toModelDto(normalizedName, storedModel);
  }

  async update(name: string, payload: unknown, userId = 'default'): Promise<ModelDto> {
    const currentName = this.validateName(name);
    const modelConfig = this.validateModelPayload(payload);
    const nextName = modelConfig.name;
    const config = await this.readRootConfig(userId);
    const models = this.getModelMap(config);
    const currentStorageKey = this.findModelStorageKeyByName(models, currentName);
    const nextStorageKey = this.findModelStorageKeyByName(models, nextName);

    if (!currentStorageKey) {
      throw new NotFoundException({
        message: `Model "${currentName}" does not exist.`,
        error: MODEL_NOT_FOUND,
      });
    }

    if (currentName !== nextName && nextStorageKey) {
      throw new ConflictException({
        message: `Model "${nextName}" already exists.`,
        error: MODEL_ALREADY_EXISTS,
      });
    }

    const storedModel = this.toStoredModelConfig(modelConfig);
    const nextModels = Object.fromEntries(
      Object.entries(models).map(([modelName, modelValue]) =>
        modelName === currentStorageKey
          ? [nextName, storedModel]
          : [modelName, modelValue],
      ),
    ) as ModelMap;

    const nextConfig: RootConfig = {
      ...config,
      models: nextModels,
    };

    await this.writeRootConfig(nextConfig, userId);
    return this.toModelDto(nextName, storedModel);
  }

  async remove(name: string, userId = 'default'): Promise<void> {
    const normalizedName = this.validateName(name);
    const config = await this.readRootConfig(userId);
    const models = this.getModelMap(config);
    const storageKey = this.findModelStorageKeyByName(models, normalizedName);

    if (!storageKey) {
      throw new NotFoundException({
        message: `Model "${normalizedName}" does not exist.`,
        error: MODEL_NOT_FOUND,
      });
    }

    const { [storageKey]: _removed, ...restModels } = models;
    await this.writeRootConfig(
      {
        ...config,
        models: restModels,
      },
      userId,
    );
  }

  private validateName(name: string): string {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new BadRequestException({
        message: 'Model name must not be empty.',
        error: INVALID_MODEL_NAME,
      });
    }

    return normalizedName;
  }

  private validateModelPayload(payload: unknown): ModelDto {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException({
        message: 'Model config must be a JSON object.',
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    const candidate = payload as Record<string, unknown>;

    return {
      name: this.validateRequiredString(candidate.name, 'name'),
      provider: this.validateRequiredString(candidate.provider, 'provider'),
      active: this.validateActive(candidate.active),
      id: this.validateRequiredString(candidate.id, 'id'),
      base_url: this.validateRequiredString(candidate.base_url, 'base_url'),
      api_key: this.validateStringField(candidate.api_key, 'api_key'),
      use_env_api_key: this.validateBinaryFlag(
        candidate.use_env_api_key,
        'use_env_api_key',
      ),
      temperature: this.validateTemperature(candidate.temperature),
    };
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

  private getModelMap(config: RootConfig): ModelMap {
    return (config.models ?? {}) as ModelMap;
  }

  private toModelDto(storageKey: string, raw: RawModelConfig): ModelDto {
    const candidate = raw as Record<string, unknown>;
    const id = this.readString(candidate.id) ?? storageKey;
    const modelName = this.readString(candidate.name) ?? storageKey;
    const provider = this.readString(candidate.provider);
    const baseUrl =
      this.readString(candidate.base_url) ?? this.readString(candidate.baseUrl);
    const apiKey =
      this.readNullableString(candidate.api_key) ??
      this.readNullableString(candidate.apiKey);
    const useEnvApiKey =
      this.readActive(candidate.use_env_api_key) ??
      this.readBooleanAsActive(candidate.useEnvApiKey) ??
      1;
    const temperature = this.readNumber(candidate.temperature);
    const active =
      this.readActive(candidate.active) ?? this.readBooleanAsActive(candidate.enabled);

    if (
      !id ||
      !modelName ||
      !provider ||
      !baseUrl ||
      apiKey === null ||
      temperature === null ||
      active === null
    ) {
      throw new InternalServerErrorException(
        `Model "${storageKey}" has invalid config shape.`,
      );
    }

    return {
      id,
      name: modelName,
      provider,
      active,
      base_url: baseUrl,
      api_key: apiKey,
      use_env_api_key: useEnvApiKey,
      temperature,
    };
  }

  private findModelStorageKeyByName(
    models: ModelMap,
    name: string,
  ): string | null {
    for (const [storageKey, value] of Object.entries(models)) {
      if (storageKey === name) {
        return storageKey;
      }

      const candidateName = this.readString((value as Record<string, unknown>).name);
      if (candidateName === name) {
        return storageKey;
      }
    }

    return null;
  }

  private toStoredModelConfig(model: ModelDto): RawModelConfig {
    return {
      id: model.id,
      name: model.name,
      provider: model.provider,
      active: model.active,
      base_url: model.base_url,
      api_key: model.api_key,
      use_env_api_key: model.use_env_api_key,
      temperature: model.temperature,
    };
  }

  private validateRequiredString(value: unknown, field: string): string {
    const normalizedValue = this.readString(value);

    if (!normalizedValue) {
      throw new BadRequestException({
        message: `Model field "${field}" must be a non-empty string.`,
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateStringField(value: unknown, field: string): string {
    const normalizedValue = this.readNullableString(value);

    if (normalizedValue === null) {
      throw new BadRequestException({
        message: `Model field "${field}" must be a string.`,
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateActive(value: unknown): 0 | 1 {
    const active = this.readActive(value);

    if (active === null) {
      throw new BadRequestException({
        message: 'Model field "active" must be 0 or 1.',
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    return active;
  }

  private validateBinaryFlag(value: unknown, field: string): 0 | 1 {
    const flag = this.readActive(value);

    if (flag === null) {
      throw new BadRequestException({
        message: `Model field "${field}" must be 0 or 1.`,
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    return flag;
  }

  private validateTemperature(value: unknown): number {
    const temperature = this.readNumber(value);

    if (temperature === null) {
      throw new BadRequestException({
        message: 'Model field "temperature" must be a finite number.',
        error: INVALID_MODEL_PAYLOAD,
      });
    }

    return temperature;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private readNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    return value.trim();
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readActive(value: unknown): 0 | 1 | null {
    return value === 0 || value === 1 ? value : null;
  }

  private readBooleanAsActive(value: unknown): 0 | 1 | null {
    return typeof value === 'boolean' ? (value ? 1 : 0) : null;
  }
}
