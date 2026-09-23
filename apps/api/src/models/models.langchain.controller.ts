import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { createAgent, readConfigByAgentName, buildResumeCommand, getPendingInterrupts } from '@blooms-claw/agent-core';
import type { Response } from 'express';
import { ModelsAttachmentsService } from './models.attachments.service';
import type { ChatThoughtStepDto } from './models.chat-history.service';
import { ModelsChatHistoryService } from './models.chat-history.service';
import { ModelsWorkspaceService } from './models.workspace.service';

type ThoughtStepStatus = 'loading' | 'success' | 'error' | 'abort' | 'waiting';

function extractGraphInterruptValue(error: unknown): unknown | undefined {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const jsonStart = raw.indexOf('[');
  if (jsonStart < 0) return undefined;
  const jsonEnd = raw.indexOf(']\n\nGraphInterrupt', jsonStart);
  const jsonText = jsonEnd >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw.slice(jsonStart);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && typeof first === 'object' && 'value' in first) {
      return (first as { value: unknown }).value;
    }
    return first;
  } catch {
    return undefined;
  }
}


interface ThoughtStepChunk {
  key: string;
  title: string;
  description?: string;
  content?: string;
  status: ThoughtStepStatus;
}

type ChatStreamChunk =
  | {
      id: string;
      type: 'thinking_delta';
      delta: string;
    }
  | {
      id: string;
      type: 'content_delta';
      delta: string;
    }
  | {
      id: string;
      type: 'thought_step';
      step: ThoughtStepChunk;
    }
  | {
      id: string;
      type: 'done';
      isEnd: true;
    }
  | {
      id: string;
      type: 'interrupt';
      interrupt: unknown;
      isEnd: true;
    }
  | {
      id?: string;
      type: 'error';
      error: string;
      isEnd: true;
    };

@Controller('models-streaming')
export class ModelsLangchainController {
  private readonly logger = new Logger(ModelsLangchainController.name);

  constructor(
    private readonly modelsChatHistoryService: ModelsChatHistoryService,
    private readonly modelsAttachmentsService: ModelsAttachmentsService,
    private readonly modelsWorkspaceService: ModelsWorkspaceService,
  ) {}

  @Get('history')
  listHistory(@Query('userId') userId = 'default') {
    return this.modelsChatHistoryService.listConversations(userId);
  }

  @Delete('history/:id')
  removeHistory(@Param('id') id: string, @Query('userId') userId = 'default') {
    this.modelsChatHistoryService.removeConversation(id, userId);
    return { deleted: true };
  }

  @Post('attachments')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: {
        fileSize: 15 * 1024 * 1024,
      },
    }),
  )
  uploadAttachments(
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype?: string;
      size: number;
      buffer: Buffer;
    }>,
  ) {
    return this.modelsAttachmentsService.saveUploadedFiles(files);
  }

  @Get('workspace/tree')
  getWorkspaceTree(
    @Query('id') threadId?: string,
    @Query('userId') userId = 'default',
  ) {
    return this.modelsWorkspaceService.getWorkspaceTree(threadId, userId);
  }

  @Get('workspace/file')
  async getWorkspaceFile(
    @Query('path') filePath: string,
    @Query('id') threadId?: string,
    @Query('userId') userId = 'default',
  ) {
    return {
      path: filePath,
      content: await this.modelsWorkspaceService.readFileContent(
        filePath,
        threadId,
        userId,
      ),
    };
  }

  @Get('attachments/:token/download')
  downloadAttachment(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const file = this.modelsAttachmentsService.downloadAttachment(token);
      if (!fs.existsSync(file.filePath)) {
        throw new BadRequestException('附件文件不存在');
      }
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(file.name)}"`,
      );
      if (typeof file.size === 'number') {
        res.setHeader('Content-Length', String(file.size));
      }
      const stream = fs.createReadStream(file.filePath);
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) {
        return;
      }
      throw error;
    }
  }

  @Get()
  async streamByQuery(
    @Query()
    query: {
      input?: string;
      id?: string;
      agentName?: string;
      skill?: string | string[];
      userId?: string;
    },
    @Res() res: Response,
  ) {
    return this.streamChat(
      {
        input: query.input,
        id: query.id,
        agentName: query.agentName,
        skillNames: this.normalizeQuerySkills(query.skill),
        attachments: [],
      },
      res,
      query.userId,
    );
  }

  @Post()
  async streamByBody(
    @Body()
    body: {
      input?: string;
      id?: string;
      agentName?: string;
      skillNames?: string[];
      attachments?: Array<{ token?: string }>;
      userId?: string;
    },
    @Res() res: Response,
  ) {
    return this.streamChat(body, res, body.userId);
  }

  @Post('resume')
  async resume(
    @Body()
    body: {
      id?: string;
      userId?: string;
      agentName?: string;
      skillNames?: string[];
      resume?: unknown;
    },
    @Res() res: Response,
  ) {
    const chatId = body.id?.trim();
    if (!chatId) {
      throw new BadRequestException('缺少会话 id');
    }
    if (body.resume === undefined) {
      throw new BadRequestException('缺少 resume 决策');
    }

    const currentUserId = body.userId ?? 'default';
    const agentName = body.agentName?.trim() || 'TestAgent';
    const skillNames = this.normalizeBodySkills(body.skillNames);
    const assistantMessageId = randomUUID();
    let closeAgent: (() => Promise<void>) | undefined;

    try {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      this.modelsChatHistoryService.ensureAssistantMessage(
        chatId,
        { id: assistantMessageId },
        currentUserId,
      );

      const { agent, close } = await createAgent(agentName, {
        threadId: chatId,
        userId: currentUserId,
        enableThinking: true,
        skillNames,
      } as any);
      closeAgent = close;

      const response = agent.streamEvents(
        buildResumeCommand(body.resume),
        {
          configurable: {
            thread_id: chatId,
          },
        },
      );

      const { interrupted, chunkCount } = await this.consumeAgentStream(
        response,
        res,
        chatId,
        assistantMessageId,
        currentUserId,
        agent,
      );

      if (interrupted) {
        this.modelsChatHistoryService.finalizeAssistantMessage(
          chatId,
          assistantMessageId,
          'waiting',
          currentUserId,
        );
        this.logger.log(`[deepagents-resume] re-interrupted chatId=${chatId}`);
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      this.modelsChatHistoryService.finalizeAssistantMessage(
        chatId,
        assistantMessageId,
        'done',
        currentUserId,
      );
      if (!res.writableEnded) {
        this.writeChunk(res, { id: assistantMessageId, type: 'done', isEnd: true });
        res.end();
      }
      this.logger.log(`[deepagents-resume] completed chatId=${chatId} chunkCount=${chunkCount}`);
    } catch (e) {
      this.logger.error(
        `[deepagents-resume] failed chatId=${chatId} message=${e instanceof Error ? e.message : '未知错误'}`,
        e instanceof Error ? e.stack : undefined,
      );
      if (!res.writableEnded) {
        res.write(
          JSON.stringify({
            id: assistantMessageId,
            type: 'error',
            error: e instanceof Error ? e.message : '未知错误',
            isEnd: true,
          }) + '\n',
        );
        res.end();
      }
      this.modelsChatHistoryService.finalizeAssistantMessage(
        chatId,
        assistantMessageId,
        'error',
        currentUserId,
      );
    } finally {
      if (closeAgent) {
        try {
          await closeAgent();
        } catch (closeError) {
          this.logger.error(
            `[deepagents-resume] closeAgent failed chatId=${chatId}`,
            closeError instanceof Error ? closeError.stack : undefined,
          );
        }
      }
    }
  }

  private async streamChat(
    payload: {
      input?: string;
      id?: string;
      agentName?: string;
      skillNames?: string[];
      attachments?: Array<{ token?: string }>;
    },
    res: Response,
    userId?: string,
  ) {
    const input = (payload.input ?? '').trim();
    const attachments = this.modelsAttachmentsService.resolveAttachments(
      payload.attachments,
    );
    const currentUserId = userId ?? 'default';

    if (!input && attachments.length === 0) {
      this.logger.warn('[agent-stream] request ignored because input and attachments are empty');
      return '';
    }

    {
      let closeAgent: (() => Promise<void>) | undefined;
      const requestStartedAt = Date.now();
      const chatId = payload.id || randomUUID();
      const assistantMessageId = randomUUID();
      const userMessageId = randomUUID();
      let chunkCount = 0;
      try {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const agentName = payload.agentName?.trim() || 'TestAgent';
        const skillNames = this.normalizeBodySkills(payload.skillNames);
        const reasoningStepKey = `${assistantMessageId}:reasoning`;
        const answerStepKey = `${assistantMessageId}:answer`;
        const userContent = input || '请阅读并分析我上传的附件内容。';
        this.logger.log(
          `[deepagents-stream] request started chatId=${chatId} agent=${agentName} skills=${skillNames.join(',') || 'none'} inputLength=${userContent.length} attachments=${attachments.length}`,
        );
        this.modelsChatHistoryService.appendUserMessage(chatId, {
          id: userMessageId,
          content: userContent,
          attachments,
        }, currentUserId);
        this.modelsChatHistoryService.ensureAssistantMessage(chatId, {
          id: assistantMessageId,
        }, currentUserId);
        const agentRuntimeConfig = readConfigByAgentName(agentName, currentUserId);
        if (!agentRuntimeConfig?.modelConfig) {
          throw new BadRequestException(
            `未找到智能体配置: ${agentName}（model=${agentRuntimeConfig?.modelName ?? 'missing'}，请检查 ~/.blooms_claw/blooms_claw.json 中 agents.${agentName}.model 是否与 models 下的 key 大小写一致）`,
          );
        }
        this.logger.log(
          `[deepagents-stream] agent=${agentName} model=${agentRuntimeConfig.modelName} ` +
            `base_url=${agentRuntimeConfig.modelConfig?.base_url ?? 'missing'} ` +
            `provider=${(agentRuntimeConfig.modelConfig as any)?.provider ?? 'unspecified'}`,
        );
        const bailianFileReferences =
          await this.modelsAttachmentsService.resolveBailianFileReferences(
            attachments,
            agentRuntimeConfig.modelConfig,
          );
        const runtimeFileRefs = bailianFileReferences.filter(
          (item): item is typeof item & { fileId: string } => Boolean(item.fileId),
        );
        this.logger.log(
          `[deepagents-stream] 传入 createAgent runtimeContext.bailianFileReferences=` +
            JSON.stringify(runtimeFileRefs.map((r) => ({ name: r.name, kind: r.kind, fileId: r.fileId }))),
        );
        const { agent, close, config } = await createAgent(agentName, {
          threadId: chatId,
          userId: currentUserId,
          enableThinking: true,
          skillNames,
          runtimeContext: {
            bailianFileReferences: runtimeFileRefs,
          },
        } as any);
        closeAgent = close;
        this.logger.log(`[deepagents-stream] agent created chatId=${chatId}`);
        const fileidSystemContent = runtimeFileRefs
          .filter((r) => r && r.kind !== 'image' && r.fileId)
          .map((r) => `fileid://${r.fileId}`)
          .join(',');
        this.logger.log(
          `[deepagents-stream] buildModelMessages 额外注入的 fileid system content=${fileidSystemContent || '(空)'}`,
        );
        const modelMessages = await this.modelsAttachmentsService.buildModelMessages(
          userContent,
          attachments,
          config.modelConfig,
          fileidSystemContent ? [fileidSystemContent] : [],
        );
        this.logger.log(
          `[deepagents-stream] 最终传给 agent.streamEvents().messages=` +
            JSON.stringify(modelMessages.map((m) => ({ role: m.role, contentPreview: (String(m.content ?? '')).slice(0, 80) }))),
        );

        const response = agent.streamEvents(
          {
            messages: modelMessages,
          },
          {
            configurable: {
              thread_id: chatId,
            },
          },
        );
        this.logger.log(`[deepagents-stream] stream opened chatId=${chatId}`);

        const { interrupted, chunkCount: streamedChunks } = await this.consumeAgentStream(
          response,
          res,
          chatId,
          assistantMessageId,
          currentUserId,
          agent,
        );
        chunkCount += streamedChunks;

        if (interrupted) {
          this.modelsChatHistoryService.finalizeAssistantMessage(
            chatId,
            assistantMessageId,
            'waiting',
            currentUserId,
          );
          this.logger.log(`[deepagents-stream] interrupted, awaiting human input chatId=${chatId}`);
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        this.modelsChatHistoryService.finalizeAssistantMessage(
          chatId,
          assistantMessageId,
          'done',
          currentUserId,
        );

        if (!res.writableEnded) {
          this.writeChunk(res, {
            id: assistantMessageId,
            type: 'done',
            isEnd: true,
          });
          res.end();
        }
        this.logger.log(`[deepagents-stream] request completed chatId=${chatId} chunkCount=${chunkCount} durationMs=${Date.now() - requestStartedAt}`);
      } catch (e) {
        this.logger.error(`[deepagents-stream] request failed chatId=${chatId} message=${e instanceof Error ? e.message : '未知错误'}`, e instanceof Error ? e.stack : undefined);

        if (!res.writableEnded) {
          const responseContent: ChatStreamChunk = {
            id: assistantMessageId,
            type: 'error',
            error: e instanceof Error ? e.message : '未知错误',
            isEnd: true,
          };
          res.write(JSON.stringify(responseContent) + '\n');
          res.end();
        }
          this.modelsChatHistoryService.finalizeAssistantMessage(
            chatId,
            assistantMessageId,
            'error',
            currentUserId,
          );
      } finally {
        if (closeAgent) {
          this.logger.log(`[deepagents-stream] closing agent chatId=${chatId}`);
          try {
            await closeAgent();
          } catch (closeError) {
            this.logger.error(`[deepagents-stream] closeAgent failed chatId=${chatId}`, closeError instanceof Error ? closeError.stack : undefined);
          }
        }
      }
    }
  }

  private async consumeAgentStream(
    response: AsyncIterable<any>,
    res: Response,
    chatId: string,
    assistantMessageId: string,
    userId: string,
    agent?: { getState: (config: unknown) => Promise<{ values?: unknown }> },
  ): Promise<{ interrupted: boolean; chunkCount: number }> {
    const reasoningStepKey = `${assistantMessageId}:reasoning`;
    const answerStepKey = `${assistantMessageId}:answer`;
    let hasReasoning = false;
    let reasoningCompleted = false;
    let hasAnswer = false;
    let chunkCount = 0;

    try {
      for await (const event of response) {
      chunkCount += 1;

      if (event?.event === 'on_chat_model_stream') {
        const messageChunk = event?.data?.chunk ?? {};
        const thinkingDelta = this.normalizeChunkText(
          messageChunk?.additional_kwargs?.reasoning_content,
        );
        const contentDelta = this.normalizeChunkText(messageChunk?.content);

        if (thinkingDelta) {
          if (!hasReasoning) {
            hasReasoning = true;
            this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
              key: reasoningStepKey,
              title: '深度思考',
              description: '模型正在分析问题并规划执行步骤',
              status: 'loading',
            });
          }

          this.writeChunk(res, {
            id: assistantMessageId,
            type: 'thinking_delta',
            delta: thinkingDelta,
          });
          this.modelsChatHistoryService.appendAssistantThinking(
            chatId,
            assistantMessageId,
            thinkingDelta,
            userId,
          );
        }

        const toolCalls = this.normalizeToolCalls(
          messageChunk?.tool_calls ?? messageChunk?.additional_kwargs?.tool_calls,
        );
        if (toolCalls.length > 0) {
          if (hasReasoning && !reasoningCompleted) {
            reasoningCompleted = true;
            this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
              key: reasoningStepKey,
              title: '深度思考',
              description: '分析完成，开始执行任务',
              status: 'success',
            });
          }

          this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
            key: `${assistantMessageId}:plan:${toolCalls[0].key}`,
            title: '任务分配',
            description: '已规划待执行任务',
            content: this.serializeToolPlan(toolCalls),
            status: 'success',
          });
        }

        if (contentDelta) {
          if (hasReasoning && !reasoningCompleted) {
            reasoningCompleted = true;
            this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
              key: reasoningStepKey,
              title: '深度思考',
              description: '分析完成，开始组织最终回答',
              status: 'success',
            });
          }

          if (!hasAnswer) {
            hasAnswer = true;
            this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
              key: answerStepKey,
              title: '生成回答',
              description: '整理并输出最终答复',
              status: 'loading',
            });
          }

          this.writeChunk(res, {
            id: assistantMessageId,
            type: 'content_delta',
            delta: contentDelta,
          });
          this.modelsChatHistoryService.appendAssistantContent(
            chatId,
            assistantMessageId,
            contentDelta,
            userId,
          );
        }

        continue;
      }

      if (event?.event === 'on_tool_start') {
        if (hasReasoning && !reasoningCompleted) {
          reasoningCompleted = true;
          this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
            key: reasoningStepKey,
            title: '深度思考',
            description: '分析完成，开始执行任务',
            status: 'success',
          });
        }

        const stepKey = this.getStepKey(assistantMessageId, event);
        this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
          key: stepKey,
          title: this.formatToolTitle(event?.name),
          description: '正在调用工具',
          content: this.serializeToolPayload(event?.data?.input),
          status: 'loading',
        });
        continue;
      }

      if (event?.event === 'on_tool_end') {
        const stepKey = this.getStepKey(assistantMessageId, event);
        this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
          key: stepKey,
          title: this.formatToolTitle(event?.name),
          description: '工具调用完成',
          content: this.serializeToolPayload(event?.data?.output),
          status: 'success',
        });
        continue;
      }

      if (event?.event === 'on_tool_error') {
        const toolError = this.serializeToolPayload(event?.data?.error);
        if (/GraphInterrupt|ask_human/.test(toolError)) {
          const interruptValue = extractGraphInterruptValue(event?.data?.error);
          if (interruptValue !== undefined) {
            this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
              key: `${assistantMessageId}:interrupt`,
              title: '等待用户输入',
              description:
                interruptValue && typeof interruptValue === 'object' && 'question' in interruptValue
                  ? String((interruptValue as { question?: unknown }).question ?? '需要你的回答')
                  : '需要你的回答',
              content: this.serializeToolPayload(interruptValue),
              status: 'waiting',
            });
            this.writeChunk(res, {
              id: assistantMessageId,
              type: 'interrupt',
              interrupt: interruptValue,
              isEnd: true,
            });
            return { interrupted: true, chunkCount };
          }
          // If the event contains no payload, the checkpoint lookup below is
          // still attempted after the stream finishes.
          continue;
        }
        const stepKey = this.getStepKey(assistantMessageId, event);
        this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
          key: stepKey,
          title: this.formatToolTitle(event?.name),
          description: '工具调用失败',
          content: toolError,
          status: 'error',
        });
      }
      }
    } catch (error) {
      const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (!errorText.includes('GraphInterrupt')) {
        throw error;
      }
      const interruptValue = extractGraphInterruptValue(error);
      if (interruptValue !== undefined) {
        this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
          key: `${assistantMessageId}:interrupt`,
          title: '等待用户输入',
          description:
            interruptValue && typeof interruptValue === 'object' && 'question' in interruptValue
              ? String((interruptValue as { question?: unknown }).question ?? '需要你的回答')
              : '需要你的回答',
          content: this.serializeToolPayload(interruptValue),
          status: 'waiting',
        });
        this.writeChunk(res, {
          id: assistantMessageId,
          type: 'interrupt',
          interrupt: interruptValue,
          isEnd: true,
        });
        return { interrupted: true, chunkCount };
      }
    }

    if (hasReasoning && !reasoningCompleted) {
      this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
        key: reasoningStepKey,
        title: '深度思考',
        description: '分析完成',
        status: 'success',
      });
    }

    if (hasAnswer) {
      this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
        key: answerStepKey,
        title: '生成回答',
        description: '最终答复已完成',
        status: 'success',
      });
    }

    if (agent) {
      const pending = await getPendingInterrupts(agent, chatId);
      if (pending && pending.length > 0) {
        const pendingValue = pending.length === 1 ? pending[0] : pending;
        const interruptValue = Array.isArray(pendingValue)
          ? pendingValue.map((item) =>
              item && typeof item === 'object' && 'value' in item
                ? (item as { value: unknown }).value
                : item,
            )
          : pendingValue && typeof pendingValue === 'object' && 'value' in pendingValue
            ? (pendingValue as { value: unknown }).value
            : pendingValue;
        const isAskHuman =
          interruptValue &&
          typeof interruptValue === 'object' &&
          (interruptValue as { kind?: unknown }).kind === 'ask_human';
        this.emitThoughtStep(res, chatId, assistantMessageId, userId, {
          key: `${assistantMessageId}:interrupt`,
          title: isAskHuman ? '等待用户输入' : '等待人工审批',
          description: isAskHuman
            ? String((interruptValue as { question?: unknown }).question ?? '需要你的回答')
            : '工具执行前需要你确认',
          content: this.serializeToolPayload(interruptValue),
          status: 'waiting',
        });
        this.writeChunk(res, {
          id: assistantMessageId,
          type: 'interrupt',
          interrupt: interruptValue,
          isEnd: true,
        });
        return { interrupted: true, chunkCount };
      }
    }

    return { interrupted: false, chunkCount };
  }

  private normalizeBodySkills(value?: string[]): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) => item.trim()).filter((item) => Boolean(item));
  }

  private normalizeQuerySkills(value?: string | string[]): string[] {
    if (!value) {
      return [];
    }

    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => item.split(','))
      .map((item) => item.trim())
      .filter((item) => Boolean(item));
  }

  private writeChunk(res: Response, payload: ChatStreamChunk) {
    res.write(JSON.stringify(payload) + '\n');
  }

  private emitThoughtStep(
    res: Response,
    chatId: string,
    assistantMessageId: string,
    userId: string,
    step: ChatThoughtStepDto,
  ) {
    this.writeChunk(res, {
      id: assistantMessageId,
      type: 'thought_step',
      step,
    });
    this.modelsChatHistoryService.upsertAssistantThoughtStep(
      chatId,
      assistantMessageId,
      step,
      userId,
    );
  }

  private normalizeChunkText(value: unknown): string {
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
            return this.normalizeChunkText((item as { text?: unknown }).text);
          }
          return '';
        })
        .join('');
    }

    return '';
  }

  private formatToolTitle(name?: string): string {
    if (!name) {
      return '调用工具';
    }

    const normalized = name.replace(/_/g, ' ').trim();
    return normalized ? `工具: ${normalized}` : '调用工具';
  }

  private getStepKey(
    assistantMessageId: string,
    event: {
      run_id?: string;
      name?: string;
      data?: {
        tool_call_id?: string;
      };
    },
  ) {
    return (
      event.data?.tool_call_id
      || event.run_id
      || `${assistantMessageId}:${event.name || 'tool'}`
    );
  }

  private serializeToolPayload(value: unknown): string | undefined {
    if (value == null) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value.trim() || undefined;
    }

    try {
      const serialized = JSON.stringify(value, null, 2);
      return serialized ? `\`\`\`json\n${serialized}\n\`\`\`` : undefined;
    } catch {
      return String(value);
    }
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
        args?: unknown;
        function?: {
          name?: unknown;
          arguments?: unknown;
        };
      };
      const name = this.normalizeChunkText(toolCall.function?.name ?? toolCall.name);
      if (!name) {
        return [];
      }

      const serializedArguments = this.serializeToolPayload(
        toolCall.function?.arguments ?? toolCall.args,
      );
      return [
        {
          key: this.normalizeChunkText(toolCall.id) || `${name}:${index}`,
          name,
          arguments: serializedArguments,
        },
      ];
    });
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
}
