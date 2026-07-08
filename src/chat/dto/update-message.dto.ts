import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateMessageDto {
  @ApiProperty({
    example: 'Updated message text',
    description: 'New message content',
  })
  @IsOptional()
  @IsString()
  content?: string;
}

