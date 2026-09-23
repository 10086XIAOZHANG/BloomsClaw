import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import nodemailer from 'nodemailer';

export const SEND_EMAIL_TOOL_NAME = 'SendEmail';

const MAX_RECIPIENTS = 20;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 100_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  from?: string;
  secure?: boolean;
}

interface EmailAttachment {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf8';
}

interface SendEmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  html?: boolean;
  attachments?: EmailAttachment[];
}

function normalizeAddressList(value: unknown, label: string): string[] {
  if (value == null) {
    return [];
  }
  const raw = Array.isArray(value) ? value : [value];
  const addresses = raw
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (addresses.length > MAX_RECIPIENTS) {
    throw new Error(`${label}数量过多，最多允许 ${MAX_RECIPIENTS} 个`);
  }
  const invalid = addresses.filter((item) => !EMAIL_PATTERN.test(item));
  if (invalid.length > 0) {
    throw new Error(`${label}地址格式不正确: ${invalid.join(', ')}`);
  }
  return addresses;
}

function validateInput(input: SendEmailInput): {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html: boolean;
  attachments: EmailAttachment[];
} {
  const to = normalizeAddressList(input?.to, '收件人');
  if (to.length === 0) {
    throw new Error('收件人不能为空');
  }
  const cc = normalizeAddressList(input?.cc, '抄送');
  const bcc = normalizeAddressList(input?.bcc, '密送');

  const subject = String(input?.subject ?? '').trim();
  if (!subject) {
    throw new Error('邮件主题不能为空');
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new Error(`邮件主题过长，最多允许 ${MAX_SUBJECT_LENGTH} 个字符`);
  }

  const body = String(input?.body ?? '');
  if (!body.trim()) {
    throw new Error('邮件正文不能为空');
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new Error(`邮件正文过长，最多允许 ${MAX_BODY_LENGTH} 个字符`);
  }

  const attachments = Array.isArray(input?.attachments) ? input.attachments : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment.filename !== 'string' || !attachment.filename.trim()) {
      throw new Error('附件缺少文件名');
    }
    if (typeof attachment.content !== 'string') {
      throw new Error(`附件 ${attachment.filename} 缺少内容`);
    }
  }

  return {
    to,
    cc,
    bcc,
    subject,
    body,
    html: input?.html === true,
    attachments,
  };
}

function parseCredentials(answer: unknown): SmtpCredentials {
  const source =
    answer && typeof answer === 'object'
      ? (answer as Record<string, unknown>)
      : null;
  if (!source) {
    throw new Error('用户未提供发件邮箱信息');
  }
  const host = String(source.host ?? '').trim();
  const user = String(source.user ?? '').trim();
  const pass = String(source.pass ?? '');
  const port = Number(source.port);
  if (!host) {
    throw new Error('缺少 SMTP 服务器地址（host）');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP 端口（port）无效，应为 1-65535 的整数');
  }
  if (!user) {
    throw new Error('缺少发件邮箱账号（user）');
  }
  if (!pass) {
    throw new Error('缺少发件邮箱授权码/密码（pass）');
  }
  const from = String(source.from ?? '').trim();
  return {
    host,
    port,
    user,
    pass,
    ...(from ? { from } : {}),
    ...(source.secure === true ? { secure: true } : {}),
  };
}

/**
 * 通过 interrupt 向用户索取发件邮箱凭证。
 * 执行会在此暂停，用户以 Command({resume}) 恢复时返回其提供的凭证。
 * 凭证只在本次调用内存中使用，不会写入配置或日志。
 */
const SMTP_FIELDS = [
  { name: 'host', label: 'SMTP 服务器地址', required: true, example: 'smtp.qq.com' },
  { name: 'port', label: '端口', required: true, example: '465' },
  { name: 'user', label: '邮箱账号', required: true, example: 'you@qq.com' },
  { name: 'pass', label: '授权码/密码', required: true, secret: true },
  { name: 'from', label: '发件人显示名（可选）', required: false },
  { name: 'secure', label: '强制 SSL（可选，465 端口建议开启）', required: false },
] as const;

const SMTP_AUTH_FIELDS = [
  { name: 'user', label: '邮箱账号', required: true, example: 'you@qq.com' },
  { name: 'pass', label: '授权码/密码', required: true, secret: true },
] as const;

async function requestCredentials(options?: {
  question?: string;
  fields?: readonly unknown[];
  defaults?: Partial<SmtpCredentials>;
}): Promise<SmtpCredentials> {
  const answer = await interrupt({
    kind: 'ask_human',
    question:
      options?.question ??
      '发送邮件需要你的发件邮箱信息，请提供：SMTP 服务器地址(host)、端口(port)、' +
      '邮箱账号(user)、授权码或密码(pass)，可选发件人显示名(from)与是否强制 SSL(secure)。',
    fields: options?.fields ?? SMTP_FIELDS,
  });
  const mergedAnswer = {
    ...(options?.defaults ?? {}),
    ...(answer && typeof answer === 'object' ? answer : {}),
  };
  return parseCredentials(mergedAnswer);
}

function isSmtpAuthenticationError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /authentication|auth|535|用户名|密码|授权码|认证|登录验证/i.test(text);
}

/**
 * SendEmail 工具：通过 SMTP 对外发送邮件。
 * 发件账号不预存，每次发送前通过 LangGraph interrupt 向用户索取，
 * 用户确认并提供凭证后流程自动恢复并完成发送。
 */
export const sendEmailTool = tool(
  async (input: SendEmailInput) => {
    let validated: ReturnType<typeof validateInput>;
    try {
      validated = validateInput(input);
    } catch (error) {
      return `发送失败: ${error instanceof Error ? error.message : '参数无效'}`;
    }

    let credentials = await requestCredentials();
    let retryCredentials: SmtpCredentials | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (retryCredentials) {
        credentials = retryCredentials;
      }

      const transporter = nodemailer.createTransport({
        host: credentials.host,
        port: credentials.port,
        secure: credentials.secure ?? credentials.port === 465,
        auth: { user: credentials.user, pass: credentials.pass },
      });

      try {
        const info = await transporter.sendMail({
          from: credentials.from
            ? `"${credentials.from}" <${credentials.user}>`
            : credentials.user,
          to: validated.to.join(', '),
          ...(validated.cc.length > 0 ? { cc: validated.cc.join(', ') } : {}),
          ...(validated.bcc.length > 0 ? { bcc: validated.bcc.join(', ') } : {}),
          subject: validated.subject,
          ...(validated.html ? { html: validated.body } : { text: validated.body }),
          ...(validated.attachments.length > 0
            ? {
                attachments: validated.attachments.map((item) => ({
                  filename: item.filename.trim(),
                  content: item.content,
                  encoding: item.encoding === 'base64' ? 'base64' : 'utf8',
                })),
              }
            : {}),
        });
        return `邮件已发送，收件人: ${validated.to.join(', ')}，messageId: ${info.messageId ?? '未知'}`;
      } catch (error) {
        if (attempt === 0 && isSmtpAuthenticationError(error)) {
          retryCredentials = await requestCredentials({
            question:
              'SMTP 登录验证失败。请只检查并重新提供邮箱账号和授权码/密码，其他连接信息将沿用上次填写的内容。',
            fields: SMTP_AUTH_FIELDS,
            defaults: credentials,
          });
          continue;
        }
        return `发送失败: ${error instanceof Error ? error.message : '未知错误'}`;
      } finally {
        transporter.close();
      }
    }

    return '发送失败: SMTP 登录验证失败，请检查邮箱账号和授权码/密码';
  },
  {
    name: SEND_EMAIL_TOOL_NAME,
    description:
      '通过 SMTP 对外发送邮件。支持多个收件人、抄送、密送、纯文本或 HTML 正文以及文本/base64 附件。' +
      '发件邮箱信息不预存：调用后流程会暂停，向用户索取 SMTP 服务器、端口、账号和授权码，' +
      '用户确认后自动继续并完成发送。仅在用户明确要求发送邮件时使用。',
    schema: {
      type: 'object',
      properties: {
        to: {
          type: 'array',
          items: { type: 'string' },
          description: '收件人邮箱地址列表，例如 ["a@example.com"]',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: '抄送邮箱地址列表（可选）',
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: '密送邮箱地址列表（可选）',
        },
        subject: {
          type: 'string',
          description: '邮件主题',
        },
        body: {
          type: 'string',
          description: '邮件正文，纯文本或 HTML（配合 html=true）',
        },
        html: {
          type: 'boolean',
          description: '正文是否按 HTML 发送，默认 false（纯文本）',
        },
        attachments: {
          type: 'array',
          description: '附件列表（可选）',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: '附件文件名' },
              content: { type: 'string', description: '附件内容，文本或 base64 字符串' },
              encoding: {
                type: 'string',
                enum: ['utf8', 'base64'],
                description: '内容编码，默认 utf8',
              },
            },
            required: ['filename', 'content'],
          },
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
);
