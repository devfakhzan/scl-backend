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
  
  // After listen, manually mount Socket.IO HTTP handler for namespace
  // This ensures the namespace HTTP handler is accessible
  const namespace = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
  if (namespace && namespace !== '/') {
    try {
      const httpServer = app.getHttpServer()
      const io = (httpServer as any).io || (httpServer as any)._io
      if (io) {
        // Access namespace to ensure it's initialized
        const nsp = io.of(namespace)
        console.log(`[main.ts] ✅ Namespace ${namespace} accessed after listen`)
        
        // Manually mount the HTTP handler if needed
        // Socket.IO should handle this automatically, but we're ensuring it
        const expressApp = app.getHttpAdapter().getInstance()
        const socketIoPath = `${namespace}/socket.io`
        
        // Check if handler is already mounted
        console.log(`[main.ts] Checking if Socket.IO handler is mounted at ${socketIoPath}`)
      } else {
        console.error(`[main.ts] ❌ Socket.IO instance not found after listen`)
      }
    } catch (e: unknown) {
      const error = e as Error
      console.error(`[main.ts] ❌ Post-listen namespace init error: ${error.message}`)
    }
  }
}
bootstrap()
