export interface AgentDto {
  name: string;
  model: string;
  tools: string[];
  description: string;
  active: 0 | 1;
  systemPrompt: string;
}
