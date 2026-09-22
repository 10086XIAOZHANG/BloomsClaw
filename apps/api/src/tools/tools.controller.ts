import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RemoteMcpToolMeta, ToolDto } from './tools.types';
import { ToolsService } from './tools.service';

@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  findAll(@Query('userId') userId = 'default'): Promise<ToolDto[]> {
    return this.toolsService.findAll(userId);
  }

  @Post('validate')
  validateMcp(@Body() body: unknown): Promise<{ ok: true; tools: RemoteMcpToolMeta[] }> {
    return this.toolsService.validateMcpConfigAndListTools(body);
  }

  @Get(':name/remote-tools')
  listRemoteTools(@Param('name') name: string, @Query('userId') userId = 'default') {
    return this.toolsService.listRemoteTools(name, userId);
  }

  @Get(':name')
  findOne(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<ToolDto> {
    return this.toolsService.findOne(name, userId);
  }

  @Post()
  create(@Body() body: unknown, @Query('userId') userId = 'default'): Promise<ToolDto> {
    return this.toolsService.create(body, userId);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown, @Query('userId') userId = 'default'): Promise<ToolDto> {
    return this.toolsService.update(name, body, userId);
  }

  @Delete(':name')
  async remove(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<{ deleted: true }> {
    await this.toolsService.remove(name, userId);
    return { deleted: true };
  }
}
