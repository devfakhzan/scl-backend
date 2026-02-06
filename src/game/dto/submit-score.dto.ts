import { IsString, IsNumber, IsOptional, Min } from 'class-validator'

export class SubmitScoreDto {
  @IsString()
  walletAddress: string

  @IsNumber()
  @Min(0)
  score: number

  @IsOptional()
  @IsString()
  gameData?: string
}
