export type AgentItem = {
  id: string;
  name: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  enabled: boolean;
  toolIds: string[];
};

export type ModelItem = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  useEnvApiKey: boolean;
  temperature: number;
  enabled: boolean;
};

export type ToolItem = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
};

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  installCommand: string;
  installedAt: string;
};

export const MODEL_PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Qwen', value: 'qwen' },
];

export const createEmptyAgent = (): AgentItem => ({
  id: '',
  name: '',
  description: '',
  modelId: '',
  systemPrompt: '',
  enabled: true,
  toolIds: [],
});

export const createEmptyModel = (): ModelItem => ({
  id: '',
  name: '',
  provider: 'openai',
  model: '',
  baseUrl: '',
  apiKey: '',
  useEnvApiKey: true,
  temperature: 0.7,
  enabled: true,
});
