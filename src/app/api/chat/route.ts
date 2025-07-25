import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";

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

// Initialize environment variables
const env = getenv();
const client = new QdrantClient({ url: env.QDRANT_URL });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Similarity threshold to decide between web search and knowledge base
const SIMILARITY_THRESHOLD = 0.6;

// Pricing per 1K tokens (you can update these based on current OpenAI pricing)
const PRICING = {
  "gpt-4": {
    input: 0.03, // $0.03 per 1K input tokens
    output: 0.06, // $0.06 per 1K output tokens
  },
  "gpt-4o-search-preview": {
    input: 0.025, // Estimated pricing - update with actual rates
    output: 0.1, // Estimated pricing - update with actual rates
  },
};

const calculateCost = (
  model: string,
  inputTokens: number,
  outputTokens: number
): number => {
  const modelPricing = PRICING[model as keyof typeof PRICING];
  if (!modelPricing) {
    console.warn(`Pricing not available for model: ${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;
  return inputCost + outputCost;
};

// Function to check if question is relevant to France Challenges business domain
const isQuestionRelevant = async (message: string): Promise<boolean> => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `Tu es un filtre qui détermine si une question est pertinente pour une entreprise spécialisée dans les opérations de ventes auprès des écoles, lycées et associations.
          
          DOMAINES PERTINENTS :
          - Éducation (écoles, lycées, universités)
          - Associations et organisations
          - Ventes B2B dans le secteur éducatif
          - Services et produits éducatifs
          - Réglementations commerciales et juridiques
          - Appels d'offres et marchés publics
          - Stratégies de vente et partenariats
          - Questions administratives liées à l'éducation
          
          DOMAINES NON PERTINENTS :
          - Voitures, immobilier, finance personnelle
          - Cuisine, sport, divertissement
          - Technologie non liée à l'éducation
          - Santé, médecine (sauf si lié à l'éducation)
          - Voyage, mode, beauté
          
          Réponds uniquement par 'oui' si la question est pertinente, 'non' sinon.`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      max_tokens: 5,
      temperature: 0.1,
    });

    // Log token usage for relevance check
    if (response.usage) {
      const totalTokens = response.usage.total_tokens;
      const inputTokens = response.usage.prompt_tokens;
      const outputTokens = response.usage.completion_tokens;
      const cost = calculateCost("gpt-4", inputTokens, outputTokens);

      console.log(
        `Test Pertinence - Tokens utilisés : ${totalTokens} (input: ${inputTokens}, output: ${outputTokens}), Cout: $${cost.toFixed(
          4
        )}`
      );
    }

    const answer = response.choices[0].message.content?.trim().toLowerCase();
    return answer === "oui";
  } catch (error) {
    console.error("Error checking question relevance:", error);
    // En cas d'erreur, on autorise la question par défaut
    return true;
  }
};

const checkSimilarityAndDecideModel = async (
  message: string
): Promise<{ useWebSearch: boolean; context: string; maxScore: number }> => {
  try {
    // Create embedding for the user's question
    const vector = await openai.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: message,
    });

    // Search for similar messages in the knowledge base
    const similarMessages = await client.search(env.QDRANT_DB_COLLECTION, {
      vector: vector.data[0].embedding,
      limit: 5,
      with_payload: true,
    });

    // Get the highest similarity score
    const maxScore =
      similarMessages.length > 0
        ? Math.max(...similarMessages.map((point) => point.score))
        : 0;

    // Extract context from similar messages
    const context = similarMessages
      .map((msg) => msg?.payload?.text)
      .filter(Boolean)
      .join("\n");

    console.log("Max similarity score:", maxScore);
    console.log("Similarity threshold:", SIMILARITY_THRESHOLD);

    // If similarity score is below threshold, use web search
    const useWebSearch = maxScore < SIMILARITY_THRESHOLD;
    console.log("Using web search:", useWebSearch);

    return { useWebSearch, context, maxScore };
  } catch (error) {
    console.error("Error checking similarity:", error);
    // If there's an error with similarity check, default to web search
    return { useWebSearch: true, context: "", maxScore: 0 };
  }
};
export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }
    const lastMessage = messages[messages.length - 1]?.content || "";
    if (!lastMessage) {
      return NextResponse.json(
        { error: "Last message content is empty" },
        { status: 400 }
      );
    }
    // Check similarity and decide on model type
    const { useWebSearch, context, maxScore } =
      await checkSimilarityAndDecideModel(lastMessage);

    if (useWebSearch) {
      const isRelevant = await isQuestionRelevant(lastMessage);

      if (!isRelevant) {
        console.log(`Question non pertinente: ${lastMessage}`);

        const politeRefusalResponse = {
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "gpt-4",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  "Je suis l'assistant IA de France Challenges, spécialisé dans l'accompagnement des établissements scolaires et associations. Votre question ne semble pas liée à mon domaine d'expertise. Je peux vous aider avec des questions concernant les ventes aux écoles, lycées, associations, les réglementations commerciales, ou les opportunités dans le secteur éducatif. Comment puis-je vous accompagner sur ces sujets ?",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };

        return NextResponse.json(politeRefusalResponse, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      console.log(
        `Question pertinente, recherche dans le web... (max similarity: ${maxScore})`
      );

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-search-preview",
        messages: [
          {
            role: "system",
            content: `Tu es l'assistant IA personnel de l'entreprise France Challenges, spécialisé dans les opérations de ventes auprès des écoles, lycées et associations. 
            Tu réponds à des questions commerciales et juridiques en utilisant les informations web les plus récentes.
            Concentre-toi sur :
            - Les réglementations commerciales et juridiques récentes
            - Les tendances du marché éducatif
            - Les opportunités commerciales dans le secteur éducatif
            - Les aspects légaux des ventes aux établissements publics
            - Les appels d'offres et marchés publics
            
            Formate tes réponses en utilisant le markdown quand c'est approprié.
            NE MENTIONNE PAS tes sources web directement, intègre naturellement les informations dans ta réponse.`,
          },
          ...messages,
        ],
        max_tokens: 1000,
      });

      // Log token usage and cost for web search
      if (completion.usage) {
        const totalTokens = completion.usage.total_tokens;
        const inputTokens = completion.usage.prompt_tokens;
        const outputTokens = completion.usage.completion_tokens;
        const cost = calculateCost(
          "gpt-4o-search-preview",
          inputTokens,
          outputTokens
        );

        console.log(
          `Web search - Tokens utilisés : ${totalTokens} (input: ${inputTokens}, output: ${outputTokens}), Cout: $${cost.toFixed(
            4
          )}`
        );
      }

      return NextResponse.json(completion, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      console.log(`Using knowledge base model (max similarity: ${maxScore})`);
      console.log("Context found:", context.length > 0 ? "Yes" : "No");

      // Create system message with knowledge base context
      const systemMessage = {
        role: "system" as const,
        content: `Tu es l'assistant IA personnel de l'entreprise France Challenges, spécialisé dans les opérations de ventes auprès des écoles, lycées et associations. Utilise le contexte ci-dessous pour enrichir tes connaissances sur les services et offres de France Challenges.
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
        ${context}
        FIN DU CONTEXTE
        -------------
        QUESTION ${lastMessage}
        -------------`,
      };

      // Prepare messages with system context
      const messagesWithContext = [systemMessage, ...messages];

      // Use the modern chat completions API
      const completion = await openai.chat.completions.create({
        model: "gpt-4", // or whatever model you prefer
        messages: messagesWithContext,
        temperature: 0.7,
        max_tokens: 1000,
      });

      // Log token usage and cost for knowledge base
      if (completion.usage) {
        const totalTokens = completion.usage.total_tokens;
        const inputTokens = completion.usage.prompt_tokens;
        const outputTokens = completion.usage.completion_tokens;
        const cost = calculateCost("gpt-4", inputTokens, outputTokens);

        console.log(
          `Base de connaissances - Tokens utilises : ${totalTokens} (input: ${inputTokens}, output: ${outputTokens}), Cout: $${cost.toFixed(
            4
          )}`
        );
      }

      // Return the response directly - it's already in the correct format
      return NextResponse.json(completion, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
  } catch (error) {
    console.error("Error in chat route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
