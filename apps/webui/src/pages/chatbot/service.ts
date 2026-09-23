import { getCurrentUserId } from '@/utils/userSession';

const CHAT_STREAM_API_BASE_URL =
  process.env.CHAT_STREAM_API_URL ||
  process.env.API_BASE_URL ||
  (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:3000');

const resolveApiBaseUrl = (baseUrl: string): string => {
  if (baseUrl.startsWith('/')) {
    return `${window.location.origin}${baseUrl}`;
  }
  return baseUrl;
};

export type ChatAttachmentKind =
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'text'
  | 'binary';

export interface ChatAttachment {
  token: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  url?: string;
}

export interface ChatSelectableAgent {
  name: string;
  active: 0 | 1;
}

export interface ChatSelectableSkill {
  name: string;
  active: 0 | 1;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  id?: string;
  agentName?: string;
  skillNames?: string[];
  attachments?: ChatAttachment[];
  onChunk: (chunk: ChatStreamChunk) => void;
}

export interface ChatInterruptField {
  name: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  example?: string;
}

export interface ChatInterruptPayload {
  kind?: string;
  question?: string;
  fields?: ChatInterruptField[];
  actionRequests?: Array<{
    name?: string;
    description?: string;
    args?: Record<string, unknown>;
  }>;
  reviewConfigs?: Array<Record<string, unknown>>;
}

export interface ResumeChatOptions {
  signal?: AbortSignal;
  id: string;
  agentName?: string;
  skillNames?: string[];
  onChunk: (chunk: ChatStreamChunk) => void;
}

export type ChatThoughtStepStatus = 'loading' | 'success' | 'error' | 'abort';

export interface ChatThoughtStepChunk {
  key: string;
  title: string;
  description?: string;
  content?: string;
  status: ChatThoughtStepStatus;
}

export type ChatStreamChunk =
  | {
      id?: string;
      type: 'thinking_delta';
      delta: string;
    }
  | {
      id?: string;
      type: 'content_delta';
      delta: string;
    }
  | {
      id?: string;
      type: 'thought_step';
      step: ChatThoughtStepChunk;
    }
  | {
      id?: string;
      type: 'done';
      isEnd: true;
    }
  | {
      id?: string;
      type: 'error';
      error: string;
      isEnd: true;
    }
  | {
      id?: string;
      type: 'interrupt';
      interrupt: ChatInterruptPayload;
      isEnd: true;
    };

export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  rawThinkContent?: string;
  thoughtSteps?: ChatThoughtStepChunk[];
  status?: 'updating' | 'done' | 'error' | 'waiting';
}

export interface ChatHistoryConversation {
  id: string;
  label: string;
  updatedAt: string;
  messages: ChatHistoryMessage[];
}

export interface WorkspaceTreeNode {
  title: string;
  path: string;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceTreeResponse {
  rootPath: string;
  treeData: WorkspaceTreeNode[];
}

interface ApiEnvelope<T> {
  code: number;
  data: T;
  msg: string;
}

const createChatStreamUrl = (): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  const url = new URL('models-streaming', normalizedBase);
  return url.toString();
};

const createAttachmentUploadUrl = (): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  return new URL('models-streaming/attachments', normalizedBase).toString();
};

const createChatHistoryUrl = (id?: string): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  const url = new URL(id ? `models-streaming/history/${id}` : 'models-streaming/history', normalizedBase);
  return url.toString();
};

const createWorkspaceTreeUrl = (): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  return new URL('models-streaming/workspace/tree', normalizedBase).toString();
};

const createWorkspaceFileUrl = (filePath: string): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  const url = new URL('models-streaming/workspace/file', normalizedBase);
  url.searchParams.set('path', filePath);
  return url.toString();
};

const parseApiResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }

  const payload = (await response.json()) as T | ApiEnvelope<T>;
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    'code' in payload
  ) {
    return (payload as ApiEnvelope<T>).data;
  }

  return payload as T;
};

export const streamChatCompletion = async (
  input: string,
  { signal, id, agentName, skillNames, attachments, onChunk }: StreamChatOptions,
) => {
  const response = await fetch(createChatStreamUrl(), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: getCurrentUserId(),
      input,
      id,
      agentName,
      skillNames,
      attachments: (attachments ?? []).map((attachment) => ({
        token: attachment.token,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('未获取到可读流');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const flushBuffer = (flushFinalLine = false) => {
    const { objects, rest } = extractJsonLines(buffer, flushFinalLine);
    buffer = rest;
    objects.forEach((item) => onChunk(item));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      buffer += chunk;
      flushBuffer();
    }
  }

  const rest = decoder.decode();
  if (rest) {
    buffer += rest;
  }

  flushBuffer(true);
};

const createResumeUrl = (): string => {
  const normalizedBase = resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).endsWith('/')
    ? CHAT_STREAM_API_BASE_URL
    : `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL)}/`;
  return new URL('models-streaming/resume', normalizedBase).toString();
};

const consumeChatStream = async (
  response: Response,
  onChunk: (chunk: ChatStreamChunk) => void,
): Promise<void> => {
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('未获取到可读流');
  }
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const flushBuffer = (flushFinalLine = false) => {
    const { objects, rest } = extractJsonLines(buffer, flushFinalLine);
    buffer = rest;
    objects.forEach((item) => onChunk(item));
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      buffer += chunk;
      flushBuffer();
    }
  }
  const rest = decoder.decode();
  if (rest) buffer += rest;
  flushBuffer(true);
};

export const resumeChatCompletion = async (
  resume: unknown,
  { signal, id, agentName, skillNames, onChunk }: ResumeChatOptions,
): Promise<void> => {
  const response = await fetch(createResumeUrl(), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: getCurrentUserId(),
      id,
      agentName,
      skillNames,
      resume,
    }),
  });
  await consumeChatStream(response, onChunk);
};

export const uploadChatAttachments = async (
  files: File[],
): Promise<ChatAttachment[]> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await fetch(createAttachmentUploadUrl(), {
    method: 'POST',
    body: formData,
  });

  return parseApiResponse<ChatAttachment[]>(response);
};

export const listSelectableAgents = async (): Promise<ChatSelectableAgent[]> => {
  const response = await fetch(
    `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).replace(/\/$/, '')}/agents?userId=${encodeURIComponent(getCurrentUserId())}`,
    {
      method: 'GET',
    },
  );

  return parseApiResponse<ChatSelectableAgent[]>(response);
};

export const listSelectableSkills = async (): Promise<ChatSelectableSkill[]> => {
  const response = await fetch(
    `${resolveApiBaseUrl(CHAT_STREAM_API_BASE_URL).replace(/\/$/, '')}/skills?userId=${encodeURIComponent(getCurrentUserId())}`,
    {
      method: 'GET',
    },
  );

  return parseApiResponse<ChatSelectableSkill[]>(response);
};

export const listChatHistory = async (): Promise<ChatHistoryConversation[]> => {
  const url = createChatHistoryUrl();
  const finalUrl = `${url}${url.includes('?') ? '&' : '?'}userId=${encodeURIComponent(getCurrentUserId())}`;
  const response = await fetch(finalUrl, {
    method: 'GET',
  });

  return parseApiResponse<ChatHistoryConversation[]>(response);
};

export const deleteChatHistory = async (id: string): Promise<void> => {
  const url = createChatHistoryUrl(id);
  const finalUrl = `${url}${url.includes('?') ? '&' : '?'}userId=${encodeURIComponent(getCurrentUserId())}`;
  const response = await fetch(finalUrl, {
    method: 'DELETE',
  });

  await parseApiResponse<{ deleted: true }>(response);
};

export const getWorkspaceTree = async (threadId?: string): Promise<WorkspaceTreeResponse> => {
  const url = createWorkspaceTreeUrl();
  const params = new URLSearchParams();
  if (threadId?.trim()) {
    params.set('id', threadId.trim());
  }
  params.set('userId', getCurrentUserId());
  const finalUrl = `${url}?${params.toString()}`;
  const response = await fetch(finalUrl, {
    method: 'GET',
  });

  return parseApiResponse<WorkspaceTreeResponse>(response);
};

export const getWorkspaceFileContent = async (
  filePath: string,
  threadId?: string,
): Promise<string> => {
  const url = createWorkspaceFileUrl(filePath);
  const params = new URLSearchParams();
  if (threadId?.trim()) {
    params.set('id', threadId.trim());
  }
  params.set('userId', getCurrentUserId());
  const finalUrl = `${url}&${params.toString()}`;
  const response = await fetch(finalUrl, {
    method: 'GET',
  });

  const payload = await parseApiResponse<{ path: string; content: string }>(response);
  return payload.content;
};

const extractJsonLines = (
  source: string,
  flushFinalLine = false,
): { objects: ChatStreamChunk[]; rest: string } => {
  const objects: ChatStreamChunk[] = [];
  const lines = source.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const completedLines = flushFinalLine ? [...lines, rest] : lines;

  completedLines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      objects.push(JSON.parse(trimmed) as ChatStreamChunk);
    } catch {
      // Keep the stream resilient and skip malformed lines.
    }
  });

  return { objects, rest: flushFinalLine ? '' : rest };
};
