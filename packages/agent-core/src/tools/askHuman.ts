import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';

export const ASK_HUMAN_TOOL_NAME = 'AskHuman';

/**
 * AskHuman 工具：模型需要向用户澄清/确认 / 索取缺失信息时调用。
 * 调用时通过 LangGraph interrupt() 暂停执行，等待用户回答后，
 * 以 Command({resume: <回答>}) 恢复时，interrupt() 返回该回答并继续本轮。
 */
export const askHumanTool = tool(
  async (input: { question: string }) => {
    const question = String(input?.question ?? '').trim();
    if (!question) {
      return '问题为空，无法向用户提问';
    }
    const answer = interrupt({ question, kind: 'ask_human' });
    const text =
      typeof answer === 'string' ? answer : JSON.stringify(answer);
    return text ? `用户回答: ${text}` : '用户未提供回答';
  },
  {
    name: ASK_HUMAN_TOOL_NAME,
    description:
      '当你需要向用户询问信息（澄清需求、确认偏好、索取缺失的关键参数等）时必须调用。' +
      '调用后流程会暂停，等待用户回答，你将在拿到回答后自动继续执行。' +
      '仅在用户未提供足够信息、且重要决策需要人工确认时使用，避免无必要的提问。',
    schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '希望用户回答的问题，应清晰、具体、可回答',
        },
      },
      required: ['question'],
    },
  },
);