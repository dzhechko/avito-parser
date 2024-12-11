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

async function chat(
  codeInterpreter: Sandbox,
  userMessage: string
): Promise<Execution | undefined> {
  console.log('Waiting for Claude...')

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
  const prices = JSON.parse(data)

  // Convert prices array to a string representation of a Python list
  const pricesList = JSON.stringify(prices)

  const userMessage = `
  Please execute the following Python code to analyze and visualize the Avito real estate price distribution:

  # Complete code block for data analysis and visualization
  import json
  import pandas as pd
  import matplotlib.pyplot as plt
  import seaborn as sns
  
  # Load and prepare the data
  listings_data = ${pricesList}
  df = pd.DataFrame(listings_data)
  
  # Clean the data by removing zero prices and handling outliers
  df_clean = df[df['price_per_night'] > 0]
  
  # Calculate some statistics for better binning
  price_mean = df_clean['price_per_night'].mean()
  price_std = df_clean['price_per_night'].std()
  
  # Create figure with a reasonable size
  plt.figure(figsize=(12, 6))
  
  # Create the histogram
  plt.hist(
    df_clean['price_per_night'],
    bins=30,
    edgecolor='black',
    alpha=0.7,
    color='skyblue'
  )
  
  # Customize the plot
  plt.title('Distribution of Real Estate Prices on Avito', fontsize=14, pad=15)
  plt.xlabel('Price (RUB)', fontsize=12)
  plt.ylabel('Number of Listings', fontsize=12)
  
  # Add grid for better readability
  plt.grid(True, alpha=0.3, linestyle='--')
  
  # Format axis labels to be more readable
  current_values = plt.gca().get_xticks()
  plt.gca().set_xticklabels(['{:,.0f}'.format(x) for x in current_values])
  
  # Adjust layout and display
  plt.tight_layout()
  plt.show()
  
  # Print some basic statistics
  print("\\nBasic price statistics (in RUB):")
  stats = df_clean['price_per_night'].describe()
  print(stats.apply(lambda x: '{:,.2f}'.format(x) if isinstance(x, (int, float)) else x))
`

  const codeInterpreter = await Sandbox.create()
  const codeOutput = await chat(codeInterpreter, userMessage)
  if (!codeOutput) {
    console.log('No code output')
    return
  }

  const logs = codeOutput.logs
  console.log(logs)

  if (codeOutput.results.length == 0) {
    console.log('No results')
    return
  }

  const firstResult = codeOutput.results[0]
  console.log(firstResult.text)

  if (firstResult.png) {
    const pngData = Buffer.from(firstResult.png, 'base64')
    const filename = 'avito_prices_chart.png'
    fs.writeFileSync(filename, pngData)
    console.log(`✅ Saved chart to ${filename}`)
  }

  await codeInterpreter.kill()
}

run()
