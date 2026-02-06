import { Injectable } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Cache } from 'cache-manager'
import axios, { AxiosInstance } from 'axios'
import { ConfigService } from '@nestjs/config'

export interface WordPressPost {
  id: number
  title: string
  content: string
  excerpt: string
  date: string
  modified: string
  slug: string
  featuredImage: string | null
  author: string
}

@Injectable()
export class WordpressService {
  private readonly wpClient: AxiosInstance

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    const wpUrl = this.configService.get<string>('WORDPRESS_URL', 'http://wordpress:80')
    this.wpClient = axios.create({
      baseURL: wpUrl,
      timeout: 10000,
    })
  }

  async getPosts(limit = 10, page = 1): Promise<WordPressPost[]> {
    const cacheKey = `wp:posts:${limit}:${page}`
    const cached = await this.cacheManager.get<WordPressPost[]>(cacheKey)
    if (cached) {
      return cached
    }

    try {
      const response = await this.wpClient.get('/wp-json/wp/v2/posts', {
        params: {
          per_page: limit,
          page,
          _embed: true,
        },
      })

      const posts: WordPressPost[] = response.data.map((post: {
        id: number
        title?: { rendered?: string }
        content?: { rendered?: string }
        excerpt?: { rendered?: string }
        date: string
        modified: string
        slug: string
        _embedded?: {
          'wp:featuredmedia'?: Array<{ source_url?: string }>
          author?: Array<{ name?: string }>
        }
      }) => ({
        id: post.id,
        title: post.title?.rendered || '',
        content: post.content?.rendered || '',
        excerpt: post.excerpt?.rendered || '',
        date: post.date,
        modified: post.modified,
        slug: post.slug,
        featuredImage: post._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
        author: post._embedded?.author?.[0]?.name || '',
      }))

      await this.cacheManager.set(cacheKey, posts, 600) // Cache for 10 minutes
      return posts
    } catch (error) {
      console.error('WordPress API error:', error)
      return []
    }
  }

  async getPost(slug: string): Promise<WordPressPost | null> {
    const cacheKey = `wp:post:${slug}`
    const cached = await this.cacheManager.get<WordPressPost>(cacheKey)
    if (cached) {
      return cached
    }

    try {
      const response = await this.wpClient.get(`/wp-json/wp/v2/posts`, {
        params: {
          slug,
          _embed: true,
        },
      })

      if (response.data.length === 0) {
        return null
      }

      const post = response.data[0] as {
        id: number
        title?: { rendered?: string }
        content?: { rendered?: string }
        excerpt?: { rendered?: string }
        date: string
        modified: string
        slug: string
        _embedded?: {
          'wp:featuredmedia'?: Array<{ source_url?: string }>
          author?: Array<{ name?: string }>
        }
      }
      const formatted: WordPressPost = {
        id: post.id,
        title: post.title?.rendered || '',
        content: post.content?.rendered || '',
        excerpt: post.excerpt?.rendered || '',
        date: post.date,
        modified: post.modified,
        slug: post.slug,
        featuredImage: post._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
        author: post._embedded?.author?.[0]?.name || '',
      }

      await this.cacheManager.set(cacheKey, formatted, 600)
      return formatted
    } catch (error) {
      console.error('WordPress API error:', error)
      return null
    }
  }
}
