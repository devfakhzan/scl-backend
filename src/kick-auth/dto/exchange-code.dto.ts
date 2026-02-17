import { IsString } from 'class-validator'

export class ExchangeCodeDto {
  @IsString()
  code: string

  @IsString()
  codeVerifier: string

  @IsString()
  redirectUri: string
}

