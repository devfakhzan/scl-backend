import { Module } from '@nestjs/common'
import { KickChatService } from './kick-chat.service'
import { KickChatGateway } from './kick-chat.gateway'

@Module({
  providers: [KickChatService, KickChatGateway],
  exports: [KickChatService],
})
export class KickChatModule {}
