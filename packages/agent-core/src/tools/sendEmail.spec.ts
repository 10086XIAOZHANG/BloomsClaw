import { SEND_EMAIL_TOOL_NAME, sendEmailTool } from './sendEmail';

const sendMail = jest.fn();
const close = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail, close })),
  },
}));

jest.mock('@langchain/langgraph', () => ({
  interrupt: jest.fn(),
}));

import { interrupt } from '@langchain/langgraph';

const mockedInterrupt = interrupt as unknown as jest.Mock;

const validInput = {
  to: ['a@example.com'],
  subject: '你好',
  body: '这是正文',
};

const validCredentials = {
  host: 'smtp.example.com',
  port: 465,
  user: 'me@example.com',
  pass: 'secret',
};

describe('sendEmailTool', () => {
  beforeEach(() => {
    sendMail.mockReset();
    close.mockReset();
    mockedInterrupt.mockReset();
    sendMail.mockResolvedValue({ messageId: '<id-1>' });
  });

  it('has the expected name and description', () => {
    expect(sendEmailTool.name).toBe(SEND_EMAIL_TOOL_NAME);
    expect(sendEmailTool.name).toBe('SendEmail');
    expect(sendEmailTool.description).toContain('SMTP');
  });

  it('requires to, subject and body', () => {
    const schema = sendEmailTool.schema as unknown as {
      jsonSchema?: { required?: string[] };
      required?: string[];
    };
    const required = schema.jsonSchema?.required ?? schema.required ?? [];
    expect(required).toEqual(expect.arrayContaining(['to', 'subject', 'body']));
  });

  it('rejects an empty recipient list before asking for credentials', async () => {
    const result = await sendEmailTool.invoke({ ...validInput, to: [] });
    expect(result).toMatch(/收件人不能为空/);
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it('rejects an invalid recipient address', async () => {
    const result = await sendEmailTool.invoke({ ...validInput, to: ['not-an-email'] });
    expect(result).toMatch(/地址格式不正确/);
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it('rejects an empty subject', async () => {
    const result = await sendEmailTool.invoke({ ...validInput, subject: '   ' });
    expect(result).toMatch(/主题不能为空/);
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it('propagates the interrupt so the runtime can pause', async () => {
    const interruptError = new Error('interrupt');
    mockedInterrupt.mockImplementation(() => {
      throw interruptError;
    });
    await expect(sendEmailTool.invoke(validInput)).rejects.toBe(interruptError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects incomplete credentials after resume', async () => {
    mockedInterrupt.mockResolvedValue({ host: 'smtp.example.com', port: 465 });
    await expect(sendEmailTool.invoke(validInput)).rejects.toThrow(/账号/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends the email with the credentials the user provides', async () => {
    mockedInterrupt.mockResolvedValue({ ...validCredentials, from: '我' });
    const result = await sendEmailTool.invoke({
      ...validInput,
      cc: ['c@example.com'],
      html: true,
    });
    expect(result).toMatch(/邮件已发送/);
    expect(result).toContain('<id-1>');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = sendMail.mock.calls[0][0];
    expect(sent.to).toBe('a@example.com');
    expect(sent.cc).toBe('c@example.com');
    expect(sent.html).toBe('这是正文');
    expect(sent.from).toContain('me@example.com');
    expect(close).toHaveBeenCalled();
  });

  it('reports a transport failure without throwing', async () => {
    mockedInterrupt.mockResolvedValue(validCredentials);
    sendMail.mockRejectedValue(new Error('认证失败'));
    const result = await sendEmailTool.invoke(validInput);
    expect(result).toMatch(/发送失败: 认证失败/);
    expect(close).toHaveBeenCalled();
  });
});
