import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegisterUserDto } from './dto/user.dto';
import { User } from './entity/user.entity';
import { Role } from './role.enum';
import { join, extname, basename } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { VisionService } from '../module/ai/vision.service';
import {
  AutoVerificationResult,
  BulkAutoVerificationResult,
  namesMatch,
} from './identity-verification.util';
import {
  isValidVerificationDocumentType,
  requiresTwoPhotos,
} from './verification-document-type.enum';

export interface UploadVerificationResult {
  user: User;
  autoVerification: AutoVerificationResult;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private visionService: VisionService,
  ) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async register(dto: RegisterUserDto): Promise<User> {
    const disposableDomains = ['mailinator.com', 'tempmail.com', '10minutemail.com', 'yopmail.com', 'trashmail.com', 'dispostable.com', 'guerrillamail.com', 'getnada.com', 'throwawaymail.com'];
    const emailDomain = dto.email.split('@')[1]?.toLowerCase();
    if (disposableDomains.includes(emailDomain)) {
      throw new BadRequestException('Disposable/temporary email addresses are not permitted. Please use a genuine email provider (e.g. Gmail, Outlook, Yahoo).');
    }

    const role = dto.role || Role.USER;
    const user = this.userRepo.create({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      address: dto.address,
      role,
      ...(role === Role.ADMIN
        ? { isVerified: true, verificationStatus: 'verified' }
        : {}),
    });

    return this.userRepo.save(user);
  }

  private async ensureAdminVerified(user: User): Promise<User> {
    if (user.role !== Role.ADMIN) return user;
    if (user.isVerified && user.verificationStatus === 'verified') return user;
    user.isVerified = true;
    user.verificationStatus = 'verified';
    return this.userRepo.save(user);
  }

  canPostLostFoundItems(user: User): boolean {
    if (user.role === Role.ADMIN) return true;
    if (user.isVerified || user.verificationStatus === 'verified') return true;
    return false;
  }

  assertCanPostLostFoundItems(user: User): void {
    if (this.canPostLostFoundItems(user)) return;

    const status = user.verificationStatus || 'unverified';
    if (status === 'pending') {
      throw new ForbiddenException(
        'Your identity document is currently under manual review. You will be able to post once an admin approves it.',
      );
    }
    if (status === 'rejected') {
      throw new ForbiddenException(
        'Your identity verification was rejected. Re-upload your ID in Profile to post lost or found items.',
      );
    }

    throw new ForbiddenException(
      'Verify your identity in Profile before posting lost or found items.',
    );
  }

  async updateUser(id: number, data: Partial<User>): Promise<User | null> {
    await this.userRepo.update(id, data);
    return this.userRepo.findOne({ where: { id } });
  }

  async findUserByGoogleId(googleId: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { googleId } });
  }

  async findOrCreateGoogleUser(
    googleId: string,
    email: string,
    name: string,
  ): Promise<User> {
    let user = await this.userRepo.findOne({ where: { googleId } });

    if (user) return user;

    user = await this.userRepo.findOne({ where: { email } });

    if (user) {
      user.googleId = googleId;
      return this.userRepo.save(user);
    }

    const newUser = this.userRepo.create({
      name: name || 'Google User',
      email,
      googleId,
      role: Role.USER, 
    });

    return this.userRepo.save(newUser);
  }

  async findAll(): Promise<User[]> {
    const users = await this.userRepo.find();
    return Promise.all(users.map((u) => this.ensureAdminVerified(u)));
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.ensureAdminVerified(user);
  }

  async verifyUser(id: number, status: string = 'verified'): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN) {
      throw new BadRequestException('Admins do not require identity verification');
    }
    if (status === 'verified') {
      user.isVerified = true;
      user.verificationStatus = 'verified';
    } else if (status === 'rejected') {
      user.isVerified = false;
      user.verificationStatus = 'rejected';
    } else {
      throw new BadRequestException('Invalid verification status');
    }
    return this.userRepo.save(user);
  }

  async changePassword(id: number, oldPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.findOne(id);
    
    if (!user.password) {
      throw new BadRequestException('Cannot change password for users registered via external providers');
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Incorrect old password');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);

    return { message: 'Password changed successfully' };
  }

  async updateProfile(id: number, data: { address?: string; phone?: string }): Promise<User> {
    const user = await this.findOne(id);
    if (data.address !== undefined) user.address = data.address;
    if (data.phone !== undefined) user.phone = data.phone;
    return this.userRepo.save(user);
  }

  private resolveVerificationFilename(user: User, side: 'front' | 'back'): string {
    const stored =
      side === 'back' ? user.verificationDocumentBack : user.verificationDocument;
    if (!stored) {
      throw new NotFoundException(
        side === 'back' ? 'No back document uploaded' : 'No verification document uploaded',
      );
    }
    return basename(stored);
  }

  private mimeTypeForFile(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mimeMap[ext] || 'image/jpeg';
  }

  hasCompleteVerificationDocuments(user: User): boolean {
    if (!user.verificationDocument || !user.verificationDocumentType) return false;
    if (requiresTwoPhotos(user.verificationDocumentType)) {
      return !!user.verificationDocumentBack;
    }
    return true;
  }

  async getVerificationDocumentFile(
    userId: number,
    side: 'front' | 'back' = 'front',
  ): Promise<{ filePath: string; mimeType: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const filename = this.resolveVerificationFilename(user, side);
    const filePath = join(process.cwd(), 'uploads', 'users', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Document file not found on server');
    }
    return { filePath, mimeType: this.mimeTypeForFile(filename) };
  }

  private async extractNameFromUserDocuments(
    user: User,
  ): Promise<{ name: string | null; unavailable: boolean; isValid: boolean; reason?: string }> {
    const filenames = [user.verificationDocument, user.verificationDocumentBack].filter(
      Boolean,
    ) as string[];

    let sawUnavailable = false;
    let anyInvalid = false;
    let invalidReason = '';

    for (const stored of filenames) {
      const filename = basename(stored);
      const filePath = join(process.cwd(), 'uploads', 'users', filename);
      if (!existsSync(filePath)) continue;
      
      const result = await this.visionService.extractNameFromIdentityDocument(filePath, user.verificationDocumentType || 'identity document');
      
      if (!result.isValid) {
        anyInvalid = true;
        invalidReason = result.reason || 'Image does not appear to be a valid document.';
        break;
      }

      if (result.name) return { name: result.name, unavailable: false, isValid: true };
      if (result.unavailable) sawUnavailable = true;
    }

    if (anyInvalid) {
      return { name: null, unavailable: false, isValid: false, reason: invalidReason };
    }

    return { name: null, unavailable: sawUnavailable, isValid: true };
  }

  async attemptAutoVerification(user: User): Promise<AutoVerificationResult> {
    const currentAttempts = (user.verificationAttempts || 0) + 1;
    user.verificationAttempts = currentAttempts;

    const accountName = user.name?.trim() || '';
    const base: AutoVerificationResult = {
      attempted: true,
      matched: false,
      documentName: null,
      accountName,
      verified: false,
      rejected: false,
      attemptsCount: currentAttempts,
      maxAttempts: 6,
    };

    // If max 6 attempts already exceeded
    if (currentAttempts > 6) {
      user.isVerified = false;
      user.verificationStatus = 'pending';
      await this.userRepo.save(user);
      return {
        ...base,
        attempted: false,
        reason: 'Maximum auto-verification attempts (6/6) reached. Your account is now pending manual review by an administrator.',
      };
    }

    if (!this.hasCompleteVerificationDocuments(user)) {
      await this.userRepo.save(user);
      return {
        ...base,
        attempted: false,
        reason: requiresTwoPhotos(user.verificationDocumentType || '')
          ? 'Citizenship card requires front and back photos'
          : 'No document uploaded',
      };
    }

    const { name: documentName, unavailable, isValid, reason: invalidReason } = await this.extractNameFromUserDocuments(user);

    if (!isValid) {
      if (currentAttempts >= 6) {
        user.isVerified = false;
        user.verificationStatus = 'pending';
        await this.userRepo.save(user);
        return {
          ...base,
          verified: false,
          rejected: false,
          reason: `6 failed attempts reached. Uploaded document is unreadable. Account moved to manual review.`,
        };
      } else {
        user.isVerified = false;
        user.verificationStatus = 'rejected';
        await this.userRepo.save(user);
        return {
          ...base,
          verified: false,
          rejected: true,
          reason: `Verification attempt ${currentAttempts}/6 failed: ${invalidReason || 'Uploaded images are not valid documents.'}`,
        };
      }
    }

    if (!documentName) {
      user.isVerified = false;
      user.verificationStatus = 'pending';
      await this.userRepo.save(user);
      return {
        ...base,
        reason: unavailable
          ? 'Name check temporarily unavailable — left for manual review'
          : 'Could not read a name from the document — left for manual review',
      };
    }

    const matched = namesMatch(accountName, documentName);
    if (matched) {
      user.isVerified = true;
      user.verificationStatus = 'verified';
      await this.userRepo.save(user);
      return {
        ...base,
        matched: true,
        documentName,
        verified: true,
        rejected: false,
        reason: 'Document name matches account full name',
      };
    }

    // Name Mismatch Case
    if (currentAttempts >= 6) {
      // 6th failed attempt -> move to manual review (pending) instead of rejecting!
      user.isVerified = false;
      user.verificationStatus = 'pending';
      await this.userRepo.save(user);
      return {
        ...base,
        matched: false,
        documentName,
        verified: false,
        rejected: false,
        reason: `Auto-verification limit (6/6 attempts) reached. Document name shows "${documentName}". Your request has been submitted for manual admin verification.`,
      };
    }

    // Attempt failed (<6 attempts) -> reject so user can re-try uploading!
    user.isVerified = false;
    user.verificationStatus = 'rejected';
    await this.userRepo.save(user);
    return {
      ...base,
      matched: false,
      documentName,
      verified: false,
      rejected: true,
      reason: `Name mismatch (Attempt ${currentAttempts}/6): document shows "${documentName}", Account is "${accountName}". You have ${6 - currentAttempts} re-try attempt(s) left before manual review.`,
    };
  }

  async bulkAutoVerifyPending(): Promise<BulkAutoVerificationResult> {
    const pendingUsers = await this.userRepo.find({
      where: { verificationStatus: 'pending' },
    });

    const eligible = pendingUsers.filter(
      (u) => u.role !== Role.ADMIN && this.hasCompleteVerificationDocuments(u),
    );

    const results: BulkAutoVerificationResult['results'] = [];
    let verified = 0;
    let rejected = 0;
    let stillPending = 0;

    for (const user of eligible) {
      const result = await this.attemptAutoVerification(user);
      const entry = { userId: user.id, userName: user.name, ...result };
      results.push(entry);
      if (result.verified) verified++;
      else if (result.rejected) rejected++;
      else stillPending++;
    }

    return {
      processed: eligible.length,
      verified,
      rejected,
      pending: stillPending,
      results,
    };
  }

  async uploadVerificationDocument(
    id: number,
    documentType: string,
    frontFilename: string,
    backFilename?: string,
  ): Promise<UploadVerificationResult> {
    const user = await this.findOne(id);
    if (user.role === Role.ADMIN) {
      throw new BadRequestException('Admins do not require identity verification');
    }
    if (!isValidVerificationDocumentType(documentType)) {
      throw new BadRequestException(
        'Invalid document type. Use passport, citizenship, or drivers_license',
      );
    }
    if (requiresTwoPhotos(documentType) && !backFilename) {
      throw new BadRequestException(
        'Citizenship card requires front and back photos',
      );
    }
    if (!requiresTwoPhotos(documentType) && backFilename) {
      throw new BadRequestException('Back photo is only required for citizenship card or student ID card');
    }

    // AI Vision Document Type Validation
    const frontPath = join(process.cwd(), 'uploads', 'users', frontFilename);
    if (existsSync(frontPath)) {
      const docValidation = await this.visionService.validateDocumentType(frontPath, documentType);
      if (!docValidation.isMatch) {
        if (existsSync(frontPath)) unlinkSync(frontPath);
        if (backFilename) {
          const backPath = join(process.cwd(), 'uploads', 'users', backFilename);
          if (existsSync(backPath)) unlinkSync(backPath);
        }
        throw new BadRequestException({
          statusCode: 400,
          error: 'Document Type Mismatch',
          message: docValidation.reason || `The uploaded document image does not match the selected document type "${documentType.replace(/_/g, ' ')}". Please upload a valid document image.`,
        });
      }
    }

    user.verificationDocumentType = documentType;
    user.verificationDocument = frontFilename;
    user.verificationDocumentBack = backFilename || null;
    user.verificationStatus = 'pending';
    const saved = await this.userRepo.save(user);

    const autoVerification = await this.attemptAutoVerification(saved);
    const updated = await this.findOne(id);
    return { user: updated, autoVerification };
  }

  async removeUser(id: number): Promise<{ message: string }> {
    const user = await this.findOne(id);
    await this.userRepo.remove(user);
    return { message: 'User deleted successfully' };
  }

  async suspendUser(id: number, reason: string): Promise<User> {
    const user = await this.findOne(id);
    if (user.role === Role.ADMIN) {
      throw new BadRequestException('Cannot suspend an admin user');
    }
    user.isSuspended = true;
    user.suspensionReason = reason;
    return this.userRepo.save(user);
  }

  async unsuspendUser(id: number): Promise<User> {
    const user = await this.findOne(id);
    user.isSuspended = false;
    user.suspensionReason = null;
    return this.userRepo.save(user);
  }
}