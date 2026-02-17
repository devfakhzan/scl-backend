import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  
  // Log Socket.IO namespace before adapter initialization
  console.log(`[main.ts] SOCKET_IO_NAMESPACE env var: ${process.env.SOCKET_IO_NAMESPACE || 'not set'}`)
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }))
  
  // Use standard Socket.IO adapter AFTER pipes but BEFORE listen
  // This ensures Socket.IO HTTP handler is mounted before Express catch-all
  const ioAdapter = new IoAdapter(app)
  app.useWebSocketAdapter(ioAdapter)
  
  // Log after adapter is set up
  console.log(`[main.ts] Socket.IO adapter initialized`)
  
  // Force initialization of Socket.IO namespaces before server starts
  // This ensures namespace HTTP handlers are mounted
  const namespace = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
  if (namespace && namespace !== '/') {
    try {
      // Get the HTTP server - it should exist after adapter is set up
      const httpServer = app.getHttpServer()
      console.log(`[main.ts] HTTP server obtained, looking for Socket.IO instance...`)
      
      // Try multiple ways to access the Socket.IO instance
      const io = (httpServer as any).io || (httpServer as any)._io || (httpServer as any).socketio
      if (io) {
        console.log(`[main.ts] Found Socket.IO instance, accessing namespace: ${namespace}`)
        // Access the namespace to force its initialization and HTTP handler mounting
        const nsp = io.of(namespace)
        console.log(`[main.ts] ✅ Initialized Socket.IO namespace: ${namespace}`)
      } else {
        console.warn(`[main.ts] ⚠️ Socket.IO instance not found on HTTP server. Available keys: ${Object.keys(httpServer).join(', ')}`)
      }
    } catch (e: any) {
      console.error(`[main.ts] ❌ Could not pre-initialize namespace ${namespace}: ${e.message}`)
      console.error(`[main.ts] Error stack: ${e.stack}`)
    }
  }
  
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost', // For nginx proxy on port 80
      'https://staging.shadowcombatleague.com',
      'https://www.staging.shadowcombatleague.com',
      'https://shadowcombatleague.com',
      'https://www.shadowcombatleague.com',
    ],
    credentials: true,
  })
  
  // Note: PrismaService handles database connection in onModuleInit
  // Prisma Client generation is handled in package.json scripts (prisma generate)
  // Migrations should be run explicitly: yarn prisma:migrate (dev) or yarn prisma:migrate:deploy (prod)
  
  const port = process.env.PORT || 3333
  await app.listen(port, '0.0.0.0')
  console.log(`Application is running on: http://0.0.0.0:${port}`)
}
bootstrap()
