import { DataAPIClient } from "@datastax/astra-db-ts";
import { pipeline } from "@xenova/transformers";
import { NextRequest, NextResponse } from "next/server";

import "dotenv/config";

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  OPEN_ROUTER_API_KEY,
} = process.env;

// Validate required environment variables
if (!ASTRA_DB_APPLICATION_TOKEN || !ASTRA_DB_ENDPOINT) {
  throw new Error("Missing required Astra DB environment variables");
}

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(ASTRA_DB_ENDPOINT, {
  keyspace: ASTRA_DB_NAMESPACE,
});

// Initialize the embedding pipeline
// Using a model that produces vectors compatible with the database
const embeddingPipeline = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const latestMessages = messages[messages?.length - 1]?.content;

    let docContext: string;

    // Generate embeddings using Xenova
    console.log("Generating embeddings...");
    const output = await embeddingPipeline(latestMessages, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to array and ensure proper dimension
    let vector = Array.from(output.data);
    console.log("Original vector dimension:", vector.length);

    // The Astra DB collection expects 384 dimensions, but all-MiniLM-L6-v2 produces 384
    // We need to pad the vector to match the expected dimension
    if (vector.length < 384) {
      const padding = new Array(384 - vector.length).fill(0);
      vector = [...vector, ...padding];
      console.log("Padded vector dimension:", vector.length);
    } else if (vector.length > 384) {
      // Truncate if somehow longer than expected
      vector = vector.slice(0, 384);
      console.log("Truncated vector dimension:", vector.length);
    }

    // fetching the documents from the database based on the vector embedding
    try {
      if (!ASTRA_DB_COLLECTION) {
        throw new Error("ASTRA_DB_COLLECTION environment variable is not set");
      }

      const collection = await db.collection(ASTRA_DB_COLLECTION);
      const results = await collection.find(
        {},
        {
          sort: {
            $vector: vector,
          },
          limit: 20, // increased the limit to 20 from 10
        }
      );

      console.log("Collection, results:", { results, collection });
      const docs = await results.toArray();
      docContext = JSON.stringify(docs?.map((doc) => doc.text));
      console.log("Document context:", docContext);
      console.log("Found relevant documents:", docs?.length);
    } catch (err) {
      console.error("Error fetching documents:", err);
      docContext = "";
    }

    // sending the prompt to the AI for the response
    const template = {
      role: "system",
      content: [
        {
          type: "text",
          text: `You are an AI assistant who knows everything about Formula One. Use the below context to augment what you know about Formula One racing. The context will provide you with the most recent page data from wikipedia, the official F1 website and others.
        If the context doesn't include the information you need answer based on your existing knowledge and don't mention the source of your information or what the context does or doesn't include.
        Format responses using markdown where applicable and don't return images.
        ABSOLUTELY DO NOT MENTION THE SOURCE OF YOUR INFORMATION OR WHAT THE CONTEXT DOES OR DOESN'T INCLUDE.
        IF YOU ARE NOT SURE ABOUT THE ANSWER, SAY YOU DON'T KNOW.
        -------------
        START CONTEXT
        ${docContext}
        END CONTEXT
        -------------
        QUESTION ${latestMessages}
        -------------
        `,
        },
      ],
    };

    console.log("Starting gemini completion...");
    const openRouterResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPEN_ROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001",
          messages: [template, ...messages],
        }),
      }
    );

    const res = await openRouterResponse.json();
    return new NextResponse(JSON.stringify(res), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    throw error;
  }
}
