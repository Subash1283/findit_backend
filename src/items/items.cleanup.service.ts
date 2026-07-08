import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Not, LessThanOrEqual } from 'typeorm';
import { ItemStatus } from './entities/item.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from './entities/item.entity';

@Injectable()
export class ItemsCleanupService {
  private readonly logger = new Logger(ItemsCleanupService.name);

  constructor(@InjectRepository(Item) private readonly itemRepo: Repository<Item>) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async removeExpiredItems() {
    const now = new Date();
    const result = await this.itemRepo.delete({
      expirationDate: LessThanOrEqual(now),
      status: Not(ItemStatus.SOLVED),
    });
    this.logger.log(`Deleted ${result.affected || 0} expired items`);
  }
}
