import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentDto } from './agents.types';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(): Promise<AgentDto[]> {
    return this.agentsService.findAll();
  }

  @Get(':name')
  findOne(@Param('name') name: string): Promise<AgentDto> {
    return this.agentsService.findOne(name);
  }

  @Post()
  create(@Body() body: unknown): Promise<AgentDto> {
    return this.agentsService.create(body);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown): Promise<AgentDto> {
    return this.agentsService.update(name, body);
  }

  @Delete(':name')
  async remove(@Param('name') name: string): Promise<{ deleted: true }> {
    await this.agentsService.remove(name);
    return { deleted: true };
  }
}
