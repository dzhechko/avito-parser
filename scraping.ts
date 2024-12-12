//@ts-ignore
import * as fs from 'fs'
import FirecrawlApp from '@mendable/firecrawl-js'
import 'dotenv/config'
import { config } from 'dotenv'
import { z } from 'zod'
import { setTimeout } from 'timers/promises';

config()

// Добавим вспомогательную функцию для задержки
async function delay(ms: number) {
  await setTimeout(ms);
}

// Функция для повторных попыток с экспоненциальной задержкой
async function retryWithBackoff(
  fn: () => Promise<any>,
  retries = 3,
  baseDelay = 2000,
) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error?.message?.includes('429') && i < retries - 1) {
        const waitTime = baseDelay * Math.pow(2, i);
        console.log(`Rate limited. Waiting ${waitTime}ms before retry ${i + 1}/${retries}`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
}

export async function scrapeAvito() {
  try {
    // Initialize the FirecrawlApp with your API key
    const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY })

    // Define the URL to crawl
    const listingsUrl =
      // 'https://www.airbnb.com/s/San-Francisco--CA--United-States/homes'
      'https://www.avito.ru/moskva_i_mo/kvartiry/prodam/vtorichka/big-kitchen-ASgBAgECAkSSA8YQ5geMUgFFrCoVeyJmcm9tIjoxMCwidG8iOm51bGx9?context=&localPriority=0&metro=11'
    // const baseUrl = 'https://www.airbnb.com'
    const baseUrl = 'https://www.avito.ru'
    // Define schema to extract pagination links
    const paginationSchema = z.object({
      page_links: z
        .array(
          z.object({
            link: z.string(),
          })
        )
        .describe('Pagination links in the bottom of the page.'),
    })

    const params2 = {
      pageOptions: {
        onlyMainContent: false,
        waitForSelector: '.pagination-root-Ntd_O',
        waitForTimeout: 5000,
      },
      extractorOptions: { 
        extractionSchema: paginationSchema,
        retries: 3,
      },
      timeout: 120000,
    }

    // Start crawling to get pagination links
    let linksData;
    try {
      linksData = await app.scrapeUrl(listingsUrl, params2)
      console.log('Successfully fetched pagination data')
    } catch (error) {
      console.error('Failed to fetch pagination:', error.message)
      // Если не удалось получить пагинацию, пробуем хотя бы первую страницу
      linksData = { data: { llm_extraction: { page_links: [] } } }
    }
    console.log(linksData.data['llm_extraction'])

    let paginationLinks = linksData.data['llm_extraction'].page_links.map(
      (link) => baseUrl + link.link
    )

    // Just in case is not able to get the pagination links
    if (paginationLinks.length === 0) {
      paginationLinks = [listingsUrl]
    }

    // Define schema to extract listings
    const schema = z.object({
      listings: z
        .array(
          z.object({
            title: z.string(),
            price: z.preprocess(
              // Конвертируем строку цены в число
              (val) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                  // Удаляем все нечисловые символы кроме точки
                  return Number(val.replace(/[^0-9.]/g, ''));
                }
                return null;
              },
              z.number()
            ),
            location: z.string(),
            area: z.preprocess(
              (val) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                  return Number(val.replace(/[^0-9.]/g, ''));
                }
                return null;
              },
              z.number().optional()
            ),
            rooms: z.preprocess(
              (val) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                  return Number(val.replace(/[^0-9]/g, ''));
                }
                return null;
              },
              z.number().optional()
            ),
            floor: z.string().optional(),
            description: z.string().optional(),
            seller_rating: z.preprocess(
              (val) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                  return Number(val.replace(/[^0-9.]/g, ''));
                }
                return null;
              },
              z.number().optional()
            ),
            views: z.preprocess(
              (val) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                  return Number(val.replace(/[^0-9]/g, ''));
                }
                return null;
              },
              z.number().optional()
            ),
          })
        )
        .describe('Объявления недвижимости на Avito'),
    })

    const params = {
      pageOptions: {
        onlyMainContent: false,
        waitForSelector: '.items-items-kAJAg',
        waitForTimeout: 5000,
      },
      extractorOptions: { 
        extractionSchema: schema,
        retries: 3,
      },
      timeout: 120000,
    }

    // Модифицируем функцию скрапинга одной страницы
    const scrapeListings = async (url: string, pageIndex: number) => {
      console.log(`Scraping page ${pageIndex + 1}/${paginationLinks.length}`);
      
      // Добавляем случайную задержку между запросами
      const randomDelay = Math.floor(Math.random() * 2000) + 1000;
      await delay(randomDelay);

      return retryWithBackoff(async () => {
        const result = await app.scrapeUrl(url, params);
        return result.data['llm_extraction'].listings;
      });
    };

    // Модифицируем параллельный скрапинг на последовательный
    const allListings = [];
    for (let i = 0; i < paginationLinks.length; i++) {
      try {
        const pageListings = await scrapeListings(paginationLinks[i], i);
        allListings.push(...pageListings);
        
        // Сохраняем промежуточные результаты
        fs.writeFileSync(
          'avito_listings.json',
          JSON.stringify(allListings, null, 2)
        );
        
        console.log(`Successfully scraped page ${i + 1}/${paginationLinks.length}`);
        console.log(`Total listings so far: ${allListings.length}`);
        
      } catch (error) {
        console.error(`Failed to scrape page ${i + 1}:`, error.message);
        // Продолжаем со следующей страницей
        continue;
      }
    }

    // Возвращаем результаты
    return JSON.stringify(allListings, null, 2);
    
  } catch (error) {
    console.error('An error occurred:', error.message);
    throw error;
  }
}
