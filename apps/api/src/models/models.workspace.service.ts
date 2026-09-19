import fs from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

export interface WorkspaceTreeNodeDto {
  title: string;
  path: string;
  children?: WorkspaceTreeNodeDto[];
}

export interface WorkspaceTreeDto {
  rootPath: string;
  treeData: WorkspaceTreeNodeDto[];
}

const WORKSPACE_ROOT = '/Users/jack/.blooms_claw/workspaces';
const MAX_PREVIEW_BYTES = 256 * 1024;
const TEXT_FILE_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
  '.scss', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.sh', '.zsh', '.bash', '.env', '.sql',
  '.csv', '.log', '.conf', '.ini',
]);

@Injectable()
export class ModelsWorkspaceService {
  getWorkspaceRoot(): string {
    return WORKSPACE_ROOT;
  }

  getWorkspaceTree(): WorkspaceTreeDto {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

    return {
      rootPath: WORKSPACE_ROOT,
      treeData: this.readTreeNodes(WORKSPACE_ROOT),
    };
  }

  readFileContent(relativePath: string): string {
    const normalizedRelativePath = relativePath.trim();
    if (!normalizedRelativePath) {
      throw new BadRequestException('文件路径不能为空');
    }

    const absolutePath = this.resolveWorkspacePath(normalizedRelativePath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      throw new BadRequestException('当前路径是文件夹，无法预览内容');
    }

    const extension = path.extname(absolutePath).toLowerCase();
    if (!TEXT_FILE_EXTENSIONS.has(extension)) {
      return [
        `当前文件类型暂不支持在线预览。`,
        `文件名：${path.basename(absolutePath)}`,
        `扩展名：${extension || '无'}`,
        `大小：${stat.size} bytes`,
      ].join('\n');
    }

    const buffer = fs.readFileSync(absolutePath);
    const text = buffer.subarray(0, MAX_PREVIEW_BYTES).toString('utf8');
    if (buffer.length <= MAX_PREVIEW_BYTES) {
      return text;
    }

    return `${text}\n\n[预览已截断，仅显示前 ${MAX_PREVIEW_BYTES} bytes]`;
  }

  private readTreeNodes(directoryPath: string): WorkspaceTreeNodeDto[] {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh-Hans-CN');
      })
      .map((entry) => {
        const absolutePath = path.join(directoryPath, entry.name);
        return {
          title: entry.name,
          path: entry.name,
          children: entry.isDirectory()
            ? this.readTreeNodes(absolutePath)
            : undefined,
        };
      });
  }

  private resolveWorkspacePath(relativePath: string): string {
    const safeRelativePath = relativePath.replace(/^\/+/, '');
    const absolutePath = path.resolve(WORKSPACE_ROOT, safeRelativePath);
    const normalizedRoot = path.resolve(WORKSPACE_ROOT);

    if (
      absolutePath !== normalizedRoot
      && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      throw new BadRequestException('只允许访问工作区目录内的文件');
    }

    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException(`文件不存在：${relativePath}`);
    }

    return absolutePath;
  }
}
