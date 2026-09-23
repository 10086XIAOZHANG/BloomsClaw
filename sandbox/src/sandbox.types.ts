export interface HealthDto {
  status: 'ok';
}

export interface ExecuteRequestDto {
  command?: string;
}

export interface ExecuteResultDto {
  output: string;
  exitCode: number;
  truncated: boolean;
}

export interface PathRequestDto {
  path: string;
}

export interface ListRequestDto {
  path?: string;
}

export interface ReadRequestDto extends PathRequestDto {
  offset?: number;
  limit?: number;
}

export interface WriteRequestDto extends PathRequestDto {
  content?: unknown;
}

export interface EditRequestDto extends PathRequestDto {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface GrepRequestDto extends PathRequestDto {
  pattern: string;
  glob?: string;
}

export interface GlobRequestDto extends PathRequestDto {
  pattern: string;
}

export interface FileInfo {
  path: string;
  is_dir?: boolean;
  size?: number;
  modified_at?: string;
}

export interface GrepMatchDto {
  path: string;
  line: number;
  text: string;
}

export interface GrepResultDto {
  matches?: GrepMatchDto[];
  error?: string;
}

export interface FileInfoDto extends FileInfo {
  is_dir: boolean;
  size: number;
  modified_at: string;
}

export interface FileListDto {
  files: FileInfoDto[];
  error?: string;
}

export interface ReadFileDto {
  content: string;
  mimeType: string;
}

export interface FileMutationDto {
  path: string;
  filesUpdate?: null;
  occurrences?: number;
}

export interface ErrorDto {
  error: string;
}
