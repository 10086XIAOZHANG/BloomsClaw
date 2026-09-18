import fs from 'node:fs';
import path from 'node:path';
import {MemorySaver} from '@langchain/langgraph';

function uint8ToPlainText(arr) {
  const text = new TextDecoder().decode(arr);
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function plainTextToUint8(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return new TextEncoder().encode(text);
}

export class FileSaver extends MemorySaver {
  filePath = '';

  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.load();
  }

  // 从本地文件中读取记忆内容，并加载到内存中
  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

        if (data.storage) {
          for (const [threadId, nsRecord] of Object.entries(data.storage)) {
            this.storage[threadId] = {};
            for (const [ns, cpRecord] of Object.entries(nsRecord)) {
              this.storage[threadId][ns] = {};
              for (const [checkpointId, tuple] of Object.entries(cpRecord)) {
                this.storage[threadId][ns][checkpointId] = [
                  plainTextToUint8(tuple[0]),
                  plainTextToUint8(tuple[1]),
                  tuple[2],
                ];
              }
            }
          }
        }

        if (data.writes) {
          for (const [outerKey, innerRecord] of Object.entries(data.writes)) {
            this.writes[outerKey] = {};
            for (const [innerKey, tuple] of Object.entries(innerRecord)) {
              this.writes[outerKey][innerKey] = [
                tuple[0],
                tuple[1],
                plainTextToUint8(tuple[2]),
              ];
            }
          }
        }
      } catch (e) {
        console.error('加载记忆失败', e);
      }
    }
  }

  // 将内存中的记忆数据，存储到本地文件中
  save() {
    const data = {
      storage: {},
      writes: {},
    };

    for (const [threadId, nsRecord] of Object.entries(this.storage)) {
      data.storage[threadId] = {};
      for (const [ns, cpRecord] of Object.entries(nsRecord)) {
        data.storage[threadId][ns] = {};
        for (const [checkpointId, tuple] of Object.entries(cpRecord)) {
          data.storage[threadId][ns][checkpointId] = [
            uint8ToPlainText(tuple[0]),
            uint8ToPlainText(tuple[1]),
            tuple[2],
          ];
        }
      }
    }

    for (const [outerKey, innerRecord] of Object.entries(this.writes)) {
      data.writes[outerKey] = {};
      for (const [innerKey, tuple] of Object.entries(innerRecord)) {
        data.writes[outerKey][innerKey] = [
          tuple[0],
          tuple[1],
          uint8ToPlainText(tuple[2]),
        ];
      }
    }

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async put(config, checkpoint, metadata) {
    const res = await super.put(config, checkpoint, metadata);
    this.save();
    return res;
  }

  async putWrites(config, writes, taskId) {
    await super.putWrites(config, writes, taskId);
    this.save();
  }

  async deleteThread(threadId) {
    await super.deleteThread(threadId);
    this.save();
  }
}
