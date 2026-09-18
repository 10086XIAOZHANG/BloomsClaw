import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigFileService, RootConfig } from '../shared/config-file.service';
import { ModelsService } from './models.service';
import { ModelDto } from './models.types';

describe('ModelsService', () => {
  let service: ModelsService;
  let configFileService: Pick<
    jest.Mocked<ConfigFileService>,
    'getConfigPath' | 'readConfig' | 'writeConfig'
  >;
  let store: RootConfig;

  beforeEach(() => {
    store = {
      models: {
        'Qwen Plus': {
          id: 'model-qwen-plus',
          name: 'Qwen Plus',
          provider: 'qwen',
          active: 1,
          base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          api_key: '',
          use_env_api_key: 1,
          temperature: 0.7,
        },
      },
      tools: {
        browser: {
          enabled: true,
        },
      },
    };

    configFileService = {
      getConfigPath: jest.fn().mockReturnValue('/tmp/imooc_claw.json'),
      readConfig: jest.fn(async () => structuredClone(store)),
      writeConfig: jest.fn(async (nextConfig: RootConfig) => {
        store = structuredClone(nextConfig);
      }),
    };

    service = new ModelsService(configFileService as unknown as ConfigFileService);
  });

  it('returns all models', async () => {
    await expect(service.findAll()).resolves.toEqual([
      {
        id: 'model-qwen-plus',
        name: 'Qwen Plus',
        provider: 'qwen',
        active: 1,
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api_key: '',
        use_env_api_key: 1,
        temperature: 0.7,
      },
    ]);
  });

  it('returns a single model', async () => {
    await expect(service.findOne('Qwen Plus')).resolves.toEqual({
      id: 'model-qwen-plus',
      name: 'Qwen Plus',
      provider: 'qwen',
      active: 1,
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api_key: '',
      use_env_api_key: 1,
      temperature: 0.7,
    });
  });

  it('creates a new model and keeps other root keys', async () => {
    const payload: ModelDto = {
      id: 'model-deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'deepseek',
      active: 1,
      base_url: 'https://api.deepseek.com',
      api_key: 'sk-test',
      use_env_api_key: 0,
      temperature: 0.3,
    };

    await expect(service.create(payload)).resolves.toEqual(payload);
    expect(store.tools).toEqual({
      browser: {
        enabled: true,
      },
    });
    expect(store.models).toEqual({
      'Qwen Plus': {
        id: 'model-qwen-plus',
        name: 'Qwen Plus',
        provider: 'qwen',
        active: 1,
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api_key: '',
        use_env_api_key: 1,
        temperature: 0.7,
      },
      'DeepSeek Chat': {
        id: 'model-deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'deepseek',
        active: 1,
        base_url: 'https://api.deepseek.com',
        api_key: 'sk-test',
        use_env_api_key: 0,
        temperature: 0.3,
      },
    });
  });

  it('updates and renames an existing model', async () => {
    const payload: ModelDto = {
      id: 'model-qwen-plus-v2',
      name: 'Qwen Plus V2',
      provider: 'qwen',
      active: 0,
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v2',
      api_key: 'new-key',
      use_env_api_key: 1,
      temperature: 0.9,
    };

    await expect(service.update('Qwen Plus', payload)).resolves.toEqual(
      payload,
    );
    expect(store.models).toEqual({
      'Qwen Plus V2': {
        id: 'model-qwen-plus-v2',
        name: 'Qwen Plus V2',
        provider: 'qwen',
        active: 0,
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v2',
        api_key: 'new-key',
        use_env_api_key: 1,
        temperature: 0.9,
      },
    });
  });

  it('keeps the original position when renaming a model', async () => {
    store = {
      models: {
        Alpha: {
          id: 'alpha-id',
          name: 'Alpha',
          provider: 'openai',
          active: 1,
          base_url: 'https://alpha.test',
          api_key: 'a',
          use_env_api_key: 1,
          temperature: 0.1,
        },
        Beta: {
          id: 'beta-id',
          name: 'Beta',
          provider: 'qwen',
          active: 1,
          base_url: 'https://beta.test',
          api_key: 'b',
          use_env_api_key: 0,
          temperature: 0.2,
        },
        Gamma: {
          id: 'gamma-id',
          name: 'Gamma',
          provider: 'deepseek',
          active: 0,
          base_url: 'https://gamma.test',
          api_key: 'c',
          use_env_api_key: 1,
          temperature: 0.3,
        },
      },
    };

    await service.update('Beta', {
      id: 'beta-v2',
      name: 'Beta V2',
      provider: 'qwen',
      active: 1,
      base_url: 'https://beta-v2.test',
      api_key: 'b2',
      use_env_api_key: 0,
      temperature: 0.4,
    });

    expect(Object.keys(store.models ?? {})).toEqual(['Alpha', 'Beta V2', 'Gamma']);
  });

  it('deletes an existing model', async () => {
    await expect(service.remove('Qwen Plus')).resolves.toBeUndefined();
    expect(store.models).toEqual({});
  });

  it('rejects duplicate model creation', async () => {
    await expect(
      service.create({
        id: 'model-qwen-plus-duplicate',
        name: 'Qwen Plus',
        provider: 'qwen',
        active: 1,
        base_url: 'https://duplicate.test',
        api_key: '',
        use_env_api_key: 1,
        temperature: 0.5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing models', async () => {
    await expect(service.findOne('Missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid payloads', async () => {
    await expect(service.create(null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create([])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create({
        id: 'invalid-tools',
        name: 'Invalid',
        provider: 'qwen',
        active: true,
        base_url: 'https://invalid.test',
        api_key: '',
        use_env_api_key: 1,
        temperature: 0.7,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        id: 'invalid-temperature',
        name: 'Invalid',
        provider: 'qwen',
        active: 1,
        base_url: 'https://invalid.test',
        api_key: '',
        use_env_api_key: 1,
        temperature: Number.NaN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        id: 'invalid-env-flag',
        name: 'Invalid Env Flag',
        provider: 'qwen',
        active: 1,
        base_url: 'https://invalid.test',
        api_key: '',
        use_env_api_key: true,
        temperature: 0.7,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads legacy field names from config file', async () => {
    store = {
      models: {
        Legacy: {
          id: 'legacy-id',
          name: 'Legacy',
          provider: 'openai',
          enabled: true,
          baseUrl: 'https://legacy.test',
          apiKey: 'legacy-key',
          temperature: 0.6,
        },
      },
    };

    await expect(service.findOne('Legacy')).resolves.toEqual({
      id: 'legacy-id',
      name: 'Legacy',
      provider: 'openai',
      active: 1,
      base_url: 'https://legacy.test',
      api_key: 'legacy-key',
      use_env_api_key: 1,
      temperature: 0.6,
    });
  });

  it('defaults env api key flag to enabled for legacy configs', async () => {
    store = {
      models: {
        LegacyEnv: {
          id: 'legacy-env-id',
          name: 'LegacyEnv',
          provider: 'openai',
          active: 1,
          base_url: 'https://legacy-env.test',
          api_key: 'legacy-env-key',
          temperature: 0.8,
        },
      },
    };

    await expect(service.findOne('LegacyEnv')).resolves.toEqual({
      id: 'legacy-env-id',
      name: 'LegacyEnv',
      provider: 'openai',
      active: 1,
      base_url: 'https://legacy-env.test',
      api_key: 'legacy-env-key',
      use_env_api_key: 1,
      temperature: 0.8,
    });
  });
});
