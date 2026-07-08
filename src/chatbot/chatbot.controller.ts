import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { JwtAuthGuard } from '../module/common/guards/jwt-authguard';
import { ApiBearerAuth, ApiProperty } from '@nestjs/swagger';

class ChatMessageDto {
  @ApiProperty()
  message: string;
}

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @UseGuards(JwtAuthGuard)
  @Post('ask')
  async ask(@Body() dto: any, @Req() req: any) {
    console.log('[Chatbot] Request received:', dto);
    const userId = req.user?.id;
    const response = await this.chatbotService.processMessage(dto.message, userId);
    return { response: response || "I'm here to help!" };
  }
}
