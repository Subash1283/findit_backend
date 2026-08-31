import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ChatGateway');
  private connectedUsers = new Map<number, string>(); // userId -> socketId

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        client.disconnect();
        return;
      }
      
      let payload;
      try {
        payload = this.jwtService.verify(token);
      } catch (err) {
        client.disconnect();
        return;
      }
      
      const userId = payload.sub;
      client.data.userId = userId;
      this.connectedUsers.set(userId, client.id);
      this.logger.log(`Client connected: ${client.id} (User: ${userId})`);
      
      // Auto-send inbox on connect
      const inbox = await this.chatService.getUserInbox(userId);
      client.emit('inboxData', inbox);
    } catch (err) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      this.connectedUsers.delete(userId);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('getHistory')
  async handleGetHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { itemId: number; otherUserId: number },
  ) {
    const userId = client.data.userId;
    try {
      const history = await this.chatService.getMessages(
        data.itemId,
        userId,
        data.otherUserId,
      );
      client.emit('chatHistory', history);
      const inbox = await this.chatService.getUserInbox(userId);
      client.emit('inboxData', inbox);
    } catch (err) {
      client.emit('chatError', { message: 'Failed to fetch history' });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId: number; itemId: number; content: string; imageUrl?: string },
  ) {
    const senderId = client.data.userId;
    try {
      const message = await this.chatService.saveMessage(
        senderId,
        data.receiverId,
        data.itemId,
        data.content,
        data.imageUrl
      );

      const receiverSocketId = this.connectedUsers.get(data.receiverId);
      if (receiverSocketId) {
        this.server.to(receiverSocketId).emit('newMessage', message);
      }
      client.emit('newMessage', message); // send back to sender
    } catch (error) {
      client.emit('chatError', { message:'Failed to send message' });
    }
  }

  @SubscribeMessage('acceptRequest')
  async handleAcceptRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { itemId: number; initiatorId: number },
  ) {
    const ownerId = client.data.userId;
    try {
      await this.chatService.setConversationStatus(data.itemId, data.initiatorId, ownerId, 'accepted');
      
      const payload = { itemId: data.itemId, initiatorId: data.initiatorId, status: 'accepted' };
      client.emit('requestStatusChanged', payload);

      const initiatorSocketId = this.connectedUsers.get(data.initiatorId);
      if (initiatorSocketId) {
        this.server.to(initiatorSocketId).emit('requestStatusChanged', payload);
      }
    } catch (err) {
      client.emit('chatError', { message: 'Failed to accept request' });
    }
  }

  @SubscribeMessage('declineRequest')
  async handleDeclineRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { itemId: number; initiatorId: number },
  ) {
    const ownerId = client.data.userId;
    try {
      await this.chatService.setConversationStatus(data.itemId, data.initiatorId, ownerId, 'declined');
      
      const payload = { itemId: data.itemId, initiatorId: data.initiatorId, status: 'declined' };
      client.emit('requestStatusChanged', payload);

      const initiatorSocketId = this.connectedUsers.get(data.initiatorId);
      if (initiatorSocketId) {
        this.server.to(initiatorSocketId).emit('requestStatusChanged', payload);
      }
    } catch (err) {
      client.emit('chatError', { message: 'Failed to decline request' });
    }
  }

  @SubscribeMessage('getInbox')
  async handleGetInbox(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    try {
      const inbox = await this.chatService.getUserInbox(userId);
      client.emit('inboxData', inbox);
    } catch (err) {
      client.emit('chatError', { message: 'Failed to fetch inbox' });
    }
  }
}
