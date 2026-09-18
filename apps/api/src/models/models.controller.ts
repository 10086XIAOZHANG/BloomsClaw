import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ModelsService } from './models.service';
import { ModelDto } from './models.types';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  findAll(): Promise<ModelDto[]> {
    return this.modelsService.findAll();
  }

  @Get(':name')
  findOne(@Param('name') name: string): Promise<ModelDto> {
    return this.modelsService.findOne(name);
  }

  @Post()
  create(@Body() body: unknown): Promise<ModelDto> {
    return this.modelsService.create(body);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() body: unknown): Promise<ModelDto> {
    return this.modelsService.update(name, body);
  }

  @Delete(':name')
  async remove(@Param('name') name: string): Promise<{ deleted: true }> {
    await this.modelsService.remove(name);
    return { deleted: true };
  }
}
