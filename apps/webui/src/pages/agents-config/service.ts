import { request } from '@umijs/max';
import type {
  AgentHumanInTheLoop,
  AgentItem,
  McpConfig,
  ModelItem,
  RemoteMcpToolMeta,
  SkillItem,
  ToolItem,
} from './data';
import { getCurrentUserId } from '@/utils/userSession';

type ApiResponse<T> = {
  code: number;
  data: T;
  msg: string;
  error?: string;
};

type BackendAgentItem = {
  name: string;
  model: string;
  tools: string[];
  description: string;
  active: 0 | 1;
  systemPrompt: string;
  humanInTheLoop?: AgentHumanInTheLoop | null;
};

type BackendModelItem = {
  name: string;
  provider: string;
  active: 0 | 1;
  id: string;
  base_url: string;
  api_key: string;
  use_env_api_key?: 0 | 1;
  temperature: number;
};

type BackendToolItem = {
  name: string;
  description: string;
  active: 0 | 1;
  builtin: 0 | 1;
  mcp?: McpConfig | null;
};

type BackendSkillItem = {
  name: string;
  description: string;
  active: 0 | 1;
  source: string;
  installCommand: string;
  installedAt: string;
};

const API_BASE_URL =
  process.env.API_PUBLIC_BASE_URL ||
  process.env.API_BASE_URL ||
  (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:3000');

const DEFAULT_HUMAN_IN_THE_LOOP: AgentHumanInTheLoop = {
  enabled: false,
  tools: [],
  enableAskHuman: true,
};

export const getBloomsClawAgentsConfig = async (): Promise<{
  agents: AgentItem[];
}> => {
  const response = await request<ApiResponse<BackendAgentItem[]>>(
    `${API_BASE_URL}/agents`,
    { params: { userId: getCurrentUserId() } },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '读取 Agents 配置失败');
  }

  return {
    agents: (response.data ?? []).map((agent) => ({
      id: agent.name,
      name: agent.name,
      modelId: agent.model,
      toolIds: agent.tools ?? [],
      description: agent.description,
      enabled: agent.active === 1,
      systemPrompt: agent.systemPrompt,
      humanInTheLoop: {
        ...DEFAULT_HUMAN_IN_THE_LOOP,
        ...(agent.humanInTheLoop ?? {}),
        tools: agent.humanInTheLoop?.tools ?? [],
      },
    })),
  };
};

export const getBloomsClawModelsConfig = async (): Promise<{
  models: ModelItem[];
}> => {
  const response = await request<ApiResponse<BackendModelItem[]>>(
    `${API_BASE_URL}/models`,
    { params: { userId: getCurrentUserId() } },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '读取 Models 配置失败');
  }

  return {
    models: (response.data ?? []).map((model) => ({
      // Frontend uses `id` as the persisted config key, which is `name` on the backend.
      id: model.name,
      name: model.name,
      provider: model.provider,
      model: model.id,
      baseUrl: model.base_url,
      apiKey: model.api_key,
      useEnvApiKey: model.use_env_api_key !== 0,
      temperature: model.temperature,
      enabled: model.active === 1,
    })),
  };
};

export const getBloomsClawToolsConfig = async (): Promise<{
  tools: ToolItem[];
}> => {
  const response = await request<ApiResponse<BackendToolItem[]>>(
    `${API_BASE_URL}/tools`,
    { params: { userId: getCurrentUserId() } },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '读取 Tools 配置失败');
  }

  return {
    tools: (response.data ?? []).map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      builtin: tool.builtin === 1,
      enabled: tool.active === 1,
      mcp: tool.mcp ?? null,
    })),
  };
};

export const getBloomsClawSkillsConfig = async (): Promise<{
  skills: SkillItem[];
}> => {
  const response = await request<ApiResponse<BackendSkillItem[]>>(
    `${API_BASE_URL}/skills`,
    { params: { userId: getCurrentUserId() } },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '读取 Skills 配置失败');
  }

  return {
    skills: (response.data ?? []).map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      enabled: skill.active === 1,
      source: skill.source,
      installCommand: skill.installCommand,
      installedAt: skill.installedAt,
    })),
  };
};

export const saveAgentItem = async (
  agent: AgentItem,
): Promise<{ agents: AgentItem[] }> => {
  const payload: BackendAgentItem = {
    name: agent.name.trim(),
    model: agent.modelId,
    tools: agent.toolIds ?? [],
    description: agent.description.trim(),
    active: agent.enabled ? 1 : 0,
    systemPrompt: agent.systemPrompt.trim(),
    humanInTheLoop: agent.humanInTheLoop ?? DEFAULT_HUMAN_IN_THE_LOOP,
  };
  const requestUrl = agent.id
    ? `${API_BASE_URL}/agents/${encodeURIComponent(agent.id)}`
    : `${API_BASE_URL}/agents`;
  const response = agent.id
    ? await request<ApiResponse<BackendAgentItem>>(requestUrl, {
        method: 'PUT',
        data: payload,
        params: { userId: getCurrentUserId() },
      })
    : await request<ApiResponse<BackendAgentItem>>(requestUrl, {
        method: 'POST',
        data: payload,
        params: { userId: getCurrentUserId() },
      });

  if (response.code !== 0) {
    throw new Error(response.msg || '保存 Agent 配置失败');
  }

  return getBloomsClawAgentsConfig();
};

export const deleteAgentItem = async (
  agentId: string,
): Promise<{ agents: AgentItem[] }> => {
  const response = await request<ApiResponse<{ deleted: true }>>(
    `${API_BASE_URL}/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'DELETE',
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '删除 Agent 配置失败');
  }

  return getBloomsClawAgentsConfig();
};

export const saveModelItem = async (
  model: ModelItem,
): Promise<{ models: ModelItem[] }> => {
  const payload: BackendModelItem = {
    name: model.name.trim(),
    provider: model.provider,
    active: model.enabled ? 1 : 0,
    id: model.model.trim(),
    base_url: model.baseUrl.trim(),
    api_key: model.apiKey,
    use_env_api_key: model.useEnvApiKey ? 1 : 0,
    temperature: model.temperature ?? 0.7,
  };
  const requestUrl = model.id
    ? `${API_BASE_URL}/models/${encodeURIComponent(model.id)}`
    : `${API_BASE_URL}/models`;
  const response = model.id
    ? await request<ApiResponse<BackendModelItem>>(requestUrl, {
        method: 'PUT',
        data: payload,
        params: { userId: getCurrentUserId() },
      })
    : await request<ApiResponse<BackendModelItem>>(requestUrl, {
        method: 'POST',
        data: payload,
        params: { userId: getCurrentUserId() },
      });

  if (response.code !== 0) {
    throw new Error(response.msg || '保存 Model 配置失败');
  }

  return getBloomsClawModelsConfig();
};

export const deleteModelItem = async (
  modelName: string,
): Promise<{ models: ModelItem[] }> => {
  const response = await request<ApiResponse<{ deleted: true }>>(
    `${API_BASE_URL}/models/${encodeURIComponent(modelName)}`,
    {
      method: 'DELETE',
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '删除 Model 配置失败');
  }

  return getBloomsClawModelsConfig();
};

export const saveToolItem = async (
  tool: ToolItem,
): Promise<{ tools: ToolItem[] }> => {
  const payload: BackendToolItem = {
    name: tool.name.trim(),
    description: tool.description.trim(),
    active: tool.enabled ? 1 : 0,
    builtin: tool.builtin ? 1 : 0,
    ...(tool.builtin ? {} : { mcp: tool.mcp ?? null }),
  };
  const response = tool.id
    ? await request<ApiResponse<BackendToolItem>>(
        `${API_BASE_URL}/tools/${encodeURIComponent(tool.id)}`,
        {
          method: 'PUT',
          data: payload,
          params: { userId: getCurrentUserId() },
        },
      )
    : await request<ApiResponse<BackendToolItem>>(`${API_BASE_URL}/tools`, {
        method: 'POST',
        data: payload,
        params: { userId: getCurrentUserId() },
      });

  if (response.code !== 0) {
    throw new Error(response.msg || '保存 Tool 配置失败');
  }

  return getBloomsClawToolsConfig();
};

export const createToolItem = async (
  tool: ToolItem,
): Promise<{ tools: ToolItem[] }> => {
  if (!tool.mcp) {
    throw new Error('MCP 工具必须填写连接配置');
  }
  const payload: BackendToolItem = {
    name: tool.name.trim(),
    description: tool.description.trim(),
    active: tool.enabled ? 1 : 0,
    builtin: 0,
    mcp: tool.mcp,
  };
  const response = await request<ApiResponse<BackendToolItem>>(
    `${API_BASE_URL}/tools`,
    {
      method: 'POST',
      data: payload,
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '新建 MCP 工具失败（请检查 MCP Server 是否可连接）');
  }

  return getBloomsClawToolsConfig();
};

export const listRemoteMcpTools = async (
  toolId: string,
): Promise<RemoteMcpToolMeta[]> => {
  const response = await request<ApiResponse<RemoteMcpToolMeta[]>>(
    `${API_BASE_URL}/tools/${encodeURIComponent(toolId)}/remote-tools`,
    { params: { userId: getCurrentUserId() } },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '读取 MCP 远端工具列表失败');
  }

  return response.data ?? [];
};

export const validateMcpConfig = async (
  mcp: McpConfig,
): Promise<RemoteMcpToolMeta[]> => {
  const response = await request<ApiResponse<{ ok: true; tools: RemoteMcpToolMeta[] }>>(
    `${API_BASE_URL}/tools/validate`,
    {
      method: 'POST',
      data: { mcp },
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || 'MCP 连接校验失败');
  }

  return response.data?.tools ?? [];
};

export const deleteToolItem = async (
  toolId: string,
): Promise<{ tools: ToolItem[] }> => {
  const response = await request<ApiResponse<{ deleted: true }>>(
    `${API_BASE_URL}/tools/${encodeURIComponent(toolId)}`,
    {
      method: 'DELETE',
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '删除 Tool 失败');
  }

  return getBloomsClawToolsConfig();
};

export const saveSkillItem = async (
  skill: SkillItem,
): Promise<{ skills: SkillItem[] }> => {
  const payload: BackendSkillItem = {
    name: skill.name.trim(),
    description: skill.description.trim(),
    active: skill.enabled ? 1 : 0,
    source: skill.source,
    installCommand: skill.installCommand,
    installedAt: skill.installedAt,
  };
  const response = await request<ApiResponse<BackendSkillItem>>(
    `${API_BASE_URL}/skills/${encodeURIComponent(skill.id)}`,
    {
      method: 'PUT',
      data: payload,
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '保存 Skill 配置失败');
  }

  return getBloomsClawSkillsConfig();
};

export const installSkillByCommand = async (
  command: string,
): Promise<{ skills: SkillItem[] }> => {
  const response = await request<ApiResponse<BackendSkillItem[]>>(
    `${API_BASE_URL}/skills/install`,
    {
      method: 'POST',
      data: { command },
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '安装 Skill 失败');
  }

  return getBloomsClawSkillsConfig();
};

export const deleteSkillItem = async (
  skillId: string,
): Promise<{ skills: SkillItem[] }> => {
  const response = await request<ApiResponse<{ deleted: true }>>(
    `${API_BASE_URL}/skills/${encodeURIComponent(skillId)}`,
    {
      method: 'DELETE',
      params: { userId: getCurrentUserId() },
    },
  );

  if (response.code !== 0) {
    throw new Error(response.msg || '删除 Skill 失败');
  }

  return getBloomsClawSkillsConfig();
};
