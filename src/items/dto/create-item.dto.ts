import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType, Currency, BlurType } from '../entities/item.enum';

export class CreateItemDto {
  @ApiProperty({ example: 'Lost Mobile' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Electronics' })
  @IsString()
  category: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiProperty({ enum: ItemType })
  @IsEnum(ItemType)
  type: ItemType;

  @ApiProperty({ example: 'Kathmandu' })
  @IsString()
  location: string;

  @ApiPropertyOptional({ example: 27.7172 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: 85.3240 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sensitive?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  sensitiveBlur?: boolean = true;

  @ApiPropertyOptional({ enum: BlurType, example: BlurType.FULL_IMAGE })
  @IsOptional()
  @IsEnum(BlurType)
  blurType?: BlurType = BlurType.FULL_IMAGE;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  reward: number;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({ type: 'string', format: 'binary' })
  @IsOptional()
  imageFront?: Express.Multer.File;

  @ApiPropertyOptional({ type: 'string', format: 'binary' })
  @IsOptional()
  imageBack?: Express.Multer.File;
}