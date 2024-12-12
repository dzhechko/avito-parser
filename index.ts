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
  
  Follow these requirements:
  1. Clean the data first:
     - Remove any outliers (use IQR method)
     - Convert string prices to numbers if needed
     - Handle missing values
  
  2. Create a histogram with these specifications:
     - Use ${analysisParams.bins || 30} bins
     - Add proper labels in Russian
     - Format numbers manually using the function below
     - Add grid for better readability
     - Use a pleasant color scheme (e.g., 'skyblue')
  
  Here's the code to use:
  
  import matplotlib.pyplot as plt
  import numpy as np
  import pandas as pd
  import re
  
  # Create DataFrame from the data
  df = pd.DataFrame(data)
  
  # Print raw data for debugging
  print("\\nDebug: Raw data sample:")
  print(df.head())
  print("\\nColumns available:", df.columns.tolist())
  
  # Function to extract numeric value from string
  def extract_number(x):
      if pd.isna(x):
          return None
      if isinstance(x, (int, float)):
          return float(x)
      # Extract numbers from string, handling both comma and dot
      matches = re.findall(r'\\d+(?:[,.]\\d+)?', str(x))
      if matches:
          # Take the first match and convert to float
          result = float(matches[0].replace(',', '.'))
          print(f"Debug: Extracted {result} from {x}")
          return result
      print(f"Debug: Could not extract number from {x}")
      return None
  
  # Process data based on parameter type
  if '${analysisParams.parameter}' == 'area':
      print("\\nDebug: Processing area data...")
      # First try to get area from dedicated column if exists
      if 'area' in df.columns:
          print("Debug: Using 'area' column")
          data_to_plot = df['area'].apply(extract_number)
      else:
          print("Debug: Extracting area from titles...")
          # Print some title examples
          print("\\nDebug: Title examples:")
          print(df['title'].head())
          
          # Extract area with more detailed debugging
          def extract_area_from_title(title):
              match = re.search(r'(\\d+(?:[,.]\\d+)?)\\s*м²', str(title))
              if match:
                  area_str = match.group(1)
                  area = float(area_str.replace(',', '.'))
                  print(f"Debug: Extracted area {area} from title: {title}")
                  return area
              print(f"Debug: No area found in title: {title}")
              return None
          
          data_to_plot = df['title'].apply(extract_area_from_title)
      
      print(f"\\nDebug: Found {len(data_to_plot.dropna())} valid area values")
      print("Debug: Area values sample:", data_to_plot.dropna().head().tolist())
  else:
      data_to_plot = pd.to_numeric(df['${analysisParams.parameter}'], errors='coerce')
  
  # Drop NA values and print statistics
  data_to_plot = data_to_plot.dropna()
  
  if len(data_to_plot) == 0:
      raise ValueError(f"No valid data found for parameter: {analysisParams.parameter}")
  
  print(f"\\nСтатистика для {analysisParams.parameter}:")
  print(f"Количество значений: {len(data_to_plot)}")
  print(f"Среднее: {data_to_plot.mean():.2f}")
  print(f"Медиана: {data_to_plot.median():.2f}")
  print(f"Мин.: {data_to_plot.min():.2f}")
  print(f"Макс.: {data_to_plot.max():.2f}")
  
  # Remove outliers using IQR method
  Q1 = data_to_plot.quantile(0.25)
  Q3 = data_to_plot.quantile(0.75)
  IQR = Q3 - Q1
  lower_bound = Q1 - 1.5 * IQR
  upper_bound = Q3 + 1.5 * IQR
  data_to_plot = data_to_plot[(data_to_plot >= lower_bound) & (data_to_plot <= upper_bound)]
  
  print(f"\\nПосле удаления выбросов:")
  print(f"Количество значений: {len(data_to_plot)}")
  print(f"Среднее: {data_to_plot.mean():.2f}")
  print(f"Медиана: {data_to_plot.median():.2f}")
  
  # Set figure size and style
  plt.style.use('default')  # Using default style instead of seaborn
  plt.figure(figsize=(12, 6), facecolor='white')
  
  # Create histogram with improved style
  n, bins, patches = plt.hist(data_to_plot, bins=${analysisParams.bins || 30}, 
                            color='#2196F3', edgecolor='black', alpha=0.7,
                            rwidth=0.85)  # Slightly narrower bars
  
  # Customize plot appearance
  ax = plt.gca()
  ax.set_facecolor('#f8f9fa')  # Light gray background
  
  # Format axis labels
  def format_axis_label(x, p):
      if x >= 1000000:
          return f"{x/1000000:.1f}M{'₽' if ${analysisParams.parameter === 'price'} else ''}"
      elif x >= 1000:
          return f"{x/1000:.0f}K{'₽' if ${analysisParams.parameter === 'price'} else ''}"
      return f"{x:.0f}{'₽' if ${analysisParams.parameter === 'price'} else ''}"
  
  plt.gca().xaxis.set_major_formatter(plt.FuncFormatter(format_axis_label))
  
  # Rotate labels if needed
  plt.xticks(rotation=45)
  
  # Add grid with custom style
  plt.grid(True, alpha=0.3, linestyle='--', color='gray')
  
  # Calculate and add statistics
  mean_val = data_to_plot.mean()
  median_val = data_to_plot.median()
  
  # Add mean and median lines with improved style
  plt.axvline(mean_val, color='#e53935', linestyle='dashed', linewidth=2, 
              label=f'Среднее: {format_axis_label(mean_val, None)}')
  plt.axvline(median_val, color='#43a047', linestyle='dashed', linewidth=2, 
              label=f'Медиана: {format_axis_label(median_val, None)}')
  
  # Improve title and labels
  plt.title("${analysisParams.title || `Распределение ${analysisParams.parameter}`}",
           pad=20, fontsize=14, fontweight='bold')
  
  plt.xlabel("${analysisParams.parameter === 'price' ? 'Цена, ₽' : 
    analysisParams.parameter === 'area' ? 'Площадь, м²' : 
    analysisParams.parameter === 'rooms' ? 'Количество комнат' : 
    analysisParams.parameter === 'seller_rating' ? 'Рейтинг продавца' : 
    analysisParams.parameter}",
    labelpad=10)
  
  plt.ylabel("Количество объявлений", labelpad=10)
  
  # Improve legend
  plt.legend(frameon=True, facecolor='white', edgecolor='none',
            shadow=True, fontsize=10)
  
  # Adjust layout
  plt.tight_layout()
  
  Here's the data: ${JSON.stringify(data)}
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
      parameter: 'price',
      title: 'Распределение цен на недвижимость',
      bins: 50
    },
    {
      parameter: 'rating',
      title: 'Распределение рейтингов',
      bins: 20
    },
    {
      parameter: 'area',
      title: 'Распределение площади объектов',
      bins: 30
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
