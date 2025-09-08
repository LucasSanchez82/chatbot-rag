import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import fs from "fs";
import "dotenv/config";
import { parse } from "csv-parse/sync";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import { generateEmbedding } from "@/app/api/chat/utils";

type SimilarityMetric = "cosine" | "dot_product" | "euclidean";

const {
  QDRANT_URL,
  QDRANT_DB_COLLECTION,
  OPENAI_API_KEY,
  EMBEDDING_MODEL_DIMENSION,
  OPENAI_EMBEDDING_MODEL,
} = process.env;

if (
  !QDRANT_URL ||
  !QDRANT_DB_COLLECTION ||
  !EMBEDDING_MODEL_DIMENSION ||
  !OPENAI_EMBEDDING_MODEL ||
  !OPENAI_API_KEY
) {
  throw new Error(
    "Please set the environment variables: QDRANT_URL, QDRANT_DB_COLLECTION, OPENAI_API_KEY, EMBEDDING_MODEL_DIMENSION, OPENAI_EMBEDDING_MODEL"
  );
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Function to generate embeddings using OpenAI

const embeddingDimensions = parseInt(EMBEDDING_MODEL_DIMENSION, 10);
// Track which URLs have been processed
const processedUrlsFile = "processed_urls.json";

const franceChallengesData = [
  "https://france-challenges.com/",
  "https://france-challenges.com/classes",
  "https://france-challenges.com/association",
  "https://france-challenges.com/rejoignez-nous",
];
// const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);

const client = new QdrantClient({ url: QDRANT_URL });

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: embeddingDimensions,
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
  similarityMetric: SimilarityMetric = "cosine" // documentation openai
) => {
  try {
    console.log(
      `Creating collection ${QDRANT_DB_COLLECTION} with similarity metric ${similarityMetric}...`
    );
    const createdCollection = await client.createCollection(
      QDRANT_DB_COLLECTION,
      {
        vectors: {
          size: embeddingDimensions, // OpenAI embedding dimensions
          distance: "Dot", // Use dot product like in documentation of qdrant
        },
      }
    );
    console.log("Collection created:", createdCollection);
  } catch (error) {
    // Collection might already exist, continue anyway
    console.log("Collection might already exist, continuing...", error);
  }
};

const loadData = async () => {
  const processedUrls = getProcessedUrls();
  const newlyProcessedUrls = [...processedUrls]; // Copy to track new additions
  const urlsToProcess = franceChallengesData;

  console.log(`Found ${urlsToProcess.length} new URLs to process`);

  const allPoints = [];

  for (const url of urlsToProcess) {
    console.log(`Processing ${url}...`);
    try {
      const content = await scrapePage(url);
      const chunks = await splitter.splitText(content);

      console.log(`Generated ${chunks.length} chunks from ${url}`);

      for (const chunk of chunks) {
        // Generate embeddings using OpenAI
        const vector = await generateEmbedding({
          openai,
          text: chunk,
          model: OPENAI_EMBEDDING_MODEL,
        });

        allPoints.push({
          id: crypto.randomUUID(), // Use UUID for unique IDs
          vector: vector,
          payload: {
            text: chunk,
            url,
            timestamp: new Date().toISOString(), // Add timestamp for tracking
            source: "web_scraping",
          },
        });
      }

      // Mark URL as processed
      newlyProcessedUrls.push(url);
      saveProcessedUrls(newlyProcessedUrls);
      console.log(`Successfully processed ${url}`);
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
    }
  }

  // Batch insert all points at once
  if (allPoints.length > 0) {
    console.log(`Inserting ${allPoints.length} points in batch...`);
    try {
      const createdVectors = await client.upsert(QDRANT_DB_COLLECTION, {
        wait: true,
        points: allPoints,
      });
      console.log("Batch insert completed:", createdVectors);
    } catch (error) {
      console.error("Detailed error:", error);
      throw error;
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

    const allPoints: {
      id: string;
      vector: number[];
      payload: {
        text: string;
        question: string;
        response: string;
        source: string;
        type: string;
        timestamp: string;
      };
    }[] = [];
    const allPromises: Promise<number[]>[] = [];
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

      // Generate embeddings using OpenAI
      allPromises.push(
        generateEmbedding({
          openai,
          text: combinedText,
          model: OPENAI_EMBEDDING_MODEL,
        })
      );

      // Add the Q&A pair to the batch
      allPoints.push({
        id: crypto.randomUUID(), // Use UUID for unique IDs
        vector: [],
        payload: {
          text: combinedText,
          question,
          response,
          source: "csv_training_data",
          type: "qa_pair",
          timestamp: new Date().toISOString(),
        },
      });

      console.log(`Prepared Q&A: ${question.substring(0, 50)}...`);
    }

    (await Promise.all(allPromises)).forEach((vector, index) => {
      allPoints[index].vector = vector;
    });

    // Batch insert all Q&A pairs at once
    if (allPoints.length > 0) {
      console.log(`Inserting ${allPoints.length} Q&A pairs in batch...`);
      try {
        const createdVectors = await client.upsert(QDRANT_DB_COLLECTION, {
          wait: true,
          points: allPoints,
        });
        console.log("CSV batch insert completed:", createdVectors);
      } catch (error) {
        console.error("Detailed error:", error);
        throw error;
      }
    }

    console.log("CSV data loading completed successfully!");
  } catch (error) {
    console.error("Error loading CSV data:", error);
  }
};

console.log("Seeding database...");

createCollection().then(async () => {
  try {
    await loadCsvData();
    // await loadData();
    console.log("All data loading completed successfully!");
  } catch (error) {
    console.error("Error during data loading:", error);
    process.exit(1);
  }
});
