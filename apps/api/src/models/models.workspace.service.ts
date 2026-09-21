import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DockerSandboxBackend, getHostWorkspaceDir } from '@blooms-claw/agent-core';
import fs from 'node:fs';
import path from 'node:path';

export interface WorkspaceTreeNodeDto {
  title: string;
  path: string;
  children?: WorkspaceTreeNodeDto[];
}

export interface WorkspaceTreeDto {
  rootPath: string;
  treeData: WorkspaceTreeNodeDto[];
}

const MAX_PREVIEW_CHARS = 256 * 1024;
const DEFAULT_THREAD_ID = 'default';

@Injectable()
export class ModelsWorkspaceService {
  private readonly logger = new Logger(ModelsWorkspaceService.name);
  private readonly sandboxes = new Map<string, DockerSandboxBackend>();

  async getWorkspaceRoot(threadId = DEFAULT_THREAD_ID): Promise<string> {
    await this.getSandbox(threadId);
    return '/';
  }

  async getWorkspaceTree(threadId = DEFAULT_THREAD_ID, userId = 'default'): Promise<WorkspaceTreeDto> {
    try {
      const sandbox = await this.getSandbox(threadId, userId);
      const treeData = await this.readTreeNodes(sandbox, '/');
      return { rootPath: '/', treeData };
    } catch (error) {
      this.logger.warn(
        `沙箱工作区不可用，回退到宿主机目录: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.getHostWorkspaceTree(threadId);
    }
  }

  async readFileContent(relativePath: string, threadId = DEFAULT_THREAD_ID, userId = 'default'): Promise<string> {
    const normalizedPath = String(relativePath ?? '').trim();
    if (!normalizedPath) {
      throw new BadRequestException('文件路径不能为空');
    }

    const sandbox = await this.getSandbox(threadId);
    const result = await sandbox.read(normalizedPath, 0, 10_000);
    if (result.error || result.content == null) {
      throw new NotFoundException(result.error ?? `文件不存在：${normalizedPath}`);
    }

    if (result.content.length <= MAX_PREVIEW_CHARS) {
      return result.content;
    }
    return `${result.content.slice(0, MAX_PREVIEW_CHARS)}\n\n[预览已截断，仅显示前 ${MAX_PREVIEW_CHARS} 个字符]`;
  }

  async closeWorkspace(threadId: string): Promise<void> {
    const sandbox = this.sandboxes.get(threadId);
    if (!sandbox) {
      return;
    }
    this.sandboxes.delete(threadId);
    await sandbox.close();
  }

  private async getSandbox(threadId: string, userId = 'default'): Promise<DockerSandboxBackend> {
    const normalizedThreadId = String(`${userId}-${threadId ?? ''}`).trim() || DEFAULT_THREAD_ID;
    const existing = this.sandboxes.get(normalizedThreadId);
    if (existing) {
      await existing.ensure();
      return existing;
    }

    const sandbox = await DockerSandboxBackend.create({
      threadId: normalizedThreadId,
    });
    this.sandboxes.set(normalizedThreadId, sandbox);
    return sandbox;
  }

  private getHostWorkspaceTree(threadId: string): WorkspaceTreeDto {
    const root = getHostWorkspaceDir(threadId || DEFAULT_THREAD_ID);
    return { rootPath: '/', treeData: this.readHostTreeNodes(root, '/') };
  }

  private readHostTreeNodes(absDir: string, virtualDir: string): WorkspaceTreeNodeDto[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh-Hans-CN');
      })
      .map((entry) => {
        const virtualPath = virtualDir === '/' ? `/${entry.name}` : `${virtualDir}/${entry.name}`;
        return {
          title: entry.name,
          path: entry.name,
          children: entry.isDirectory()
            ? this.readHostTreeNodes(path.join(absDir, entry.name), virtualPath)
            : undefined,
        };
      });
  }

  private async readTreeNodes(
    sandbox: DockerSandboxBackend,
    directoryPath: string,
  ): Promise<WorkspaceTreeNodeDto[]> {
    const result = await sandbox.ls(directoryPath);
    if (result.error) {
      throw new NotFoundException(result.error);
    }

    const files = result.files ?? [];
    const nodes: WorkspaceTreeNodeDto[] = [];
    for (const file of files) {
      const isDirectory = file.is_dir === true;
      const childPath = file.path.replace(/\/$/, '');
      const name = childPath.split('/').pop() || childPath;
      nodes.push({
        title: name,
        path: name,
        children: isDirectory
          ? await this.readTreeNodes(sandbox, childPath)
          : undefined,
      });
    }
    return nodes;
  }
}
