import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  getenv,
  isQuestionRelevantForWebSearch,
  createWebSearchCompletion,
  checkSimilarityAndDecideModel,
  createKnowledgeBaseCompletion,
  checkKnowledgeBaseOrWebSearch,
} from "./utils";
import { POLITE_REFUSAL_RESPONSE } from "./constants";

// Initialize environment variables and clients
const env = getenv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const client = new QdrantClient({ url: env.QDRANT_URL });
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

    // Check similarity with knowledge base
    const {
      useWebSearch,
      context,
      maxScore: maxSimilarityScore,
    } = await checkSimilarityAndDecideModel(
      openai,
      client,
      env,
      lastMessage,
      groupTransactionIdentifier
    );

    if (!useWebSearch && context) {
      // Use knowledge base with RAG
      console.log(
        `Found relevant context in knowledge base (score: ${maxSimilarityScore})`
      );

      const { completion } = await createKnowledgeBaseCompletion({
        openai,
        messages,
        context,
        lastMessage,
        groupTransactionIdentifier,
        similarityScore: maxSimilarityScore,
      });

      return NextResponse.json(completion, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // No relevant context in knowledge base, proceed with web search
    console.log(
      `No relevant context found (score: ${maxSimilarityScore}), checking web search relevance...`
    );

    // Check relevance before doing web search
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
    // ///////////////////`

    // First, check if AI can answer with base knowledge or needs web search
    const { needsWebSearch, response } = await checkKnowledgeBaseOrWebSearch(
      openai,
      lastMessage,
      groupTransactionIdentifier,
      messages
    );

    if (!needsWebSearch && response) {
      console.log("AI answered with base knowledge");

      // Create a response in the expected OpenAI format
      const completion = {
        id: "chatcmpl-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response,
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

      return NextResponse.json(completion, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // AI returned "null", so we need to check similarity and decide between RAG or web search
    console.log(
      "AI returned null, checking similarity in knowledge base...\n\t- starting web search..."
    );

    // Web search completion (saves web search cost automatically)
    const { completion } = await createWebSearchCompletion({
      openai,
      messages,
      groupTransactionIdentifier,
    });

    return NextResponse.json(completion, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
