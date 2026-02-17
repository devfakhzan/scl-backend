import { Module } from '@nestjs/common'
import { TestWebSocketGateway } from './test-websocket.gateway'

@Module({
  providers: [TestWebSocketGateway],
})
export class TestWebSocketModule {}
