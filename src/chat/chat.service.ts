import { Injectable, BadRequestException } from '@nestjs/common';

import { CryptoService } from './crypto.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { Conversation } from './entities/conversation.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    private readonly cryptoService: CryptoService,
  ) {}

  async getConversation(itemId: number, userId1: number, userId2: number): Promise<Conversation> {
    return this.conversationRepository.findOne({
      where: [
        { itemId, initiatorId: userId1, ownerId: userId2 },
        { itemId, initiatorId: userId2, ownerId: userId1 },
      ]
    });
  }

  async saveMessage(senderId: number, receiverId: number, itemId: number, content: string, imageUrl?: string): Promise<Message> {
    let conversation = await this.getConversation(itemId, senderId, receiverId);
    
    if (!conversation) {
      // Create new conversation request
      conversation = this.conversationRepository.create({
        itemId,
        initiatorId: senderId,
        ownerId: receiverId,
        status: 'pending'
      });
      await this.conversationRepository.save(conversation);
    } else {
      if (conversation.status === 'declined') {
        throw new BadRequestException('This conversation was declined.');
      }
    }

    const encryptedContent = this.cryptoService.encrypt(content);
    const message = this.messageRepository.create({
      senderId,
      receiverId,
      itemId,
      content: encryptedContent,
      imageUrl,
    });
    const savedMessage = await this.messageRepository.save(message);
    const completeMessage = await this.messageRepository.findOne({
      where: { id: savedMessage.id },
      relations: ['sender', 'receiver'],
    });
    completeMessage.content = this.cryptoService.decrypt(completeMessage.content);
    return completeMessage;
  }

  async setConversationStatus(itemId: number, initiatorId: number, ownerId: number, status: 'accepted' | 'declined'): Promise<Conversation> {
    let conversation = await this.conversationRepository.findOne({ where: { itemId, initiatorId, ownerId } });
    if (conversation) {
      conversation.status = status;
      return this.conversationRepository.save(conversation);
    }
    return null;
  }

  async getMessages(itemId: number, userId1: number, userId2: number): Promise<{ messages: Message[], conversation: Conversation }> {
    const messages = await this.messageRepository.find({
      where: [
        { itemId, senderId: userId1, receiverId: userId2 },
        { itemId, senderId: userId2, receiverId: userId1 },
      ],
      relations: ['sender', 'receiver'],
      order: { createdAt: 'ASC' },
    });
    // Decrypt message contents
    const decryptedMessages = messages.map(msg => {
      try {
        const decrypted = this.cryptoService.decrypt(msg.content);
        return { ...msg, content: decrypted };
      } catch {
        return msg; // fallback to raw if decryption fails
      }
    });
    const conversation = await this.getConversation(itemId, userId1, userId2);
    return { messages: decryptedMessages, conversation };
  }

  async getUserInbox(userId: number) {
    const messages = await this.messageRepository.find({
      where: [ { senderId: userId }, { receiverId: userId } ],
      relations: ['sender', 'receiver', 'item'],
      order: { createdAt: 'DESC' }
    });

    // Decrypt message content for inbox display
    const decrypted = messages.map(msg => {
      try {
        return { ...msg, content: this.cryptoService.decrypt(msg.content) };
      } catch {
        return msg;
      }
    });

    const conversations = new Map<string, any>();
    for(const msg of decrypted) {
      if (!msg.item || !msg.sender || !msg.receiver) continue;
      const otherUser = msg.senderId === userId ? msg.receiver : msg.sender;
      if (!otherUser) continue;
      const key = `${msg.itemId}_${otherUser.id}`;
      if (!conversations.has(key)) {
        // Fetch conversation status
        const convStatus = await this.getConversation(msg.itemId, userId, otherUser.id);
        
        conversations.set(key, {
          item: msg.item,
          otherUser,
          lastMessage: msg.content,
          updatedAt: msg.createdAt,
          conversation: convStatus
        });
      }
    }
    return Array.from(conversations.values());
  }
}
