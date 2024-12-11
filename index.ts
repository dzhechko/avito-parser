// @ts-ignore
import * as fs from 'fs'

import 'dotenv/config'
import { Sandbox, Execution } from '@e2b/code-interpreter'
import Anthropic from '@anthropic-ai/sdk'
import { Buffer } from 'buffer'

import { MODEL_NAME, SYSTEM_PROMPT, tools } from './model'

import { codeInterpret } from './codeInterpreter'
import { scrapeAvito } from './scraping'

const anthropic = new Anthropic()

// Добавим интерфейс для параметров анализа
interface AnalysisParams {
  parameter: string;
  title?: string;
  bins?: number;
}

// Модифицируем функцию chat для принятия параметров
async function chat(
  codeInterpreter: Sandbox,
  data: any[],
  analysisParams: AnalysisParams
): Promise<Execution | undefined> {
  console.log('Waiting for Claude...')

  const userMessage = `
  Analyze the distribution of ${analysisParams.parameter} in the provided real estate data and create a histogram.
  If possible, add basic statistics (mean, median, mode).
  Use ${analysisParams.bins || 30} bins for the histogram.
  Title the graph "${analysisParams.title || `Distribution of ${analysisParams.parameter}`}".
  Data: ${JSON.stringify(data)}
  `

  const msg = await anthropic.messages.create({
    model: MODEL_NAME,
    system: SYSTEM_PROMPT,
    max_tokens: 4096,
    messages: [{ role: 'user', content: userMessage }],
    tools,
  })

  console.log(
    `\n${'='.repeat(50)}\nModel response: ${msg.content}\n${'='.repeat(50)}`
  )
  console.log(msg)

  if (msg.stop_reason === 'tool_use') {
    const toolBlock = msg.content.find((block) => block.type === 'tool_use')
    // @ts-ignore
    const toolName = toolBlock?.name ?? ''
    // @ts-ignore
    const toolInput = toolBlock?.input ?? ''

    console.log(
      `\n${'='.repeat(50)}\nUsing tool: ${toolName}\n${'='.repeat(50)}`
    )

    if (toolName === 'execute_python') {
      const code = toolInput.code
      return codeInterpret(codeInterpreter, code)
    }
    return undefined
  }
}

async function run() {
  // Load the Avito prices data from the JSON file
  let data
  const readDataFromFile = () => {
    try {
      return fs.readFileSync('avito_listings.json', 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log('File not found, scraping data...')
        return null
      } else {
        throw err
      }
    }
  }

  const fetchData = async () => {
    data = readDataFromFile()
    if (!data || data.trim() === '[]') {
      console.log('File is empty or contains an empty list, scraping data...')
      data = await scrapeAvito()
    }
  }

  await fetchData()

  // Parse the JSON data
  const listings = JSON.parse(data)

  // Пример анализа разных параметров
  const analysisParams: AnalysisParams[] = [
    {
      parameter: 'price_per_night',
      title: 'Распределение цен на недвижимость',
      bins: 50
    },
    {
      parameter: 'rating',
      title: 'Распределение рейтингов',
      bins: 20
    }
  ]

  const codeInterpreter = await Sandbox.create()

  // Выполняем анализ для каждого параметра
  for (const params of analysisParams) {
    console.log(`Analyzing ${params.parameter}...`)
    const codeOutput = await chat(codeInterpreter, listings, params)
    
    if (!codeOutput) {
      console.log(`No output for ${params.parameter}`)
      continue
    }

    const logs = codeOutput.logs
    console.log(logs)

    if (codeOutput.results.length == 0) {
      console.log(`No results for ${params.parameter}`)
      continue
    }

    const firstResult = codeOutput.results[0]
    console.log(firstResult.text)

    if (firstResult.png) {
      const pngData = Buffer.from(firstResult.png, 'base64')
      const filename = `avito_${params.parameter}_distribution.png`
      fs.writeFileSync(filename, pngData)
      console.log(`✅ Saved ${params.parameter} chart to ${filename}`)
    }
  }

  await codeInterpreter.kill()
}

run()
