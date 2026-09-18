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

@Injectable()
export class ConfigFileService {
  private readonly configPath = join(
    homedir(),
    '.imooc_claw',
    'imooc_claw.json',
  );

  getConfigPath(): string {
    return this.configPath;
  }

  async readConfig(): Promise<RootConfig> {
    await this.ensureDirectoryExists();

    try {
      const content = await readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!this.isPlainObject(parsed)) {
        throw new Error('Root config must be a JSON object.');
      }

      return this.normalizeRootConfig(parsed);
    } catch (error) {
      if (this.isMissingFileError(error)) {
        await this.writeConfig(DEFAULT_ROOT_CONFIG);
        return { ...DEFAULT_ROOT_CONFIG };
      }

      throw error;
    }
  }

  async writeConfig(config: RootConfig): Promise<void> {
    await this.ensureDirectoryExists();

    const normalized = this.normalizeRootConfig(config);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    const tempPath = `${this.configPath}.${randomUUID()}.tmp`;

    await writeFile(tempPath, serialized, 'utf8');
    await rename(tempPath, this.configPath);
  }

  private async ensureDirectoryExists(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
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
