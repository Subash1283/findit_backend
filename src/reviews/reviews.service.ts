import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
  ) {}

  async create(reviewerId: number, dto: CreateReviewDto): Promise<Review> {
    const reviewType = dto.type || 'user';

    if (reviewType === 'user') {
      if (!dto.targetUserId) {
        throw new BadRequestException('targetUserId is required for user reviews.');
      }
      if (reviewerId === dto.targetUserId) {
        throw new BadRequestException('You cannot review yourself.');
      }

      if (dto.itemId) {
        const existing = await this.reviewRepository.findOne({
          where: { reviewerId, targetUserId: dto.targetUserId, itemId: dto.itemId, type: 'user' },
        });
        if (existing) {
          throw new BadRequestException('You have already left a review for this transaction.');
        }
      }
    } else if (reviewType === 'platform') {
      if (dto.itemId) {
        const existing = await this.reviewRepository.findOne({
          where: { reviewerId, itemId: dto.itemId, type: 'platform' },
        });
        if (existing) {
          throw new BadRequestException('You have already reviewed the platform for this item.');
        }
      }
    }

    const review = this.reviewRepository.create({
      ...dto,
      type: reviewType,
      reviewerId,
    });
    return this.reviewRepository.save(review);
  }

  // Public: only non-hidden user reviews
  async findByTargetUser(targetUserId: number): Promise<Review[]> {
    return this.reviewRepository.find({
      where: { targetUserId, type: 'user', isHidden: false },
      relations: ['reviewer'],
      order: { createdAt: 'DESC' },
    });
  }

  // Public: only non-hidden platform reviews
  async getPlatformReviews(): Promise<Review[]> {
    return this.reviewRepository.find({
      where: { type: 'platform', isHidden: false },
      relations: ['reviewer'],
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }

  async getUserStats(targetUserId: number): Promise<{ averageRating: number; totalReviews: number }> {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'averageRating')
      .addSelect('COUNT(review.id)', 'totalReviews')
      .where('review.targetUserId = :targetUserId', { targetUserId })
      .andWhere('review.type = :type', { type: 'user' })
      .andWhere('review.isHidden = :isHidden', { isHidden: false })
      .getRawOne();

    return {
      averageRating: result.averageRating ? parseFloat(parseFloat(result.averageRating).toFixed(1)) : 0,
      totalReviews: result.totalReviews ? parseInt(result.totalReviews, 10) : 0,
    };
  }

  // Admin: get ALL reviews (including hidden)
  async findAll(): Promise<Review[]> {
    return this.reviewRepository.find({
      relations: ['reviewer', 'targetUser'],
      order: { createdAt: 'DESC' },
    });
  }

  // Admin: update review (hide/unhide, add response)
  async adminUpdate(id: number, update: { isHidden?: boolean; adminResponse?: string }): Promise<Review> {
    const review = await this.reviewRepository.findOne({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review #${id} not found`);
    }

    if (update.isHidden !== undefined) {
      review.isHidden = update.isHidden;
    }
    if (update.adminResponse !== undefined) {
      review.adminResponse = update.adminResponse;
    }

    return this.reviewRepository.save(review);
  }

  // Admin: delete review permanently
  async adminDelete(id: number): Promise<{ message: string }> {
    const review = await this.reviewRepository.findOne({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review #${id} not found`);
    }
    await this.reviewRepository.remove(review);
    return { message: 'Review deleted successfully' };
  }
}
