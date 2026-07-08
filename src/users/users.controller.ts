import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Delete,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { decryptFileInPlace, encryptFileInPlace, decryptFileToBuffer } from '../utils/crypto.util';
import { UsersService } from './user.service';
import { JwtAuthGuard } from '../module/common/guards/jwt-authguard';
import { Roles } from '../module/common/decorators/role.decorator';
import { RoleGuard } from '../module/common/guards/role.guard';
import { Role } from './role.enum';

const userVerificationStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = './uploads/users/';
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },

  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = extname(file.originalname) || '.jpg';
    cb(null, `document-${unique}${ext}`);
  },
});

const imageFileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!file.mimetype.match(/^image\/(jpeg|png|gif|webp)$/)) {
    return cb(
      new BadRequestException(
        'Only image files (JPEG, PNG, GIF, WebP) are allowed',
      ),
      false,
    );
  }
  cb(null, true);
};

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  //  Get all users (ADMIN only)

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  findAll() {
    return this.usersService.findAll();
  }

  // Check all pending verifications (name match → verified, mismatch → rejected)

  @Post('verify-pending')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  verifyPending() {
    return this.usersService.bulkAutoVerifyPending();
  }

  //  Get logged-in user profile 

  @Get('me')
  @UseGuards(JwtAuthGuard)
  findMe(@Req() req: any) {
    return this.usersService.findOne(req.user.id);
  }

  // View verification document (ADMIN only)

  @Get(':id/verification-document')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  async viewVerificationDocument(
    @Param('id', ParseIntPipe) id: number,
    @Query('side') side: string | undefined,
    @Res() res: Response,
  ) {
    const docSide = side === 'back' ? 'back' : 'front';
    const { filePath, mimeType } =
      await this.usersService.getVerificationDocumentFile(
        id,
        docSide,
      );

    const decryptedBuffer = await decryptFileToBuffer(filePath);

    res.set({
      'Content-Type': mimeType,

      'Content-Disposition': 'inline',
    });

    res.send(decryptedBuffer);
  }

  //  Get user by ID

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  //  Update Profile

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Req() req: any, @Body() body: any) {
    if (body.oldPassword && body.newPassword) {
      await this.usersService.changePassword(
        req.user.id,
        body.oldPassword,
        body.newPassword,
      );
    }

    return this.usersService.updateProfile(req.user.id, {
      address: body.address,
    });
  }

  //  Upload Verification Document

  @Post('upload-document')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'document', maxCount: 1 },

        { name: 'documentBack', maxCount: 1 },
      ],

      {
        storage: userVerificationStorage,

        fileFilter: imageFileFilter,
      },
    ),
  )
  async uploadDocument(
    @Req() req: any,

    @UploadedFiles()
    files: {
      document?: Express.Multer.File[];
      documentBack?: Express.Multer.File[];
    },

    @Body('documentType') documentType: string,
  ) {
    const front = files.document?.[0];

    if (!front) {
      throw new BadRequestException('Document photo is required');
    }

    const back = files.documentBack?.[0];

    const { user, autoVerification } =
      await this.usersService.uploadVerificationDocument(
        req.user.id,

        documentType,

        front.filename,

        back?.filename,
      );

    return { ...user, autoVerification };
  }

  // Verify User (ADMIN only)

  @Patch(':id/verify')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.usersService.verifyUser(id, status || 'verified');
  }

  // Suspend User (ADMIN only)
  @Patch(':id/suspend')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  suspendUser(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
  ) {
    if (!reason) {
      throw new BadRequestException('Suspension reason is required');
    }
    return this.usersService.suspendUser(id, reason);
  }

  // Unsuspend User (ADMIN only)
  @Patch(':id/unsuspend')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  unsuspendUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.unsuspendUser(id);
  }

  //  Delete User (ADMIN only)

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.removeUser(id);
  }
}
