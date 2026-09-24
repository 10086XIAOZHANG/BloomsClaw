import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';

export const REMEMBER_TOOL_NAME = 'remember';
export const RECALL_TOOL_NAME = 'recall';

/** 文本向量化函数：返回每条文本的 embedding 数组。失败时返回空数组表示禁用向量层。 */
export type MemoryEmbedder = (texts: string[]) => Promise<number[][]>;

interface MemoryRecord {
  id: string;
  key: string;
  text: string;
  updatedAt: string;
}

interface MemoryStoreOptions {
  userId: string;
  agentName: string;
  baseDir?: string;
  embedder?: MemoryEmbedder;
  chromaUrl?: string;
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || fallback;
}

/** 生成合法的 Chroma collection 名：3-512 字符、字母/数字开头结尾。 */
function collectionName(userId: string, agentName: string): string {
  const segments = ['blooms', safeSegment(userId, 'u').replace(/[^a-zA-Z0-9]/g, ''),
    safeSegment(agentName, 'a').replace(/[^a-zA-Z0-9]/g, '')];
  return segments.join('_').slice(0, 512).replace(/^[^a-zA-Z0-9]+/, 'blooms')
    .replace(/[^a-zA-Z0-9]+$/, '');
}

const CHROMA_V2_BASE = '/api/v2/tenants/default_tenant/databases/default_database';

export class LongTermMemoryStore {
  private readonly filePath: string;
  private readonly records: MemoryRecord[];
  private readonly chromaUrl: string;
  private readonly embedder?: MemoryEmbedder;
  private readonly userId: string;
  private readonly agentName: string;
  private chromaCollectionId?: string;

  constructor(options: MemoryStoreOptions) {
    this.userId = options.userId;
    this.agentName = options.agentName;
    const root = options.baseDir ?? path.join(os.homedir(), '.blooms_claw', 'users', options.userId, 'memory_store');
    this.filePath = path.join(root, `${safeSegment(options.agentName, 'agent')}.json`);
    this.chromaUrl = (options.chromaUrl ?? process.env.CHROMA_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
    this.embedder = options.embedder;
    this.records = this.load();
  }

  remember(key: string, text: string): MemoryRecord {
    const existing = this.records.find((item) => item.key === key);
    const record: MemoryRecord = {
      id: existing?.id ?? randomUUID(),
      key,
      text,
      updatedAt: new Date().toISOString(),
    };
    if (existing) {
      Object.assign(existing, record);
    } else {
      this.records.push(record);
    }
    this.save();
    void this.upsertChroma(record);
    return record;
  }

  async recall(query: string, limit = 5): Promise<MemoryRecord[]> {
    const exact = this.records.filter((item) => item.key === query);
    if (exact.length > 0) return exact;

    const chroma = await this.queryChroma(query, limit);
    if (chroma.length > 0) return chroma;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.records
      .map((record) => ({
        record,
        score: terms.reduce((score, term) =>
          score + (record.key.toLowerCase().includes(term) ? 2 : 0)
            + (record.text.toLowerCase().includes(term) ? 1 : 0), 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, limit)
      .map((item) => item.record);
  }

  private load(): MemoryRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.filter(this.isRecord) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf8');
  }

  private isRecord(value: unknown): value is MemoryRecord {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.key === 'string'
      && typeof item.text === 'string' && typeof item.updatedAt === 'string';
  }

  private async getCollectionId(): Promise<string | undefined> {
    if (this.chromaCollectionId) return this.chromaCollectionId;
    if (!this.embedder) return undefined;
    const name = collectionName(this.userId, this.agentName);
    try {
      const listResponse = await fetch(`${this.chromaUrl}${CHROMA_V2_BASE}/collections`);
      if (!listResponse.ok) return undefined;
      const collections = await listResponse.json() as Array<{ id: string; name: string }>;
      this.chromaCollectionId = collections.find((item) => item.name === name)?.id;
      if (!this.chromaCollectionId) {
        const createResponse = await fetch(`${this.chromaUrl}${CHROMA_V2_BASE}/collections`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!createResponse.ok) return undefined;
        const created = await createResponse.json() as { id: string };
        this.chromaCollectionId = created.id;
      }
      return this.chromaCollectionId;
    } catch {
      return undefined;
    }
  }

  private async upsertChroma(record: MemoryRecord): Promise<void> {
    if (!this.embedder) return;
    const collectionId = await this.getCollectionId();
    if (!collectionId) return;
    const embeddings = await this.embedder([record.text]);
    if (embeddings.length === 0) return;
    try {
      await fetch(`${this.chromaUrl}${CHROMA_V2_BASE}/collections/${collectionId}/upsert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ids: [record.id],
          documents: [record.text],
          embeddings,
          metadatas: [{ key: record.key }],
        }),
      });
    } catch {
      // Chroma 为可选层；JSON 文件仍是权威数据源。
    }
  }

  private async queryChroma(query: string, limit: number): Promise<MemoryRecord[]> {
    if (!this.embedder) return [];
    const collectionId = await this.getCollectionId();
    if (!collectionId) return [];
    const queryEmbeddings = await this.embedder([query]);
    if (queryEmbeddings.length === 0) return [];
    try {
      const response = await fetch(`${this.chromaUrl}${CHROMA_V2_BASE}/collections/${collectionId}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query_embeddings: queryEmbeddings, n_results: limit }),
      });
      if (!response.ok) return [];
      const result = await response.json() as { ids?: string[][] };
      const ids = result.ids?.[0] ?? [];
      return ids.map((id) => this.records.find((record) => record.id === id)).filter(
        (record): record is MemoryRecord => Boolean(record),
      );
    } catch {
      return [];
    }
  }
}

export interface MemoryToolsOptions {
  embedder?: MemoryEmbedder;
  chromaUrl?: string;
}

export function createMemoryTools(userId: string, agentName: string, options: MemoryToolsOptions = {}) {
  const store = new LongTermMemoryStore({
    userId,
    agentName,
    embedder: options.embedder,
    chromaUrl: options.chromaUrl,
  });
  const rememberTool = tool(
    async (input: { key: string; text: string }) => {
      const key = String(input?.key ?? '').trim();
      const text = String(input?.text ?? '').trim();
      if (!key || !text) return '记忆写入失败：key 和 text 均不能为空';
      const record = store.remember(key, text);
      return `已保存长期记忆：${record.key}`;
    },
    {
      name: REMEMBER_TOOL_NAME,
      description: '保存跨会话仍然有效的用户偏好、稳定事实或项目决策。相同 key 会更新已有记忆。',
      schema: {
        type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' } },
        required: ['key', 'text'],
      },
    },
  );
  const recallTool = tool(
    async (input: { query: string }) => {
      const query = String(input?.query ?? '').trim();
      if (!query) return '查询失败：query 不能为空';
      const records = await store.recall(query);
      return records.length > 0
        ? records.map((record) => `[${record.key}] ${record.text}`).join('\n')
        : '没有找到相关长期记忆';
    },
    {
      name: RECALL_TOOL_NAME,
      description: '检索跨会话的长期记忆；优先精确 key，再进行语义/关键词检索。',
      schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  );
  return { rememberTool, recallTool, store };
}
