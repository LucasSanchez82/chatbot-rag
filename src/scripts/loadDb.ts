import { DataAPIClient } from "@datastax/astra-db-ts";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import fs from "fs";
import "dotenv/config";
import { FeatureExtractionPipeline } from "@xenova/transformers";
import { parse } from "csv-parse/sync";

type SimilarityMetric = "cosine" | "dot_product" | "euclidean";

const {
  ASTRA_DB_APPLICATION_TOKEN,
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  OPENAI_API_KEY,
} = process.env;
if (
  !ASTRA_DB_APPLICATION_TOKEN ||
  !ASTRA_DB_NAMESPACE ||
  !ASTRA_DB_COLLECTION ||
  !ASTRA_DB_ENDPOINT ||
  !OPENAI_API_KEY
) {
  throw new Error(
    "Please set the environment variables: ASTRA_DB_APPLICATION_TOKEN, ASTRA_DB_NAMESPACE, ASTRA_DB_COLLECTION, ASTRA_DB_ENDPOINT, OPENAI_API_KEY"
  );
}
let embeddingPipeline: FeatureExtractionPipeline;

// Track which URLs have been processed
const processedUrlsFile = "processed_urls.json";

const franceChallengesData = [
  "https://france-challenges.com/",
  "https://france-challenges.com/classes",
  "https://france-challenges.com/association",
  "https://france-challenges.com/rejoignez-nous",
];
const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);

const db = client.db(ASTRA_DB_ENDPOINT, {
  keyspace: ASTRA_DB_NAMESPACE,
});

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,
  chunkOverlap: 100,
});

// Get previously processed URLs or initialize empty array
const getProcessedUrls = () => {
  try {
    if (fs.existsSync(processedUrlsFile)) {
      return JSON.parse(fs.readFileSync(processedUrlsFile, "utf8"));
    }
  } catch (error) {
    console.error("Error reading processed URLs file:", error);
  }
  return [];
};

// Save processed URLs to file
const saveProcessedUrls = (urls: string[]) => {
  try {
    fs.writeFileSync(processedUrlsFile, JSON.stringify(urls, null, 2));
  } catch (error) {
    console.error("Error saving processed URLs:", error);
  }
};

const createCollection = async (
  similarityMetric: SimilarityMetric = "dot_product"
) => {
  // Initialize the embedding pipeline with a sentence transformer model
  const { pipeline } = await import("@xenova/transformers");
  embeddingPipeline = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  try {
    console.log(
      `Creating collection ${ASTRA_DB_COLLECTION} with similarity metric ${similarityMetric}...`
    );
    const res = await db.createCollection(ASTRA_DB_COLLECTION, {
      vector: {
        dimension: 384, // MiniLM-L6-v2 output dimension
        metric: similarityMetric,
      },
    });
    console.log("Collection created:", res);
  } catch (error) {
    // Collection might already exist, continue anyway
    console.log("Collection might already exist, continuing...", error);
  }
};

const loadData = async () => {
  const collection = await db.collection(ASTRA_DB_COLLECTION);
  const processedUrls = getProcessedUrls();
  const newlyProcessedUrls = [...processedUrls]; // Copy to track new additions

  // Filter out already processed URLs
  const urlsToProcess = franceChallengesData;
  // .filter(
  //   (url) => !processedUrls.includes(url)
  // );

  console.log(`Found ${urlsToProcess.length} new URLs to process`);

  for (const url of urlsToProcess) {
    console.log(`Processing ${url}...`);
    try {
      const content = await scrapePage(url);
      const chunks = await splitter.splitText(content);

      console.log(`Generated ${chunks.length} chunks from ${url}`);

      for (const chunk of chunks) {
        // Generate embeddings using the sentence transformer model
        const output = await embeddingPipeline(chunk, {
          pooling: "mean",
          normalize: true,
        });
        const vector = Array.from(output.data);

        const res = await collection.insertOne({
          $vector: vector,
          text: chunk,
          url: url, // Store source URL for reference
          timestamp: new Date().toISOString(), // Add timestamp for tracking
        });
        console.log(res);
      }

      // Mark URL as processed
      newlyProcessedUrls.push(url);
      saveProcessedUrls(newlyProcessedUrls);
      console.log(`Successfully processed ${url}`);
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
    }
  }
};

const scrapePage = async (url: string) => {
  console.log(`Scraping ${url}...`);
  const loader = new PuppeteerWebBaseLoader(url, {
    launchOptions: {
      headless: true,
    },
    gotoOptions: {
      waitUntil: "domcontentloaded",
      timeout: 60000, // Increase timeout to 60s for slower sites
    },
    evaluate: async (page, browser) => {
      const result = await page.evaluate(() => document.body.innerHTML);
      await browser.close();
      return result;
    },
  });

  return (await loader.scrape())?.replace(/<[^>]*>?/gm, "");
};

// CSV file path
const csvFilePath = "datas.csv";

// Function to load CSV data into the database
const loadCsvData = async () => {
  const collection = await db.collection(ASTRA_DB_COLLECTION);

  try {
    console.log(`Loading CSV data from ${csvFilePath}...`);

    // Read and parse CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<{
      question?: string;
      response?: string;
      [key: string]: string | undefined;
    }>;

    console.log(`Found ${records.length} Q&A pairs in CSV`);

    for (const record of records) {
      console.log("Processing record:", record);
      const question = record.question?.trim();
      const response = record.reponse?.trim();

      if (!question || !response) {
        console.log("Skipping empty question or response");
        continue;
      }

      // Create a combined text for better context
      const combinedText = `Question: ${question}\nRéponse: ${response}`;

      // Generate embeddings for the combined text
      const output = await embeddingPipeline(combinedText, {
        pooling: "mean",
        normalize: true,
      });
      const vector = Array.from(output.data);

      // Insert the Q&A pair into the database
      await collection.insertOne({
        $vector: vector,
        text: combinedText,
        question: question,
        response: response,
        source: "csv_training_data",
        type: "qa_pair",
        timestamp: new Date().toISOString(),
      });

      console.log(`Inserted Q&A: ${question.substring(0, 50)}...`);
    }

    console.log("CSV data loading completed successfully!");
  } catch (error) {
    console.error("Error loading CSV data:", error);
  }
};

console.log("Seeding database...");

createCollection().then(() => {
  loadCsvData();
  loadData();
});
