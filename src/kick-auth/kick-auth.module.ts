import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { KickAuthService } from './kick-auth.service'
import { KickAuthController } from './kick-auth.controller'

@Module({
  imports: [ConfigModule],
  controllers: [KickAuthController],
  providers: [KickAuthService],
})
export class KickAuthModule {}

