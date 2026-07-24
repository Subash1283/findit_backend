import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entity/user.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(userId: number, message: string, link?: string, type: string = 'info') {
    const notification = this.notificationRepository.create({
      userId,
      message,
      link,
      type,
    });
    return this.notificationRepository.save(notification);
  }

  async findAllForUser(userId: number) {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async markAsRead(id: number) {
    return this.notificationRepository.update(id, { isRead: true });
  }

  async createAnnouncement(message: string, senderId?: number) {
    const users = await this.userRepository.find();
    const notifications = users
      .filter(user => user.id !== senderId) // Exclude the sender (admin) from receiving the announcement
      .map(user =>
        this.notificationRepository.create({
          userId: user.id,
          message,
          link: '/dashboard',
          type: 'announcement',
        })
      );
    await this.notificationRepository.save(notifications);
  }
}
