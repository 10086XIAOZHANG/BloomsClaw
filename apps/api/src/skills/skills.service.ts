import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile as execFileCallback } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { promisify } from 'node:util';
import {
  ConfigEntry,
  ConfigFileService,
  RootConfig,
} from '../shared/config-file.service';
import { InstallSkillDto, SkillDto } from './skills.types';

type RawSkillConfig = ConfigEntry;
type SkillMap = Record<string, RawSkillConfig>;

interface ParsedInstallCommand {
  source: string;
  skillNames: string[];
}

interface SkillDocumentMetadata {
  name: string;
  description: string;
  content: string;
}

const execFile = promisify(execFileCallback);

const SKILL_NOT_FOUND = 'SKILL_NOT_FOUND';
const INVALID_SKILL_NAME = 'INVALID_SKILL_NAME';
const INVALID_SKILL_PAYLOAD = 'INVALID_SKILL_PAYLOAD';
const INVALID_INSTALL_COMMAND = 'INVALID_INSTALL_COMMAND';
const SKILL_INSTALL_FAILED = 'SKILL_INSTALL_FAILED';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(private readonly configFileService: ConfigFileService) {}

  private getSkillsBaseDir(userId = 'default'): string {
    const normalized = String(userId ?? '').trim();
    if (!normalized || normalized === 'default') {
      return join(homedir(), '.blooms_claw', 'skills');
    }
    return join(homedir(), '.blooms_claw', 'users', normalized, 'skills');
  }

  async findAll(userId = 'default'): Promise<SkillDto[]> {
    this.debugLog('skills:list', 'start');
    const config = await this.readRootConfig(userId);
    const skills = Object.entries(this.getSkillMap(config))
      .map(([name, value]) => this.toSkillDto(name, value, userId))
      .sort((left, right) => left.name.localeCompare(right.name));
    this.debugLog('skills:list', `completed count=${skills.length}`);
    return skills;
  }

  async findOne(name: string, userId = 'default'): Promise<SkillDto> {
    const normalizedName = this.validateName(name);
    this.debugLog('skills:get', `start name=${normalizedName}`);
    const config = await this.readRootConfig(userId);
    const skills = this.getSkillMap(config);
    const skill = skills[normalizedName];

    if (!skill) {
      this.logger.warn(`[skills:get] not found name=${normalizedName}`);
      throw new NotFoundException({
        message: `Skill "${normalizedName}" does not exist.`,
        error: SKILL_NOT_FOUND,
      });
    }

    const skillDto = this.toSkillDto(normalizedName, skill, userId);
    this.debugLog('skills:get', `completed name=${normalizedName}`);
    return skillDto;
  }

  async install(payload: unknown, userId = 'default'): Promise<SkillDto[]> {
    const { command } = this.validateInstallPayload(payload);
    const parsedCommand = this.parseInstallCommand(command);
    const tempDir = await mkdtemp(join(tmpdir(), 'blooms-claw-skills-'));
    const installStartedAt = Date.now();
    const skillsBaseDir = this.getSkillsBaseDir(userId);

    this.debugLog(
      'skills:install',
      `start source=${parsedCommand.source} skillCount=${parsedCommand.skillNames.length || 'all'} tempDir=${tempDir} command="${this.formatCommandForLog(command)}"`,
    );

    try {
      this.debugLog('skills:install', 'running skills cli');
      await this.runSkillsInstall(tempDir, parsedCommand);
      this.debugLog('skills:install', 'skills cli completed, scanning installed files');
      const installedSkills = await this.collectInstalledSkills(tempDir);
      this.debugLog(
        'skills:install',
        `discovered skill files count=${installedSkills.length} names=${installedSkills.map((skill) => skill.name).join(',') || 'none'}`,
      );

      if (installedSkills.length === 0) {
        this.logger.warn('[skills:install] no skill files discovered after install');
        throw new BadRequestException({
          message: '未从安装命令中发现任何可用的 SKILL.md 文件。',
          error: INVALID_INSTALL_COMMAND,
        });
      }

      const config = await this.readRootConfig(userId);
      const skills = this.getSkillMap(config);
      const nextSkills: SkillMap = { ...skills };
      const installedAt = new Date().toISOString();

      for (const skill of installedSkills) {
        const existing = skills[skill.name]
          ? this.toSkillDto(skill.name, skills[skill.name], userId)
          : null;

        this.debugLog(
          'skills:install',
          `syncing skill name=${skill.name} existed=${existing ? 'yes' : 'no'} targetDir=${this.getSkillDirectory(skill.name, userId)}`,
        );
        await this.copyInstalledSkill(tempDir, skill.name, skillsBaseDir);
        nextSkills[skill.name] = {
          description: skill.description,
          active: existing?.active ?? 1,
          source: parsedCommand.source,
          installCommand: command,
          installedAt,
        };
      }

      this.debugLog(
        'skills:install',
        `writing root config path=${this.configFileService.getConfigPath(userId)} totalSkills=${Object.keys(nextSkills).length}`,
      );
      await this.writeRootConfig(
        {
          ...config,
          skills: nextSkills,
        },
        userId,
      );

      const savedSkills = Object.keys(nextSkills)
        .filter((name) =>
          installedSkills.some((installedSkill) => installedSkill.name === name),
        )
        .map((name) => this.toSkillDto(name, nextSkills[name], userId));

      this.debugLog(
        'skills:install',
        `completed saved=${savedSkills.length} durationMs=${Date.now() - installStartedAt}`,
      );

      return savedSkills;
    } catch (error) {
      this.logger.error(
        `[skills:install] failed source=${parsedCommand.source} message=${error instanceof Error ? error.message : '未知错误'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      this.debugLog('skills:install', `cleanup tempDir=${tempDir}`);
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async update(name: string, payload: unknown, userId = 'default'): Promise<SkillDto> {
    const normalizedName = this.validateName(name);
    this.debugLog('skills:update', `start name=${normalizedName}`);
    const config = await this.readRootConfig(userId);
    const skills = this.getSkillMap(config);
    const currentSkill = skills[normalizedName];

    if (!currentSkill) {
      this.logger.warn(`[skills:update] not found name=${normalizedName}`);
      throw new NotFoundException({
        message: `Skill "${normalizedName}" does not exist.`,
        error: SKILL_NOT_FOUND,
      });
    }

    const mergedSkill = this.validateSkillPayload({
      ...this.toSkillDto(normalizedName, currentSkill, userId),
      ...(payload as Record<string, unknown>),
      name: normalizedName,
    });

    const nextSkills: SkillMap = {
      ...skills,
      [normalizedName]: this.toStoredSkillConfig(mergedSkill),
    };

    await this.writeRootConfig(
      {
        ...config,
        skills: nextSkills,
      },
      userId,
    );

    const updatedSkill = this.toSkillDto(normalizedName, nextSkills[normalizedName], userId);
    this.debugLog(
      'skills:update',
      `completed name=${normalizedName} active=${updatedSkill.active}`,
    );
    return updatedSkill;
  }

  async remove(name: string, userId = 'default'): Promise<void> {
    const normalizedName = this.validateName(name);
    this.debugLog('skills:remove', `start name=${normalizedName}`);
    const config = await this.readRootConfig(userId);
    const skills = this.getSkillMap(config);

    if (!skills[normalizedName]) {
      this.logger.warn(`[skills:remove] not found name=${normalizedName}`);
      throw new NotFoundException({
        message: `Skill "${normalizedName}" does not exist.`,
        error: SKILL_NOT_FOUND,
      });
    }

    const { [normalizedName]: _removed, ...restSkills } = skills;
    await rm(this.getSkillDirectory(normalizedName, userId), {
      recursive: true,
      force: true,
    });
    await this.writeRootConfig(
      {
        ...config,
        skills: restSkills,
      },
      userId,
    );
    this.debugLog('skills:remove', `completed name=${normalizedName}`);
  }

  private validateInstallPayload(payload: unknown): InstallSkillDto {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException({
        message: '安装参数必须是 JSON 对象。',
        error: INVALID_INSTALL_COMMAND,
      });
    }

    const command = this.readString((payload as Record<string, unknown>).command);
    if (!command) {
      throw new BadRequestException({
        message: '请提供从 skills.sh 复制的安装命令。',
        error: INVALID_INSTALL_COMMAND,
      });
    }

    return { command };
  }

  private parseInstallCommand(command: string): ParsedInstallCommand {
    const tokens = this.tokenizeCommand(command);

    if (tokens[0] !== 'npx' || tokens[1] !== 'skills' || tokens[2] !== 'add') {
      throw new BadRequestException({
        message: '当前仅支持 skills.sh 的 `npx skills add ...` 安装命令。',
        error: INVALID_INSTALL_COMMAND,
      });
    }

    let source: string | null = null;
    const skillNames: string[] = [];

    for (let index = 3; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--skill' || token === '-s') {
        const skillName = tokens[index + 1];
        if (!skillName) {
          throw new BadRequestException({
            message: '安装命令中的 `--skill` 缺少参数。',
            error: INVALID_INSTALL_COMMAND,
          });
        }
        skillNames.push(skillName);
        index += 1;
        continue;
      }

      if (token === '--list' || token === '-l') {
        throw new BadRequestException({
          message: '列表命令不能用于安装，请提供实际的安装命令。',
          error: INVALID_INSTALL_COMMAND,
        });
      }

      if (token.startsWith('-')) {
        const takesValue =
          token === '--agent' || token === '-a' || token === '--from';
        if (takesValue) {
          index += 1;
        }
        continue;
      }

      if (!source) {
        source = token;
      }
    }

    if (!source) {
      throw new BadRequestException({
        message: '未从安装命令中解析到 Skill 来源地址。',
        error: INVALID_INSTALL_COMMAND,
      });
    }

    return {
      source,
      skillNames,
    };
  }

  private tokenizeCommand(command: string): string[] {
    const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    return matches.map((token: string) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return token.slice(1, -1);
      }
      return token;
    });
  }

  private async runSkillsInstall(
    cwd: string,
    parsedCommand: ParsedInstallCommand,
  ): Promise<void> {
    const args = [
      '-y',
      'skills',
      'add',
      parsedCommand.source,
      ...parsedCommand.skillNames.flatMap((skillName) => ['--skill', skillName]),
      '--copy',
      '--yes',
      '--agent',
      'claude-code',
    ];

    try {
      await execFile('npx', args, {
        cwd,
        env: {
          ...process.env,
          CI: '1',
        },
      });
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'stderr' in error &&
        typeof error.stderr === 'string' &&
        error.stderr.trim()
          ? error.stderr.trim()
          : error instanceof Error
          ? error.message
          : 'Skills 安装失败。';

      throw new BadRequestException({
        message,
        error: SKILL_INSTALL_FAILED,
      });
    }
  }

  private async collectInstalledSkills(tempDir: string): Promise<SkillDocumentMetadata[]> {
    this.debugLog('skills:scan', `searching SKILL.md under tempDir=${tempDir}`);
    const skillFiles = await this.findSkillFiles(tempDir);
    const installedSkills: SkillDocumentMetadata[] = [];

    this.debugLog('skills:scan', `found skill files count=${skillFiles.length}`);

    for (const skillFile of skillFiles) {
      this.debugLog('skills:scan', `reading skill file path=${skillFile}`);
      const document = await readFile(skillFile, 'utf8');
      const metadata = this.parseSkillDocument(
        basename(dirname(skillFile)),
        document,
      );

      this.debugLog(
        'skills:scan',
        `parsed skill name=${metadata.name} descriptionLength=${metadata.description.length}`,
      );
      installedSkills.push(metadata);
    }

    return installedSkills;
  }

  private async findSkillFiles(rootDir: string): Promise<string[]> {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (entry.name === 'node_modules') {
        continue;
      }

      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findSkillFiles(entryPath)));
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(entryPath);
      }
    }

    return results;
  }

  private parseSkillDocument(
    fallbackName: string,
    document: string,
  ): SkillDocumentMetadata {
    const trimmed = document.trim();
    const content = this.extractSkillContent(trimmed);
    const frontmatter = this.extractFrontmatter(trimmed);
    const name =
      this.readString(this.readFrontmatterValue(frontmatter, 'name')) ??
      fallbackName;
    const description =
      this.readString(this.readFrontmatterValue(frontmatter, 'description')) ??
      this.extractBodySummary(content);

    return {
      name,
      description,
      content,
    };
  }

  private extractFrontmatter(document: string): string {
    if (!document.startsWith('---')) {
      return '';
    }

    const sections = document.split(/^---\s*$/m);
    return sections[1]?.trim() ?? '';
  }

  private extractSkillContent(document: string): string {
    if (!document.startsWith('---')) {
      return document.trim();
    }

    const sections = document.split(/^---\s*$/m);
    return sections.slice(2).join('---').trim();
  }

  private readFrontmatterValue(frontmatter: string, key: string): string | null {
    if (!frontmatter) {
      return null;
    }

    const lines = frontmatter.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!match || match[1] !== key) {
        continue;
      }

      const rawValue = match[2].trim();
      if (rawValue === '>' || rawValue === '|') {
        const blockLines: string[] = [];
        for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
          const line = lines[blockIndex];
          if (!line.startsWith(' ') && !line.startsWith('\t')) {
            break;
          }
          blockLines.push(line.trim());
          index = blockIndex;
        }
        return blockLines.join(rawValue === '>' ? ' ' : '\n').trim();
      }

      return rawValue.replace(/^['"]|['"]$/g, '').trim();
    }

    return null;
  }

  private extractBodySummary(content: string): string {
    return (
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#')) ?? ''
    );
  }

  private async copyInstalledSkill(
    tempDir: string,
    skillName: string,
    skillsBaseDir: string,
  ): Promise<void> {
    const sourceDir = await this.findInstalledSkillDirectory(tempDir, skillName);
    const targetDir = join(skillsBaseDir, skillName);

    await mkdir(skillsBaseDir, { recursive: true });
    await rm(targetDir, { recursive: true, force: true });
    await cp(sourceDir, targetDir, { recursive: true });
  }

  private async findInstalledSkillDirectory(
    rootDir: string,
    skillName: string,
  ): Promise<string> {
    const skillFiles = await this.findSkillFiles(rootDir);

    for (const skillFile of skillFiles) {
      const metadata = this.parseSkillDocument(
        basename(dirname(skillFile)),
        await readFile(skillFile, 'utf8'),
      );

      if (metadata.name === skillName) {
        return dirname(skillFile);
      }
    }

    throw new NotFoundException({
      message: `找不到已安装 Skill "${skillName}" 的目录。`,
      error: SKILL_NOT_FOUND,
    });
  }

  private getSkillDirectory(skillName: string, userId = 'default'): string {
    return join(this.getSkillsBaseDir(userId), skillName);
  }

  private validateName(name: string): string {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new BadRequestException({
        message: 'Skill 名称不能为空。',
        error: INVALID_SKILL_NAME,
      });
    }

    return normalizedName;
  }

  private formatCommandForLog(command: string): string {
    const normalized = command.replace(/\s+/g, ' ').trim();
    return normalized.length > 200
      ? `${normalized.slice(0, 197)}...`
      : normalized;
  }

  private debugLog(scope: string, message: string): void {
    this.logger.debug(`${this.colorizeScope(scope)} ${message}`);
  }

  private colorizeScope(scope: string): string {
    const cyan = '\x1b[96m';
    const reset = '\x1b[0m';
    return `${cyan}[${scope}]${reset}`;
  }

  private validateSkillPayload(payload: unknown): SkillDto {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException({
        message: 'Skill 配置必须是 JSON 对象。',
        error: INVALID_SKILL_PAYLOAD,
      });
    }

    const candidate = payload as Record<string, unknown>;

    return {
      name: this.validateRequiredString(candidate.name, 'name'),
      description: this.validateString(candidate.description, 'description'),
      active: this.validateFlag(candidate.active, 'active'),
      source: this.validateString(candidate.source, 'source'),
      installCommand: this.validateString(candidate.installCommand, 'installCommand'),
      installedAt: this.validateString(candidate.installedAt, 'installedAt'),
    };
  }

  private async readRootConfig(userId = 'default'): Promise<RootConfig> {
    try {
      return await this.configFileService.readConfig(userId);
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private async writeRootConfig(config: RootConfig, userId = 'default'): Promise<void> {
    try {
      await this.configFileService.writeConfig(config, userId);
    } catch (error) {
      throw this.wrapConfigError(error);
    }
  }

  private wrapConfigError(error: unknown): InternalServerErrorException {
    const message =
      error instanceof Error ? error.message : 'Failed to access config file.';
    return new InternalServerErrorException(message);
  }

  private getSkillMap(config: RootConfig): SkillMap {
    return (config.skills ?? {}) as SkillMap;
  }

  private toSkillDto(name: string, raw: RawSkillConfig, userId = 'default'): SkillDto {
    const candidate = raw as Record<string, unknown>;
    const document = this.readInstalledSkillDocument(name, userId);
    const parsedDocument = document
      ? this.parseSkillDocument(name, document)
      : { name, description: '', content: '' };

    const description =
      this.readString(candidate.description) ?? parsedDocument.description;
    const active =
      this.readFlag(candidate.active) ?? this.readBooleanAsFlag(candidate.enabled);
    const source = this.readString(candidate.source) ?? '';
    const installCommand = this.readString(candidate.installCommand) ?? '';
    const installedAt = this.readString(candidate.installedAt) ?? '';

    if (active === null) {
      throw new InternalServerErrorException(
        `Skill "${name}" has invalid config shape.`,
      );
    }

    return {
      name,
      description,
      active,
      source,
      installCommand,
      installedAt,
    };
  }

  private readInstalledSkillDocument(name: string, userId = 'default'): string | null {
    try {
      const skillPath = join(this.getSkillDirectory(name, userId), 'SKILL.md');
      return readFileSync(skillPath, 'utf8');
    } catch {
      return null;
    }
  }

  private toStoredSkillConfig(skill: SkillDto): RawSkillConfig {
    return {
      description: skill.description,
      active: skill.active,
      source: skill.source,
      installCommand: skill.installCommand,
      installedAt: skill.installedAt,
    };
  }

  private validateRequiredString(value: unknown, field: string): string {
    const normalizedValue = this.readString(value);

    if (!normalizedValue) {
      throw new BadRequestException({
        message: `Skill 字段 "${field}" 必须是非空字符串。`,
        error: INVALID_SKILL_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateString(value: unknown, field: string): string {
    const normalizedValue = this.readNullableString(value);

    if (normalizedValue === null) {
      throw new BadRequestException({
        message: `Skill 字段 "${field}" 必须是字符串。`,
        error: INVALID_SKILL_PAYLOAD,
      });
    }

    return normalizedValue;
  }

  private validateFlag(value: unknown, field: string): 0 | 1 {
    const flag = this.readFlag(value);

    if (flag === null) {
      throw new BadRequestException({
        message: `Skill 字段 "${field}" 必须是 0 或 1。`,
        error: INVALID_SKILL_PAYLOAD,
      });
    }

    return flag;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private readNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    return value.trim();
  }

  private readFlag(value: unknown): 0 | 1 | null {
    return value === 0 || value === 1 ? value : null;
  }

  private readBooleanAsFlag(value: unknown): 0 | 1 | null {
    return typeof value === 'boolean' ? (value ? 1 : 0) : null;
  }
}
