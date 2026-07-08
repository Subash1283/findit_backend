import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { Item } from './entities/item.entity';

import { Dispute } from './entities/dispute.entity';
import { UsersModule } from '../users/user.module';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer'; 
import { UpdateItemDto } from './dto/update-item.dto';
import { NotificationsModule } from '../notifications/notifications.module';
import { ResetPasswordModule } from '../reset-password/resetpassword.module';
import { AIModule } from '../module/ai/ai.module';

import { ClaimRequest } from './entities/claim-request.entity';
import { ItemsCleanupService } from './items.cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Item, Dispute, ClaimRequest]),
    UsersModule,
    NotificationsModule,
    ResetPasswordModule,
    AIModule,

    //  File upload config
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/items',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);

          const ext = file.originalname.substring(
            file.originalname.lastIndexOf('.'),
          );

          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  ],

  controllers: [ItemsController],
  providers: [ItemsService, ItemsCleanupService],
  exports: [ItemsService],
})
export class ItemsModule {}