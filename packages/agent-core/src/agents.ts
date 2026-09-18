import {initChatModel} from 'langchain';

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
