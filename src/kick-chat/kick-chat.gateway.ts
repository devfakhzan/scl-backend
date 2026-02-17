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
// IMPORTANT: Use simple namespace path /kick-chat (not /api/kick-chat)
// Ingress has a dedicated route for /kick-chat that forwards directly to backend
// This avoids Socket.IO namespace path conflicts with Express routing
// Local: /kick-chat, Staging/Production: /kick-chat (same for all environments)
// This is evaluated when the module is loaded, so env var must be set before app starts
const NAMESPACE = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
console.log(`[KickChatGateway] Module loading - namespace will be: ${NAMESPACE}, env var: ${process.env.SOCKET_IO_NAMESPACE || 'not set'}`)

@WebSocketGateway({
  cors: {
    origin: '*', // In production, specify your frontend URL
    credentials: true,
  },
  namespace: NAMESPACE,
  path: '/socket.io', // Socket.IO HTTP handler path (default, but explicit for clarity)
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
    if (this.server) {
      const serverAny = this.server as any
      this.logger.log(`Namespace server exists: ${!!this.server}`)
      this.logger.log(`Namespace server name: ${serverAny.name || 'unknown'}`)
      
      // Try multiple ways to access the main server
      const mainServer = serverAny.server || serverAny._server || (this.server as any).io || (this.server as any).parent
      if (mainServer) {
        const mainServerAny = mainServer as any
        const registeredNamespaces = mainServerAny._nsps ? Object.keys(mainServerAny._nsps) : []
        this.logger.log(`Socket.IO main server registered namespaces: ${JSON.stringify(registeredNamespaces)}`)
        this.logger.log(`Main server _nsps object: ${mainServerAny._nsps ? 'exists' : 'missing'}`)
        
        // Try to access the namespace directly
        if (mainServerAny._nsps && mainServerAny._nsps[namespace]) {
          this.logger.log(`✅ Namespace ${namespace} found in _nsps`)
        } else {
          this.logger.warn(`❌ Namespace ${namespace} NOT found in _nsps`)
          // List all keys in _nsps
          if (mainServerAny._nsps) {
            const allKeys = Object.keys(mainServerAny._nsps)
            this.logger.log(`All _nsps keys: ${JSON.stringify(allKeys)}`)
          }
          
          // Try to manually access/register the namespace
          this.logger.log(`Attempting to manually access namespace ${namespace} via .of()...`)
          try {
            const nsp = mainServerAny.of(namespace)
            if (nsp) {
              this.logger.log(`✅ Successfully accessed namespace ${namespace} via .of()`)
              // Force register the namespace by adding it to _nsps if it's not there
              // Socket.IO lazy-loads namespaces, so we need to ensure it's registered
              if (!mainServerAny._nsps[namespace]) {
                this.logger.log(`Forcing namespace registration in _nsps...`)
                mainServerAny._nsps[namespace] = nsp
                const updatedKeys = mainServerAny._nsps ? Object.keys(mainServerAny._nsps) : []
                this.logger.log(`Updated _nsps keys after manual registration: ${JSON.stringify(updatedKeys)}`)
              } else {
                const updatedKeys = mainServerAny._nsps ? Object.keys(mainServerAny._nsps) : []
                this.logger.log(`Namespace already in _nsps: ${JSON.stringify(updatedKeys)}`)
              }
            }
          } catch (e: any) {
            this.logger.error(`❌ Failed to access namespace ${namespace}: ${e.message}`)
            this.logger.error(`Error stack: ${e.stack}`)
          }
        }
      } else {
        this.logger.warn('Could not find main Socket.IO server')
        this.logger.log(`serverAny.server: ${!!serverAny.server}, serverAny._server: ${!!serverAny._server}, this.server.io: ${!!(this.server as any).io}`)
      }
    } else {
      this.logger.warn('Socket.IO server not initialized yet')
    }
    
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
