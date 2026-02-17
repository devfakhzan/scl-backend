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

export interface SiteSettings {
  isLive: boolean
  kickUsername: string | null
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

  async getGameRefCodeByCode(code: string): Promise<WordPressPost | null> {
    // Search by slug (case-insensitive)
    const searchSlug = code.toLowerCase()
    const cacheKey = `wp:game_ref_code:${searchSlug}`
    const cached = await this.cacheManager.get<WordPressPost>(cacheKey)
    if (cached) {
      return cached
    }

    try {
      // Search by slug first (exact match, case-insensitive)
      let response = await this.wpClient.get(`/wp-json/wp/v2/game_ref_code`, {
        params: {
          slug: searchSlug,
          _embed: true,
        },
      })

      // If no match by slug, try searching by title
      if (response.data.length === 0) {
        response = await this.wpClient.get(`/wp-json/wp/v2/game_ref_code`, {
          params: {
            search: code,
            _embed: true,
            per_page: 1,
          },
        })
      }

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
      console.error('WordPress API error (game_ref_code):', error)
      return null
    }
  }

  async getSiteSettings(): Promise<SiteSettings | null> {
    console.log('[getSiteSettings] Starting site settings fetch...')
    const cacheKey = 'wp:site_settings'
    const cached = await this.cacheManager.get<SiteSettings>(cacheKey)
    if (cached) {
      console.log('[getSiteSettings] Returning cached settings')
      return cached
    }
    console.log('[getSiteSettings] Cache miss, fetching from WordPress...')

    try {
      // Get the scl_site_settings post type (should only be 1 post)
      const settingsResponse = await this.wpClient.get('/wp-json/wp/v2/scl_site_settings', {
        params: {
          per_page: 1,
          _embed: true,
        },
      })

      if (settingsResponse.data.length === 0) {
        return {
          isLive: false,
          kickUsername: null,
        }
      }

      const settingsPost = settingsResponse.data[0] as {
        id: number
        acf?: {
          livestream_live?: boolean | string | number
          kick_username?: string
        }
        meta?: {
          livestream_live?: string[]
          kick_username?: string[]
        }
      }

      // Extract livestream_live and fallback kick_username from site settings
      let isLive = false
      let fallbackKickUsername: string | null = null

      if (settingsPost.acf) {
        const isLiveValue = settingsPost.acf.livestream_live
        isLive = isLiveValue === true || isLiveValue === '1' || isLiveValue === 1 || isLiveValue === 'true'
        fallbackKickUsername = settingsPost.acf.kick_username || null
      } else if (settingsPost.meta) {
        isLive = settingsPost.meta.livestream_live?.[0] === '1' || settingsPost.meta.livestream_live?.[0] === 'true'
        fallbackKickUsername = settingsPost.meta.kick_username?.[0] || null
      }

      // If ACF not exposed, try fetching ACF fields directly via ACF REST API
      if (!settingsPost.acf && !settingsPost.meta) {
        try {
          const acfResponse = await this.wpClient.get(`/wp-json/acf/v3/scl_site_settings/${settingsPost.id}`)
          if (acfResponse.data && acfResponse.data.acf) {
            const isLiveValue = acfResponse.data.acf.livestream_live
            isLive = isLiveValue === true || isLiveValue === '1' || isLiveValue === 1 || isLiveValue === 'true'
            fallbackKickUsername = acfResponse.data.acf.kick_username || null
          }
        } catch (acfError) {
          // ACF REST API might not be available, that's okay
          console.warn('ACF REST API not available, using defaults')
        }
      }

      // If livestream_live is true, check for active livestreams
      let kickUsername: string | null = fallbackKickUsername

      console.log(`[getSiteSettings] isLive: ${isLive}, fallbackKickUsername: ${fallbackKickUsername}`)

      if (isLive) {
        console.log('[getSiteSettings] isLive is true, checking for active livestreams...')
        try {
          // Get all livestreams post type
          console.log('[getSiteSettings] Fetching livestreams from WordPress API...')
          const livestreamsResponse = await this.wpClient.get('/wp-json/wp/v2/livestreams', {
            params: {
              per_page: 100, // Get enough to check all active streams
              _embed: true,
            },
          })

          console.log(`[getSiteSettings] Received ${livestreamsResponse.data?.length || 0} livestream post(s) from WordPress`)

          const now = new Date()
          const currentTime = now.getTime()
          console.log(`[getSiteSettings] Current UTC time: ${now.toISOString()}`)

          // Find the first livestream that is currently active (between start and end)
          for (const livestream of livestreamsResponse.data) {
            const livestreamPost = livestream as {
              id: number
              acf?: {
                start?: string
                end?: string
                kick_username?: string
              }
              meta?: {
                start?: string[]
                end?: string[]
                kick_username?: string[]
              }
            }

            let startDate: Date | null = null
            let endDate: Date | null = null
            let livestreamKickUsername: string | null = null

            if (livestreamPost.acf) {
              if (livestreamPost.acf.start) {
                startDate = new Date(livestreamPost.acf.start)
              }
              if (livestreamPost.acf.end) {
                endDate = new Date(livestreamPost.acf.end)
              }
              livestreamKickUsername = livestreamPost.acf.kick_username || null
            } else if (livestreamPost.meta) {
              if (livestreamPost.meta.start?.[0]) {
                startDate = new Date(livestreamPost.meta.start[0])
              }
              if (livestreamPost.meta.end?.[0]) {
                endDate = new Date(livestreamPost.meta.end[0])
              }
              livestreamKickUsername = livestreamPost.meta.kick_username?.[0] || null
            }

            // If ACF not exposed, try ACF REST API
            if (!livestreamPost.acf && !livestreamPost.meta) {
              try {
                const acfResponse = await this.wpClient.get(`/wp-json/acf/v3/livestreams/${livestreamPost.id}`)
                if (acfResponse.data && acfResponse.data.acf) {
                  if (acfResponse.data.acf.start) {
                    startDate = new Date(acfResponse.data.acf.start)
                  }
                  if (acfResponse.data.acf.end) {
                    endDate = new Date(acfResponse.data.acf.end)
                  }
                  livestreamKickUsername = acfResponse.data.acf.kick_username || null
                }
              } catch (acfError) {
                // Continue to next livestream
              }
            }

            // Check if current time is between start and end
            if (startDate && endDate) {
              const startTime = startDate.getTime()
              const endTime = endDate.getTime()

              if (currentTime >= startTime && currentTime <= endTime) {
                // Found an active livestream
                if (livestreamKickUsername) {
                  kickUsername = livestreamKickUsername
                }
                break // Use the first active livestream found
              }
            } else if (startDate && !endDate) {
              // If only start date is set, consider it active if current time is after start
              const startTime = startDate.getTime()
              if (currentTime >= startTime) {
                if (livestreamKickUsername) {
                  kickUsername = livestreamKickUsername
                }
                break
              }
            }
          }
          } catch (livestreamsError) {
          console.error('[getSiteSettings] Error fetching livestreams:', livestreamsError)
          if (livestreamsError instanceof Error) {
            console.error('[getSiteSettings] Error message:', livestreamsError.message)
            console.error('[getSiteSettings] Error stack:', livestreamsError.stack)
          }
          // Continue with fallback username
        }
      }

      const settings: SiteSettings = {
        isLive,
        kickUsername,
      }

      await this.cacheManager.set(cacheKey, settings, 60) // Cache for 1 minute (settings change frequently)
      return settings
    } catch (error) {
      console.error('WordPress API error (site_settings):', error)
      return {
        isLive: false,
        kickUsername: null,
      }
    }
  }
}
