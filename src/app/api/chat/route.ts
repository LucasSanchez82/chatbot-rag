import { pipeline } from "@xenova/transformers";
import { NextRequest, NextResponse } from "next/server";

import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";

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

// const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const client = new QdrantClient({ host: "localhost", port: 6333 });

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
      const results = await client.query(ASTRA_DB_COLLECTION, {
        query: vector,
        with_payload: true,
        limit: 20,
      });

      console.log("Collection, results:", results);
      const docs = await results.points
        .map((res) => res?.payload?.text ?? null)
        .filter(Boolean);
      docContext = JSON.stringify(docs);
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
          text: `Tu es l'assistant IA personnel de l'entreprise France Challenges, spécialisé dans les opérations de ventes auprès des écoles, lycées et associations. Utilise le contexte ci-dessous pour enrichir tes connaissances sur les services et offres de France Challenges.
        Si le contexte ne contient pas les informations nécessaires, réponds en te basant sur tes connaissances existantes sur les services éducatifs et les ventes B2B, sans mentionner la source de tes informations ou ce que le contexte contient ou ne contient pas.
        Formate tes réponses en utilisant le markdown quand c'est approprié et ne retourne pas d'images.
        NE MENTIONNE ABSOLUMENT PAS LA SOURCE DE TES INFORMATIONS OU CE QUE LE CONTEXTE CONTIENT OU NE CONTIENT PAS.
        SI TU N'ES PAS SÛR DE LA RÉPONSE, DIS QUE TU NE SAIS PAS.
        Concentre-toi sur :
        - Les solutions éducatives pour les établissements scolaires
        - Les programmes et services pour lycées et écoles
        - Les offres destinées aux associations
        - Les stratégies de vente et de partenariat
        - L'accompagnement des établissements dans leurs projets
        - Les avantages des programmes de France Challenges
        - Les témoignages et retours d'expérience
        - Les questions légales et réglementaires liées à la vente
        -------------
        DÉBUT DU CONTEXTE
        ${docContext}
        FIN DU CONTEXTE
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
