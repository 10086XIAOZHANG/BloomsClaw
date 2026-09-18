import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { ModelsModule } from './models/models.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SkillsModule } from './skills/skills.module';
import { ToolsModule } from './tools/tools.module';

@Module({
  imports: [AgentsModule, ModelsModule, ToolsModule, SkillsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
