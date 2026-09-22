import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ModelsService } from './models.service';
import { ModelDto } from './models.types';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  findAll(@Query('userId') userId = 'default'): Promise<ModelDto[]> {
    return this.modelsService.findAll(userId);
  }

  @Get(':name')
  findOne(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<ModelDto> {
    return this.modelsService.findOne(name, userId);
  }

  @Post()
  create(@Body() body: unknown, @Query('userId') userId = 'default'): Promise<ModelDto> {
    return this.modelsService.create(body, userId);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown, @Query('userId') userId = 'default'): Promise<ModelDto> {
    return this.modelsService.update(name, body, userId);
  }

  @Delete(':name')
  async remove(@Param('name') name: string, @Query('userId') userId = 'default'): Promise<{ deleted: true }> {
    await this.modelsService.remove(name, userId);
    return { deleted: true };
  }
}
