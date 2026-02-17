import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { KickChatService } from './kick-chat.service'

// Namespace is determined at runtime from environment variable
// Local: /kick-chat, Staging/Production: /api/kick-chat
const getNamespace = () => {
  return process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
}

@WebSocketGateway({
  cors: {
    origin: '*', // In production, specify your frontend URL
    credentials: true,
  },
  namespace: getNamespace(),
})
export class KickChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(KickChatGateway.name)
  private clientChannels: Map<string, string> = new Map() // socketId -> channelName

  constructor(
    private readonly kickChatService: KickChatService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    // Log the namespace being used (read from env at runtime)
    const namespace = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
    this.logger.log(`Socket.IO namespace configured: ${namespace}`)
    this.logger.log(`Socket.IO server should be listening at: ${namespace}/socket.io/`)
    
    // Verify the server is actually using this namespace
    const serverNamespaces = this.server ? Object.keys(this.server.nsps || {}) : []
    this.logger.log(`Socket.IO server namespaces: ${JSON.stringify(serverNamespaces)}`)
    this.logger.log(`Current server namespace path: ${this.server?.name || 'unknown'}`)
    
    // Listen for messages from Kick chat service via EventEmitter
    this.eventEmitter.on('kick-chat.message', ({ channelName, message }) => {
      // Log first few messages to debug color data
      if (Math.random() < 0.05) { // Log ~5% of messages
        this.logger.log(`Sending message to frontend: username=${message.username}, color=${message.color || 'undefined'}`)
      }
      // Broadcast message to all clients subscribed to this channel
      this.server.emit(`chat:${channelName}`, message)
    })

    this.eventEmitter.on('kick-chat.ready', (channelName: string) => {
      this.logger.log(`Kick chat ready for channel: ${channelName}`)
      this.server.emit(`chat:${channelName}:ready`, { channelName })
    })

    this.eventEmitter.on('kick-chat.error', ({ channelName, error }) => {
      this.logger.error(`Kick chat error for channel ${channelName}:`, error)
      this.server.emit(`chat:${channelName}:error`, { channelName, error: error?.message || 'Unknown error' })
    })
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    const channelName = this.clientChannels.get(client.id)
    if (channelName) {
      this.logger.log(`Client ${client.id} disconnected from channel: ${channelName}`)
      this.clientChannels.delete(client.id)
    } else {
      this.logger.log(`Client disconnected: ${client.id}`)
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() data: { channelName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { channelName } = data

    if (!channelName) {
      client.emit('error', { message: 'Channel name is required' })
      return
    }

    try {
      this.logger.log(`Client ${client.id} subscribing to channel: ${channelName}`)

      // Connect to Kick chat if not already connected
      if (!this.kickChatService.isConnected(channelName)) {
        const connected = await this.kickChatService.connect(channelName, true)
        if (!connected) {
          client.emit('error', { message: `Failed to connect to Kick chat for channel: ${channelName}` })
          return
        }
      }

      // Store the client's channel subscription
      this.clientChannels.set(client.id, channelName)

      // Join the channel room
      client.join(`channel:${channelName}`)

      // Notify client of successful subscription
      client.emit('subscribed', { channelName })

      this.logger.log(`Client ${client.id} successfully subscribed to channel: ${channelName}`)
    } catch (error) {
      this.logger.error(`Error subscribing client ${client.id} to channel ${channelName}:`, error)
      client.emit('error', { message: `Error subscribing to channel: ${error.message}` })
    }
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() data: { channelName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { channelName } = data

    this.logger.log(`Client ${client.id} unsubscribing from channel: ${channelName}`)

    // Leave the channel room
    client.leave(`channel:${channelName}`)

    // Remove client's channel subscription
    if (this.clientChannels.get(client.id) === channelName) {
      this.clientChannels.delete(client.id)
    }

    client.emit('unsubscribed', { channelName })
  }
}
