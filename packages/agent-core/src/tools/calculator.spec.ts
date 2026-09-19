import { calculatorTool } from './calculator';

describe('calculatorTool', () => {
  it('evaluates basic arithmetic', async () => {
    await expect(calculatorTool.invoke({ expression: '1+2*3' })).resolves.toBe('7');
    await expect(calculatorTool.invoke({ expression: '(10-2)/4' })).resolves.toBe('2');
  });

  it('supports power operator and decimals', async () => {
    await expect(calculatorTool.invoke({ expression: '2^10' })).resolves.toBe('1024');
    await expect(calculatorTool.invoke({ expression: '100*0.85' })).resolves.toBe('85');
  });

  it('rejects invalid or unsafe input gracefully', async () => {
    await expect(calculatorTool.invoke({ expression: 'abc' })).resolves.toMatch(/^计算失败/);
    await expect(calculatorTool.invoke({ expression: '' })).resolves.toMatch(/^计算失败/);
    await expect(calculatorTool.invoke({ expression: '1/0' })).resolves.toMatch(/^计算失败/);
  });
});
