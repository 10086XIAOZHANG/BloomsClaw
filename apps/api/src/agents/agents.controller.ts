import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentDto } from './agents.types';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(@Query('userId') userId = 'default'): Promise<AgentDto[]> {
    return this.agentsService.findAll(userId);
  }

  @Get(':name')
  findOne(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<AgentDto> {
    return this.agentsService.findOne(name, userId);
  }

  @Post()
  create(@Body() body: unknown, @Query('userId') userId = 'default'): Promise<AgentDto> {
    return this.agentsService.create(body, userId);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown, @Query('userId') userId = 'default'): Promise<AgentDto> {
    return this.agentsService.update(name, body, userId);
  }

  @Delete(':name')
  async remove(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<{ deleted: true }> {
    await this.agentsService.remove(name, userId);
    return { deleted: true };
  }
}