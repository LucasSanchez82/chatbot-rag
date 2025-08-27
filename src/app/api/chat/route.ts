import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  getenv,
  isQuestionRelevantForWebSearch,
  checkSimilarityAndDecideModel,
  createWebSearchCompletion,
  createKnowledgeBaseCompletion,
} from "./utils";
import { POLITE_REFUSAL_RESPONSE } from "./constants";

// Initialize environment variables and clients
const env = getenv();
const client = new QdrantClient({ url: env.QDRANT_URL });
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
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
    const groupTransactionIdentifier = crypto.randomUUID();
    console.log(
      `Starting transaction group with identifier: ${groupTransactionIdentifier}`
    );
    // Check similarity and decide on model type (saves embedding cost automatically)
    const { useWebSearch, context, maxScore } =
      await checkSimilarityAndDecideModel(
        openai,
        client,
        env,
        lastMessage,
        groupTransactionIdentifier
      );

    if (useWebSearch) {
      // Check relevance (saves relevance cost automatically)
      const { isRelevant } = await isQuestionRelevantForWebSearch(
        openai,
        lastMessage,
        groupTransactionIdentifier,
        messages
      );

      if (!isRelevant) {
        console.log(`Question non pertinente: ${lastMessage}`);
        return NextResponse.json(POLITE_REFUSAL_RESPONSE, {
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

      // Web search completion (saves web search cost automatically)
      const { completion } = await createWebSearchCompletion(
        openai,
        messages,
        lastMessage,
        groupTransactionIdentifier
      );

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

      // Knowledge base completion (saves knowledge base cost automatically)
      const { completion } = await createKnowledgeBaseCompletion(
        openai,
        messages,
        context,
        lastMessage,
        lastMessage,
        groupTransactionIdentifier
      );

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
