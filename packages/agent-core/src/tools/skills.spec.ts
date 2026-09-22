import { buildSkillIndexPrompt } from './skills';
import {
  getSkillDir,
  listActiveSkills,
  readSkillBody,
  readSkillResourceFile,
} from '../readConfig';
import { LOAD_SKILL_TOOL_NAME, READ_SKILL_RESOURCE_TOOL_NAME } from './skills';

jest.mock('../readConfig', () => {
  const actual = jest.requireActual('../readConfig');
  return {
    ...actual,
    getSkillDir: jest.fn((name: string) => `/tmp/.blooms_claw/skills/${name}`),
    listActiveSkills: jest.fn(),
    readSkillBody: jest.fn(),
    readSkillResourceFile: jest.fn(),
  };
});

const mockListActiveSkills = listActiveSkills as jest.Mock;
const mockReadSkillBody = readSkillBody as jest.Mock;
const mockReadSkillResourceFile = readSkillResourceFile as jest.Mock;
const mockGetSkillDir = getSkillDir as jest.Mock;

describe('skill progressive loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('L1 索引只包含 active skill 的 name + description，不含正文', () => {
    mockListActiveSkills.mockReturnValue([
      { name: 'ui-ux-pro-max', description: 'UI/UX design intelligence' },
    ]);
    const prompt = buildSkillIndexPrompt();
    expect(prompt).toContain('ui-ux-pro-max');
    expect(prompt).toContain('UI/UX design intelligence');
    expect(prompt).toContain('load_skill');
    expect(mockReadSkillBody).not.toHaveBeenCalled();
  });

  it('无 active skill 时索引为空', () => {
    mockListActiveSkills.mockReturnValue([]);
    expect(buildSkillIndexPrompt()).toBe('');
  });

  it('load_skill 按用户命中的 skill 按需加载正文', async () => {
    const { loadSkillTool } = await import('./skills');
    mockReadSkillBody.mockReturnValue('# UI/UX Pro Max 正文');
    mockGetSkillDir.mockReturnValue('/tmp/.blooms_claw/skills/ui-ux-pro-max');
    const result = await loadSkillTool.invoke({ skill_name: 'ui-ux-pro-max' });
    expect(mockReadSkillBody).toHaveBeenCalledWith('ui-ux-pro-max', undefined);
    expect(result).toContain('已加载');
    expect(result).toContain('# UI/UX Pro Max 正文');
  });

  it('load_skill 对未激活/不存在 skill 返回可用列表而不抛错', async () => {
    const { loadSkillTool } = await import('./skills');
    mockReadSkillBody.mockReturnValue(null);
    mockListActiveSkills.mockReturnValue([
      { name: 'ui-ux-pro-max', description: 'UI/UX design intelligence' },
    ]);
    const result = await loadSkillTool.invoke({ skill_name: 'not-exist' });
    expect(result).toContain('不存在或未激活');
    expect(result).toContain('ui-ux-pro-max');
  });

  it('read_skill_resource 拦截目录穿越并只读单个文件', async () => {
    const { readSkillResourceTool } = await import('./skills');
    const evil = await readSkillResourceTool.invoke({
      skill_name: 'ui-ux-pro-max',
      relative_path: '../blooms_claw.json',
    });
    expect(evil).toMatch(/非法/);
    expect(mockReadSkillResourceFile).not.toHaveBeenCalled();

    mockReadSkillResourceFile.mockReturnValue({ ok: true, content: 'quick ref 正文' });
    const ok = await readSkillResourceTool.invoke({
      skill_name: 'ui-ux-pro-max',
      relative_path: 'references/quick-reference.md',
    });
    expect(ok).toContain('quick ref 正文');
  });

  it('工具名稳定，供 systemPrompt 引用', () => {
    expect(LOAD_SKILL_TOOL_NAME).toBe('load_skill');
    expect(READ_SKILL_RESOURCE_TOOL_NAME).toBe('read_skill_resource');
  });
});
