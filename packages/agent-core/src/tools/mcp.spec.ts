import fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { listMcpBindingsForAgent } from './mcp';

const ORIGINAL_HOME = process.env.HOME;

function withTempHomeDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(join(homedir(), '.blooms-test-'));
  const configDir = join(dir, '.blooms_claw');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    join(configDir, 'blooms_claw.json'),
    JSON.stringify(files, null, 2),
  );
  process.env.HOME = dir;
  return dir;
}

function restoreHome(dir: string) {
  process.env.HOME = ORIGINAL_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('listMcpBindingsForAgent', () => {
  it('只返回 agent 绑定且 active 的 MCP Servers，跳过内置与未激活', () => {
    const dir = withTempHomeDir({
      agents: {
        demo: {
          model: 'm',
          tools: ['fs-mcp', 'builtin-tool', 'inactive-mcp', 'missing-mcp'],
        },
      },
      tools: {
        'fs-mcp': {
          description: '文件 MCP',
          active: 1,
          builtin: 0,
          mcp: { transport: 'stdio', command: 'npx', args: ['-y', 'srv'] },
        },
        'builtin-tool': {
          description: '内置',
          active: 1,
          builtin: 1,
        },
        'inactive-mcp': {
          description: '已停用',
          active: 0,
          builtin: 0,
          mcp: { transport: 'stdio', command: 'npx', args: [] },
        },
        'bad-mcp': {
          description: '坏配置',
          active: 1,
          builtin: 0,
          mcp: { transport: 'stdio' },
        },
      },
    });
    try {
      expect(listMcpBindingsForAgent('demo')).toEqual([
        {
          serverName: 'fs-mcp',
          serverConfig: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'srv'],
            env: undefined,
            cwd: undefined,
          },
        },
      ]);
      expect(listMcpBindingsForAgent('missing-agent')).toEqual([]);
    } finally {
      restoreHome(dir);
    }
  });

  it('支持 streamableHttp / sse 配置并校验 url', () => {
    const dir = withTempHomeDir({
      agents: {
        demo: { model: 'm', tools: ['http-mcp', 'bad-http'] },
      },
      tools: {
        'http-mcp': {
          description: 'http',
          active: 1,
          builtin: 0,
          mcp: {
            transport: 'streamableHttp',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer x' },
          },
        },
        'bad-http': {
          description: 'bad',
          active: 1,
          builtin: 0,
          mcp: { transport: 'streamableHttp', url: 'nota-url' },
        },
      },
    });
    try {
      expect(listMcpBindingsForAgent('demo')).toEqual([
        {
          serverName: 'http-mcp',
          serverConfig: {
            transport: 'streamableHttp',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer x' },
          },
        },
      ]);
    } finally {
      restoreHome(dir);
    }
  });
});
