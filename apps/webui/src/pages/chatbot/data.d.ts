// src/pages/chatbot/data.d.ts

export interface ConversationItem {
  key: string;
  label: string;
  group?: string;
  isDraft?: boolean;
}

export type ChatMessageStatus = 'updating' | 'done' | 'error';

export type ChatThoughtStepStatus = 'loading' | 'success' | 'error' | 'abort';
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
  status: ChatMessageStatus;
}

export interface ChatAgentOption {
  value: string;
  label: string;
}

export interface ChatSkillOption {
  value: string;
  label: string;
}
