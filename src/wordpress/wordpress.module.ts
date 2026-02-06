import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { WordpressController } from './wordpress.controller'
import { WordpressService } from './wordpress.service'

@Module({
  imports: [HttpModule.register({ timeout: 10000 })],
  controllers: [WordpressController],
  providers: [WordpressService],
  exports: [WordpressService],
})
export class WordpressModule {}
