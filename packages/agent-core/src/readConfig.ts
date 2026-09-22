import fs from 'fs';
import {homedir} from 'os';
import {join} from 'path';

interface RootConfigFile {
  agents?: Record<string, Record<string, unknown>>;
  models?: Record<string, Record<string, unknown>>;
  skills?: Record<string, Record<string, unknown>>;
}

export interface ActiveSkillMeta {
  name: string;
  description: string;
}

/** 兼容测试/沙盒临时 HOME 覆盖；os.homedir() 在模块加载时缓存，无法感知运行时改 HOME */
function resolveHome(): string {
  return process.env.HOME?.trim() ? process.env.HOME : homedir();
}

/** default（未登录）用户沿用全局配置；其它用户按 userId 隔离 */
export function resolveConfigPath(userId = 'default'): string {
  const normalized = String(userId ?? '').trim();
  if (!normalized || normalized === 'default') {
    return join(resolveHome(), '.blooms_claw', 'blooms_claw.json');
  }
  return join(
    resolveHome(),
    '.blooms_claw',
    'users',
    normalized,
    'blooms_claw.json',
  );
}

function resolveSkillBaseDir(userId = 'default'): string {
  const normalized = String(userId ?? '').trim();
  if (!normalized || normalized === 'default') {
    return join(resolveHome(), '.blooms_claw', 'skills');
  }
  return join(resolveHome(), '.blooms_claw', 'users', normalized, 'skills');
}

function readRootConfig(userId?: string): RootConfigFile | null {
  try {
    return JSON.parse(
      fs.readFileSync(resolveConfigPath(userId)).toString(),
    ) as RootConfigFile;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/** Skill 在宿主机上的物理目录（注意：沙盒 backend 读不到这里，只能用 node:fs 直读） */
export function getSkillDir(skillName: string, userId?: string): string {
  return join(resolveSkillBaseDir(userId), skillName);
}

/** 列出配置中 active 的 Skills（L1 索引用，只含 name + description） */
export function listActiveSkills(userId?: string): ActiveSkillMeta[] {
  const config = readRootConfig(userId);
  if (!config) {
    return [];
  }
  const skillsConfig = config.skills ?? {};
  return Object.entries(skillsConfig)
    .filter(([, value]) => isSkillEnabled(value as Record<string, unknown>))
    .map(([name, value]) => ({
      name,
      description:
        value && typeof (value as Record<string, unknown>).description === 'string'
          ? String((value as Record<string, unknown>).description)
          : '',
    }));
}

/** 按需读取单个 active Skill 的 SKILL.md 正文（L2），未激活/不存在返回 null */
export function readSkillBody(skillName: string, userId?: string): string | null {
  const name = skillName.trim();
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  const config = readRootConfig(userId);
  if (!config) {
    return null;
  }
  if (!isSkillEnabled((config.skills ?? {})[name])) {
    return null;
  }
  const skillPath = join(getSkillDir(name, userId), 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return null;
  }
  try {
    return extractSkillContent(fs.readFileSync(skillPath, 'utf8'));
  } catch (error) {
    console.error(error);
    return null;
  }
}

/** 按需读取 Skill 目录内的二级文件（L3），带目录穿越防护 */
export function readSkillResourceFile(
  skillName: string,
  relativePath: string,
  userId?: string,
): { ok: boolean; content?: string; error?: string } {
  const name = skillName.trim();
  const rel = relativePath.replace(/\\/g, '/');
  if (!name || !rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) {
    return { ok: false, error: '非法路径' };
  }
  const config = readRootConfig(userId);
  if (!config) {
    return { ok: false, error: '读取全局配置失败' };
  }
  if (!isSkillEnabled((config.skills ?? {})[name])) {
    return { ok: false, error: `Skill 不存在或未激活: ${name}` };
  }
  const skillDir = getSkillDir(name, userId);
  const fullPath = join(skillDir, rel);
  if (!fullPath.startsWith(skillDir)) {
    return { ok: false, error: '非法路径：不允许跳出 Skill 目录' };
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return { ok: false, error: `文件不存在: ${rel}` };
  }
  try {
    return { ok: true, content: fs.readFileSync(fullPath, 'utf8') };
  } catch (error) {
    console.error(error);
    return { ok: false, error: `读取失败: ${rel}` };
  }
}

export function readConfigByAgentName(agentName: string, userId?: string) {
  if (!agentName) {
    throw new Error('智能体不存在');
  }

  // 1. 生成智能体配置的路径
  const configPath = resolveConfigPath(userId);

  try {
    // 2. 读取智能体配置
    const config = JSON.parse(fs.readFileSync(configPath).toString()) as RootConfigFile;

    // 3. 根据智能体名称读取智能体配置、大模型配置和工具配置
    const agentsConfig = config['agents'] || null;
    const modelsConfig = config['models'] || null;
    if (!agentsConfig || !modelsConfig) {
      return null;
    }
    const agentConfig = agentsConfig[agentName];
    if (!agentConfig) {
      return null;
    }
    const modelName = typeof agentConfig.model === 'string' ? agentConfig.model.trim() : '';
    if (!modelName) {
      return null;
    }
    const modelConfig =
      modelsConfig[modelName] ??
      Object.entries(modelsConfig).find(
        ([key]) => key.toLowerCase() === modelName.toLowerCase(),
      )?.[1];
    if (!modelConfig) {
      console.error(
        `[readConfig] 未找到模型配置: agent=${agentName} model=${modelName} 可用模型=${Object.keys(modelsConfig).join(',') || '(空)'}`,
      );
      return null;
    }
    return {agentName, agentConfig, modelName, modelConfig, rootConfig: config};
  } catch (error) {
    console.error(error);
    return null;
  }
}

function extractSkillContent(fullContent: string): string {
  if (!fullContent.startsWith('---')) {
    return fullContent.trim();
  }

  const sections = fullContent.split(/^---\s*$/m);
  return sections.slice(2).join('---').trim();
}

function isSkillEnabled(value: Record<string, unknown> | undefined): boolean {
  if (!value) {
    return false;
  }

  if (value.active === 0 || value.active === false) {
    return false;
  }

  if (value.active === 1 || value.active === true) {
    return true;
  }

  if (value.enabled === false) {
    return false;
  }

  return true;
}

export function readSelectedSkillContents(skillNames: string[], userId?: string) {
  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    return [];
  }

  const configPath = resolveConfigPath(userId);

  try {
    const config = JSON.parse(fs.readFileSync(configPath).toString()) as RootConfigFile;
    const skillsConfig = config.skills ?? {};

    return skillNames
      .map((skillName) => skillName.trim())
      .filter(Boolean)
      .filter((skillName) => isSkillEnabled(skillsConfig[skillName]))
      .map((skillName) => {
        const skillPath = join(resolveSkillBaseDir(userId), skillName, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
          return null;
        }

        const fullContent = fs.readFileSync(skillPath, 'utf8');
        return {
          name: skillName,
          content: extractSkillContent(fullContent),
        };
      })
      .filter((item): item is {name: string; content: string} => Boolean(item));
  } catch (error) {
    console.error(error);
    return [];
  }
}
