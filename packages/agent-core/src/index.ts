import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMiddleware } from 'langchain';
import { SystemMessage } from '@langchain/core/messages';
import {
  createDeepAgent,
  FilesystemBackend,
  LocalShellBackend,
} from 'deepagents';

import { readConfigByAgentName, readSelectedSkillContents } from './readConfig';
import { initStreamModel } from './agents';
import { FileSaver } from './FileSaver';
import { CALCULATOR_TOOL_NAME, calculatorTool } from './tools/calculator';
import { loadMcpToolsForAgent } from './tools/mcp';
import { webSearchTool } from './tools/webSearch';
import {
  buildSkillIndexPrompt,
  loadSkillTool,
  readSkillResourceTool,
} from './tools/skills';

/** 所有 agent 自动加载的默认工具（不依赖 agentConfig.tools 配置） */
export const DEFAULT_AGENT_TOOLS = ['FileTools', 'RunCommand', 'WebSearch'] as const;

const FIXED_WORKSPACE_ROOT = '/Users/jack/.blooms_claw/workspaces';

const _stripTrailingSlash = (p: string): string =>
  p.endsWith('/') ? p.slice(0, -1) : p;

const _ROOT_NO_SLASH = _stripTrailingSlash(FIXED_WORKSPACE_ROOT);
const _ROOT_WITHOUT_LEADING_SLASH = _ROOT_NO_SLASH.startsWith('/')
  ? _ROOT_NO_SLASH.slice(1)
  : _ROOT_NO_SLASH;

function _normalizeStringArg(value: unknown): unknown {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  if (value === _ROOT_NO_SLASH || value === `${_ROOT_NO_SLASH}/`) {
    return '/';
  }
  if (value.startsWith(`${_ROOT_NO_SLASH}/`)) {
    const stripped = value.slice(_ROOT_NO_SLASH.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
  if (value.startsWith(`${_ROOT_WITHOUT_LEADING_SLASH}/`)) {
    const stripped = value.slice(_ROOT_WITHOUT_LEADING_SLASH.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }

  return value;
}

function _normalizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (Array.isArray(arg)) {
      return arg.map((item) => _normalizeStringArg(item));
    }
    if (arg && typeof arg === 'object') {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(arg as Record<string, unknown>)) {
        next[k] = _normalizeStringArg(v);
      }
      return next;
    }
    return _normalizeStringArg(arg);
  });
}

function _wrapBackendWithPathNormalization<T extends object>(backend: T): T {
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (descriptor && !descriptor.configurable && !descriptor.writable && !descriptor.get && (descriptor.value as unknown) !== undefined && typeof descriptor.value !== 'function') {
        return descriptor.value;
      }
      const prototype = Object.getPrototypeOf(target);
      let getter: ((this: unknown) => unknown) | undefined;
      if (prototype) {
        const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, prop);
        if (prototypeDescriptor?.get) {
          getter = prototypeDescriptor.get as (this: unknown) => unknown;
        }
      }
      let value: unknown;
      if (getter) {
        try {
          value = getter.call(target);
        } catch {
          value = Reflect.get(target, prop, target);
        }
      } else {
        value = Reflect.get(target, prop, target);
      }
      if (typeof value !== 'function') {
        return value;
      }
      const bound = value.bind(target) as typeof value;
      const proxyWrapped = function (this: unknown, ...args: unknown[]) {
        const normalizedArgs = _normalizeArgs(args);
        return (bound as (this: unknown, ...args: unknown[]) => unknown).apply(
          target,
          normalizedArgs,
        );
      };
      for (const key of Object.getOwnPropertyNames(value as object)) {
        if (key === 'length' || key === 'name' || key === 'prototype') {
          continue;
        }
        try {
          const propertyDescriptor = Object.getOwnPropertyDescriptor(value as object, key);
          if (propertyDescriptor) {
            Object.defineProperty(proxyWrapped, key, propertyDescriptor);
          }
        } catch {
          // ignore
        }
      }
      try {
        Object.defineProperty(proxyWrapped, 'name', {
          value: (value as { name?: string }).name ?? String(prop),
          configurable: true,
        });
      } catch {
        // ignore
      }
      return proxyWrapped as unknown;
    },
    has(target, prop) {
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as T;
}

export interface AttachmentFileReference {
  token: string;
  name: string;
  kind: 'image' | 'document' | 'spreadsheet' | 'text' | 'binary' | string;
  url?: string;
}

export interface BailianFileReference extends AttachmentFileReference {
  fileId: string;
}

export interface CreateAgentRuntimeContext {
  bailianFileReferences?: BailianFileReference[];
}

/**
 * 创建 DeepAgents 智能体
 */
export interface CreateAgentToolsEnableOptions {
  fileTools: boolean;
  shellTools: boolean;
  webTools: boolean;
  calculatorTools: boolean;
}

export interface CreateAgentOptions {
  threadId: string;
  enableThinking?: boolean;
  skillNames?: string[];
  toolsEnable?: CreateAgentToolsEnableOptions;
  runtimeContext?: CreateAgentRuntimeContext;
}

export interface CreateAgentResult {
  model: Awaited<ReturnType<typeof initStreamModel>>;
  agent: Awaited<ReturnType<typeof createDeepAgent>>;
  config: NonNullable<ReturnType<typeof readConfigByAgentName>>;
  close: () => Promise<void>;
}

type RuntimeBackend = FilesystemBackend | LocalShellBackend | undefined;

function resolveToolsEnable(
  toolsEnable: CreateAgentToolsEnableOptions | undefined,
  configuredTools: unknown,
): CreateAgentToolsEnableOptions {
  // 显式传入时完全按调用方配置（便于测试关闭）
  if (toolsEnable) {
    return {
      fileTools: toolsEnable.fileTools,
      shellTools: toolsEnable.shellTools,
      webTools: toolsEnable.webTools,
      calculatorTools: toolsEnable.calculatorTools ?? true,
    };
  }

  // FileTools / RunCommand / WebSearch 为所有 agent 的默认工具，始终自动加载
  // agentConfig.tools 仅控制可选工具（如 Calculator）
  const defaults = {
    fileTools: true,
    shellTools: true,
    webTools: true,
  } as const;

  if (!Array.isArray(configuredTools)) {
    return {
      ...defaults,
      calculatorTools: true,
    };
  }

  const enabledTools = new Set(
    configuredTools.filter((item): item is string => typeof item === 'string'),
  );

  return {
    ...defaults,
    calculatorTools: enabledTools.has(CALCULATOR_TOOL_NAME),
  };
}

function buildSystemPrompt(basePrompt: string, skillNames: string[] | undefined) {
  const selectedSkills = readSelectedSkillContents(skillNames ?? []);
  const workspaceGuardrail = `你运行在一个虚拟沙盒文件系统中，当前目录（./）即为你的工作区根目录。\n请直接使用相对路径（如 ./file.txt）进行文件读取、创建和修改。\n**严禁**在路径中包含宿主机的绝对路径（例如绝对不要使用 ${FIXED_WORKSPACE_ROOT} 这样的前缀），否则会导致路径嵌套错误。\n例外：调用已加载 Skill 自带 scripts/*.py 时，允许使用其 ~/.blooms_claw/skills/<name> 绝对路径（这是唯一例外）。`;
  // L1 常驻：只放 active Skills 的 name + description 索引（约200 token/skill），
  // 正文走 load_skill / read_skill_resource 按用户提问按需加载，避免首轮全量注入爆 context。
  const skillIndex = buildSkillIndexPrompt();
  const parts = [basePrompt.trim(), workspaceGuardrail, skillIndex];
  // 兼容逻辑：调用方显式传入 skillNames 时，首轮仍强制预加载这些 Skill 正文（L2）；
  // 不传时仅给索引，由模型根据用户提问调用 load_skill 渐进加载。
  if (selectedSkills.length > 0) {
    const skillPrompt = selectedSkills
      .map(({ name, content }) => `## Skill: ${name}\n${content.trim()}`)
      .join('\n\n');
    parts.push(
      '以下是本次对话预加载的 Skills，请在回答时严格遵循其中相关流程与约束：',
      skillPrompt,
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

function getWorkspaceRoot(): string {
  fs.mkdirSync(FIXED_WORKSPACE_ROOT, { recursive: true });
  return FIXED_WORKSPACE_ROOT;
}

function buildFileReferenceSystemContent(
  references: BailianFileReference[] | undefined,
): string | undefined {
  const fileIds = references
    ?.filter((item) => item && item.kind !== 'image' && Boolean(item.fileId))
    .map((item) => `fileid://${item.fileId}`);
  if (!fileIds?.length) {
    return undefined;
  }
  return fileIds.join(',');
}

function createBailianFileReferenceMiddleware(
  references: BailianFileReference[] | undefined,
) {
  const systemContent = buildFileReferenceSystemContent(references);
  if (!systemContent) {
    console.log(
      '[agent-core][BailianFileReferenceMiddleware] 跳过创建：未检测到有效的 fileId references，' +
        '传入 references=' + JSON.stringify(references ?? null),
    );
    return null;
  }
  console.log(
    '[agent-core][BailianFileReferenceMiddleware] 已创建，将在每次 wrapModelCall 注入 system content=' +
      systemContent,
  );
  return createMiddleware({
    name: 'BailianFileReferenceMiddleware',
    wrapModelCall: async (request, handler) => {
      const appended = new SystemMessage({ content: systemContent });
      const beforeArray = (request.systemMessage as unknown) as unknown[];
      const beforeCount = Array.isArray(beforeArray) ? beforeArray.length : 0;
      const currentSystemMessage = request.systemMessage.concat(appended);
      const afterArray = (currentSystemMessage as unknown) as unknown[];
      const afterCount = Array.isArray(afterArray) ? afterArray.length : beforeCount + 1;
      console.log(
        '[agent-core][BailianFileReferenceMiddleware] wrapModelCall 被触发：' +
          `原始 systemMessage 条数=${beforeCount}，追加后=${afterCount}，` +
          `新增 system content=${systemContent}`,
      );
      return handler({
        ...request,
        systemMessage: currentSystemMessage,
      });
    },
  });
}

async function createRuntimeBackend(
  toolsEnable: CreateAgentToolsEnableOptions,
): Promise<{
  backend: RuntimeBackend;
  close: () => Promise<void>;
}> {
  const workspaceRoot = getWorkspaceRoot();

  if (toolsEnable.shellTools) {
    const backend = await LocalShellBackend.create({
      rootDir: workspaceRoot,
      virtualMode: true,
      inheritEnv: true,
      timeout: 120,
      maxOutputBytes: 100_000,
    });

    return {
      backend: _wrapBackendWithPathNormalization(backend) as LocalShellBackend,
      close: async () => {
        await backend.close();
      },
    };
  }

  if (toolsEnable.fileTools) {
    return {
      backend: _wrapBackendWithPathNormalization(
        new FilesystemBackend({
          rootDir: workspaceRoot,
          virtualMode: true,
        }),
      ) as FilesystemBackend,
      close: async () => {},
    };
  }

  return {
    backend: undefined,
    close: async () => {},
  };
}

export async function createAgent(
  agentName: string,
  {
    threadId,
    enableThinking = true,
    skillNames,
    toolsEnable,
    runtimeContext,
  }: CreateAgentOptions,
): Promise<CreateAgentResult> {
  const homePath = os.homedir();
  const filePath = path.join(homePath, '.blooms_claw', 'memory', `${threadId}.json`);
  const checkpointer = new FileSaver(filePath);

  const config = readConfigByAgentName(agentName);
  if (!config) {
    throw new Error(`未找到智能体配置: ${agentName}`);
  }

  const model = await initStreamModel(config, { enableThinking });
  const { agentConfig } = config;
  const resolvedToolsEnable = resolveToolsEnable(toolsEnable, agentConfig.tools);
  const systemPrompt = buildSystemPrompt(
    String(agentConfig.systemPrompt ?? ''),
    skillNames,
  );

  const { backend, close } = await createRuntimeBackend(resolvedToolsEnable);
  // MCP 自定义工具：读取 agentConfig.tools 绑定的 MCP Servers，按需建连后注入
  const { tools: mcpTools, close: closeMcp } = await loadMcpToolsForAgent(agentName);
  if (mcpTools.length > 0) {
    console.log(
      `[agent-core][createAgent] agent=${agentName} 已加载 MCP 工具: ` +
        mcpTools.map((item) => item.name).join(', '),
    );
  }
  const customTools = [
    ...(resolvedToolsEnable.webTools ? [webSearchTool] : []),
    ...(resolvedToolsEnable.calculatorTools ? [calculatorTool] : []),
    ...mcpTools,
    // Skill 渐进式加载工具常驻：模型命中索引后自行调用，与用户提问动态相关
    loadSkillTool,
    readSkillResourceTool,
  ];
  const bailianFileReferenceMiddleware = createBailianFileReferenceMiddleware(
    runtimeContext?.bailianFileReferences,
  );
  const middleware = bailianFileReferenceMiddleware
    ? [bailianFileReferenceMiddleware]
    : undefined;
  console.log(
    '[agent-core][createAgent] runtimeContext.bailianFileReferences=' +
      JSON.stringify(runtimeContext?.bailianFileReferences ?? null) +
      '，middleware 注入=' + (middleware ? '已启用（1条 BailianFileReferenceMiddleware）' : '未启用'),
  );

  const agent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    backend,
    tools: customTools,
    middleware: middleware as any,
  });

  return {
    model,
    agent,
    config,
    close: async () => {
      await closeMcp();
      await close();
    },
  };
}

export { readConfigByAgentName } from './readConfig';
