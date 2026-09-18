import fs from 'fs';
import {homedir} from 'os';
import {join} from 'path';

interface RootConfigFile {
  agents?: Record<string, Record<string, unknown>>;
  models?: Record<string, Record<string, unknown>>;
  skills?: Record<string, Record<string, unknown>>;
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
