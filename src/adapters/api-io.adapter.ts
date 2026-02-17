import { IoAdapter } from '@nestjs/platform-socket.io'
import { ServerOptions } from 'socket.io'
import { INestApplication } from '@nestjs/common'
import * as http from 'http'

export class ApiIoAdapter extends IoAdapter {
  constructor(app: INestApplication) {
    super(app)
  }

  createIOServer(port: number, options?: ServerOptions): any {
    // Create the Socket.IO server
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
    })

    // Intercept HTTP requests at the engine level BEFORE Socket.IO processes them
    // This rewrites /api/kick-chat paths to /kick-chat so the namespace matches
    const originalHandleRequest = server.engine.handleRequest.bind(server.engine)
    
    server.engine.handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
      // Rewrite the URL if it contains /api/kick-chat
      if (req.url && req.url.includes('/api/kick-chat')) {
        const originalUrl = req.url
        req.url = originalUrl.replace('/api/kick-chat', '/kick-chat')
        
        // Update the parsed URL object if it exists
        const parsedUrl = (req as any)._parsedUrl
        if (parsedUrl) {
          if (parsedUrl.pathname) {
            parsedUrl.pathname = parsedUrl.pathname.replace('/api/kick-chat', '/kick-chat')
          }
          if (parsedUrl.path) {
            parsedUrl.path = parsedUrl.path.replace('/api/kick-chat', '/kick-chat')
          }
        }
      }
      
      // Call the original handler with the rewritten URL
      return originalHandleRequest(req, res)
    }

    return server
  }
}
