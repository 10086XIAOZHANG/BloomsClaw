export interface SkillDto {
  name: string;
  description: string;
  active: 0 | 1;
  source: string;
  installCommand: string;
  installedAt: string;
}

export interface InstallSkillDto {
  command: string;
}
