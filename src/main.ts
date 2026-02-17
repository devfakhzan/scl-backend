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
  
  // Force initialization of Socket.IO namespaces AFTER adapter but BEFORE listen
  // Access the Socket.IO instance from the adapter to initialize namespaces
  const namespace = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
  if (namespace && namespace !== '/') {
    try {
      // Get the HTTP server
      const httpServer = app.getHttpServer()
      
      // Access Socket.IO instance - it should be attached after adapter initialization
      // Try to get it from the adapter's internal server
      const adapterAny = ioAdapter as any
      const io = adapterAny.io || adapterAny._io || (httpServer as any).io || (httpServer as any)._io
      
      if (io) {
        console.log(`[main.ts] Found Socket.IO instance, initializing namespace: ${namespace}`)
        // Force namespace initialization by accessing it
        const nsp = io.of(namespace)
        console.log(`[main.ts] ✅ Namespace ${namespace} initialized, HTTP handler should be mounted`)
      } else {
        // If not found, try after listen - but this is less ideal
        console.warn(`[main.ts] ⚠️ Socket.IO instance not immediately available, will initialize after listen`)
      }
    } catch (e: any) {
      console.error(`[main.ts] ❌ Error initializing namespace: ${e.message}`)
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
  
  // After listen, ensure namespace is initialized if it wasn't before
  const namespace = process.env.SOCKET_IO_NAMESPACE || '/kick-chat'
  if (namespace && namespace !== '/') {
    try {
      const httpServer = app.getHttpServer()
      const io = (httpServer as any).io || (httpServer as any)._io
      if (io) {
        const nsp = io.of(namespace)
        console.log(`[main.ts] ✅ Post-listen: Namespace ${namespace} confirmed initialized`)
      }
    } catch (e: any) {
      console.error(`[main.ts] ❌ Post-listen namespace init error: ${e.message}`)
    }
  }
}
bootstrap()
