import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google.strategy';
import { UsersModule } from 'src/users/user.module';
import { ResetPasswordModule } from '../reset-password/resetpassword.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    UsersModule, 
    ResetPasswordModule,
JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'), // ✅ STRICT
    signOptions: { expiresIn: config.get('JWT_EXPIRE') || '1d' },
  }),
}),

  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy], 
  exports: [AuthService],
}) 
export class AuthModule {}
