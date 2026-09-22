import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { InstallSkillDto, SkillDto } from './skills.types';
import { SkillsService } from './skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  findAll(@Query('userId') userId = 'default'): Promise<SkillDto[]> {
    return this.skillsService.findAll(userId);
  }

  @Get(':name')
  findOne(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<SkillDto> {
    return this.skillsService.findOne(name, userId);
  }

  @Post('install')
  install(@Body() body: InstallSkillDto, @Query('userId') userId = 'default'): Promise<SkillDto[]> {
    return this.skillsService.install(body, userId);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown, @Query('userId') userId = 'default'): Promise<SkillDto> {
    return this.skillsService.update(name, body, userId);
  }

  @Delete(':name')
  async remove(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<{ deleted: true }> {
    await this.skillsService.remove(name, userId);
    return { deleted: true };
  }
}