import { Controller, Get, Post, Body, Param, UseGuards, Request, UseInterceptors, UploadedFile, Patch, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/chat.dto';
import { JwtAuthGuard } from 'src/module/common/guards/jwt-authguard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

@ApiTags('Chat (Read-Only Representation for Swagger)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'Get current user inbox', description: 'Returns all active and pending chat requests for the logged-in user. Note: In the actual app, this is done via WebSockets.' })
  @ApiResponse({ status: 200, description: 'Inbox returned successfully.' })
  async getInbox(@Request() req: any) {
    return this.chatService.getUserInbox(req.user.id);
  }

  @Get('history/:itemId/:otherUserId')
  @ApiOperation({ summary: 'Get chat history', description: 'Fetch conversation history between the logged in user and another user regarding a specific item.' })
  @ApiResponse({ status: 200, description: 'History returned successfully.' })
  async getHistory(
    @Param('itemId') itemId: number,
    @Param('otherUserId') otherUserId: number,
    @Request() req: any
  ) {
    return this.chatService.getMessages(itemId, req.user.id, otherUserId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a message (REST fallback)', description: 'Saves a message. If no conversation exists, a pending Chat Request is created.' })
  @ApiResponse({ status: 201, description: 'Message sent successfully.' })
  async sendMessage(@Body() dto: CreateMessageDto, @Request() req: any) {
    return this.chatService.saveMessage(req.user.id, dto.receiverId, dto.itemId, dto.content);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/chat',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      },
    }),
  }))
  @ApiOperation({ summary: 'Upload chat image' })
  @ApiConsumes('multipart/form-data')
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    return { imageUrl: `/uploads/chat/${file.filename}` };
  }
}
