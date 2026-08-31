import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseInterceptors,
  UploadedFiles,
  Delete,
  Param,
  UseGuards,
  Req,
  ValidationPipe,
  UsePipes,
  ParseIntPipe,
  ForbiddenException,
  BadRequestException,
  Res,
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ClaimStatus } from './entities/claim-request.entity';
import { JwtAuthGuard } from '../module/common/guards/jwt-authguard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  findAll() {
    return this.itemsService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  findMine(@Req() req: any) {
    return this.itemsService.findMine(req.user.id);
  }


  @Get('heatmap')
  getHeatmap() {
    return this.itemsService.getHeatmapData();
  }

  @Get('admin/disputes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getAllDisputes(@Req() req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Admin only');
    return this.itemsService.getAllDisputes();
  }

  @Patch('admin/disputes/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  resolveDispute(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @Body('adminResponse') adminResponse: string,
    @Req() req: any,
  ) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Admin only');
    return this.itemsService.resolveDispute(id, status, adminResponse);
  }

  @Get('admin/claims')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getAllClaims(@Req() req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Admin only');
    return this.itemsService.getAllClaims();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  @UseInterceptors(
    FilesInterceptor('images', 2, {
      dest: './uploads/items/',
    }),
  )
  @ApiBearerAuth('access-token')
  create(
    @Body() dto: CreateItemDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    const userId = req.user.id; 

    return this.itemsService.create(dto, files, userId);
  }

  @Post('autofill')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('image', 1, {
      dest: './uploads/items/',
    }),
  )
  @ApiBearerAuth('access-token')
  autoFillDetails(
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.itemsService.autoFillDetails(files && files.length > 0 ? files[0] : null);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  @UseInterceptors(
    FilesInterceptor('images', 2, {
      dest: './uploads/items/',
    }),
  )
  @ApiBearerAuth('access-token')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    return this.itemsService.update(id, dto, files || [], req.user.id, req.user.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.itemsService.remove(id, req.user.id, req.user.role);
  }

  @Get(':id/claim/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getClaimStatus(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.itemsService.getClaimStatus(id, req.user.id);
  }

  @Post(':id/claim-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  createClaimRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body('proofMessage') proofMessage: string,
    @Req() req: any,
  ) {
    return this.itemsService.createClaimRequest(id, req.user.id, proofMessage);
  }

  @Get(':id/claim-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getClaimRequests(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.itemsService.getClaimRequests(id, req.user.id);
  }

  @Patch('claim-requests/:requestId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  respondToClaimRequest(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body('status') status: ClaimStatus,
    @Req() req: any,
  ) {
    return this.itemsService.respondToClaimRequest(requestId, req.user.id, status);
  }

  @Get(':id/dispute')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getUserDispute(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.itemsService.getDisputeByItemAndReporter(id, req.user.id);
  }

  @Post(':id/dispute')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  createDispute(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Reason is required');
    }
    return this.itemsService.createDispute(req.user.id, id, reason);
  }

  @Get('claim-requests/:claimId/tracking')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  getClaimTracking(
    @Param('claimId', ParseIntPipe) claimId: number,
    @Req() req: any,
  ) {
    return this.itemsService.getClaimTrackingInfo(claimId, req.user.id);
  }

  @Patch('claim-requests/:claimId/arrange-return')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  markReturnArranged(
    @Param('claimId', ParseIntPipe) claimId: number,
    @Req() req: any,
  ) {
    return this.itemsService.markReturnArranged(claimId, req.user.id);
  }

  @Patch('claim-requests/:claimId/receive')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  markItemReceived(
    @Param('claimId', ParseIntPipe) claimId: number,
    @Req() req: any,
  ) {
    return this.itemsService.markItemReceived(claimId, req.user.id);
  }

  @Get('admin/returns/pdf')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  async downloadReturnedItemsPdf(
    @Req() req: any,
    @Res() res: any,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Admin only');
    return this.itemsService.generateReturnedItemsPdf(res, status, startDate, endDate);
  }
}

