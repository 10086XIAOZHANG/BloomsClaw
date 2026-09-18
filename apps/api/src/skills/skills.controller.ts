import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { InstallSkillDto, SkillDto } from './skills.types';
import { SkillsService } from './skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  findAll(): Promise<SkillDto[]> {
    return this.skillsService.findAll();
  }

  @Get(':name')
  findOne(@Param('name') name: string): Promise<SkillDto> {
    return this.skillsService.findOne(name);
  }

  @Post('install')
  install(@Body() body: InstallSkillDto): Promise<SkillDto[]> {
    return this.skillsService.install(body);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown): Promise<SkillDto> {
    return this.skillsService.update(name, body);
  }

  @Delete(':name')
  async remove(@Param('name') name: string): Promise<{ deleted: true }> {
    await this.skillsService.remove(name);
    return { deleted: true };
  }
}
