import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { RemoteMcpToolMeta, ToolDto } from './tools.types';
import { ToolsService } from './tools.service';

@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  findAll(): Promise<ToolDto[]> {
    return this.toolsService.findAll();
  }

  @Post('validate')
  validateMcp(@Body() body: unknown): Promise<{ ok: true; tools: RemoteMcpToolMeta[] }> {
    return this.toolsService.validateMcpConfigAndListTools(body);
  }

  @Get(':name/remote-tools')
  listRemoteTools(@Param('name') name: string) {
    return this.toolsService.listRemoteTools(name);
  }

  @Get(':name')
  findOne(@Param('name') name: string): Promise<ToolDto> {
    return this.toolsService.findOne(name);
  }

  @Post()
  create(@Body() body: unknown): Promise<ToolDto> {
    return this.toolsService.create(body);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown): Promise<ToolDto> {
    return this.toolsService.update(name, body);
  }

  @Delete(':name')
  async remove(@Param('name') name: string): Promise<{ deleted: true }> {
    await this.toolsService.remove(name);
    return { deleted: true };
  }
}
