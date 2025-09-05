import OpenAI from "openai";
import "dotenv/config";
import { getenv } from "../app/api/chat/utils";
import { QdrantClient } from "@qdrant/js-client-rest";
import { SYSTEM_PROMPTS } from "@/app/api/chat/constants";
const env = getenv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const client = new QdrantClient({ url: env.QDRANT_URL });

const main = async () => {
  try {
    // Initialize environment variables and clients

    const question = prompt("Quelle est ta question ?\n\t : ");
    if (!question) {
      console.log("Aucune question fournie.");
      return;
    }
    const iterations_str = prompt(
      "Combien de fois veux-tu tester ? (défaut 1) : "
    );
    const iterations = iterations_str ? parseInt(iterations_str, 10) : 1;

    console.log("Ta question :", question);
    console.log("=".repeat(60));
    const askPromises: Promise<{
      answer: string;
      args: string;
      isRelevant: boolean;
    }>[] = [];
    for (let i = 0; i < iterations; i++) {
      askPromises.push(ask(question));
    }
    const responses = await Promise.all(askPromises);

    console.log("iteration finit");
    console.table(responses);
    const relevantCount = responses.filter((r) => r.isRelevant).length;
    console.log(
      `Sur ${iterations} itérations, ${relevantCount} réponses pertinentes (${(
        (relevantCount / iterations) *
        100
      ).toFixed(2)}%)`
    );
  } catch (error) {
    console.error("Erreur lors du test:", error);
  }
};

main();

async function ask(question: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPTS.RELEVANCE_FILTER_FOR_WEB_SEARCH,
      },
      {
        role: "user",
        content: question,
      },
    ],
    max_tokens: 1000,
    temperature: 0.1,
  });
  const answer = response.choices[0]?.message?.content ?? "";
  const [_, ...rest] = answer.split("\n");
  const isRelevant = Boolean(answer?.toLowerCase()?.trim()?.startsWith("oui"));
  console.log("Réponse du modèle :", answer);
  return {
    answer: isRelevant ? "Vrai" : "Faux",
    isRelevant,
    args: rest.join(" - "),
  };
}
