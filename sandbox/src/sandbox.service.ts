import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import {
  ExecuteResultDto,
  FileInfoDto,
  FileListDto,
  FileMutationDto,
  GrepResultDto,
  HealthDto,
  ReadFileDto,
} from './sandbox.types';

@Injectable()
export class SandboxService {
  private readonly root = path.resolve('/workspace');
  private readonly maxOutputBytes = Number(process.env.MAX_OUTPUT_BYTES ?? 100_000);
  private readonly commandTimeoutMs = Number(process.env.COMMAND_TIMEOUT_MS ?? 120_000);

  async health(): Promise<HealthDto> { return { status: 'ok' }; }

  private resolve(input: string | undefined) {
    const raw = String(input || '/');
    const virtual = raw.startsWith('/') ? raw : `/${raw}`;
    if (virtual.includes('..') || virtual.includes('\\') || virtual.startsWith('/~')) {
      throw new Error('Path traversal not allowed');
    }
    const resolved = path.resolve(this.root, virtual.slice(1));
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Path outside workspace');
    }
    return resolved;
  }

  private virtual(filePath: string, isDir = false) {
    const relative = path.relative(this.root, filePath).split(path.sep).join('/');
    const result = relative ? `/${relative}` : '/';
    return isDir && result !== '/' ? `${result}/` : result;
  }

  async list(input?: string): Promise<FileListDto> {
    try {
      const directory = this.resolve(input);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const files: FileInfoDto[] = [];
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          const isDir = stat.isDirectory();
          files.push({ path: this.virtual(fullPath, isDir), is_dir: isDir, size: stat.size, modified_at: stat.mtime.toISOString() });
        } catch { /* entry may disappear during listing */ }
      }
      return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read(input: string, offset = 0, limit = 500) {
    const filePath = this.resolve(input);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { error: `File '${input}' not found` };
    const lines = (await fs.readFile(filePath, 'utf8')).split('\n');
    if (offset >= lines.length) return { error: `Line offset ${offset} exceeds file length (${lines.length} lines)` };
    return { content: lines.slice(offset, offset + limit).join('\n'), mimeType: 'text/plain' };
  }

  async write(input: string, content: unknown) {
    const filePath = this.resolve(input);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(content ?? ''), 'utf8');
    return { path: input, filesUpdate: null };
  }

  async edit(input: string, oldString: string, newString: string, replaceAll = false) {
    if (!oldString) return { error: 'Error: oldString cannot be empty' };
    const current = await this.read(input, 0, Number.MAX_SAFE_INTEGER);
    if (current.error || current.content == null) return current;
    const occurrences = current.content.split(oldString).length - 1;
    if (occurrences === 0) return { error: `Error: String not found in file: '${oldString}'` };
    if (occurrences > 1 && !replaceAll) return { error: `Error: String appears ${occurrences} times; set replaceAll=true` };
    await this.write(input, current.content.split(oldString).join(newString));
    return { path: input, filesUpdate: null, occurrences };
  }

  async grep(
    pattern: string,
    input = '/',
    glob?: string,
  ): Promise<{ matches: Array<{ path: string; line: number; text: string }> }> {
    const base = this.resolve(input);
    const stat = await fs.stat(base);
    const candidates: string[] = stat.isFile() ? [base] : [];

    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (!glob || this.matchesGlob(entry.name, glob)) {
          candidates.push(fullPath);
        }
      }
    };

    if (stat.isDirectory()) {
      await walk(base);
    }

    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const filePath of candidates.slice(0, 2000)) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        content.split('\\n').forEach((line, index) => {
          if (line.includes(pattern)) {
            matches.push({ path: this.virtual(filePath), line: index + 1, text: line.slice(0, 2000) });
          }
        });
      } catch {
        // Ignore binary files and files removed during traversal.
      }
      if (matches.length >= 200) break;
    }
    return { matches: matches.slice(0, 200) };
  }

  async glob(pattern: string, input = '/'): Promise<{ files: FileInfoDto[] }> {
    const base = this.resolve(input);
    const files: FileInfoDto[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        const relative = path.relative(base, fullPath).split(path.sep).join('/');
        if (this.matchesGlob(relative, pattern) || this.matchesGlob(entry.name, pattern)) {
          const stat = await fs.stat(fullPath);
          files.push({
            path: this.virtual(fullPath, entry.isDirectory()),
            is_dir: entry.isDirectory(),
            size: stat.size,
            modified_at: stat.mtime.toISOString(),
          });
        }
        if (entry.isDirectory()) await walk(fullPath);
      }
    };
    await walk(base);
    return { files: files.slice(0, 500) };
  }

  private matchesGlob(value: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\\]\\\\]/g, '\\\\$&');
    return new RegExp(`^${escaped.replace(/\\*/g, '.*').replace(/\\?/g, '.')}$`).test(value);
  }
  async remove(input: string): Promise<FileMutationDto | { error: string }> {
    const filePath = this.resolve(input);
    const stat = await fs.lstat(filePath);
    if (stat.isDirectory()) return { error: `Error: '${input}' is a directory` };
    await fs.unlink(filePath);
    return { path: input };
  }

  async execute(command: string): Promise<ExecuteResultDto> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-lc', String(command || '')], { cwd: this.root, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/home/sandbox' } });
      let output = '';
      const append = (chunk: Buffer) => { output += chunk.toString(); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timer = setTimeout(() => child.kill('SIGKILL'), this.commandTimeoutMs);
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const bytes = Buffer.from(output, 'utf8');
        resolve(bytes.length <= this.maxOutputBytes
          ? { output, exitCode: exitCode ?? 1, truncated: false }
          : { output: `${bytes.subarray(0, this.maxOutputBytes).toString('utf8')}\n... [output truncated]`, exitCode: exitCode ?? 1, truncated: true });
      });
      child.on('error', (error) => { clearTimeout(timer); resolve({ output: error.message, exitCode: 1, truncated: false }); });
    });
  }
}
