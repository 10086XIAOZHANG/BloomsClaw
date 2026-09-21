import { tool } from '@langchain/core/tools';
import type { DockerSandboxBackend, SandboxFileInfo, SandboxGrepMatch } from '../sandbox';

export const SANDBOX_FILE_TOOL_NAME = 'sandbox_file';
export const SANDBOX_SHELL_TOOL_NAME = 'sandbox_shell';

type FileOperation = 'read' | 'write' | 'edit' | 'delete' | 'list' | 'grep' | 'glob';

interface SandboxFileInput {
  operation: FileOperation;
  path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  offset?: number;
  limit?: number;
  pattern?: string;
  glob?: string;
}

interface SandboxShellInput {
  command: string;
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function requirePath(input: SandboxFileInput): string {
  const filePath = String(input.path ?? '').trim();
  if (!filePath) {
    throw new Error('path 不能为空');
  }
  return filePath;
}

function requireText(input: SandboxFileInput, field: 'content' | 'old_string' | 'new_string'): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须是字符串`);
  }
  return value;
}

function requirePattern(input: SandboxFileInput): string {
  const pattern = String(input.pattern ?? '');
  if (!pattern) {
    throw new Error('pattern 不能为空');
  }
  return pattern;
}

async function executeFileOperation(
  backend: DockerSandboxBackend,
  input: SandboxFileInput,
): Promise<unknown> {
  const operation = input?.operation;
  switch (operation) {
    case 'read':
      return backend.read(requirePath(input), input.offset ?? 0, input.limit ?? 500);
    case 'write':
      return backend.write(requirePath(input), requireText(input, 'content'));
    case 'edit':
      return backend.edit(
        requirePath(input),
        requireText(input, 'old_string'),
        requireText(input, 'new_string'),
        input.replace_all ?? false,
      );
    case 'delete':
      return backend.delete(requirePath(input));
    case 'list':
      return backend.ls(input.path ?? '/');
    case 'grep':
      return backend.grep(requirePattern(input), input.path ?? '/', input.glob);
    case 'glob':
      return backend.glob(requirePattern(input), input.path ?? '/');
    default:
      throw new Error(`不支持的文件操作: ${String(operation)}`);
  }
}

export function createSandboxTools(backend: DockerSandboxBackend): any[] {
  const fileTool = tool(
    async (input: SandboxFileInput) => {
      try {
        return serialize(await executeFileOperation(backend, input));
      } catch (error) {
        return `沙箱文件操作失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: SANDBOX_FILE_TOOL_NAME,
      description:
        '在 Docker 沙箱工作区中执行文件操作。operation 支持 read、write、edit、delete、list、grep、glob。所有 path 都必须使用沙箱虚拟路径，例如 /src/index.ts，不要使用宿主机绝对路径。',
      schema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['read', 'write', 'edit', 'delete', 'list', 'grep', 'glob'],
            description: '文件操作类型',
          },
          path: { type: 'string', description: '沙箱内虚拟路径，默认为 /' },
          content: { type: 'string', description: 'write 操作写入的完整文件内容' },
          old_string: { type: 'string', description: 'edit 操作待替换的原字符串' },
          new_string: { type: 'string', description: 'edit 操作的新字符串' },
          replace_all: { type: 'boolean', description: 'edit 是否替换全部匹配项' },
          offset: { type: 'number', description: 'read 的起始行索引，默认 0' },
          limit: { type: 'number', description: 'read 的最大行数，默认 500' },
          pattern: { type: 'string', description: 'grep 或 glob 的匹配表达式' },
          glob: { type: 'string', description: 'grep 的文件名过滤模式，例如 *.ts' },
        },
        required: ['operation'],
      },
    },
  );

  const shellTool = tool(
    async (input: SandboxShellInput) => {
      const command = String(input?.command ?? '').trim();
      if (!command) {
        return '沙箱命令执行失败: command 不能为空';
      }
      try {
        return serialize(await backend.execute(command));
      } catch (error) {
        return `沙箱命令执行失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: SANDBOX_SHELL_TOOL_NAME,
      description:
        '在 Docker 隔离沙箱的 /workspace 目录中执行 Shell 命令。命令只能操作沙箱内文件，不得尝试访问宿主机、Docker socket 或宿主机绝对路径。',
      schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要在沙箱内执行的 Shell 命令' },
        },
        required: ['command'],
      },
    },
  );

  return [fileTool, shellTool];
}

export type { SandboxFileInfo, SandboxGrepMatch };
