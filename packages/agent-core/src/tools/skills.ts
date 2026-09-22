import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';

import {
  getSkillDir,
  listActiveSkills,
  readSkillBody,
  readSkillResourceFile,
} from '../readConfig';

const MAX_RESOURCE_BYTES = 200_000;
const MAX_RESOURCE_CHARS = 60_000;

export const LOAD_SKILL_TOOL_NAME = 'load_skill';
export const READ_SKILL_RESOURCE_TOOL_NAME = 'read_skill_resource';

/**
 * L1 常驻索引：只放 active skill 的 name + description，
 * 正文（L2/L3）走下面的 tool 按需拉取，避免首轮就把所有 SKILL.md 全塞进 systemPrompt。
 */
export function buildSkillIndexPrompt(userId?: string): string {
  const skills = listActiveSkills(userId);
  if (skills.length === 0) {
    return '';
  }
  const lines = skills.map((s) =>
    s.description ? `- \`${s.name}\`: ${s.description}` : `- \`${s.name}\``,
  );
  return [
    '## Available Skills（按需加载，不要提前全量加载）',
    '下面是当前已激活（active）的 Skills 索引，仅包含名称与一句话描述：',
    ...lines,
    '',
    '使用规则：',
    '1. 只有当用户任务与某个 Skill 的描述高度相关时，才调用 `load_skill` 加载其正文；无关任务不要调用。',
    '2. 一次只加载最相关的一个 Skill；同一对话中已加载过的不再重复加载。',
    `3. SKILL.md 里要求读取 references/...、data/... 或运行 scripts/... 时，再用 \`${READ_SKILL_RESOURCE_TOOL_NAME}\` 按需读取单个文件，不要一次性全读。`,
    '4. 若没有命中任何 Skill，直接回答，不要调用 Skill 工具。',
  ].join('\n');
}

export function createLoadSkillTool(userId?: string) {
  return tool(
    async (input: { skill_name: string }) => {
      const name = String(input?.skill_name ?? '').trim();
      if (!name) {
        const available = listActiveSkills(userId).map((s) => s.name).join(', ');
        return `skill_name 不能为空，可用 Skills: ${available || '（无）'}`;
      }
      const body = readSkillBody(name, userId);
      if (!body) {
        const available = listActiveSkills(userId).map((s) => s.name).join(', ');
        return `Skill 不存在或未激活: ${name}，可用 Skills: ${available || '（无）'}`;
      }
      const skillDir = getSkillDir(name, userId);
      return [
        `# Skill: ${name} 已加载，请严格遵循以下流程与约束：`,
        body,
        '',
        `附：该 Skill 物理路径为 ${skillDir}。如需运行其 scripts/*.py，允许使用该绝对路径调用，例如 python "${path.join(skillDir, 'scripts', 'search.py')}" "<query>" --domain ux（这是沙盒相对路径规则的唯一例外）。需要读其 references/data 下的二级文件时，请用 \`${READ_SKILL_RESOURCE_TOOL_NAME}\` 按需读取，不要一次性全读。`,
      ].join('\n');
    },
    {
      name: LOAD_SKILL_TOOL_NAME,
      description:
        '按需加载某个已激活 Skill 的 SKILL.md 全文。当用户任务涉及界面/组件/设计/样式等且命中 Available Skills 索引中的描述时，先调用本工具再回答。入参 skill_name。',
      schema: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'Skill 名称，例如 "ui-ux-pro-max"',
          },
        },
        required: ['skill_name'],
      },
    },
  );
}

export function createReadSkillResourceTool(userId?: string) {
  return tool(
    async (input: { skill_name: string; relative_path: string }) => {
      const name = String(input?.skill_name ?? '').trim();
      const rel = String(input?.relative_path ?? '').replace(/\\/g, '/');
      if (!name) {
        return 'skill_name 不能为空';
      }
      if (!rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) {
        return '非法 relative_path，只允许 Skill 目录内的相对路径，例如 references/quick-reference.md';
      }
      const result = readSkillResourceFile(name, rel, userId);
      if (!result.ok || result.content == null) {
        return result.error ?? `读取失败: ${rel}`;
      }
      const byteLen = fs.existsSync(path.join(getSkillDir(name, userId), rel))
        ? fs.statSync(path.join(getSkillDir(name, userId), rel)).size
        : result.content.length;
      if (byteLen > MAX_RESOURCE_BYTES) {
        return `文件过大（约 ${byteLen} 字节），请换更具体的 relative_path 分段读取`;
      }
      return result.content.slice(0, MAX_RESOURCE_CHARS);
    },
    {
      name: READ_SKILL_RESOURCE_TOOL_NAME,
      description:
        '按需读取已加载 Skill 目录内的二级文件，例如 references/quick-reference.md、data/stacks/react.csv。只在 SKILL.md 明确要求时调用，每次只读一个文件。',
      schema: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'Skill 名称，例如 "ui-ux-pro-max"',
          },
          relative_path: {
            type: 'string',
            description: 'Skill 目录内的相对路径，例如 "references/quick-reference.md"',
          },
        },
        required: ['skill_name', 'relative_path'],
      },
    },
  );
}

// 默认用户（未登录）的 Skill 工具，向后兼容旧引用
export const loadSkillTool = createLoadSkillTool();
export const readSkillResourceTool = createReadSkillResourceTool();
