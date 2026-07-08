import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './user.service';
import { UsersController } from './users.controller';
import { User } from './entity/user.entity';
import { AIModule } from '../module/ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AIModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], 
})
export class UsersModule {}
