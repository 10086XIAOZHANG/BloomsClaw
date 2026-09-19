import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigFileService, RootConfig } from '../shared/config-file.service';
import { ToolsService } from './tools.service';
import { ToolDto } from './tools.types';

describe('ToolsService', () => {
  let service: ToolsService;
  let configFileService: Pick<
    jest.Mocked<ConfigFileService>,
    'getConfigPath' | 'readConfig' | 'writeConfig'
  >;
  let store: RootConfig;

  beforeEach(() => {
    store = {
      tools: {
        WebSearch: {
          description: '联网搜索工具',
          active: 1,
          builtin: 1,
        },
      },
      agents: {
        helper: {
          description: 'agent helper',
        },
      },
    };

    configFileService = {
      getConfigPath: jest.fn().mockReturnValue('/tmp/blooms_claw.json'),
      readConfig: jest.fn(async () => structuredClone(store)),
      writeConfig: jest.fn(async (nextConfig: RootConfig) => {
        store = structuredClone(nextConfig);
      }),
    };

    service = new ToolsService(configFileService as unknown as ConfigFileService);
  });

  it('returns all tools', async () => {
    await expect(service.findAll()).resolves.toEqual([
      {
        name: 'WebSearch',
        description: '联网搜索工具',
        active: 1,
        builtin: 1,
      },
    ]);
  });

  it('returns a single tool', async () => {
    await expect(service.findOne('WebSearch')).resolves.toEqual({
      name: 'WebSearch',
      description: '联网搜索工具',
      active: 1,
      builtin: 1,
    });
  });

  it('creates a new tool and keeps other root keys', async () => {
    const payload: ToolDto = {
      name: 'RunCommand',
      description: '执行终端命令',
      active: 0,
      builtin: 1,
    };

    await expect(service.create(payload)).resolves.toEqual(payload);
    expect(store.agents).toEqual({
      helper: {
        description: 'agent helper',
      },
    });
    expect(store.tools).toEqual({
      WebSearch: {
        description: '联网搜索工具',
        active: 1,
        builtin: 1,
      },
      RunCommand: {
        description: '执行终端命令',
        active: 0,
        builtin: 1,
      },
    });
  });

  it('updates and renames an existing tool', async () => {
    const payload: ToolDto = {
      name: 'WebSearchPlus',
      description: '增强版联网搜索工具',
      active: 1,
      builtin: 1,
    };

    await expect(service.update('WebSearch', payload)).resolves.toEqual(payload);
    expect(store.tools).toEqual({
      WebSearchPlus: {
        description: '增强版联网搜索工具',
        active: 1,
        builtin: 1,
      },
    });
  });

  it('keeps the original position when renaming a tool', async () => {
    store = {
      tools: {
        Alpha: {
          description: 'alpha',
          active: 1,
          builtin: 1,
        },
        Beta: {
          description: 'beta',
          active: 0,
          builtin: 0,
        },
        Gamma: {
          description: 'gamma',
          active: 1,
          builtin: 0,
        },
      },
    };

    await service.update('Beta', {
      name: 'BetaV2',
      description: 'beta v2',
      active: 1,
      builtin: 0,
    });

    expect(Object.keys(store.tools ?? {})).toEqual(['Alpha', 'BetaV2', 'Gamma']);
  });

  it('deletes an existing tool', async () => {
    await expect(service.remove('WebSearch')).resolves.toBeUndefined();
    expect(store.tools).toEqual({});
  });

  it('rejects duplicate tool creation', async () => {
    await expect(
      service.create({
        name: 'WebSearch',
        description: 'duplicate',
        active: 1,
        builtin: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing tools', async () => {
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
        name: 'BadTool',
        description: 'bad',
        active: true,
        builtin: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        name: 'BadBuiltin',
        description: 'bad',
        active: 1,
        builtin: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads legacy boolean field names from config file', async () => {
    store = {
      tools: {
        LegacyTool: {
          description: 'legacy',
          enabled: true,
          builtin: false,
        },
      },
    };

    await expect(service.findOne('LegacyTool')).resolves.toEqual({
      name: 'LegacyTool',
      description: 'legacy',
      active: 1,
      builtin: 0,
    });
  });
});
