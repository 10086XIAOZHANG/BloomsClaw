import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SandboxMode = 'docker' | 'local';

export interface SandboxOptions {
  threadId: string;
  image?: string;
  network?: string;
  memory?: string;
  cpus?: string;
  timeoutSec?: number;
  maxOutputBytes?: number;
  apiPort?: number;
}

export interface SandboxGrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface SandboxFileInfo {
  path: string;
  is_dir?: boolean;
  size?: number;
  modified_at?: string;
}

const CONTAINER_WORKDIR = '/workspace';
const MAX_THREAD_SEGMENT = 48;

function sanitizeThreadSegment(threadId: string): string {
  const normalized = String(threadId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_THREAD_SEGMENT);
  return normalized || 'default';
}

export function getSandboxMode(): SandboxMode {
  const raw = String(process.env.BLOOMS_CLAW_SANDBOX_MODE ?? 'docker')
    .trim()
    .toLowerCase();
  return raw === 'local' ? 'local' : 'docker';
}

export function getSandboxImage(): string {
  return (
    process.env.BLOOMS_CLAW_SANDBOX_IMAGE?.trim() ||
    (process.env.NODE_ENV === 'production'
      ? 'blooms-claw-sandbox:latest'
      : 'blooms-claw-sandbox:dev')
  );
}

export function getHostWorkspaceRoot(): string {
  const base =
    process.env.BLOOMS_CLAW_WORKSPACES_DIR?.trim() ||
    path.join(os.homedir(), '.blooms_claw', 'workspaces');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function getHostWorkspaceDir(threadId: string): string {
  const dir = path.join(getHostWorkspaceRoot(), sanitizeThreadSegment(threadId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getContainerName(threadId: string): string {
  return `blooms-claw-ws-${sanitizeThreadSegment(threadId)}`;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toContainerPath(virtualPath: string): string {
  const raw = String(virtualPath ?? '').trim() || '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (
    withLeadingSlash.includes('..') ||
    withLeadingSlash.startsWith('/~') ||
    withLeadingSlash === '~'
  ) {
    throw new Error(`Path traversal not allowed: ${virtualPath}`);
  }
  const normalized = path.posix.normalize(withLeadingSlash);
  if (normalized.includes('..')) {
    throw new Error(`Path traversal not allowed: ${virtualPath}`);
  }
  if (normalized === '/') {
    return CONTAINER_WORKDIR;
  }
  return path.posix.join(CONTAINER_WORKDIR, normalized.slice(1));
}

function toVirtualPath(containerPath: string, isDir: boolean): string {
  const normalized = path.posix.normalize(containerPath);
  const relative = path.posix.relative(CONTAINER_WORKDIR, normalized) || '.';
  if (relative === '.') {
    return '/';
  }
  const virtual = `/${relative.split(path.posix.sep).join('/')}`;
  return isDir && !virtual.endsWith('/') ? `${virtual}/` : virtual;
}

function getDockerBin(): string {
  if (process.env.BLOOMS_CLAW_DOCKER_BIN?.trim()) {
    return process.env.BLOOMS_CLAW_DOCKER_BIN.trim();
  }
  const candidates = [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/usr/bin/docker',
    `${os.homedir()}/.docker/bin/docker`,
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return 'docker';
}

async function runDocker(args: string[], timeoutMs: number): Promise<string> {
  const dockerBin = getDockerBin();
  try {
    const { stdout } = await execFileAsync(dockerBin, args, { timeout: timeoutMs });
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    if (err?.code === 'ENOENT') {
      throw new Error(
        `未检测到 docker 可执行文件（尝试路径: ${dockerBin}，PATH=${process.env.PATH ?? ''}）。Mac Docker Desktop 请确认 /usr/local/bin/docker 或 ~/.docker/bin/docker 存在，或设置 BLOOMS_CLAW_DOCKER_BIN=/xxx/docker 后重启 API。`,
      );
    }
    const detail = String(err?.stderr ?? err?.stdout ?? err?.message ?? error);
    throw new Error(`docker ${args[0] ?? ''} 执行失败: ${detail.slice(0, 2000)}`);
  }
}

async function containerPort(container: string, port: number): Promise<number | undefined> {
  try {
    const output = await runDocker(
      ['port', container, `${port}/tcp`],
      10_000,
    );
    const match = output.match(/:(\d+)\s*$/m);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function containerRunning(container: string): Promise<boolean> {
  try {
    const output = await runDocker(
      ['inspect', '-f', '{{.State.Running}}', container],
      10_000,
    );
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function truncateOutput(output: string, maxBytes: number): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(output, 'utf8');
  if (bytes <= maxBytes) {
    return { text: output, truncated: false };
  }
  const buffer = Buffer.from(output, 'utf8').subarray(0, maxBytes);
  return {
    text: `${buffer.toString('utf8')}\n... [output truncated, backend limit ${maxBytes} bytes]`,
    truncated: true,
  };
}

const LIST_HELPER = `import json,os,sys
root=sys.argv[1]
items=[]
try:
  entries=os.listdir(root)
except Exception as e:
  print(json.dumps({"error": str(e)})); sys.exit(0)
for name in sorted(entries):
  full=os.path.join(root,name)
  try:
    st=os.stat(full)
    is_dir=os.path.isdir(full)
    import datetime
    items.append({"name": name, "is_dir": bool(is_dir), "size": int(st.st_size), "modified_at": datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).isoformat()})
  except Exception:
    continue
print(json.dumps({"files": items}))`;

const GREP_HELPER = `import json,os,sys,fnmatch
pattern=sys.argv[1]; base=sys.argv[2]; glob=sys.argv[3] if len(sys.argv)>3 else ""
matches=[]
def walk(p):
  try:
    with os.scandir(p) as it:
      for e in it:
        try:
          if e.is_dir(follow_symlinks=False):
            walk(e.path)
          elif e.is_file(follow_symlinks=False):
            if glob and not fnmatch.fnmatch(os.path.basename(e.path), glob):
              continue
            try:
              if os.path.getsize(e.path) > 5*1024*1024:
                continue
              with open(e.path, "r", encoding="utf-8", errors="strict") as f:
                for i,line in enumerate(f, start=1):
                  if pattern in line:
                    matches.append({"path": e.path, "line": i, "text": line.rstrip("\\n")[:2000]})
                    if len(matches) >= 200:
                      return
            except Exception:
              continue
        except Exception:
          continue
try:
  if os.path.isfile(base):
    walk(os.path.dirname(base))
  else:
    walk(base)
except Exception:
  pass
print(json.dumps({"matches": matches}))`;

const GLOB_HELPER = `import json,os,sys,fnmatch
pattern=sys.argv[1]; base=sys.argv[2]
out=[]
for root,dirs,files in os.walk(base):
  for name in dirs+files:
    rel=os.path.relpath(os.path.join(root,name), base)
    if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern):
      full=os.path.join(root,name)
      try:
        st=os.stat(full)
        import datetime
        out.append({"path": full, "is_dir": os.path.isdir(full), "size": int(st.st_size), "modified_at": datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).isoformat()})
      except Exception:
        continue
print(json.dumps({"files": out[:500]}))`;

export class DockerSandboxBackend {
  readonly id: string;
  private readonly threadId: string;
  private readonly container: string;
  private readonly image: string;
  private readonly network: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly timeoutSec: number;
  private readonly maxOutputBytes: number;
  private readonly apiPort?: number;
  private apiBaseUrl?: string;
  private ensured = false;

  constructor(options: SandboxOptions) {
    if (!options?.threadId?.trim()) {
      throw new Error('DockerSandboxBackend 需要 threadId');
    }
    this.threadId = options.threadId;
    this.container = getContainerName(options.threadId);
    this.id = `docker-${sanitizeThreadSegment(options.threadId)}`;
    this.image = options.image ?? getSandboxImage();
    this.network = process.env.BLOOMS_CLAW_SANDBOX_NETWORK ?? options.network ?? 'blooms-claw-sandbox';
    this.memory = options.memory ?? process.env.BLOOMS_CLAW_SANDBOX_MEMORY ?? '512m';
    this.cpus = options.cpus ?? process.env.BLOOMS_CLAW_SANDBOX_CPUS ?? '1.0';
    this.timeoutSec = options.timeoutSec ?? Number(process.env.BLOOMS_CLAW_SANDBOX_TIMEOUT ?? 120);
    this.maxOutputBytes =
      options.maxOutputBytes ??
      Number(process.env.BLOOMS_CLAW_SANDBOX_MAX_OUTPUT ?? 100_000);
    this.apiPort = options.apiPort ?? (Number(process.env.BLOOMS_CLAW_SANDBOX_API_PORT ?? 0) || undefined);
  }

  static async create(options: SandboxOptions): Promise<DockerSandboxBackend> {
    const backend = new DockerSandboxBackend(options);
    await backend.ensure();
    return backend;
  }

  async ensure(): Promise<void> {
    if (this.ensured && (await containerRunning(this.container))) {
      return;
    }
    if (await containerRunning(this.container)) {
      this.ensured = true;
      const hostPort = this.apiPort ?? await containerPort(this.container, 8080);
      if (hostPort) {
        this.apiBaseUrl = `http://127.0.0.1:${hostPort}`;
        await this.waitForApi();
        return;
      }
    }
    const hostDir = getHostWorkspaceDir(this.threadId);
    const args = [
      'run',
      '-d',
      '--rm',
      '--name',
      this.container,
      '--network',
      this.network,
      '--memory',
      this.memory,
      '--cpus',
      this.cpus,
      '--pids-limit',
      '256',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--tmpfs',
      '/home/sandbox:rw,noexec,nosuid,size=64m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '-p',
      this.apiPort ? `${this.apiPort}:8080` : '127.0.0.1::8080',
      '-v',
      `${hostDir}:${CONTAINER_WORKDIR}`,
      '-w',
      CONTAINER_WORKDIR,
      this.image,
    ];
    await runDocker(args, 60_000);
    const hostPort = this.apiPort ?? await containerPort(this.container, 8080);
    if (!hostPort) {
      throw new Error(`无法获取沙箱容器 ${this.container} 的 API 端口`);
    }
    this.apiBaseUrl = `http://127.0.0.1:${hostPort}`;
    await this.waitForApi();
    this.ensured = true;
  }

  async close(): Promise<void> {
    try {
      await runDocker(['stop', this.container], 15_000);
    } catch {
      // 容器可能已退出，忽略
    } finally {
      this.ensured = false;
    }
  }

  private async waitForApi(): Promise<void> {
    if (!this.apiBaseUrl) {
      throw new Error('沙箱 API 地址未初始化');
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBaseUrl}/health`);
        if (response.ok) return;
      } catch {
        // Container application may still be booting.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`沙箱 API 启动超时: ${this.apiBaseUrl}`);
  }

  private async request<T>(route: string, body: unknown): Promise<T> {
    await this.ensure();
    if (!this.apiBaseUrl) throw new Error('沙箱 API 地址未初始化');
    const response = await fetch(`${this.apiBaseUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || `沙箱 API 请求失败: ${response.status}`);
    return payload;
  }

  private async execRaw(
    command: string,
    timeoutMs?: number,
  ): Promise<{ output: string; exitCode: number | null }> {
    await this.ensure();
    const timeout = timeoutMs ?? this.timeoutSec * 1000;
    try {
      const { stdout, stderr } = await execFileAsync(
        getDockerBin(),
        ['exec', '-w', CONTAINER_WORKDIR, this.container, 'sh', '-lc', command],
        { timeout, maxBuffer: 20 * 1024 * 1024 },
      );
      return { output: `${stdout}${stderr}`, exitCode: 0 };
    } catch (error) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        code?: number | null;
      };
      const output = `${err?.stdout ?? ''}${err?.stderr ?? ''}` || String((error as Error)?.message ?? error);
      return { output, exitCode: typeof err?.code === 'number' ? err.code : 1 };
    }
  }

  async execute(command: string): Promise<{
    output: string;
    exitCode: number | null;
    truncated: boolean;
  }> {
    const result = await this.request<{
      output: string;
      exitCode: number | null;
      truncated: boolean;
    }>('/v1/execute', { command: String(command ?? '').trim() });
    return {
      ...result,
      ...truncateOutput(result.output ?? '', this.maxOutputBytes),
    };
  }

  async ls(dirPath: string): Promise<{ files?: SandboxFileInfo[]; error?: string }> {
    return this.request('/v1/ls', { path: dirPath || '/' });
  }

  async read(
    filePath: string,
    offset = 0,
    limit = 500,
  ): Promise<{ content?: string; mimeType?: string; error?: string }> {
    return this.request('/v1/read', { path: filePath, offset, limit });
  }

  async readRaw(filePath: string): Promise<{
    data?: { content: string; mimeType: string; created_at: string; modified_at: string };
    error?: string;
  }> {
    const result = await this.read(filePath, 0, 10_000);
    if (result.error || result.content == null) {
      return { error: result.error ?? `File '${filePath}' not found` };
    }
    const now = new Date().toISOString();
    return {
      data: {
        content: result.content,
        mimeType: result.mimeType ?? 'text/plain',
        created_at: now,
        modified_at: now,
      },
    };
  }

  async write(
    filePath: string,
    content: string,
  ): Promise<{ path?: string; filesUpdate?: null; error?: string }> {
    return this.request('/v1/write', { path: filePath, content });
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<{ path?: string; filesUpdate?: null; occurrences?: number; error?: string }> {
    return this.request('/v1/edit', {
      path: filePath,
      oldString,
      newString,
      replaceAll,
    });
  }

  async delete(filePath: string): Promise<{ path?: string; error?: string }> {
    return this.request('/v1/delete', { path: filePath });
  }

  async grep(
    pattern: string,
    dirPath: string | null = '/',
    glob?: string | null,
  ): Promise<{ matches?: SandboxGrepMatch[]; error?: string }> {
    return this.request('/v1/grep', {
      pattern,
      path: dirPath || '/',
      glob: glob ?? undefined,
    });
  }

  async glob(
    pattern: string,
    searchPath = '/',
  ): Promise<{ files?: SandboxFileInfo[]; error?: string }> {
    let base: string;
    try {
      base = toContainerPath(searchPath || '/');
    } catch {
      return { files: [] };
    }
    const { output, exitCode } = await this.execRaw(
      `python3 -c ${shQuote(GLOB_HELPER)} ${shQuote(String(pattern ?? '*'))} ${shQuote(base)}`,
    );
    if (exitCode !== 0) {
      return { files: [] };
    }
    try {
      const parsed = JSON.parse(output.trim().split('\n').pop() ?? '{}') as {
        files?: Array<{ path: string; is_dir: boolean; size: number; modified_at: string }>;
      };
      const files = (parsed.files ?? []).map((item) => ({
        path: toVirtualPath(item.path, item.is_dir),
        is_dir: item.is_dir,
        size: item.size,
        modified_at: item.modified_at,
      }));
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files };
    } catch {
      return { files: [] };
    }
  }

  async uploadFiles(
    files: Array<[string, Uint8Array]>,
  ): Promise<Array<{ path: string; error: 'file_not_found' | 'permission_denied' | 'is_directory' | 'invalid_path' | null }>> {
    const responses: Array<{ path: string; error: 'file_not_found' | 'permission_denied' | 'is_directory' | 'invalid_path' | null }> = [];
    for (const [filePath, content] of files) {
      const text = Buffer.from(content).toString('base64');
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      const result = await this.write(filePath, decoded);
      responses.push({
        path: filePath,
        error: result.error ? 'invalid_path' : null,
      });
    }
    return responses;
  }

  async downloadFiles(
    paths: string[],
  ): Promise<Array<{ path: string; content: Uint8Array | null; error: 'file_not_found' | 'permission_denied' | 'is_directory' | 'invalid_path' | null }>> {
    const responses: Array<{
      path: string;
      content: Uint8Array | null;
      error: 'file_not_found' | 'invalid_path' | null;
    }> = [];
    for (const filePath of paths) {
      const result = await this.read(filePath, 0, 10_000);
      if (result.error || result.content == null) {
        responses.push({ path: filePath, content: null, error: 'file_not_found' });
        continue;
      }
      responses.push({
        path: filePath,
        content: new TextEncoder().encode(result.content),
        error: null,
      });
    }
    return responses;
  }
}

export const __sandboxInternals = {
  sanitizeThreadSegment,
  toContainerPath,
  toVirtualPath,
  getContainerName,
};
