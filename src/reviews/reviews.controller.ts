import { Controller, Post, Get, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../module/common/guards/jwt-authguard';
import { RoleGuard } from '../module/common/guards/role.guard';
import { Roles } from '../module/common/decorators/role.decorator';
import { Role } from '../users/role.enum';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  create(@Body() dto: CreateReviewDto, @Req() req: any) {
    return this.reviewsService.create(req.user.id, dto);
  }

  @Get('platform')
  getPlatformReviews() {
    return this.reviewsService.getPlatformReviews();
  }

  @Get('user/:userId')
  findByTargetUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.reviewsService.findByTargetUser(userId);
  }

  @Get('user/:userId/stats')
  getUserStats(@Param('userId', ParseIntPipe) userId: number) {
    return this.reviewsService.getUserStats(userId);
  }

  // Admin: get ALL reviews (including hidden)
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  findAll() {
    return this.reviewsService.findAll();
  }

  // Admin: update review (hide/unhide, respond)
  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  adminUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isHidden?: boolean; adminResponse?: string },
  ) {
    return this.reviewsService.adminUpdate(id, body);
  }

  // Admin: permanently delete a review
  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  adminDelete(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.adminDelete(id);
  }
}
