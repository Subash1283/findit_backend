import { IsOptional, IsString } from 'class-validator';

export class CreateClaimRequestDto {
  @IsOptional()
  @IsString()
  proofMessage?: string;
}
