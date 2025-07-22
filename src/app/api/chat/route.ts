import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";

const {
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  OPEN_ROUTER_API_KEY,
  OPENAI_API_KEY,
  OPENAI_EMBEDDING_MODEL,
  EMBEDDING_MODEL_DIMENSION,
} = process.env;

// Validate required environment variables
if (
  !ASTRA_DB_APPLICATION_TOKEN ||
  !ASTRA_DB_ENDPOINT ||
  !OPENAI_API_KEY ||
  !OPENAI_EMBEDDING_MODEL ||
  !EMBEDDING_MODEL_DIMENSION
) {
  throw new Error("Missing required environment variables");
}

// const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const client = new QdrantClient({ host: "localhost", port: 6333 });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const embeddingDimensions = parseInt(EMBEDDING_MODEL_DIMENSION, 10);

// Function to generate embeddings using OpenAI
const generateEmbedding = async (text: string): Promise<number[]> => {
  try {
    const response = await openai.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
      dimensions: embeddingDimensions,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
};

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const latestMessages = messages[messages?.length - 1]?.content;

    let docContext: string;

    // Generate embeddings using OpenAI
    console.log("Generating embeddings...");
    const vector = await generateEmbedding(latestMessages);

    console.log("Generated vector dimension:", vector.length);

    // fetching the documents from the database based on the vector embedding
    try {
      if (!ASTRA_DB_COLLECTION) {
        throw new Error("ASTRA_DB_COLLECTION environment variable is not set");
      }
      const results = await client.query(ASTRA_DB_COLLECTION, {
        query: vector,
        with_payload: true,
        limit: 10,
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
    const openaiAiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [template, ...messages],
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 1.0,
      n: 1,
      stream: false,
    });
    return new NextResponse(JSON.stringify(openaiAiResponse), {
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
