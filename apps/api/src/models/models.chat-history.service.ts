import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChatAttachmentDto } from './models.attachments.service';

export interface ChatHistoryMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachmentDto[];
  rawThinkContent?: string;
  thoughtSteps?: ChatThoughtStepDto[];
  status?: 'updating' | 'done' | 'error';
}

export interface ChatHistoryConversationDto {
  id: string;
  label: string;
  updatedAt: string;
  messages: ChatHistoryMessageDto[];
}

export interface ChatThoughtStepDto {
  key: string;
  title: string;
  description?: string;
  content?: string;
  status: 'loading' | 'success' | 'error' | 'abort';
}

interface SerializedLangChainMessage {
  id?: string[];
  kwargs?: {
    id?: string;
    content?: unknown;
    name?: string;
    tool_call_id?: string;
    additional_kwargs?: {
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
  };
}

interface SerializedCheckpoint {
  ts?: string;
  channel_values?: {
    messages?: SerializedLangChainMessage[];
  };
}

@Injectable()
export class ModelsChatHistoryService {
  private readonly memoryDir = path.join(os.homedir(), '.blooms_claw', 'memory');
  private readonly conversationDir = path.join(
    os.homedir(),
    '.blooms_claw',
    'chat_history',
  );

  listConversations(): ChatHistoryConversationDto[] {
    const persistedConversations = this.listPersistedConversations();
    const persistedIds = new Set(persistedConversations.map((item) => item.id));
    const fallbackConversations = this.listCheckpointConversations().filter(
      (item) => !persistedIds.has(item.id),
    );

    return [...persistedConversations, ...fallbackConversations].sort(
      (a, b) => this.toTimestamp(b.updatedAt) - this.toTimestamp(a.updatedAt),
    );
  }

  removeConversation(threadId: string): void {
    const safeThreadId = this.normalizeThreadId(threadId);
    const filePath = this.getFilePath(safeThreadId);
    const persistedFilePath = this.getConversationFilePath(safeThreadId);

    if (!fs.existsSync(filePath) && !fs.existsSync(persistedFilePath)) {
      throw new NotFoundException(`会话不存在: ${safeThreadId}`);
    }

    fs.rmSync(filePath, { force: true });
    fs.rmSync(persistedFilePath, { force: true });
  }

  readConversationById(threadId: string): ChatHistoryConversationDto | null {
    const safeThreadId = this.normalizeThreadId(threadId);
    const persistedConversation = this.readPersistedConversation(safeThreadId);
    const checkpointConversation = this.readConversationFromCheckpoint(safeThreadId);

    if (persistedConversation && checkpointConversation) {
      return this.mergeConversationSources(
        persistedConversation,
        checkpointConversation,
      );
    }

    return persistedConversation ?? checkpointConversation;
  }

  appendUserMessage(
    threadId: string,
    message: { id: string; content: string; attachments?: ChatAttachmentDto[] },
  ): void {
    const conversation = this.getOrCreateConversation(
      threadId,
      message.content,
      message.attachments,
    );
    conversation.messages.push({
      id: message.id,
      role: 'user',
      content: message.content,
      attachments: message.attachments,
      status: 'done',
    });
    conversation.updatedAt = new Date().toISOString();
    if (!conversation.label || conversation.label === '新对话') {
      conversation.label =
        message.content.slice(0, 20)
        || message.attachments?.[0]?.name?.slice(0, 20)
        || '新对话';
    }
    this.writeConversation(conversation);
  }

  ensureAssistantMessage(
    threadId: string,
    message: Pick<ChatHistoryMessageDto, 'id'>,
  ): void {
    const conversation = this.getOrCreateConversation(threadId);
    const existing = conversation.messages.find((item) => item.id === message.id);

    if (!existing) {
      conversation.messages.push({
        id: message.id,
        role: 'assistant',
        content: '',
        thoughtSteps: [],
        status: 'updating',
      });
      conversation.updatedAt = new Date().toISOString();
      this.writeConversation(conversation);
    }
  }

  appendAssistantThinking(
    threadId: string,
    messageId: string,
    delta: string,
  ): void {
    this.updateAssistantMessage(threadId, messageId, (message) => {
      message.rawThinkContent = `${message.rawThinkContent ?? ''}${delta}`;
      message.status = 'updating';
    });
  }

  appendAssistantContent(
    threadId: string,
    messageId: string,
    delta: string,
  ): void {
    this.updateAssistantMessage(threadId, messageId, (message) => {
      message.content = `${message.content}${delta}`;
      message.status = 'updating';
    });
  }

  upsertAssistantThoughtStep(
    threadId: string,
    messageId: string,
    step: ChatThoughtStepDto,
  ): void {
    this.updateAssistantMessage(threadId, messageId, (message) => {
      const thoughtSteps = message.thoughtSteps ?? [];
      const targetIndex = thoughtSteps.findIndex((item) => item.key === step.key);

      if (targetIndex === -1) {
        message.thoughtSteps = [...thoughtSteps, step];
      } else {
        message.thoughtSteps = thoughtSteps.map((item, index) =>
          index === targetIndex
            ? {
                ...item,
                ...step,
                content: step.content ?? item.content,
                description: step.description ?? item.description,
              }
            : item,
        );
      }

      message.status =
        step.status === 'error' ? 'error' : message.status ?? 'updating';
    });
  }

  finalizeAssistantMessage(
    threadId: string,
    messageId: string,
    status: 'done' | 'error' = 'done',
  ): void {
    this.updateAssistantMessage(threadId, messageId, (message) => {
      message.status = status;
      if (status !== 'error') {
        message.thoughtSteps = (message.thoughtSteps ?? []).map((step) =>
          step.status === 'loading'
            ? { ...step, status: 'success' }
            : step,
        );
      }
    });
  }

  private listPersistedConversations(): ChatHistoryConversationDto[] {
    if (!fs.existsSync(this.conversationDir)) {
      return [];
    }

    return fs
      .readdirSync(this.conversationDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) =>
        this.readPersistedConversation(path.basename(fileName, '.json')),
      )
      .filter(
        (conversation): conversation is ChatHistoryConversationDto =>
          conversation !== null,
      );
  }

  private listCheckpointConversations(): ChatHistoryConversationDto[] {
    if (!fs.existsSync(this.memoryDir)) {
      return [];
    }

    return fs
      .readdirSync(this.memoryDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) =>
        this.readConversationFromCheckpoint(path.basename(fileName, '.json')),
      )
      .filter(
        (conversation): conversation is ChatHistoryConversationDto =>
          conversation !== null,
      );
  }

  private readPersistedConversation(
    threadId: string,
  ): ChatHistoryConversationDto | null {
    const filePath = this.getConversationFilePath(this.normalizeThreadId(threadId));
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const rawData = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      ) as ChatHistoryConversationDto;
      if (!rawData || typeof rawData !== 'object' || rawData.id !== threadId) {
        return null;
      }
      return {
        ...rawData,
        messages: Array.isArray(rawData.messages)
          ? rawData.messages.map((message) => ({
              ...message,
              attachments: Array.isArray(message.attachments)
                ? message.attachments.filter(
                    (attachment): attachment is ChatAttachmentDto =>
                      Boolean(attachment)
                      && typeof attachment === 'object'
                      && typeof attachment.token === 'string'
                      && typeof attachment.name === 'string'
                      && typeof attachment.kind === 'string',
                  )
                : undefined,
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  private readConversationFromCheckpoint(
    threadId: string,
  ): ChatHistoryConversationDto | null {
    const safeThreadId = this.normalizeThreadId(threadId);
    const filePath = this.getFilePath(safeThreadId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;
    const checkpoints = Object.values(
      rawData?.storage?.[safeThreadId]?.[''] ?? {},
    ) as [SerializedCheckpoint, unknown, string | null][];

    const latestCheckpoint = checkpoints
      .map(([checkpoint]) => checkpoint)
      .filter((checkpoint) => {
        return Array.isArray(checkpoint?.channel_values?.messages);
      })
      .sort((a, b) => this.toTimestamp(b?.ts) - this.toTimestamp(a?.ts))[0];

    if (!latestCheckpoint) {
      return null;
    }

    const messages = this.mergeMessagesFromCheckpoint(
      latestCheckpoint.channel_values?.messages ?? [],
      safeThreadId,
    );

    if (messages.length === 0) {
      return null;
    }

    const firstUserMessage = messages.find((message) => message.role === 'user');

    return {
      id: safeThreadId,
      label: firstUserMessage?.content.slice(0, 20) || '新对话',
      updatedAt: latestCheckpoint.ts || new Date(0).toISOString(),
      messages,
    };
  }

  private mergeMessagesFromCheckpoint(
    rawMessages: SerializedLangChainMessage[],
    threadId: string,
  ): ChatHistoryMessageDto[] {
    const merged: ChatHistoryMessageDto[] = [];

    rawMessages.forEach((message, index) => {
      const messageType = message?.id?.[2];
      const content = this.normalizeContent(message?.kwargs?.content);
      const rawThinkContent = this.normalizeContent(
        message?.kwargs?.additional_kwargs?.reasoning_content,
      );
      const toolCalls = this.normalizeToolCalls(
        message?.kwargs?.additional_kwargs?.tool_calls,
      );

      if (messageType === 'HumanMessage') {
        merged.push({
          id: message?.kwargs?.id || `${threadId}-user-${index}`,
          role: 'user',
          content,
          status: 'done',
        });
        return;
      }

      if (messageType === 'AIMessage' || messageType === 'AIMessageChunk') {
        const previousMessage = merged[merged.length - 1];
        const shouldMergeToPrevious = previousMessage?.role === 'assistant';
        const nextThoughtSteps = this.mergeCheckpointThoughtSteps(
          shouldMergeToPrevious ? previousMessage?.thoughtSteps : undefined,
          {
            rawThinkContent,
            toolCalls,
          },
        );

        if (shouldMergeToPrevious) {
          previousMessage.content += content;
          if (rawThinkContent) {
            previousMessage.rawThinkContent =
              (previousMessage.rawThinkContent || '') + rawThinkContent;
          }
          previousMessage.thoughtSteps = nextThoughtSteps;
          previousMessage.status = 'done';
          return;
        }

        merged.push({
          id: message?.kwargs?.id || `${threadId}-assistant-${index}`,
          role: 'assistant',
          content,
          rawThinkContent: rawThinkContent || undefined,
          thoughtSteps: nextThoughtSteps,
          status: 'done',
        });
        return;
      }

      if (messageType === 'ToolMessage') {
        const previousMessage = merged[merged.length - 1];
        if (previousMessage?.role !== 'assistant') {
          return;
        }

        previousMessage.thoughtSteps = this.mergeCheckpointToolResult(
          previousMessage.thoughtSteps,
          {
            key:
              message?.kwargs?.tool_call_id
              || `${threadId}:${message?.kwargs?.name || 'tool'}:${index}`,
            name: this.normalizeContent(message?.kwargs?.name),
            output: content,
          },
        );
      }
    });

    return merged.filter((message) => {
      return Boolean(
        message.content || message.rawThinkContent || message.thoughtSteps?.length,
      );
    });
  }

  private mergeCheckpointThoughtSteps(
    steps: ChatThoughtStepDto[] | undefined,
    input: {
      rawThinkContent?: string;
      toolCalls: Array<{
        key: string;
        name: string;
        arguments?: string;
      }>;
    },
  ): ChatThoughtStepDto[] {
    let nextSteps = steps ?? [];

    if (input.rawThinkContent) {
      nextSteps = this.upsertThoughtStep(nextSteps, {
        key: 'reasoning',
        title: '深度思考',
        description: '模型已完成分析与规划',
        content: input.rawThinkContent,
        status: 'success',
      });
    }

    if (input.toolCalls.length > 0) {
      nextSteps = this.upsertThoughtStep(nextSteps, {
        key: `plan:${input.toolCalls[0].key}`,
        title: '任务分配',
        description: '已规划待执行任务',
        content: this.serializeToolPlan(input.toolCalls),
        status: 'success',
      });
    }

    return nextSteps;
  }

  private mergeCheckpointToolResult(
    steps: ChatThoughtStepDto[] | undefined,
    toolResult: {
      key: string;
      name: string;
      output: string;
    },
  ): ChatThoughtStepDto[] {
    const nextSteps = steps ?? [];
    return this.upsertThoughtStep(nextSteps, {
      key: toolResult.key,
      title: this.formatToolTitle(toolResult.name),
      description: '工具调用已完成',
      content: this.serializeThoughtContent(toolResult.output),
      status: 'success',
    });
  }

  private normalizeContent(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item === 'object' && 'text' in item) {
            return this.normalizeContent((item as { text?: unknown }).text);
          }
          return '';
        })
        .join('');
    }

    if (value == null) {
      return '';
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private normalizeThreadId(threadId: string): string {
    const normalized = threadId.trim();

    if (!normalized || path.basename(normalized) !== normalized) {
      throw new BadRequestException('非法会话 ID');
    }

    return normalized;
  }

  private getFilePath(threadId: string): string {
    return path.join(this.memoryDir, `${threadId}.json`);
  }

  private getConversationFilePath(threadId: string): string {
    return path.join(this.conversationDir, `${threadId}.json`);
  }

  private getOrCreateConversation(
    threadId: string,
    initialUserContent?: string,
    initialAttachments?: ChatAttachmentDto[],
  ): ChatHistoryConversationDto {
    return (
      this.readConversationById(threadId) ?? {
        id: threadId,
        label:
          initialUserContent?.slice(0, 20)
          || initialAttachments?.[0]?.name?.slice(0, 20)
          || '新对话',
        updatedAt: new Date().toISOString(),
        messages: [],
      }
    );
  }

  private mergeConversationSources(
    persistedConversation: ChatHistoryConversationDto,
    checkpointConversation: ChatHistoryConversationDto,
  ): ChatHistoryConversationDto {
    const mergedMessages = persistedConversation.messages.map((message, index) => {
      const checkpointMessage = checkpointConversation.messages[index];
      if (
        !checkpointMessage
        || checkpointMessage.role !== message.role
        || message.role !== 'assistant'
      ) {
        return message;
      }

      const persistedThoughtSteps = message.thoughtSteps ?? [];
      const checkpointThoughtSteps = checkpointMessage.thoughtSteps ?? [];
      const shouldUseCheckpointThoughtSteps =
        checkpointThoughtSteps.length > persistedThoughtSteps.length
        || (
          checkpointThoughtSteps.length > 1
          && this.isCompressedReasoningOnly(persistedThoughtSteps)
        );

      return {
        ...message,
        rawThinkContent:
          message.rawThinkContent || checkpointMessage.rawThinkContent,
        thoughtSteps: shouldUseCheckpointThoughtSteps
          ? checkpointThoughtSteps
          : persistedThoughtSteps,
      };
    });

    return {
      ...persistedConversation,
      label:
        persistedConversation.label === '新对话'
          ? checkpointConversation.label
          : persistedConversation.label,
      updatedAt:
        this.toTimestamp(checkpointConversation.updatedAt)
          > this.toTimestamp(persistedConversation.updatedAt)
          ? checkpointConversation.updatedAt
          : persistedConversation.updatedAt,
      messages: mergedMessages,
    };
  }

  private isCompressedReasoningOnly(steps: ChatThoughtStepDto[]): boolean {
    return (
      steps.length <= 1
      && steps.every((step) => step.title === '深度思考' || step.key === 'reasoning')
    );
  }

  private writeConversation(conversation: ChatHistoryConversationDto): void {
    if (!fs.existsSync(this.conversationDir)) {
      fs.mkdirSync(this.conversationDir, { recursive: true });
    }

    fs.writeFileSync(
      this.getConversationFilePath(conversation.id),
      JSON.stringify(conversation, null, 2),
      'utf8',
    );
  }

  private updateAssistantMessage(
    threadId: string,
    messageId: string,
    updater: (message: ChatHistoryMessageDto) => void,
  ): void {
    const conversation = this.getOrCreateConversation(threadId);
    const targetMessage = conversation.messages.find(
      (item) => item.id === messageId && item.role === 'assistant',
    );

    if (!targetMessage) {
      conversation.messages.push({
        id: messageId,
        role: 'assistant',
        content: '',
        thoughtSteps: [],
        status: 'updating',
      });
    }

    const nextTargetMessage =
      conversation.messages.find(
        (item) => item.id === messageId && item.role === 'assistant',
      ) ?? conversation.messages[conversation.messages.length - 1];
    updater(nextTargetMessage);
    conversation.updatedAt = new Date().toISOString();
    this.writeConversation(conversation);
  }

  private normalizeToolCalls(value: unknown): Array<{
    key: string;
    name: string;
    arguments?: string;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item, index) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const toolCall = item as {
        id?: unknown;
        name?: unknown;
        function?: {
          name?: unknown;
          arguments?: unknown;
        };
      };

      const name =
        this.normalizeContent(toolCall.function?.name) || this.normalizeContent(toolCall.name);
      if (!name) {
        return [];
      }

      const serializedArguments = this.serializeThoughtContent(
        this.normalizeContent(toolCall.function?.arguments),
      );

      return [
        {
          key: this.normalizeContent(toolCall.id) || `${name}:${index}`,
          name,
          arguments: serializedArguments,
        },
      ];
    });
  }

  private upsertThoughtStep(
    steps: ChatThoughtStepDto[],
    nextStep: ChatThoughtStepDto,
  ): ChatThoughtStepDto[] {
    const targetIndex = steps.findIndex((item) => item.key === nextStep.key);
    if (targetIndex === -1) {
      return [...steps, nextStep];
    }

    return steps.map((item, index) =>
      index === targetIndex
        ? {
            ...item,
            ...nextStep,
            content: nextStep.content ?? item.content,
            description: nextStep.description ?? item.description,
          }
        : item,
    );
  }

  private serializeThoughtContent(value: unknown): string | undefined {
    const content = this.normalizeContent(value).trim();
    if (!content) {
      return undefined;
    }

    const looksLikeJson =
      (content.startsWith('{') && content.endsWith('}'))
      || (content.startsWith('[') && content.endsWith(']'));
    return looksLikeJson ? `\`\`\`json\n${content}\n\`\`\`` : content;
  }

  private serializeToolPlan(
    toolCalls: Array<{ name: string; arguments?: string }>,
  ): string | undefined {
    if (toolCalls.length === 0) {
      return undefined;
    }

    return toolCalls
      .map((toolCall, index) =>
        [
          `${index + 1}. ${this.formatToolTitle(toolCall.name)}`,
          toolCall.arguments ? `参数:\n${toolCall.arguments}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
  }

  private formatToolTitle(name?: string): string {
    if (!name) {
      return '调用工具';
    }

    const normalized = name.replace(/_/g, ' ').trim();
    return normalized ? `工具: ${normalized}` : '调用工具';
  }

  private toTimestamp(value?: string): number {
    const timestamp = value ? Date.parse(value) : NaN;
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
