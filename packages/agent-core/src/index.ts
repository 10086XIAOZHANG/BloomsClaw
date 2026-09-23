import os from 'node:os';
import path from 'node:path';
import { createMiddleware } from 'langchain';
import { SystemMessage } from '@langchain/core/messages';
import { Command, INTERRUPT, isInterrupted } from '@langchain/langgraph';
import {
  createDeepAgent,
} from 'deepagents';

import { readConfigByAgentName, readSelectedSkillContents, resolveConfigPath } from './readConfig';
import { initStreamModel } from './agents';
import { FileSaver } from './FileSaver';
import { DockerSandboxBackend } from './sandbox';
import { CALCULATOR_TOOL_NAME, calculatorTool } from './tools/calculator';
import { ASK_HUMAN_TOOL_NAME, askHumanTool } from './tools/askHuman';
import { sendEmailTool } from './tools/sendEmail';
import { loadMcpToolsForAgent } from './tools/mcp';
import { webSearchTool } from './tools/webSearch';
import {
  createSandboxTools,
  SANDBOX_FILE_TOOL_NAME,
  SANDBOX_SHELL_TOOL_NAME,
} from './tools/sandbox';
import {
  buildSkillIndexPrompt,
  createLoadSkillTool,
  createReadSkillResourceTool,
} from './tools/skills';

/** 所有 agent 自动加载的默认工具（不依赖 agentConfig.tools 配置） */
export const DEFAULT_AGENT_TOOLS = ['FileTools', 'RunCommand', 'WebSearch', 'SendEmail'] as const;

/**
 * Human-in-the-loop 默认纳入审批的危险工具（写入 / 执行命令等）：
 * 仅当未显式指定 interruptOn.tools 时作为兜底。
 */
export const DEFAULT_INTERRUPT_ON_TOOLS = [
  SANDBOX_SHELL_TOOL_NAME,
  SANDBOX_FILE_TOOL_NAME,
  'execute',
  'ls',
] as const;

const _stripTrailingSlash = (p: string): string =>
  p.endsWith('/') ? p.slice(0, -1) : p;

function _normalizeStringArg(value: unknown): unknown {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  const hostRoot = process.env.BLOOMS_CLAW_WORKSPACES_DIR?.trim() ||
    path.join(os.homedir(), '.blooms_claw', 'workspaces');
  const root = _stripTrailingSlash(hostRoot);
  const rootWithoutLeadingSlash = root.startsWith('/') ? root.slice(1) : root;

  if (value === root || value === `${root}/`) {
    return '/';
  }
  if (value.startsWith(`${root}/`)) {
    const stripped = value.slice(root.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
  if (value.startsWith(`${rootWithoutLeadingSlash}/`)) {
    const stripped = value.slice(rootWithoutLeadingSlash.length);
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
  emailTools: boolean;
}

/**
 * Human-in-the-loop（人工介入）配置。
 * - `enabled`: 是否启用 HITL
 * - `interruptOn`: 需要人工审批的工具名 -> true（调用前暂停等待审批）
 * - `enableAskHuman`: 是否加载 AskHuman 工具（模型主动向用户提问），默认 true
 */
export interface CreateAgentHumanInLoopOptions {
  enabled: boolean;
  interruptOn?: Record<string, boolean>;
  enableAskHuman?: boolean;
}

export interface CreateAgentOptions {
  threadId: string;
  userId?: string;
  enableThinking?: boolean;
  skillNames?: string[];
  toolsEnable?: CreateAgentToolsEnableOptions;
  runtimeContext?: CreateAgentRuntimeContext;
  humanInTheLoop?: CreateAgentHumanInLoopOptions | boolean;
}

export interface CreateAgentResult {
  model: Awaited<ReturnType<typeof initStreamModel>>;
  agent: Awaited<ReturnType<typeof createDeepAgent>>;
  config: NonNullable<ReturnType<typeof readConfigByAgentName>>;
  close: () => Promise<void>;
}

type RuntimeBackend = DockerSandboxBackend | undefined;

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
      emailTools: toolsEnable.emailTools ?? true,
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
      emailTools: true,
    };
  }

  const enabledTools = new Set(
    configuredTools.filter((item): item is string => typeof item === 'string'),
  );

  return {
    ...defaults,
    calculatorTools: enabledTools.has(CALCULATOR_TOOL_NAME),
    // SendEmail 是公共内置工具，与 FileTools/RunCommand/WebSearch 一样始终加载；
    // 实际发信前仍会通过 interrupt 索取 SMTP 凭证。
    emailTools: true,
  };
}

export interface ResolvedHumanInLoop {
  /** 需要人工审批的工具名 -> true；为空对象时不注入 interruptOn */
  interruptOn: Record<string, boolean>;
  /** 是否加载 AskHuman 提问工具 */
  enableAskHuman: boolean;
}

function toInterruptOnMap(toolNames: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const name of toolNames) {
    const trimmed = name.trim();
    if (trimmed) {
      map[trimmed] = true;
    }
  }
  return map;
}

/**
 * 解析 Human-in-the-loop 配置。
 * 优先级：显式 options.humanInTheLoop > agentConfig.humanInTheLoop > 默认关闭。
 * 未指定工具列表时，默认对破坏性工具（sandbox_shell / sandbox_file）开启审批。
 * 返回 null 表示未启用 HITL。
 */
export function resolveHumanInLoop(
  options: CreateAgentHumanInLoopOptions | boolean | undefined,
  agentConfig: unknown,
): ResolvedHumanInLoop | null {
  const configRecord =
    agentConfig && typeof agentConfig === 'object'
      ? (agentConfig as Record<string, unknown>)
      : undefined;
  const raw = options ?? configRecord?.humanInTheLoop;

  if (!raw || raw === false) {
    return null;
  }

  const source: Record<string, unknown> =
    raw === true ? { enabled: true } : (raw as Record<string, unknown>);
  if (!source || source.enabled !== true) {
    return null;
  }

  let interruptOn: Record<string, boolean>;
  if (source.interruptOn && typeof source.interruptOn === 'object') {
    interruptOn = {};
    for (const [name, enabled] of Object.entries(
      source.interruptOn as Record<string, unknown>,
    )) {
      if (enabled === true && name.trim()) {
        interruptOn[name.trim()] = true;
      }
    }
  } else if (Array.isArray(source.tools)) {
    interruptOn = toInterruptOnMap(
      source.tools.filter((item): item is string => typeof item === 'string'),
    );
  } else {
    interruptOn = toInterruptOnMap([...DEFAULT_INTERRUPT_ON_TOOLS]);
  }

  const enableAskHuman = source.enableAskHuman !== false;

  return { interruptOn, enableAskHuman };
}

function buildSystemPrompt(
  basePrompt: string,
  skillNames: string[] | undefined,
  userId?: string,
) {
  const selectedSkills = readSelectedSkillContents(skillNames ?? [], userId);
  const workspaceGuardrail = `你运行在一个 Docker 隔离沙箱文件系统中，当前目录（./）即为你的工作区根目录。\n请直接使用相对路径（如 ./file.txt）进行文件读取、创建和修改。\n**严禁**在路径中包含宿主机绝对路径；所有命令都在临时隔离容器中执行，禁止尝试访问宿主机、Docker socket、外部工作区或绕过沙箱限制。\n例外：调用已加载 Skill 自带 scripts/*.py 时，允许使用其 ~/.blooms_claw/skills/<name> 绝对路径（这是唯一例外）。`;
  // L1 常驻：只放 active Skills 的 name + description 索引（约200 token/skill），
  // 正文走 load_skill / read_skill_resource 按用户提问按需加载，避免首轮全量注入爆 context。
  const skillIndex = buildSkillIndexPrompt(userId);
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
  threadId: string,
  userId: string,
  toolsEnable: CreateAgentToolsEnableOptions,
): Promise<{
  backend: RuntimeBackend;
  close: () => Promise<void>;
}> {
  if (!toolsEnable.fileTools && !toolsEnable.shellTools) {
    return {
      backend: undefined,
      close: async () => {},
    };
  }

  const backend = await DockerSandboxBackend.create({
    threadId: `${userId}-${threadId}`,
    timeoutSec: 120,
    maxOutputBytes: 100_000,
  });

  return {
    backend,
    close: async () => {
      await backend.close();
    },
  };
}

export async function createAgent(
  agentName: string,
  {
    threadId,
    userId = 'default',
    enableThinking = true,
    skillNames,
    toolsEnable,
    runtimeContext,
    humanInTheLoop,
  }: CreateAgentOptions,
): Promise<CreateAgentResult> {
  const homePath = os.homedir();
  const filePath = path.join(
    homePath,
    '.blooms_claw',
    'users',
    userId,
    'memory',
    `${threadId}.json`,
  );
  const checkpointer = new FileSaver(filePath);

  const config = readConfigByAgentName(agentName, userId);
  if (!config) {
    throw new Error(`未找到智能体配置: ${agentName}`);
  }

  const configPath = resolveConfigPath(userId);
  const rawAgentHitl =
    config?.agentConfig && typeof config.agentConfig === 'object'
      ? (config.agentConfig as Record<string, unknown>).humanInTheLoop
      : undefined;
  console.log(
    '[agent-core][createAgent] agent.identity=' + JSON.stringify({
      agentName,
      userId,
      configPath,
      configLoaded: Boolean(config),
      optionHumanInTheLoop: humanInTheLoop === undefined ? '<undefined>' : (typeof humanInTheLoop === 'object' ? `object keys=[${Object.keys(humanInTheLoop as object).join(',')}]` : String(humanInTheLoop)),
      agentConfigHumanInTheLoop: rawAgentHitl === undefined ? '<absent>' : `present type=${Array.isArray(rawAgentHitl) ? 'array' : typeof rawAgentHitl} shape=${JSON.stringify(typeof rawAgentHitl === 'object' ? Object.keys(rawAgentHitl as object) : rawAgentHitl)}`,
    }),
  );
  // 安全审计：humanInTheLoop 只允许 enabled/tools/interruptOn/enableAskHuman 这几个字段
  if (rawAgentHitl && typeof rawAgentHitl === 'object') {
    const allowed = ['enabled', 'tools', 'interruptOn', 'enableAskHuman', 'askHuman'];
    const keys = Object.keys(rawAgentHitl as object);
    const suspicious = keys.filter((k) => !allowed.includes(k));
    if (suspicious.length > 0) {
      console.warn(
        '[agent-core][createAgent] humanInTheLoop 含未知字段 ' + suspicious.join(',') +
          ' （可能拼写错误，影响解析）',
      );
    }
  }

  const model = await initStreamModel(config, { enableThinking });
  const { agentConfig } = config;
  const resolvedToolsEnable = resolveToolsEnable(toolsEnable, agentConfig.tools);
  const systemPrompt = buildSystemPrompt(
    String(agentConfig.systemPrompt ?? ''),
    skillNames,
    userId,
  );

  const { backend, close } = await createRuntimeBackend(
    threadId,
    userId,
    resolvedToolsEnable,
  );
  // MCP 自定义工具：读取 agentConfig.tools 绑定的 MCP Servers，按需建连后注入
  const { tools: mcpTools, close: closeMcp } = await loadMcpToolsForAgent(agentName, userId);
  if (mcpTools.length > 0) {
    console.log(
      `[agent-core][createAgent] agent=${agentName} 已加载 MCP 工具: ` +
        mcpTools.map((item) => item.name).join(', '),
    );
  }
  const sandboxTools = backend ? createSandboxTools(backend) : [];
  const resolvedHumanInLoop = resolveHumanInLoop(humanInTheLoop, agentConfig);
  const customTools: any[] = [
    ...(resolvedToolsEnable.fileTools && sandboxTools[0] ? [sandboxTools[0]] : []),
    ...(resolvedToolsEnable.shellTools && sandboxTools[1] ? [sandboxTools[1]] : []),
    ...(resolvedToolsEnable.webTools ? [webSearchTool] : []),
    ...(resolvedToolsEnable.calculatorTools ? [calculatorTool] : []),
    ...(resolvedToolsEnable.emailTools ? [sendEmailTool] : []),
    ...mcpTools,
    // Skill 渐进式加载工具常驻：模型命中索引后自行调用，与用户提问动态相关
    createLoadSkillTool(userId),
    createReadSkillResourceTool(userId),
    ...(resolvedHumanInLoop?.enableAskHuman ? [askHumanTool] : []),
  ];
  const bailianFileReferenceMiddleware = createBailianFileReferenceMiddleware(
    runtimeContext?.bailianFileReferences,
  );
  const middleware = bailianFileReferenceMiddleware
    ? [bailianFileReferenceMiddleware]
    : undefined;
  const interruptOn =
    resolvedHumanInLoop && Object.keys(resolvedHumanInLoop.interruptOn).length > 0
      ? resolvedHumanInLoop.interruptOn
      : undefined;
  console.log(
    '[agent-core][createAgent] runtimeContext.bailianFileReferences=' +
      JSON.stringify(runtimeContext?.bailianFileReferences ?? null) +
      '，middleware 注入=' + (middleware ? '已启用（1条 BailianFileReferenceMiddleware）' : '未启用') +
      '，HITL=' +
      (resolvedHumanInLoop
        ? `已启用 interruptOn=${JSON.stringify(resolvedHumanInLoop.interruptOn)} AskHuman=${resolvedHumanInLoop.enableAskHuman}`
        : '未启用'),
  );
  console.log(
    '[agent-core][createAgent] 传给 createDeepAgent 的 interruptOn=' +
      (interruptOn ? JSON.stringify(interruptOn) : '未传（undefined）') +
      ' tools=' + (customTools.map((t) => t?.name).filter(Boolean).join(',') || '(空)') +
      ' toolCount=' + customTools.length +
      ' hasCheckpointer=' + Boolean(checkpointer),
  );

  const agent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    backend,
    tools: customTools,
    middleware: middleware as any,
    ...(interruptOn ? { interruptOn } : {}),
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

export { DockerSandboxBackend, getHostWorkspaceDir } from './sandbox';
export { createSandboxTools } from './tools/sandbox';
export { readConfigByAgentName } from './readConfig';
export { ASK_HUMAN_TOOL_NAME, askHumanTool } from './tools/askHuman';
export { SEND_EMAIL_TOOL_NAME, sendEmailTool } from './tools/sendEmail';

/**
 * 构造用于恢复被 Human-in-the-loop 中断的图的 Command。
 * 审批场景传入 HITLResponse（{ decisions: [...] }），AskHuman 场景传入用户的回答字符串。
 */
export function buildResumeCommand(resume: unknown): Command {
  return new Command({ resume });
}

/**
 * 读取当前线程是否处于 Human-in-the-loop 中断等待状态。
 * 返回待处理的中断值数组（HITLRequest 或 AskHuman 的 {question, kind}），无中断时返回 null。
 */
export async function getPendingInterrupts(
  agent: {
    getState: (config: unknown) => Promise<{
      values?: unknown;
      tasks?: Array<{ interrupts?: Array<{ value?: unknown }> }>;
    }>;
  },
  threadId: string,
): Promise<unknown[] | null> {
  const state = await agent.getState({ configurable: { thread_id: threadId } });
  const interrupts = (state?.tasks ?? []).flatMap((task) => task.interrupts ?? []);
  const values = state?.values;
  const viaChannel = isInterrupted(values) ? (values as Record<string, { value?: unknown }[]>)[INTERRUPT] : undefined;
  console.log(
    '[agent-core][getPendingInterrupts] state.summary=' +
      JSON.stringify({
        threadId,
        next: (state as { next?: string[] })?.next ?? [],
        taskCount: Array.isArray((state as { tasks?: unknown[] })?.tasks) ? (state as { tasks?: unknown[] }).tasks?.length : null,
        taskInterrupts: (state as { tasks?: Array<{ name?: string; interrupts?: Array<{ value?: unknown }> }> })?.tasks?.map((t) => ({
          name: t.name,
          interruptCount: t.interrupts?.length ?? 0,
          values: (t.interrupts ?? []).map((i) => summarizeInterrupt(i.value)),
        })),
        channelInterrupts: viaChannel
          ? ((viaChannel as { value?: unknown }[]).map((i) => summarizeInterrupt(i?.value)))
          : undefined,
      }),
  );
  if (interrupts.length > 0) {
    return interrupts.map((item) => item.value);
  }

  if (viaChannel) {
    return Array.isArray(viaChannel)
      ? viaChannel.map((item) => item?.value)
      : null;
  }
  return null;
}

/** 仅输出中断值的结构摘要（不含完整文件内容 / 命令原文 / 敏感参数值） */
function summarizeInterrupt(value: unknown): Record<string, unknown> | string {
  if (!value || typeof value !== 'object') {
    return value === undefined ? '<undefined>' : String(value).slice(0, 120);
  }
  const obj = value as Record<string, unknown>;
  if (obj.kind === 'ask_human') {
    return { kind: 'ask_human', question: String(obj.question ?? '').slice(0, 200) };
  }
  const actionRequests = Array.isArray(obj.actionRequests) && obj.actionRequests.length > 0
    ? obj.actionRequests.map((a) => ({
        name: (a as Record<string, unknown>)?.name,
        argKeys: Object.keys(((a as Record<string, unknown>)?.args ?? {}) as Record<string, unknown>),
        argValuesTruncated: truncateValues((a as Record<string, unknown>)?.args),
      }))
    : undefined;
  const reviewConfigs = Array.isArray(obj.reviewConfigs)
    ? obj.reviewConfigs.map((r) => ({
        actionName: (r as Record<string, unknown>)?.actionName,
        allowedDecisions: (r as Record<string, unknown>)?.allowedDecisions,
      }))
    : undefined;
  if (actionRequests === undefined && reviewConfigs === undefined) {
    return { keys: Object.keys(obj), bodyTruncated: JSON.stringify(value).slice(0, 300) };
  }
  return { keys: Object.keys(obj), actionRequests, reviewConfigs };
}

/** 只保留参数名 + 截断后的值样例，避免打印完整命令 / 文件内容 / 敏感值 */
function truncateValues(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === 'string'
      ? (v.length > 40 ? `${v.slice(0, 40)}...[len=${v.length}]` : v)
      : Array.isArray(v)
        ? `<array[${v.length}]>`
        : v;
  }
  return out;
}
export type {
  HITLRequest,
  HITLResponse,
  Decision,
  ActionRequest,
  ReviewConfig,
  InterruptOnConfig,
} from 'langchain';
