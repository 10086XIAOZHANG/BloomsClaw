import { tool } from '@langchain/core/tools';

const MAX_EXPRESSION_LENGTH = 200;

function safeEvaluate(expr: string): number {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new Error('表达式不能为空');
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`表达式过长，最多允许 ${MAX_EXPRESSION_LENGTH} 个字符`);
  }

  const normalized = trimmed.replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');

  if (!/^[0-9+\-*/().%\s*]+$/.test(normalized)) {
    throw new Error('表达式包含非法字符，只允许数字和 + - * / ( ) % . 空格');
  }
  if (/\*\*\*/.test(normalized)) {
    throw new Error('表达式语法无效');
  }

  let result: unknown;
  try {
    result = new Function(`"use strict"; return (${normalized});`)();
  } catch {
    throw new Error('表达式语法无效，示例：1+2*3、(10-2)/4、2^10');
  }

  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('计算结果无效（可能是除零或溢出）');
  }
  return result;
}

export const CALCULATOR_TOOL_NAME = 'Calculator';

export const calculatorTool = tool(
  async (input: { expression: string }) => {
    try {
      const raw = typeof input?.expression === 'string' ? input.expression : String(input ?? '');
      const result = safeEvaluate(raw);
      return String(result);
    } catch (error) {
      return `计算失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  },
  {
    name: CALCULATOR_TOOL_NAME,
    description:
      '安全计算数学表达式。输入如 "1+2*3"、"(10-2)/4"、"2^10"、"100*0.85"，返回计算结果。只支持四则运算、括号、取余和幂运算。',
    schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '待计算的数学表达式，例如 "1+2*3"',
        },
      },
      required: ['expression'],
    },
  },
);
