import { generateEmbedding, getenv } from "@/app/api/chat/utils";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai";
import { ask } from "./utils/ask";

const main = async () => {
  try {
    const env = getenv();
    const question = await ask("Quelle est ta question ?\n> ");
    if (!question) {
      console.log("Aucune question fournie.");
      return;
    }
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const client = new QdrantClient({ url: env.QDRANT_URL });

    const embedding = await generateEmbedding({
      openai,
      text: question,
      model: env.OPENAI_EMBEDDING_MODEL,
    });

    type PointPayload = {
      question?: string;
      response?: string;
      [k: string]: unknown;
    };

    const searchResults = (await client.search(env.QDRANT_DB_COLLECTION, {
      vector: embedding,
      limit: 5,
      with_payload: true,
    })) as Array<{ payload?: PointPayload; score: number }>;

    if (!searchResults.length) {
      console.log("Aucun résultat dans Qdrant.");
      return;
    }

    console.log("=".repeat(60));
    console.log("Résultats de similarité:");
    console.table(
      searchResults.map((pt) => {
        const q =
          typeof pt.payload?.question === "string"
            ? pt.payload?.question.slice(0, 80)
            : "-";
        const r =
          typeof pt.payload?.response === "string"
            ? pt.payload?.response.slice(0, 80)
            : "-";
        return { question: q, response: r, score: pt.score?.toFixed(4) };
      })
    );

    const best = searchResults[0];
    console.log("\nMeilleur résultat:");
    console.log({
      question:
        typeof best.payload?.question === "string"
          ? best.payload?.question
          : undefined,
      response:
        typeof best.payload?.response === "string"
          ? best.payload?.response
          : undefined,
      score: best.score,
    });
  } catch (e) {
    console.error("Erreur testScoreQdrant:", e);
    process.exitCode = 1;
  }
};

main();
