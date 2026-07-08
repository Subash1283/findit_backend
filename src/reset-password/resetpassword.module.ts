import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResetPasswordService } from './resetpassword.service';
import { ResetPasswordController } from './resetpassword.controller';
import { User } from 'src/users/entity/user.entity';
import { PasswordReset } from './entity/resetpassword.entity';
import { MailerService } from './mailer.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, PasswordReset])],
  providers: [ResetPasswordService, MailerService],
  controllers: [ResetPasswordController],
  exports: [MailerService],
})
export class ResetPasswordModule {}