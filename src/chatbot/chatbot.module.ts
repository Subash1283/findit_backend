import { Module } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { ItemsModule } from '../items/items.module';

import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ItemsModule, ConfigModule],
  providers: [ChatbotService],
  controllers: [ChatbotController],
})
export class ChatbotModule {}
