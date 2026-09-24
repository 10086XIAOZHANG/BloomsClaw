import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LongTermMemoryStore, createMemoryTools } from './memory';

describe('LongTermMemoryStore', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blooms-memory-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('upserts records and reloads them from disk', async () => {
    const first = new LongTermMemoryStore({ userId: 'u', agentName: 'a', baseDir });
    first.remember('language', '用户偏好中文');
    first.remember('language', '用户偏好简体中文');

    const second = new LongTermMemoryStore({ userId: 'u', agentName: 'a', baseDir });
    await expect(second.recall('language')).resolves.toEqual([
      expect.objectContaining({ key: 'language', text: '用户偏好简体中文' }),
    ]);
  });

  it('falls back to keyword search when Chroma is unavailable', async () => {
    const store = new LongTermMemoryStore({ userId: 'u', agentName: 'a', baseDir });
    store.remember('editor', '项目使用 VS Code 编辑器');
    await expect(store.recall('VS Code')).resolves.toEqual([
      expect.objectContaining({ key: 'editor' }),
    ]);
  });
});

describe('memory tools', () => {
  it('validates inputs', async () => {
    const { rememberTool, recallTool } = createMemoryTools('u', 'a');
    await expect(rememberTool.invoke({ key: '', text: '' })).resolves.toContain('失败');
    await expect(recallTool.invoke({ query: '' })).resolves.toContain('失败');
  });
});
