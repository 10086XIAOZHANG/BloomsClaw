// src/pages/chatbot/data.d.ts

export interface ConversationItem {
  key: string;
  label: string;
  group?: string;
  isDraft?: boolean;
}

export type ChatMessageStatus = 'updating' | 'done' | 'error' | 'waiting';

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

export type ChatThoughtStepStatus = 'loading' | 'success' | 'error' | 'abort' | 'waiting';
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

export interface ChatThoughtStep {
  key: string;
  title: string;
  description?: string;
  content?: string;
  status: ChatThoughtStepStatus;
}

export interface ChatMessage {
  id: string;
  requestId?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  thinkContent?: string;
  rawThinkContent?: string;
  isThinking?: boolean;
  thoughtSteps?: ChatThoughtStep[];
  pendingInterrupt?: ChatInterruptPayload;
  status: ChatMessageStatus;
}

export interface ChatAgentOption {
  value: string;
  label: string;
}
