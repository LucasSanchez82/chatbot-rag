import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai/client";

const getenv = () => {
  const {
    QDRANT_URL,
    OPENAI_API_KEY,
    OPENAI_EMBEDDING_MODEL,
    QDRANT_DB_COLLECTION,
  } = process.env;
  const message: string[] = [];
  if (!QDRANT_URL) {
    message.push("Missing required environment variable: QDRANT_URL");
  }
  if (!OPENAI_API_KEY) {
    message.push("Missing required environment variable: OPENAI_API_KEY");
  }
  if (!OPENAI_EMBEDDING_MODEL) {
    message.push(
      "Missing required environment variable: OPENAI_EMBEDDING_MODEL"
    );
  }
  if (!QDRANT_DB_COLLECTION) {
    message.push("Missing required environment variable: QDRANT_DB_COLLECTION");
  }
  if (message.length > 0) {
    throw new Error(message.join("\n"));
  }

  return {
    QDRANT_URL: QDRANT_URL as string,
    OPENAI_API_KEY: OPENAI_API_KEY as string,
    OPENAI_EMBEDDING_MODEL: OPENAI_EMBEDDING_MODEL as string,
    QDRANT_DB_COLLECTION: QDRANT_DB_COLLECTION as string,
  };
};

const main = async () => {
  const {
    QDRANT_URL,
    OPENAI_API_KEY,
    OPENAI_EMBEDDING_MODEL,
    QDRANT_DB_COLLECTION,
  } = getenv();

  // Get command line arguments
  const args = process.argv.slice(2); // Remove 'node' and script path
  const question = args[0]; // First argument after script name

  if (!question) {
    console.error("Please provide a question to test");
    console.log('Usage: bun run test-score "your question here"');
    process.exit(1);
  }

  console.log("Question to test:", question);

  const client = new QdrantClient({
    url: QDRANT_URL,
  });

  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

  const embedded = await openai.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input: question,
  });

  const similarsPoints = await client.search(QDRANT_DB_COLLECTION, {
    vector: embedded.data[0].embedding,
    limit: 5,
  });
  const basicsScores = similarsPoints.map((point) => point.score);
  const scores = basicsScores.reduce((acc, score) => {
    if (score > 0.45) {
      acc.push(score);
    }
    return acc;
  }, [] as number[]);
  return Math.max(...scores, 0) > 0.45;
};

main();
