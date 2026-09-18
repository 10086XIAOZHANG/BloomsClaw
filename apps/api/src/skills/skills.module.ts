import { Module } from '@nestjs/common';
import { ConfigFileService } from '../shared/config-file.service';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  controllers: [SkillsController],
  providers: [SkillsService, ConfigFileService],
})
export class SkillsModule {}
