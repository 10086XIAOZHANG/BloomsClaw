import fs from 'node:fs';
import path from 'node:path';
import { MemorySaver } from '@langchain/langgraph';

function uint8ToPlainText(arr: Uint8Array): unknown {
  const text = new TextDecoder().decode(arr);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function plainTextToUint8(data: unknown): Uint8Array {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return new TextEncoder().encode(text);
}

export class FileSaver extends MemorySaver {
  filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    this.load();
  }

  // 从本地文件中读取记忆内容，并加载到内存中
  load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Record<string, any>;
      const saver = this as any;

      if (data.storage) {
        for (const [threadId, nsRecord] of Object.entries(data.storage as Record<string, any>)) {
          saver.storage[threadId] = {};
          for (const [ns, cpRecord] of Object.entries(nsRecord as Record<string, any>)) {
            saver.storage[threadId][ns] = {};
            for (const [checkpointId, tuple] of Object.entries(cpRecord as Record<string, any>)) {
              const checkpointTuple = tuple as [unknown, unknown, unknown];
              saver.storage[threadId][ns][checkpointId] = [
                plainTextToUint8(checkpointTuple[0]),
                plainTextToUint8(checkpointTuple[1]),
                checkpointTuple[2],
              ];
            }
          }
        }
      }

      if (data.writes) {
        for (const [outerKey, innerRecord] of Object.entries(data.writes as Record<string, any>)) {
          saver.writes[outerKey] = {};
          for (const [innerKey, tuple] of Object.entries(innerRecord as Record<string, any>)) {
            const writeTuple = tuple as [unknown, unknown, unknown];
            saver.writes[outerKey][innerKey] = [
              writeTuple[0],
              writeTuple[1],
              plainTextToUint8(writeTuple[2]),
            ];
          }
        }
      }
    } catch (error) {
      console.error('加载记忆失败', error);
    }
  }

  // 将内存中的记忆数据，存储到本地文件中
  save(): void {
    const saver = this as any;
    const data: { storage: Record<string, any>; writes: Record<string, any> } = {
      storage: {},
      writes: {},
    };

    for (const [threadId, nsRecord] of Object.entries(saver.storage as Record<string, any>)) {
      data.storage[threadId] = {};
      for (const [ns, cpRecord] of Object.entries(nsRecord as Record<string, any>)) {
        data.storage[threadId][ns] = {};
        for (const [checkpointId, tuple] of Object.entries(cpRecord as Record<string, any>)) {
          const checkpointTuple = tuple as [Uint8Array, Uint8Array, unknown];
          data.storage[threadId][ns][checkpointId] = [
            uint8ToPlainText(checkpointTuple[0]),
            uint8ToPlainText(checkpointTuple[1]),
            checkpointTuple[2],
          ];
        }
      }
    }

    for (const [outerKey, innerRecord] of Object.entries(saver.writes as Record<string, any>)) {
      data.writes[outerKey] = {};
      for (const [innerKey, tuple] of Object.entries(innerRecord as Record<string, any>)) {
        const writeTuple = tuple as [unknown, unknown, Uint8Array];
        data.writes[outerKey][innerKey] = [
          writeTuple[0],
          writeTuple[1],
          uint8ToPlainText(writeTuple[2]),
        ];
      }
    }

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async put(config: any, checkpoint: any, metadata: any): Promise<any> {
    const result = await super.put(config, checkpoint, metadata);
    this.save();
    return result;
  }

  async putWrites(config: any, writes: any, taskId: string): Promise<void> {
    await super.putWrites(config, writes, taskId);
    this.save();
  }

  async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    this.save();
  }
}
