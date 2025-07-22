import OpenAI from "openai";
import fs from "fs";
import path from "path";
import "dotenv/config";

const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

async function uploadFile(filePath: string) {
  console.log(`Uploading file: ${filePath}`);

  const fileStream = fs.createReadStream(filePath);
  const file = await openai.files.create({
    file: fileStream,
    purpose: "assistants",
  });

  console.log(`File uploaded with ID: ${file.id}`);
  return file;
}

async function createAssistant() {
  console.log("Creating assistant with file search...");

  const assistant = await openai.beta.assistants.create({
    name: "France Challenges Assistant",
    instructions: `Tu es l'assistant IA personnel de l'entreprise France Challenges, spécialisé dans les opérations de ventes auprès des écoles, lycées et associations. 

Utilise les fichiers qui t'ont été fournis pour répondre aux questions sur :
- Les solutions éducatives pour les établissements scolaires
- Les programmes et services pour lycées et écoles
- Les offres destinées aux associations
- Les stratégies de vente et de partenariat
- L'accompagnement des établissements dans leurs projets
- Les avantages des programmes de France Challenges
- Les témoignages et retours d'expérience
- Les questions légales et réglementaires liées à la vente

Formate tes réponses en utilisant le markdown quand c'est approprié.
Si tu n'es pas sûr de la réponse, dis que tu ne sais pas.
Ne mentionne pas la source de tes informations sauf si c'est explicitement demandé.`,
    model: "gpt-3.5-turbo",
    tools: [{ type: "file_search" }],
  });

  console.log(`Assistant created with ID: ${assistant.id}`);
  return assistant;
}

async function main() {
  try {
    // Define files to upload
    const dataFilePath = path.join(process.cwd(), "datas.csv");

    // Check if file exists
    if (!fs.existsSync(dataFilePath)) {
      console.error(`File not found: ${dataFilePath}`);
      return;
    }

    // Upload file
    const file = await uploadFile(dataFilePath);

    // Create assistant
    const assistant = await createAssistant();

    // Save IDs to environment file or output them
    console.log("\n=== SAVE THESE VALUES TO YOUR .env FILE ===");
    console.log(`OPENAI_ASSISTANT_ID=${assistant.id}`);
    console.log(`OPENAI_FILE_ID=${file.id}`);
    console.log("==========================================\n");

    // Create a file with the IDs for easy reference
    const configPath = path.join(process.cwd(), "openai-config.json");
    const config = {
      assistantId: assistant.id,
      fileId: file.id,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to: ${configPath}`);
  } catch (error) {
    console.error("Error creating OpenAI resources:", error);
  }
}

main();
