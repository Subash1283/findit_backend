import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  Request,
  Res,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { RegisterUserDto } from 'src/users/dto/user.dto';
import { LoginUserDto } from 'src/users/dto/login.dto'; 
import { JwtAuthGuard } from 'src/module/common/guards/jwt-authguard';
import { Req } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginUserDto) {
    return this.authService.login(dto);
  }

  @Post('send-magic-link')
  sendMagicLink(@Body('email') email: string) {
    return this.authService.sendMagicLink(email);
  }

  
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: any, @Res() res: any) {
    try {
      if (!req.user) throw new InternalServerErrorException('No user from Google');
      const token = await this.authService.generateToken(req.user);


      const userData = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'user'
      };

      const encodedUserData = encodeURIComponent(JSON.stringify(userData));
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

      return res.redirect(
        `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&user=${encodedUserData}`,
      );
    } catch (err) {
      console.error('Google login error:', err);
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
      const message =
        err instanceof Error ? err.message : 'Google login failed. Please try again.';
      return res.redirect(
        `${frontendUrl}/auth/callback?error=${encodeURIComponent(message)}`,
      );
    }
  }
}

