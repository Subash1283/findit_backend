import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/user.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
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
}