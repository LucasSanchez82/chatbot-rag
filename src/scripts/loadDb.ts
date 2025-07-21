import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import fs from "fs";
import "dotenv/config";
import { FeatureExtractionPipeline } from "@xenova/transformers";
import { parse } from "csv-parse/sync";
import { QdrantClient } from "@qdrant/js-client-rest";

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
// const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);

const client = new QdrantClient({ host: "localhost", port: 6333 });

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
    const createdCollection = await client.createCollection(
      ASTRA_DB_COLLECTION,
      {
        vectors: {
          size: 384, // MiniLM-L6-v2 output dimension
          distance: "Dot", // Use dot like in documenttion of Qdrant
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
        // Generate embeddings using the sentence transformer model
        const output = await embeddingPipeline(chunk, {
          pooling: "mean",
          normalize: true,
        });
        const vector = Array.from(output.data);

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
      const createdVectors = await client.upsert(ASTRA_DB_COLLECTION, {
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

    const allPoints = [];

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

      // Add the Q&A pair to the batch
      allPoints.push({
        id: crypto.randomUUID(), // Use UUID for unique IDs
        vector,
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

    // Batch insert all Q&A pairs at once
    if (allPoints.length > 0) {
      console.log(`Inserting ${allPoints.length} Q&A pairs in batch...`);
      try {
        const createdVectors = await client.upsert(ASTRA_DB_COLLECTION, {
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
    await loadData();
    console.log("All data loading completed successfully!");
  } catch (error) {
    console.error("Error during data loading:", error);
    process.exit(1);
  }
});
