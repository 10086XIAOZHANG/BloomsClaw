import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import {
  EditRequestDto,
  ExecuteRequestDto,
  ExecuteResultDto,
  FileListDto,
  FileMutationDto,
  GrepRequestDto,
  GlobRequestDto,
  GrepResultDto,
  HealthDto,
  ListRequestDto,
  PathRequestDto,
  ReadFileDto,
  ReadRequestDto,
  WriteRequestDto,
} from './sandbox.types';

@Controller()
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get('health')
  health(): Promise<HealthDto> {
    return this.sandboxService.health();
  }

  @Post('v1/execute')
  execute(@Body() body: ExecuteRequestDto): Promise<ExecuteResultDto> {
    return this.sandboxService.execute(body.command ?? '');
  }

  @Post('v1/ls')
  list(@Body() body: ListRequestDto): Promise<FileListDto> {
    return this.sandboxService.list(body.path);
  }

  @Post('v1/read')
  read(@Body() body: ReadRequestDto): Promise<ReadFileDto | { error: string }> {
    return this.sandboxService.read(body.path, body.offset, body.limit);
  }

  @Post('v1/write')
  write(@Body() body: WriteRequestDto): Promise<FileMutationDto> {
    return this.sandboxService.write(body.path, body.content);
  }

  @Post('v1/edit')
  edit(@Body() body: EditRequestDto): Promise<FileMutationDto | { error: string }> {
    return this.sandboxService.edit(
      body.path,
      body.oldString,
      body.newString,
      body.replaceAll,
    );
  }

  @Post('v1/grep')
  grep(@Body() body: GrepRequestDto): Promise<GrepResultDto> {
    return this.sandboxService.grep(body.pattern, body.path, body.glob);
  }

  @Post('v1/glob')
  glob(@Body() body: GlobRequestDto): Promise<FileListDto> {
    return this.sandboxService.glob(body.pattern, body.path);
  }

  @Delete('v1/files/*path')
  remove(@Param('path') filePath: string | string[]): Promise<FileMutationDto | { error: string }> {
    const joined = Array.isArray(filePath) ? filePath.join('/') : String(filePath ?? '');
    return this.sandboxService.remove(`/${joined}`);
  }

  @Post('v1/delete')
  removePost(@Body() body: PathRequestDto): Promise<FileMutationDto | { error: string }> {
    return this.sandboxService.remove(body.path);
  }
}
