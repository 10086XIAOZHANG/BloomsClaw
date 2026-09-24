import {initChatModel} from 'langchain';
import type { MemoryEmbedder } from './tools/memory';

export async function initStreamModel(config: any, extraConfig: any): Promise<any> {
  const {modelConfig} = config;
  const modelName = modelConfig.id;
  const modelProvider = modelConfig.provider;
  const modelBaseUrl = modelConfig.base_url;
  const modelApiKey = modelConfig.api_key;
  const modelUseEnvApiKey = modelConfig.use_env_api_key === 1;
  const modelTemperature = modelConfig.temperature;
  const {enableThinking} = extraConfig;

  return initChatModel(modelName, {
    modelProvider: modelProvider,
    configuration: {
      baseURL: modelBaseUrl,
      apiKey: modelUseEnvApiKey ? process.env[modelApiKey] : modelApiKey,
      temperature: modelTemperature,
    },
    stream: true,
    modelKwargs: {
      enable_thinking: enableThinking,
    },
  });
}

/**
 * 构造长期记忆的文本向量化函数：复用同一 OpenAI 兼容服务商的 /embeddings 端点。
 * embedding 模型默认取 text-embedding-v3（区别于对话模型 id），可用
 * BLOOMS_CLAW_EMBEDDING_MODEL 覆盖。端点不可用或失败时返回空数组（禁用向量层）。
 */
export function createMemoryEmbedder(modelConfig: any): MemoryEmbedder {
  const baseUrl = String(modelConfig?.base_url ?? '').replace(/\/$/, '');
  const apiKey = modelConfig?.use_env_api_key === 1
    ? process.env[modelConfig?.api_key]
    : modelConfig?.api_key;
  const model = process.env.BLOOMS_CLAW_EMBEDDING_MODEL ?? 'text-embedding-v3';
  if (!baseUrl || !apiKey) {
    return async () => [];
  }
  return async (texts: string[]) => {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!response.ok) return [];
      const data = await response.json() as { data?: Array<{ embedding: number[] }> };
      return (data.data ?? []).map((item) => item.embedding);
    } catch {
      return [];
    }
  };
}
