import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasswordReset } from './entity/resetpassword.entity';
import { User } from 'src/users/entity/user.entity';
import * as bcrypt from 'bcrypt';
import { MailerService } from './mailer.service';

@Injectable()
export class ResetPasswordService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(PasswordReset)
    private readonly resetRepo: Repository<PasswordReset>,

    private readonly mailerService: MailerService,
  ) {}

  async requestOtp(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    await this.resetRepo.delete({ userId: user.id });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await this.resetRepo.save({
      userId: user.id,
      otp,
      verified: false,
    });

    await this.mailerService.sendMail(
      email,
      'Your OTP for Password Reset',
      `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 25px; border: 1px solid #e2e2e2; border-radius: 10px; background-color: #fefefe;">
    
    <h2 style="color: #2c3e50; text-align: center;">Email Verification</h2>
    
    <p>Hello,</p>
    <p>We received a request to reset the password for your account. Use the OTP below to proceed:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <span style="font-size: 36px; font-weight: bold; letter-spacing: 5px; color: #228fd8; padding: 15px 30px; border: 2px solid #3498db; border-radius: 8px; display: inline-block;">
        ${otp}
      </span>
    </div>

    <p style="color: #7f8c8d; font-size: 14px;">
      This OTP is valid for the next <b>10 minutes</b>. If you did not request a password reset, please ignore this email.
    </p>

    <br/>
  <footer style="text-align: center; margin-top: 30px; font-size: 12px; color: #154393;">
      © FindIt Platform
    </footer>
  </span>
</footer>



  </div>
  `,
    );

    return {
      message: 'OTP has been sent successfully.Please check your email.',
    };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    const otpRecord = await this.resetRepo.findOne({
      where: { userId: user.id, otp },
    });

    if (!otpRecord) {
      throw new BadRequestException('Invalid OTP');
    }

    const now = new Date();
    const diff = (now.getTime() - otpRecord.createdAt.getTime()) / 1000;

    if (diff > 600) {
      await this.resetRepo.delete({ id: otpRecord.id });
      throw new BadRequestException('OTP expired');
    }

    otpRecord.verified = true;
    await this.resetRepo.save(otpRecord);

    return { message: 'OTP verified successfully' };
  }
  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    const otpRecord = await this.resetRepo.findOne({
      where: { userId: user.id, otp, verified: true },
    });

    if (!otpRecord) {
      throw new BadRequestException('OTP not verified or invalid');
    }
    const now = new Date();
    const diff = (now.getTime() - otpRecord.createdAt.getTime()) / 1000;

    if (diff > 600) {
      await this.resetRepo.delete({ id: otpRecord.id });
      throw new BadRequestException('OTP expired');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);

    await this.resetRepo.delete({ id: otpRecord.id });

    return { message: 'Password reset successfully' };
  }
}
