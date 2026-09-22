import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

export type ChatAttachmentKind =
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'text'
  | 'binary';

export interface ChatAttachmentDto {
  token: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  url?: string;
}

interface StoredAttachment extends ChatAttachmentDto {
  createdAt: string;
  storedName: string;
  ossObjectKey?: string;
  ossUrl?: string;
}

interface UploadedFileLike {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

interface ResolvedAttachment extends StoredAttachment {
  filePath: string;
}

interface ModelConfigLike {
  id?: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
  use_env_api_key?: number;
}

const OSS_BUCKET_NAME = 'blooms-claw';
const OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
const OSS_BUCKET_HOST = `${OSS_BUCKET_NAME}.${OSS_ENDPOINT}`;

@Injectable()
export class ModelsAttachmentsService {
  private readonly logger = new Logger(ModelsAttachmentsService.name);
  private readonly rootDir = path.join(os.homedir(), '.blooms_claw', 'attachments');
  private readonly filesDir = path.join(this.rootDir, 'files');
  private readonly metaDir = path.join(this.rootDir, 'meta');

  saveUploadedFiles(files: UploadedFileLike[]): ChatAttachmentDto[] {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('未检测到可上传的附件');
    }

    this.ensureBaseDirs();

    return files.map((file) => {
      const token = randomUUID();
      const safeName = this.normalizeFileName(file.originalname);
      const mimeType = file.mimetype?.trim() || this.detectMimeType(safeName);
      const ext = path.extname(safeName);
      const storedName = `${token}${ext}`;
      const url = this.buildLocalAttachmentUrl(token);
      const stored: StoredAttachment = {
        token,
        name: safeName,
        mimeType,
        size: file.size,
        kind: this.detectKind(safeName, mimeType),
        createdAt: new Date().toISOString(),
        storedName,
        url,
      };

      fs.writeFileSync(path.join(this.filesDir, storedName), file.buffer);
      fs.writeFileSync(
        this.getMetaPath(token),
        JSON.stringify(stored, null, 2),
        'utf8',
      );

      return this.toPublicAttachment(stored);
    });
  }

  async buildModelMessages(
    input: string,
    attachments: ChatAttachmentDto[],
    modelConfig: ModelConfigLike,
    extraSystemBlocks: string[] = [],
  ): Promise<Array<Record<string, unknown>>> {
    const normalizedInput = input.trim();

    if (attachments.length === 0 && extraSystemBlocks.length === 0) {
      return [{ role: 'user', content: normalizedInput }];
    }

    const resolvedAttachments = attachments.map((attachment) =>
      this.resolveAttachment(attachment.token),
    );
    const imageAttachments = resolvedAttachments.filter(
      (attachment) => attachment.kind === 'image',
    );
    const nonImageAttachments = resolvedAttachments.filter(
      (attachment) => attachment.kind !== 'image',
    );

    const imageBlocks = imageAttachments.length > 0
      ? await this.buildImageBlocks(imageAttachments, normalizedInput)
      : undefined;

    if (nonImageAttachments.length > 0) {
      if (!this.supportsBailianFileId(modelConfig)) {
        throw new BadRequestException(
          '当前模型不支持文档附件直读，请将 Agent 绑定到 qwen-long 或 qwen-doc-turbo 后重试。',
        );
      }
    }

    const systemBlocks: Array<Record<string, unknown>> = extraSystemBlocks
      .filter((content) => content && content.trim().length > 0)
      .map((content) => ({
        role: 'system',
        content: content.trim(),
      }));

    this.logger.log(
      `[buildModelMessages] 将以 system role (curl 原生) 注入的块数=${systemBlocks.length}，` +
        '内容=' + JSON.stringify(systemBlocks.map((b) => String(b.content ?? '').slice(0, 120))),
    );

    if (imageBlocks) {
      return [
        ...systemBlocks,
        {
          role: 'user',
          content: imageBlocks,
        },
      ];
    }

    return [
      ...systemBlocks,
      {
        role: 'user',
        content:
          normalizedInput ||
          (nonImageAttachments.length > 0
            ? '请阅读并分析我上传的附件内容，结合附件信息给出结论。'
            : normalizedInput),
      },
    ];
  }

  async resolveBailianFileReferences(
    attachments: ChatAttachmentDto[],
    modelConfig: ModelConfigLike,
  ): Promise<
    Array<{
      token: string;
      name: string;
      kind: ChatAttachmentKind;
      url?: string;
      fileId?: string;
    }>
  > {
    if (!attachments?.length) {
      this.logger.debug('[bailian-file-ref] attachments 为空，跳过百炼上传');
      return [];
    }

    this.logger.log(
      `[bailian-file-ref] 开始解析 attachments 共 ${attachments.length} 份，` +
        `model=${modelConfig.id ?? 'unknown'} base_url=${modelConfig.base_url ?? 'missing'} ` +
        `provider=${modelConfig.provider ?? 'unspecified'}`,
    );
    const resolvedAttachments = attachments.map((attachment) =>
      this.resolveAttachment(attachment.token),
    );
    const publicAttachments = resolvedAttachments.map((item) =>
      this.toPublicAttachment(item),
    );
    const nonImageAttachments = resolvedAttachments.filter(
      (attachment) => attachment.kind !== 'image',
    );

    this.logger.log(
      `[bailian-file-ref] 非图片附件 ${nonImageAttachments.length} 份：` +
        nonImageAttachments.map((a) => `${a.name}(${a.kind})`).join(', '),
    );

    if (nonImageAttachments.length === 0) {
      this.logger.debug('[bailian-file-ref] 无非图片附件，跳过百炼 file-id 上传');
      return publicAttachments.map((attachment) => ({
        token: attachment.token,
        name: attachment.name,
        kind: attachment.kind,
        url: attachment.url,
      }));
    }

    const supported = this.supportsBailianFileId(modelConfig);
    this.logger.log(`[bailian-file-ref] supportsBailianFileId=${supported}`);
    if (!supported) {
      throw new BadRequestException(
        '当前模型不支持文档附件直读，请将 Agent 绑定到 qwen-long 或 qwen-doc-turbo 后重试。',
      );
    }

    const fileIds = await Promise.all(
      nonImageAttachments.map((attachment) =>
        this.uploadAttachmentToBailian(attachment, modelConfig),
      ),
    );
    const fileIdByToken = new Map(
      nonImageAttachments.map((attachment, index) => [attachment.token, fileIds[index]]),
    );

    const refs = publicAttachments.map((attachment) => ({
      token: attachment.token,
      name: attachment.name,
      kind: attachment.kind,
      url: attachment.url,
      fileId: fileIdByToken.get(attachment.token),
    }));
    this.logger.log(
      `[bailian-file-ref] 最终 fileId 列表: ${JSON.stringify(refs.map((r) => ({ name: r.name, kind: r.kind, fileId: r.fileId })))}`,
    );

    return refs;
  }

  resolveAttachments(attachments?: Array<{ token?: string }>): ChatAttachmentDto[] {
    if (!attachments?.length) {
      return [];
    }

    return attachments.map((attachment) => {
      if (!attachment?.token) {
        throw new BadRequestException('附件 token 缺失');
      }

      return this.toPublicAttachment(this.resolveAttachment(attachment.token));
    });
  }

  downloadAttachment(token: string): {
    name: string;
    mimeType: string;
    filePath: string;
    size: number;
  } {
    const resolved = this.resolveAttachment(token);
    return {
      name: resolved.name,
      mimeType: resolved.mimeType,
      filePath: resolved.filePath,
      size: resolved.size,
    };
  }

  private resolveAttachment(token: string): ResolvedAttachment {
    const metaPath = this.getMetaPath(token);
    if (!fs.existsSync(metaPath)) {
      throw new NotFoundException(`附件不存在: ${token}`);
    }

    const stored = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as StoredAttachment;
    const filePath = path.join(this.filesDir, stored.storedName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`附件文件不存在: ${stored.name}`);
    }

    return {
      ...stored,
      filePath,
    };
  }

  private async uploadAttachmentToBailian(
    attachment: ResolvedAttachment,
    modelConfig: ModelConfigLike,
  ): Promise<string> {
    const apiKey = this.resolveApiKey(modelConfig);
    const baseUrl = this.normalizeBaseUrl(modelConfig.base_url);
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(attachment.filePath);

    formData.append(
      'file',
      new Blob([fileBuffer], { type: attachment.mimeType }),
      attachment.name,
    );
    formData.append('purpose', 'file-extract');

    this.logger.log(
      `[bailian-files-upload] 上传 ${attachment.name} 到 ${baseUrl}/files ` +
        `(size=${fileBuffer.length} mime=${attachment.mimeType})`,
    );
    const response = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.slice(0, 8)}***`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `[bailian-files-upload] 上传失败 file=${attachment.name} status=${response.status} detail=${errorText || 'unknown'}`,
      );
      throw new BadRequestException(
        `上传附件到百炼失败（${response.status}）：${errorText || '未知错误'}`,
      );
    }

    const payload = (await response.json()) as { id?: string; status?: string };
    this.logger.log(
      `[bailian-files-upload] 百炼响应 id=${payload.id} status=${payload.status ?? 'unspecified'} file=${attachment.name}`,
    );
    if (!payload.id) {
      throw new BadRequestException('百炼未返回有效的 file-id');
    }

    await this.waitForBailianFileReady(payload.id, baseUrl, apiKey, attachment.name);

    return payload.id;
  }

  private async buildImageBlocks(
    attachments: ResolvedAttachment[],
    input: string,
  ): Promise<Array<Record<string, unknown>>> {
    const imageUrls = await Promise.all(
      attachments.map((attachment) => this.ensureImageOssUrl(attachment)),
    );

    return [
      ...imageUrls.map((url) => ({
        type: 'image_url',
        image_url: {
          url,
        },
      })),
      {
        type: 'text',
        text: input || '请阅读并分析我上传的图片内容，结合上下文给出结论。',
      },
    ];
  }

  private async ensureImageOssUrl(attachment: ResolvedAttachment): Promise<string> {
    // 开启本地图片直读：直接把服务器本地下载 URL 交给模型，跳过 OSS 上传。
    // 前提：API_PUBLIC_BASE_URL 指向的地址对模型服务端公网可达（例如经 Nginx 反代）。
    if (this.useLocalImageUrl()) {
      const localUrl = this.buildLocalAttachmentUrl(attachment.token);
      this.logger.debug(
        `[image-url] use local url token=${attachment.token} name=${attachment.name} url=${localUrl}`,
      );
      return localUrl;
    }

    if (attachment.ossUrl) {
      this.logger.debug(
        `[oss-upload] reuse cached oss url token=${attachment.token} name=${attachment.name} url=${attachment.ossUrl}`,
      );
      return attachment.ossUrl;
    }

    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim();
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim();
    if (!accessKeyId || !accessKeySecret) {
      throw new BadRequestException('缺少 OSS 访问凭证，无法上传图片附件');
    }

    const fileBuffer = fs.readFileSync(attachment.filePath);
    const objectKey = attachment.ossObjectKey || this.buildOssObjectKey(attachment);
    this.logger.debug(
      `[oss-upload] prepare upload token=${attachment.token} name=${attachment.name} size=${attachment.size} mime=${attachment.mimeType} objectKey=${objectKey} endpoint=${OSS_ENDPOINT} host=${OSS_BUCKET_HOST}`,
    );
    const uploadAttempt = await this.putObjectToOss({
      accessKeyId,
      accessKeySecret,
      objectKey,
      mimeType: attachment.mimeType,
      fileBuffer,
    });
    const objectUrl = uploadAttempt.objectUrl;
    this.logger.debug(
      `[oss-upload] upload response token=${attachment.token} status=${uploadAttempt.response.status} ok=${uploadAttempt.response.ok} url=${objectUrl}`,
    );

    if (!uploadAttempt.response.ok) {
      const errorText = await uploadAttempt.response.text();
      this.logger.error(
        `[oss-upload] upload failed token=${attachment.token} status=${uploadAttempt.response.status} objectKey=${objectKey} detail=${errorText || 'unknown'}`,
      );
      throw new BadRequestException(
        `上传图片到 OSS 失败（${uploadAttempt.response.status}）：${errorText || '未知错误'}`,
      );
    }

    const storedAttachment: StoredAttachment = {
      token: attachment.token,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      createdAt: attachment.createdAt,
      storedName: attachment.storedName,
      ossObjectKey: objectKey,
      ossUrl: objectUrl,
    };
    this.writeMeta(storedAttachment);
    this.logger.debug(
      `[oss-upload] metadata saved token=${attachment.token} objectKey=${objectKey} url=${objectUrl}`,
    );

    return objectUrl;
  }

  private async putObjectToOss(params: {
    accessKeyId: string;
    accessKeySecret: string;
    objectKey: string;
    mimeType: string;
    fileBuffer: Buffer;
  }): Promise<{ response: Response; objectUrl: string }> {
    const encodedObjectKey = params.objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const objectUrl = `https://${OSS_BUCKET_HOST}/${encodedObjectKey}`;
    const date = new Date().toUTCString();
    const canonicalizedHeaders = 'x-oss-object-acl:public-read\n';
    const stringToSign = [
      'PUT',
      '',
      params.mimeType,
      date,
      `${canonicalizedHeaders}/${OSS_BUCKET_NAME}/${params.objectKey}`,
    ].join('\n');
    const signature = createHmac('sha1', params.accessKeySecret)
      .update(stringToSign, 'utf8')
      .digest('base64');
    const bodyBuffer = params.fileBuffer.buffer.slice(
      params.fileBuffer.byteOffset,
      params.fileBuffer.byteOffset + params.fileBuffer.byteLength,
    ) as ArrayBuffer;
    this.logger.debug(
      `[oss-upload] send put request objectKey=${params.objectKey} bytes=${params.fileBuffer.byteLength} url=${objectUrl}`,
    );

    const response = await fetch(objectUrl, {
      method: 'PUT',
      headers: {
        Authorization: `OSS ${params.accessKeyId}:${signature}`,
        Date: date,
        'Content-Type': params.mimeType,
        'x-oss-object-acl': 'public-read',
      },
      body: new Blob([bodyBuffer], { type: params.mimeType }),
    });
    this.logger.debug(
      `[oss-upload] receive put response objectKey=${params.objectKey} status=${response.status} ok=${response.ok}`,
    );

    return {
      response,
      objectUrl,
    };
  }

  private supportsBailianFileId(modelConfig: ModelConfigLike): boolean {
    const provider = String(modelConfig.provider ?? '').toLowerCase();
    const baseUrl = String(modelConfig.base_url ?? '').toLowerCase();

    if (!baseUrl.includes('dashscope.aliyuncs.com') && !baseUrl.includes('.maas.aliyuncs.com')) {
      return false;
    }

    if (!provider) {
      return true;
    }

    return provider === 'qwen' || provider === 'openai' || provider === 'aliyun' || provider === 'dashscope' || provider === 'baichuan' || provider === 'deepseek' || provider === 'zhipu';
  }

  private resolveApiKey(modelConfig: ModelConfigLike): string {
    const rawApiKey = String(modelConfig.api_key ?? '').trim();
    const useEnvApiKey = modelConfig.use_env_api_key === 1;
    const resolved = useEnvApiKey ? process.env[rawApiKey] : rawApiKey;

    if (!resolved?.trim()) {
      throw new BadRequestException('当前模型缺少可用的百炼 API Key，无法读取附件');
    }

    return resolved.trim();
  }

  private normalizeBaseUrl(baseUrl?: string): string {
    const normalized = String(baseUrl ?? '').trim().replace(/\/$/, '');
    if (!normalized) {
      throw new BadRequestException('当前模型缺少 base_url，无法读取附件');
    }

    return normalized;
  }

  private async waitForBailianFileReady(
    fileId: string,
    baseUrl: string,
    apiKey: string,
    fileName?: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/files/${fileId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.slice(0, 8)}***`,
        },
      });

      if (!response.ok) {
        this.logger.warn(
          `[bailian-files-poll] GET ${baseUrl}/files/${fileId} 返回非 2xx status=${response.status}，` +
            `file=${fileName ?? fileId}，跳过等待（当作已 ready）`,
        );
        return;
      }

      const payload = (await response.json()) as {
        status?: string;
        status_details?: string | null;
      };
      const status = String(payload.status ?? '').toLowerCase();
      this.logger.log(
        `[bailian-files-poll] attempt=${attempt + 1}/10 fileId=${fileId} status=${status || '(empty)'} ` +
          `file=${fileName ?? ''}`,
      );

      if (!status || status === 'processed') {
        this.logger.log(
          `[bailian-files-poll] file ${fileName ?? fileId} 解析完成 fileId=${fileId}`,
        );
        return;
      }

      if (status === 'error' || status === 'failed') {
        throw new BadRequestException(
          `百炼解析附件失败：${payload.status_details || fileId}`,
        );
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 800);
      });
    }
    this.logger.warn(
      `[bailian-files-poll] file ${fileName ?? fileId} 轮询 10 次仍未 processed，` +
        `继续后续流程，若模型侧解析失败会返回对应错误`,
    );
  }

  private ensureBaseDirs() {
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(this.metaDir, { recursive: true });
  }

  private useLocalImageUrl(): boolean {
    return process.env.USE_LOCAL_IMAGE_URL === '1';
  }

  private getMetaPath(token: string): string {
    return path.join(this.metaDir, `${token}.json`);
  }

  private writeMeta(attachment: StoredAttachment): void {
    fs.writeFileSync(
      this.getMetaPath(attachment.token),
      JSON.stringify(attachment, null, 2),
      'utf8',
    );
  }

  private toPublicAttachment(attachment: StoredAttachment): ChatAttachmentDto {
    const url = attachment.ossUrl ?? attachment.url ?? this.buildLocalAttachmentUrl(attachment.token);
    return {
      token: attachment.token,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      url,
    };
  }

  private buildLocalAttachmentUrl(token: string): string {
    const baseUrl = process.env.API_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
    return `${baseUrl}/models-streaming/attachments/${token}/download`;
  }

  private normalizeFileName(fileName: string): string {
    const normalized = path.basename(fileName).trim().replace(/[^\w.\-()\u4e00-\u9fa5]+/g, '_');
    return normalized || 'attachment';
  }

  private buildOssObjectKey(attachment: ResolvedAttachment): string {
    const now = new Date();
    const datePath = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('/');

    return [
      'chatbot',
      'attachments',
      datePath,
      `${attachment.token}-${attachment.name}`,
    ].join('/');
  }

  private detectKind(fileName: string, mimeType: string): ChatAttachmentKind {
    const ext = path.extname(fileName).toLowerCase();

    if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      return 'image';
    }
    if (['.doc', '.docx', '.pdf'].includes(ext)) {
      return 'document';
    }
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      return 'spreadsheet';
    }
    if (
      mimeType.startsWith('text/')
      || ['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html'].includes(ext)
    ) {
      return 'text';
    }

    return 'binary';
  }

  private detectMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mapping: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
    };

    return mapping[ext] ?? 'application/octet-stream';
  }
}
