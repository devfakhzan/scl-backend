import { Body, Controller, Post } from '@nestjs/common'
import { KickAuthService } from './kick-auth.service'
import { ExchangeCodeDto } from './dto/exchange-code.dto'

@Controller('api/kick')
export class KickAuthController {
  constructor(private readonly kickAuthService: KickAuthService) {}

  /**
   * Exchange OAuth authorization code + PKCE verifier for an access token
   * Frontend calls this instead of talking to Kick directly.
   */
  @Post('oauth/token')
  async exchangeCode(@Body() body: ExchangeCodeDto) {
    const result = await this.kickAuthService.exchangeCodeForToken({
      code: body.code,
      codeVerifier: body.codeVerifier,
      redirectUri: body.redirectUri,
    })

    return {
      access_token: result.access_token,
    }
  }
}

