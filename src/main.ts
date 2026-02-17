import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { ServerOptions } from 'socket.io'
import { AppModule } from './app.module'

class SocketIOAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      path: '/api/socket.io',
      cors: { origin: '*', credentials: true },
    })
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }))
  
  app.useWebSocketAdapter(new SocketIOAdapter(app))
  
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost',
      'https://staging.shadowcombatleague.com',
      'https://www.staging.shadowcombatleague.com',
      'https://shadowcombatleague.com',
      'https://www.shadowcombatleague.com',
    ],
    credentials: true,
  })
  
  const port = process.env.PORT || 3333
  await app.listen(port, '0.0.0.0')
  console.log(`Application is running on: http://0.0.0.0:${port}`)
}
bootstrap()
