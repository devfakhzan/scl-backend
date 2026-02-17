import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnModuleInit,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { Logger } from '@nestjs/common'

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  // No namespace = default namespace '/'
})
export class TestWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(TestWebSocketGateway.name)

  onModuleInit() {
    this.logger.log('TestWebSocketGateway onModuleInit called')
    this.logger.log(`Server exists: ${!!this.server}`)
    if (this.server) {
      const serverAny = this.server as any
      this.logger.log(`Server name: ${serverAny.name || 'unknown'}`)
      
      // Check main server
      const mainServer = serverAny.server || serverAny._server || (this.server as any).io || (this.server as any).parent
      if (mainServer) {
        const mainServerAny = mainServer as any
        const registeredNamespaces = mainServerAny._nsps ? Object.keys(mainServerAny._nsps) : []
        this.logger.log(`Registered namespaces: ${JSON.stringify(registeredNamespaces)}`)
      }
    }
  }

  handleConnection(client: Socket) {
    this.logger.log(`Test client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Test client disconnected: ${client.id}`)
  }
}
