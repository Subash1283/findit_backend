import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({
    example: 'Hello, is this item still available?',
    description: 'Message content',
  })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiProperty({
    example: 2,
    description: 'Receiver user ID',
  })
  @IsNotEmpty()
  @IsNumber()
  receiverId: number;

  @ApiProperty({
    example: 10,
    description: 'Related item ID',
  })
  @IsNotEmpty()
  @IsNumber()
  itemId: number;
}