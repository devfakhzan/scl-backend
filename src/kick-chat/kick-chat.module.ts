import { Module } from '@nestjs/common'
import { KickChatService } from './kick-chat.service'
import { KickChatGateway } from './kick-chat.gateway'

@Module({
  providers: [KickChatService, KickChatGateway],
  exports: [KickChatService, KickChatGateway], // Export gateway so it's discovered
})
export class KickChatModule {}
