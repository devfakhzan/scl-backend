import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { ApiIoAdapter } from './adapters/api-io.adapter'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  
  // Get Express instance to add middleware BEFORE Socket.IO adapter
  const expressApp = app.getHttpAdapter().getInstance()
  
  // Middleware to rewrite /api/kick-chat paths BEFORE Socket.IO processes them
  // This must run before the Socket.IO adapter is initialized
  expressApp.use((req, res, next) => {
    if (req.url && req.url.includes('/api/kick-chat/socket.io')) {
      req.url = req.url.replace('/api/kick-chat', '/kick-chat')
    }
    next()
  })
  
  // Use custom Socket.IO adapter that handles /api prefix from ingress
  // The adapter rewrites /api/kick-chat paths to /kick-chat at the Socket.IO engine level
  app.useWebSocketAdapter(new ApiIoAdapter(app))
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }))
  
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
