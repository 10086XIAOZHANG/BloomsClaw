import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigFileService, RootConfig } from '../shared/config-file.service';
import { ToolsService } from './tools.service';
import { McpConfigDto, ToolDto } from './tools.types';

describe('ToolsService (MCP)', () => {
  let service: ToolsService;
  let configFileService: Pick<
    jest.Mocked<ConfigFileService>,
    'getConfigPath' | 'readConfig' | 'writeConfig'
  >;
  let store: RootConfig;

  const stdioMcp: McpConfigDto = {
    transport: 'stdio',
    command: 'node',
    args: ['/tmp/mcp-server.js'],
    env: { FOO: 'bar' },
  };

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
    // 默认 mock 掉真实 MCP 连接：除非用例显式覆盖
    jest
      .spyOn(service as unknown as { fetchRemoteTools: () => Promise<unknown[]> }, 'fetchRemoteTools' as never)
      .mockResolvedValue([{ name: 'remote_tool', description: '远端工具' }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('创建 MCP 工具前会校验连通性，连通后落盘并可读回', async () => {
    const payload: ToolDto = {
      name: 'fs-mcp',
      description: '文件 MCP',
      active: 1,
      builtin: 0,
      mcp: stdioMcp,
    };

    await expect(service.create(payload)).resolves.toEqual(payload);
    await expect(service.findOne('fs-mcp')).resolves.toEqual(payload);
    expect(store.tools?.['fs-mcp']).toEqual({
      description: '文件 MCP',
      active: 1,
      builtin: 0,
      mcp: stdioMcp,
    });
  });

  it('MCP 连不通时拒绝创建，不写配置文件', async () => {
    jest
      .spyOn(service as unknown as { fetchRemoteTools: () => Promise<unknown[]> }, 'fetchRemoteTools' as never)
      .mockRejectedValueOnce(
        new BadRequestException({ message: '无法连接 MCP Server: boom', error: 'MCP_UNREACHABLE' }),
      );

    await expect(
      service.create({
        name: 'bad-mcp',
        description: '坏的 MCP',
        active: 1,
        builtin: 0,
        mcp: stdioMcp,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.tools?.['bad-mcp']).toBeUndefined();
  });

  it('拒绝非 MCP 的自定义工具与非法 mcp 配置', async () => {
    await expect(
      service.create({
        name: 'plain-tool',
        description: '普通工具',
        active: 1,
        builtin: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create({
        name: 'bad-transport',
        description: '坏传输',
        active: 1,
        builtin: 0,
        mcp: { transport: 'websocket' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create({
        name: 'bad-url',
        description: '坏地址',
        active: 1,
        builtin: 0,
        mcp: { transport: 'streamableHttp', url: 'nota-url' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('HTTP MCP 工具同样需要 url 与可选 headers', async () => {
    const payload: ToolDto = {
      name: 'http-mcp',
      description: '远程 MCP',
      active: 1,
      builtin: 0,
      mcp: {
        transport: 'streamableHttp',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      },
    };
    await expect(service.create(payload)).resolves.toEqual(payload);
  });

  it('内置工具强制启用且不需要 mcp', async () => {
    await expect(
      service.create({
        name: 'BuiltinTool',
        description: '内置工具',
        active: 0,
        builtin: 1,
      }),
    ).resolves.toEqual({
      name: 'BuiltinTool',
      description: '内置工具',
      active: 1,
      builtin: 1,
    });
  });

  it('老数据缺 mcp 时返回 mcp=null，前端提示删除重建', async () => {
    store = {
      tools: {
        'legacy-custom': {
          description: '老自定义工具',
          active: 1,
          builtin: 0,
        },
      },
    };
    await expect(service.findOne('legacy-custom')).resolves.toEqual({
      name: 'legacy-custom',
      description: '老自定义工具',
      active: 1,
      builtin: 0,
      mcp: null,
    });
  });

  it('重复创建返回 409', async () => {
    await expect(
      service.create({
        name: 'WebSearch',
        description: 'duplicate',
        active: 1,
        builtin: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
