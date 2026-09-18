import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { ConfigFileService, RootConfig } from '../shared/config-file.service';
import { AgentDto } from './agents.types';

describe('AgentsService', () => {
  let service: AgentsService;
  let configFileService: Pick<
    jest.Mocked<ConfigFileService>,
    'getConfigPath' | 'readConfig' | 'writeConfig'
  >;
  let store: RootConfig;

  beforeEach(() => {
    store = {
      agents: {
        alpha: {
          model: 'qwen3.6-plus',
          tools: ['tool1'],
          description: 'alpha description',
          active: 1,
          systemPrompt: 'alpha prompt',
        },
      },
      tools: {
        browser: true,
      },
    };

    configFileService = {
      getConfigPath: jest.fn().mockReturnValue('/tmp/imooc_claw.json'),
      readConfig: jest.fn(async () => structuredClone(store)),
      writeConfig: jest.fn(async (nextConfig: RootConfig) => {
        store = structuredClone(nextConfig);
      }),
    };

    service = new AgentsService(configFileService as unknown as ConfigFileService);
  });

  it('returns all agents', async () => {
    await expect(service.findAll()).resolves.toEqual([
      {
        name: 'alpha',
        model: 'qwen3.6-plus',
        tools: ['tool1'],
        description: 'alpha description',
        active: 1,
        systemPrompt: 'alpha prompt',
      },
    ]);
  });

  it('returns a single agent', async () => {
    await expect(service.findOne('alpha')).resolves.toEqual({
      name: 'alpha',
      model: 'qwen3.6-plus',
      tools: ['tool1'],
      description: 'alpha description',
      active: 1,
      systemPrompt: 'alpha prompt',
    });
  });

  it('creates a new agent and keeps other root keys', async () => {
    const payload: AgentDto = {
      name: 'beta',
      model: 'qwen3.6-plus',
      tools: ['tool1', 'tool2'],
      description: 'beta description',
      active: 0,
      systemPrompt: 'beta prompt',
    };

    await expect(service.create(payload)).resolves.toEqual(payload);
    expect(store.tools).toEqual({ browser: true });
    expect(store.agents).toEqual({
      alpha: {
        model: 'qwen3.6-plus',
        tools: ['tool1'],
        description: 'alpha description',
        active: 1,
        systemPrompt: 'alpha prompt',
      },
      beta: {
        model: 'qwen3.6-plus',
        tools: ['tool1', 'tool2'],
        description: 'beta description',
        active: 0,
        systemPrompt: 'beta prompt',
      },
    });
  });

  it('updates and renames an existing agent', async () => {
    const payload: AgentDto = {
      name: 'alpha-renamed',
      model: 'qwen3.6-plus',
      tools: ['tool2'],
      description: 'updated description',
      active: 0,
      systemPrompt: 'updated prompt',
    };

    await expect(service.update('alpha', payload)).resolves.toEqual(payload);
    expect(store.agents).toEqual({
      'alpha-renamed': {
        model: 'qwen3.6-plus',
        tools: ['tool2'],
        description: 'updated description',
        active: 0,
        systemPrompt: 'updated prompt',
      },
    });
  });

  it('keeps the original position when renaming an agent', async () => {
    store = {
      agents: {
        alpha: {
          model: 'qwen3.6-plus',
          tools: ['tool1'],
          description: 'alpha description',
          active: 1,
          systemPrompt: 'alpha prompt',
        },
        beta: {
          model: 'qwen3.6-plus',
          tools: ['tool2'],
          description: 'beta description',
          active: 1,
          systemPrompt: 'beta prompt',
        },
        gamma: {
          model: 'qwen3.6-plus',
          tools: ['tool3'],
          description: 'gamma description',
          active: 0,
          systemPrompt: 'gamma prompt',
        },
      },
    };

    await service.update('beta', {
      name: 'beta-renamed',
      model: 'qwen3.6-plus',
      tools: ['tool2'],
      description: 'beta updated',
      active: 1,
      systemPrompt: 'beta updated prompt',
    });

    expect(Object.keys(store.agents ?? {})).toEqual([
      'alpha',
      'beta-renamed',
      'gamma',
    ]);
  });

  it('deletes an existing agent', async () => {
    await expect(service.remove('alpha')).resolves.toBeUndefined();
    expect(store.agents).toEqual({});
  });

  it('rejects duplicate agent creation', async () => {
    await expect(
      service.create({
        name: 'alpha',
        model: 'qwen3.6-plus',
        tools: ['tool1'],
        description: 'duplicate',
        active: 1,
        systemPrompt: 'duplicate prompt',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing agents', async () => {
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
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
        name: 'gamma',
        model: 'qwen3.6-plus',
        tools: 'tool1',
        description: 'invalid tools',
        active: 1,
        systemPrompt: 'prompt',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        name: 'gamma',
        model: 'qwen3.6-plus',
        tools: ['tool1'],
        description: 'invalid active',
        active: true,
        systemPrompt: 'prompt',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads legacy field names from config file', async () => {
    store = {
      agents: {
        legacy: {
          modelId: 'qwen3.6-plus',
          toolIds: ['tool1', 'tool2'],
          description: 'legacy description',
          enabled: true,
          systemPrompt: 'legacy prompt',
        },
      },
    };

    await expect(service.findOne('legacy')).resolves.toEqual({
      name: 'legacy',
      model: 'qwen3.6-plus',
      tools: ['tool1', 'tool2'],
      description: 'legacy description',
      active: 1,
      systemPrompt: 'legacy prompt',
    });
  });
});
