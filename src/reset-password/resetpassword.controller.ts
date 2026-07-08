import { Controller, Post, Body } from '@nestjs/common';
import { ResetPasswordService } from './resetpassword.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-opt.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Reset Password')
@Controller('reset-password')
export class ResetPasswordController {
  constructor(private readonly resetService: ResetPasswordService) {}

  @Post('request-otp')
  @ApiOperation({ summary: 'Request OTP for password reset' })
  @ApiResponse({ status: 200, description: 'OTP has been sent successfully' })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.resetService.requestOtp(dto.email);
  }

  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP for password reset' })
  @ApiResponse({ status: 200, description: 'Your OTP has been  verified Successfully' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.resetService.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password after OTP verification' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.resetService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }
}