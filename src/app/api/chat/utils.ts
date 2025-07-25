import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { PRICING, SIMILARITY_THRESHOLD, SYSTEM_PROMPTS } from "./constants";
import { prisma } from "@/lib/prisma";
// Types
export interface EnvConfig {
  QDRANT_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_EMBEDDING_MODEL: string;
  QDRANT_DB_COLLECTION: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SimilarityResult {
  useWebSearch: boolean;
  context: string;
  maxScore: number;
}

export const getenv = (): EnvConfig => {
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

// Cost calculation
export const calculateCost = (
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

// Logging utilities
export const logTokenUsage = (
  operation: string,
  model: string,
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
  cost: number
) => {
  prisma.cost
    .create({
      data: {
        model: model,
        tokens_input: inputTokens,
        tokens_output: outputTokens,
      },
    })
    .then(() => {
      console.log(`Usage des tokens enregistre en base de données`);
    })
    .catch((error) => {
      console.error("Error logging token usage:", error);
    });
  console.log(
    `${operation} - Tokens utilisés : ${totalTokens} (input: ${inputTokens}, output: ${outputTokens}), Cout: $${cost.toFixed(
      4
    )}`
  );
};

export const logEmbeddingUsage = (
  embeddingTokens: number,
  cost: number,
  model: string
) => {
  prisma.cost
    .create({
      data: {
        model: model,
        tokens_input: embeddingTokens,
        tokens_output: 0, // Embeddings don't have output tokens
      },
    })
    .then(() => {
      console.log(`Embedding tokens usage logged in database`);
    })
    .catch((error) => {
      console.error("Error logging embedding usage:", error);
    });
  console.log(
    `Embedding - Tokens utilisés : ${embeddingTokens}, Cout: $${cost.toFixed(
      6
    )}, Modèle: ${model}`
  );
};

// Question relevance check
export const isQuestionRelevant = async (
  openai: OpenAI,
  message: string
): Promise<boolean> => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPTS.RELEVANCE_FILTER,
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

      logTokenUsage(
        "Test Pertinence",
        "gpt-4",
        totalTokens,
        inputTokens,
        outputTokens,
        cost
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

// Similarity check and model decision
export const checkSimilarityAndDecideModel = async (
  openai: OpenAI,
  client: QdrantClient,
  env: EnvConfig,
  message: string
): Promise<SimilarityResult> => {
  try {
    // Create embedding for the user's question
    const vector = await openai.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: message,
    });

    // Log embedding cost
    if (vector.usage) {
      const embeddingTokens = vector.usage.total_tokens;
      const embeddingCost = calculateCost(
        env.OPENAI_EMBEDDING_MODEL,
        embeddingTokens,
        0
      );

      logEmbeddingUsage(
        embeddingTokens,
        embeddingCost,
        env.OPENAI_EMBEDDING_MODEL
      );
    }

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

// Web search completion
export const createWebSearchCompletion = async (
  openai: OpenAI,
  messages: ChatMessage[]
) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-search-preview",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPTS.WEB_SEARCH,
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

    logTokenUsage(
      "Web search",
      "gpt-4o-search-preview",
      totalTokens,
      inputTokens,
      outputTokens,
      cost
    );
  }

  return completion;
};

// Knowledge base completion
export const createKnowledgeBaseCompletion = async (
  openai: OpenAI,
  messages: ChatMessage[],
  context: string,
  lastMessage: string
) => {
  // Create system message with knowledge base context
  const systemMessage = {
    role: "system" as const,
    content: SYSTEM_PROMPTS.KNOWLEDGE_BASE(context, lastMessage),
  };

  // Prepare messages with system context
  const messagesWithContext = [systemMessage, ...messages];

  // Use the modern chat completions API
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
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

    logTokenUsage(
      "Base de connaissances",
      "gpt-4",
      totalTokens,
      inputTokens,
      outputTokens,
      cost
    );
  }

  return completion;
};
