import { Injectable } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Cache } from 'cache-manager'
import axios, { AxiosInstance } from 'axios'
import { ConfigService } from '@nestjs/config'
import { fromZonedTime } from 'date-fns-tz'
import { parse } from 'date-fns'

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
  private wpTimezone: string | null = null
  private wpTimezoneCacheKey = 'wp:timezone'

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

  /**
   * Get WordPress timezone setting
   * Priority:
   * 1. WORDPRESS_TIMEZONE environment variable (recommended - set this to match WordPress admin timezone)
   * 2. Try WordPress REST API endpoint (if custom endpoint exists)
   * 3. Fall back to UTC
   */
  private async getWordPressTimezone(): Promise<string> {
    // Check cache first
    if (this.wpTimezone) {
      return this.wpTimezone
    }

    const cached = await this.cacheManager.get<string>(this.wpTimezoneCacheKey)
    if (cached) {
      this.wpTimezone = cached
      return cached
    }

    // First priority: Check environment variable
    const envTimezone = this.configService.get<string>('WORDPRESS_TIMEZONE')
    if (envTimezone) {
      this.wpTimezone = envTimezone
      await this.cacheManager.set(this.wpTimezoneCacheKey, this.wpTimezone, 3600) // Cache for 1 hour
      return this.wpTimezone
    }

    // Second priority: Try WordPress REST API endpoint (if it exists)
    try {
      const response = await this.wpClient.get('/wp-json/scl/v1/timezone', {
        timeout: 5000,
      })
      if (response.data && response.data.timezone) {
        this.wpTimezone = response.data.timezone
        await this.cacheManager.set(this.wpTimezoneCacheKey, this.wpTimezone, 3600)
        return this.wpTimezone
      }
    } catch (customEndpointError) {
      // Custom endpoint doesn't exist, that's okay
    }

    // Fallback: Default to UTC
    // Note: Set WORDPRESS_TIMEZONE environment variable to match WordPress admin timezone setting
    // (Settings → General → Timezone in WordPress admin)
    this.wpTimezone = 'UTC'
    await this.cacheManager.set(this.wpTimezoneCacheKey, this.wpTimezone, 3600)
    return this.wpTimezone
  }

  /**
   * Parse ACF datetime string in WordPress's timezone context
   * ACF returns datetime strings without timezone info, but they're in WordPress's local timezone
   */
  private async parseACFDateTime(dateTimeString: string): Promise<Date | null> {
    if (!dateTimeString) {
      return null
    }

    try {
      const wpTimezone = await this.getWordPressTimezone()
      console.log(`[parseACFDateTime] Parsing: "${dateTimeString}" in timezone: ${wpTimezone}`)

      // ACF typically returns datetime in format: "Y-m-d H:i:s" (e.g., "2026-02-17 14:00:00")
      // Parse it as if it's in WordPress's timezone
      const dateTimeStr = dateTimeString.trim()

      // Try to parse common ACF datetime formats
      let parsedDate: Date | null = null

      // Format: "Y-m-d H:i:s" (e.g., "2026-02-17 14:00:00")
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateTimeStr)) {
        // Parse components manually to avoid timezone interpretation
        const [datePart, timePart] = dateTimeStr.split(' ')
        const [year, month, day] = datePart.split('-').map(Number)
        const [hour, minute, second] = timePart.split(':').map(Number)
        // Create a date object with these components (will be treated as local time)
        // We'll use fromZonedTime to properly convert from WordPress timezone
        parsedDate = new Date(year, month - 1, day, hour, minute, second)
      }
      // Format: "Y-m-d H:i" (e.g., "2026-02-17 14:00")
      else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dateTimeStr)) {
        const [datePart, timePart] = dateTimeStr.split(' ')
        const [year, month, day] = datePart.split('-').map(Number)
        const [hour, minute] = timePart.split(':').map(Number)
        parsedDate = new Date(year, month - 1, day, hour, minute, 0)
      }
      // Format: ISO 8601 with timezone (e.g., "2026-02-17T14:00:00+00:00")
      else if (dateTimeStr.includes('T') || dateTimeStr.includes('Z') || dateTimeStr.includes('+') || dateTimeStr.includes('-')) {
        // If it already has timezone info, parse directly
        parsedDate = new Date(dateTimeStr)
        // If it has timezone info, return it directly (already in correct timezone)
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate
        }
      }
      // Try default Date parsing as fallback
      else {
        parsedDate = new Date(dateTimeStr)
      }

      if (!parsedDate || isNaN(parsedDate.getTime())) {
        console.warn(`Failed to parse ACF datetime: ${dateTimeString}`)
        return null
      }

      // If WordPress timezone is UTC, we can use the date directly
      if (wpTimezone === 'UTC' || wpTimezone === 'Etc/UTC') {
        return parsedDate
      }

      // Convert from WordPress timezone to UTC
      // fromZonedTime treats the Date object as if it represents a time in the specified timezone
      // and converts it to UTC
      const utcDate = fromZonedTime(parsedDate, wpTimezone)
      console.log(`[parseACFDateTime] Converted "${dateTimeString}" (${wpTimezone}) → ${utcDate.toISOString()} (UTC)`)
      return utcDate
    } catch (error) {
      console.error(`Error parsing ACF datetime "${dateTimeString}":`, error)
      // Fallback to simple Date parsing
      try {
        return new Date(dateTimeString)
      } catch {
        return null
      }
    }
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
          const livestreamsResponse = await this.wpClient.get('/wp-json/wp/v2/livestreams', {
            params: {
              per_page: 100, // Get enough to check all active streams
              _embed: true,
            },
          })

          const now = new Date()
          const currentTime = now.getTime()

          console.log(`[Livestream Check] Found ${livestreamsResponse.data.length} livestream post(s)`)
          
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
              console.log(`[Livestream Check] Post ID ${livestreamPost.id} - Using ACF fields`)
              console.log(`  ACF data:`, JSON.stringify(livestreamPost.acf, null, 2))
              if (livestreamPost.acf.start) {
                startDate = await this.parseACFDateTime(livestreamPost.acf.start)
              }
              if (livestreamPost.acf.end) {
                endDate = await this.parseACFDateTime(livestreamPost.acf.end)
              }
              livestreamKickUsername = livestreamPost.acf.kick_username || null
            } else if (livestreamPost.meta) {
              console.log(`[Livestream Check] Post ID ${livestreamPost.id} - Using meta fields`)
              console.log(`  Meta data:`, JSON.stringify(livestreamPost.meta, null, 2))
              if (livestreamPost.meta.start?.[0]) {
                startDate = await this.parseACFDateTime(livestreamPost.meta.start[0])
              }
              if (livestreamPost.meta.end?.[0]) {
                endDate = await this.parseACFDateTime(livestreamPost.meta.end[0])
              }
              livestreamKickUsername = livestreamPost.meta.kick_username?.[0] || null
            }

            // If ACF not exposed, try ACF REST API
            if (!livestreamPost.acf && !livestreamPost.meta) {
              try {
                const acfResponse = await this.wpClient.get(`/wp-json/acf/v3/livestreams/${livestreamPost.id}`)
                if (acfResponse.data && acfResponse.data.acf) {
                  if (acfResponse.data.acf.start) {
                    startDate = await this.parseACFDateTime(acfResponse.data.acf.start)
                  }
                  if (acfResponse.data.acf.end) {
                    endDate = await this.parseACFDateTime(acfResponse.data.acf.end)
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

              console.log(`[Livestream Check] Post ID: ${livestreamPost.id}`)
              console.log(`  Start (raw): ${livestreamPost.acf?.start || livestreamPost.meta?.start?.[0]}`)
              console.log(`  End (raw): ${livestreamPost.acf?.end || livestreamPost.meta?.end?.[0]}`)
              console.log(`  Start (parsed UTC): ${startDate.toISOString()}`)
              console.log(`  End (parsed UTC): ${endDate.toISOString()}`)
              console.log(`  Current (UTC): ${new Date(currentTime).toISOString()}`)
              console.log(`  Comparison: ${currentTime} >= ${startTime} && ${currentTime} <= ${endTime}`)
              console.log(`  Result: ${currentTime >= startTime && currentTime <= endTime}`)

              if (currentTime >= startTime && currentTime <= endTime) {
                // Found an active livestream
                console.log(`  ✓ Livestream is ACTIVE! Using kick_username: ${livestreamKickUsername}`)
                if (livestreamKickUsername) {
                  kickUsername = livestreamKickUsername
                }
                break // Use the first active livestream found
              } else {
                console.log(`  ✗ Livestream is NOT active (outside time range)`)
              }
            } else if (startDate && !endDate) {
              // If only start date is set, consider it active if current time is after start
              const startTime = startDate.getTime()
              console.log(`[Livestream Check] Post ID: ${livestreamPost.id} (no end time)`)
              console.log(`  Start (parsed UTC): ${startDate.toISOString()}`)
              console.log(`  Current (UTC): ${new Date(currentTime).toISOString()}`)
              console.log(`  Comparison: ${currentTime} >= ${startTime}`)
              if (currentTime >= startTime) {
                console.log(`  ✓ Livestream is ACTIVE! (started, no end time)`)
                if (livestreamKickUsername) {
                  kickUsername = livestreamKickUsername
                }
                break
              } else {
                console.log(`  ✗ Livestream has not started yet`)
              }
            } else {
              console.log(`[Livestream Check] Post ID: ${livestreamPost.id} - Missing start/end dates`)
            }
          }
        } catch (livestreamsError) {
          console.error('Error fetching livestreams:', livestreamsError)
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
