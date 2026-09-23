import { ASK_HUMAN_TOOL_NAME, askHumanTool } from './askHuman';

describe('askHumanTool', () => {
  it('has the expected name and description', () => {
    expect(askHumanTool.name).toBe(ASK_HUMAN_TOOL_NAME);
    expect(askHumanTool.name).toBe('AskHuman');
    expect(askHumanTool.description).toContain('用户');
  });

  it('requires a question parameter', () => {
    const schema = askHumanTool.schema as unknown as {
      jsonSchema?: { required?: string[] };
      required?: string[];
    };
    const required = schema.jsonSchema?.required ?? schema.required ?? [];
    expect(required).toContain('question');
  });

  it('returns an error message when the question is empty', async () => {
    await expect(askHumanTool.invoke({ question: '   ' })).resolves.toMatch(/问题为空/);
  });
});
