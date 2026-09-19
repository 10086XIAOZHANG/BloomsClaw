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

function getConfigPath(): string {
  return join(homedir(), '.imooc_claw', 'imooc_claw.json');
}

function readRootConfig(): RootConfigFile | null {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath()).toString()) as RootConfigFile;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/** Skill 在宿主机上的物理目录（注意：沙盒 backend 读不到这里，只能用 node:fs 直读） */
export function getSkillDir(skillName: string): string {
  return join(homedir(), '.imooc_claw', 'skills', skillName);
}

/** 列出配置中 active 的 Skills（L1 索引用，只含 name + description） */
export function listActiveSkills(): ActiveSkillMeta[] {
  const config = readRootConfig();
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
export function readSkillBody(skillName: string): string | null {
  const name = skillName.trim();
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  const config = readRootConfig();
  if (!config) {
    return null;
  }
  if (!isSkillEnabled((config.skills ?? {})[name])) {
    return null;
  }
  const skillPath = join(getSkillDir(name), 'SKILL.md');
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
): { ok: boolean; content?: string; error?: string } {
  const name = skillName.trim();
  const rel = relativePath.replace(/\\/g, '/');
  if (!name || !rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) {
    return { ok: false, error: '非法路径' };
  }
  const config = readRootConfig();
  if (!config) {
    return { ok: false, error: '读取全局配置失败' };
  }
  if (!isSkillEnabled((config.skills ?? {})[name])) {
    return { ok: false, error: `Skill 不存在或未激活: ${name}` };
  }
  const skillDir = getSkillDir(name);
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

export function readConfigByAgentName(agentName: string) {
  if (!agentName) {
    throw new Error('智能体不存在');
  }

  // 1. 生成智能体配置的路径
  const configPath = join(
    homedir(),
    '.imooc_claw',
    'imooc_claw.json',
  );

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
    const modelName = typeof agentConfig.model === 'string' ? agentConfig.model : '';
    if (!modelName) {
      return null;
    }
    const modelConfig = modelsConfig[modelName];
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

export function readSelectedSkillContents(skillNames: string[]) {
  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    return [];
  }

  const configPath = join(
    homedir(),
    '.imooc_claw',
    'imooc_claw.json',
  );

  try {
    const config = JSON.parse(fs.readFileSync(configPath).toString()) as RootConfigFile;
    const skillsConfig = config.skills ?? {};

    return skillNames
      .map((skillName) => skillName.trim())
      .filter(Boolean)
      .filter((skillName) => isSkillEnabled(skillsConfig[skillName]))
      .map((skillName) => {
        const skillPath = join(homedir(), '.imooc_claw', 'skills', skillName, 'SKILL.md');
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
