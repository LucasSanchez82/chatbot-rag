import OpenAI from "openai";
import "dotenv/config";
import { getenv } from "../app/api/chat/utils";
import { SYSTEM_PROMPTS } from "@/app/api/chat/constants";
import { ask, askWithDefault } from "./utils/ask";

const env = getenv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const TRUNCATION_LENGTH = 180;

async function getInputs() {
  // Allow passing values via CLI: bun run src/scripts/testRelevance.ts "Ma question" 5
  const [, , qArg, iterArg] = process.argv;
  let question = qArg ?? "";
  if (!question) {
    question = await ask("Quelle est ta question ?\n> ");
  }
  if (!question) throw new Error("Aucune question fournie.");

  let iterations = iterArg ? parseInt(iterArg, 10) : NaN;
  if (Number.isNaN(iterations)) {
    const it = await askWithDefault("Combien de fois veux-tu tester ?", "1");
    iterations = it ? parseInt(it, 10) : 1;
  }
  if (!Number.isFinite(iterations) || iterations <= 0) iterations = 1;
  return { question, iterations };
}

const main = async () => {
  try {
    const { question, iterations } = await getInputs();

    console.log("Ta question :", question);
    console.log("Iterations :", iterations);
    console.log("=".repeat(60));

    const askPromises: Promise<{ args: string; output: boolean }>[] = [];
    for (let i = 0; i < iterations; i++) {
      askPromises.push(askRelevance(question));
    }
    const responses = await Promise.all(askPromises);

    console.log("Itérations terminées");
    console.table(responses);
    const relevantCount = responses.filter((r) => r.output).length;
    console.log(
      `Sur ${iterations} itérations, ${relevantCount} réponses pertinentes (${(
        (relevantCount / iterations) *
        100
      ).toFixed(2)}%)`
    );
  } catch (error) {
    console.error("Erreur lors du test:", error);
    process.exitCode = 1;
  }
};

main();

async function askRelevance(question: string) {
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
  const parts = answer.split("\n");
  const rest = parts.slice(1);
  const isRelevant = Boolean(answer?.toLowerCase()?.trim()?.startsWith("oui"));
  console.log("Réponse du modèle :", answer);
  return {
    output: isRelevant,
    args: rest.join(" - ").substring(0, TRUNCATION_LENGTH),
  };
}
