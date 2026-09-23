import {
  DEFAULT_INTERRUPT_ON_TOOLS,
  resolveHumanInLoop,
} from '../index';

describe('resolveHumanInLoop', () => {
  it('returns null when neither options nor config enable HITL', () => {
    expect(resolveHumanInLoop(undefined, {})).toBeNull();
    expect(resolveHumanInLoop(false, {})).toBeNull();
    expect(resolveHumanInLoop(undefined, { humanInTheLoop: { enabled: false } })).toBeNull();
  });

  it('enables defaults when passed true', () => {
    const resolved = resolveHumanInLoop(true, {});
    expect(resolved?.enableAskHuman).toBe(true);
    for (const toolName of DEFAULT_INTERRUPT_ON_TOOLS) {
      expect(resolved?.interruptOn[toolName]).toBe(true);
    }
  });

  it('uses the explicit interruptOn map when provided', () => {
    const resolved = resolveHumanInLoop(
      { enabled: true, interruptOn: { sandbox_shell: true, read_file: false } },
      {},
    );
    expect(resolved?.interruptOn).toEqual({ sandbox_shell: true });
  });

  it('builds interruptOn from a tools array and respects enableAskHuman', () => {
    const resolved = resolveHumanInLoop(
      { enabled: true, tools: ['sandbox_shell', '  ', 'RunCommand'], enableAskHuman: false } as any,
      {},
    );
    expect(resolved?.interruptOn).toEqual({ sandbox_shell: true, RunCommand: true });
    expect(resolved?.enableAskHuman).toBe(false);
  });

  it('falls back to agentConfig.humanInTheLoop when options are absent', () => {
    const resolved = resolveHumanInLoop(undefined, {
      humanInTheLoop: { enabled: true, tools: ['sandbox_file'] },
    });
    expect(resolved?.interruptOn).toEqual({ sandbox_file: true });
    expect(resolved?.enableAskHuman).toBe(true);
  });

  it('gives explicit options precedence over agentConfig', () => {
    const resolved = resolveHumanInLoop(
      { enabled: true, interruptOn: { RunCommand: true } },
      { humanInTheLoop: { enabled: true, tools: ['sandbox_file'] } },
    );
    expect(resolved?.interruptOn).toEqual({ RunCommand: true });
  });
});
