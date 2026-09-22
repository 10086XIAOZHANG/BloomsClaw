import { Injectable } from '@nestjs/common';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';

export type ConfigEntry = Record<string, unknown>;

export interface RootConfig {
  agents?: Record<string, ConfigEntry>;
  models?: Record<string, ConfigEntry>;
  tools?: Record<string, ConfigEntry>;
  skills?: Record<string, ConfigEntry>;
  [key: string]: unknown;
}

const DEFAULT_ROOT_CONFIG: RootConfig = {
  agents: {},
  models: {},
  tools: {},
  skills: {},
};

/**
 * 按用户隔离的配置文件路径：
 * - default（未登录）用户沿用旧的全局文件 ~/.blooms_claw/blooms_claw.json，保留既有数据。
 * - 其它用户各自存放到 ~/.blooms_claw/users/{userId}/blooms_claw.json，互不共享。
 */
function resolveConfigPath(userId: string): string {
  const normalized = String(userId ?? '').trim();
  if (!normalized || normalized === 'default') {
    return join(homedir(), '.blooms_claw', 'blooms_claw.json');
  }
  return join(
    homedir(),
    '.blooms_claw',
    'users',
    normalized,
    'blooms_claw.json',
  );
}

@Injectable()
export class ConfigFileService {
  getConfigPath(userId = 'default'): string {
    return resolveConfigPath(userId);
  }

  async readConfig(userId = 'default'): Promise<RootConfig> {
    const configPath = resolveConfigPath(userId);
    await this.ensureDirectoryExists(configPath);

    try {
      const content = await readFile(configPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!this.isPlainObject(parsed)) {
        throw new Error('Root config must be a JSON object.');
      }

      return this.normalizeRootConfig(parsed);
    } catch (error) {
      if (this.isMissingFileError(error)) {
        await this.writeConfig(DEFAULT_ROOT_CONFIG, userId);
        return { ...DEFAULT_ROOT_CONFIG };
      }

      throw error;
    }
  }

  async writeConfig(config: RootConfig, userId = 'default'): Promise<void> {
    const configPath = resolveConfigPath(userId);
    await this.ensureDirectoryExists(configPath);

    const normalized = this.normalizeRootConfig(config);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    const tempPath = `${configPath}.${randomUUID()}.tmp`;

    await writeFile(tempPath, serialized, 'utf8');
    await rename(tempPath, configPath);
  }

  private async ensureDirectoryExists(configPath: string): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
  }

  private normalizeRootConfig(config: RootConfig): RootConfig {
    return {
      ...config,
      agents: this.isPlainObject(config.agents)
        ? (config.agents as Record<string, ConfigEntry>)
        : {},
      models: this.isPlainObject(config.models)
        ? (config.models as Record<string, ConfigEntry>)
        : {},
      tools: this.isPlainObject(config.tools)
        ? (config.tools as Record<string, ConfigEntry>)
        : {},
      skills: this.isPlainObject(config.skills)
        ? (config.skills as Record<string, ConfigEntry>)
        : {},
    };
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isMissingFileError(
    error: unknown,
  ): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
      ? error.code === 'ENOENT'
      : false;
  }
}
