import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "dotenv/config";

const { OPENAI_API_KEY, OPENAI_ASSISTANT_ID } = process.env;

// Validate required environment variables
if (!OPENAI_API_KEY || !OPENAI_ASSISTANT_ID) {
  throw new Error(
    "Missing required environment variables: OPENAI_API_KEY and OPENAI_ASSISTANT_ID"
  );
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const latestMessage = messages[messages.length - 1]?.content;

    if (!latestMessage) {
      return NextResponse.json(
        { error: "No message content provided" },
        { status: 400 }
      );
    }

    console.log("Creating thread for conversation...");

    // Create a thread for this conversation
    const thread = await openai.beta.threads.create();

    // Add the user's message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: latestMessage,
    });

    console.log("Running assistant...");

    // Run the assistant and wait for completion
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: OPENAI_ASSISTANT_ID!,
    });

    if (run.status === "completed") {
      // Get the messages from the thread
      const messages = await openai.beta.threads.messages.list(thread.id);
      const assistantMessage = messages.data.find(
        (msg) => msg.role === "assistant"
      );

      if (
        assistantMessage &&
        assistantMessage.content[0] &&
        assistantMessage.content[0].type === "text"
      ) {
        const responseText = assistantMessage.content[0].text.value;

        // Format the response to match the expected OpenAI chat completion format
        const response = {
          choices: [
            {
              message: {
                role: "assistant",
                content: responseText,
              },
              finish_reason: "stop",
              index: 0,
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };

        return NextResponse.json(response, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }
    } else {
      console.error("Run failed:", run.status, run.last_error);
      throw new Error(`Assistant run failed with status: ${run.status}`);
    }

    throw new Error("No response generated");
  } catch (error) {
    console.error("Error in chat route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
