import { Controller, Get, Param, Query } from '@nestjs/common'
import { WordpressService, WordPressPost, SiteSettings } from './wordpress.service'

@Controller('api/wordpress')
export class WordpressController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Get('posts')
  async getPosts(@Query('limit') limit?: string, @Query('page') page?: string): Promise<WordPressPost[]> {
    const limitNum = limit ? parseInt(limit, 10) : 10
    const pageNum = page ? parseInt(page, 10) : 1
    return this.wordpressService.getPosts(limitNum, pageNum)
  }

  @Get('post/:slug')
  async getPost(@Param('slug') slug: string): Promise<WordPressPost | null> {
    return this.wordpressService.getPost(slug)
  }

  @Get('game-ref-code')
  async getGameRefCode(@Query('code') code: string): Promise<WordPressPost | null> {
    if (!code || code.trim() === '') {
      throw new Error('Code parameter is required')
    }
    return this.wordpressService.getGameRefCodeByCode(code.trim())
  }

  @Get('site-settings')
  async getSiteSettings(): Promise<SiteSettings | null> {
    return this.wordpressService.getSiteSettings()
  }
}
