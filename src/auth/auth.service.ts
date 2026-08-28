import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/user.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

import { MailerService } from '../reset-password/mailer.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {}

  
  async validateGoogleUser(googleId: string, email: string, name: string) {
    const user = await this.userService.findOrCreateGoogleUser(
      googleId,
      email,
      name,
    );

    if (!user) {
      throw new UnauthorizedException('Google authentication failed');
    }

    if (user.isSuspended) {
      throw new UnauthorizedException(`Account Suspended: ${user.suspensionReason || 'Contact support'}`);
    }

    const { password, ...safeUser } = user;
    return safeUser;
  }

  async generateToken(user: any) {
    if (!user || !user.id) {
      throw new UnauthorizedException('Invalid user for token generation');
    }

    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role || 'user',
    });
  }

  //  REGISTER
  async register(dto: any) {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email and password required');
    }

    const existingUser = await this.userService.findUserByEmail(dto.email);

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.userService.register({
      ...dto,
      password: hashedPassword,
    });

    const token = await this.generateToken(user);

    const { password, ...safeUser } = user;

    return {
      message: 'User registered successfully',
      access_token: token,
      user: safeUser,
    };
  }

  // LOGIN
  async login(dto: any) {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email and password required');
    }

    const user = await this.userService.findUserByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isSuspended) {
      throw new UnauthorizedException(`Account Suspended: ${user.suspensionReason || 'Contact support'}`);
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'Use Google login for this account',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = await this.generateToken(user);

    const { password: _, ...safeUser } = user;

    return {
      message: 'Login successful',
      access_token: token,
      user: safeUser,
    };
  }

  async sendMagicLink(email: string) {
    if (!email) {
      throw new BadRequestException('Email address is required');
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await this.userService.findUserByEmail(cleanEmail);
    if (!user) {
      throw new BadRequestException(`No registered account found with email "${cleanEmail}". Please Sign Up first.`);
    }

    if (user.isSuspended) {
      throw new UnauthorizedException(`Account Suspended: ${user.suspensionReason || 'Contact support'}`);
    }

    const token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role || 'user' },
      { expiresIn: '15m' },
    );

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'user',
    };
    const magicLink = `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(userData))}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; background: #ffffff;">
        <h2 style="color: #1e3a8a; text-align: center; font-size: 22px; margin-bottom: 8px;">🔐 FindIt One-Click Login Link</h2>
        <p style="color: #475569; font-size: 15px; text-align: center;">Hello <b>${user.name}</b>,</p>
        <p style="color: #475569; font-size: 14px; text-align: center; line-height: 1.5;">
          Click the button below to instantly sign in to your FindIt account without typing a password.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${magicLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; font-weight: bold; border-radius: 10px; text-decoration: none; display: inline-block; font-size: 16px; box-shadow: 0 4px 12px rgba(37,99,235,0.3);">
            🚀 Click Here to Log In
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">This magic link is valid for 15 minutes. If you did not request this link, please ignore this email.</p>
      </div>
    `;

    try {
      await this.mailerService.sendMail(user.email, '🔐 FindIt One-Click Magic Login Link', htmlContent);
    } catch (err) {
      console.warn('SMTP error sending magic link:', err);
    }

    return {
      message: `Magic Login Link sent to ${user.email}! Please check your inbox.`,
      magicLink,
    };
  }
}