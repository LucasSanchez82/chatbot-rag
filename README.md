# France Challenges Chatbot

This is a [Next.js](https://nextjs.org) chatbot application that uses OpenAI's Assistants API with file search capabilities for the France Challenges company.

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the root directory and add your OpenAI API key:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### 2. Setup OpenAI Assistant

Run the setup script to create an OpenAI Assistant with file search capabilities:

```bash
bun run setup-openai
```

This script will:
- Upload your `datas.csv` file to OpenAI
- Create an Assistant configured for France Challenges
- Output the Assistant ID and File ID that you need to add to your `.env` file

After running the script, add the generated IDs to your `.env` file:

```bash
OPENAI_ASSISTANT_ID=your_assistant_id_here
OPENAI_FILE_ID=your_file_id_here
```

### 3. Run the Development Server

```bash
bun dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the chatbot.

## Project Structure

- `src/app/api/chat/route.ts` - API endpoint for chat functionality using OpenAI Assistants
- `src/scripts/createOpenaiFile.ts` - Script to setup OpenAI Assistant and upload knowledge base
- `datas.csv` - Knowledge base file containing Q&A data for France Challenges

## How It Works

The chatbot uses OpenAI's Assistants API with file search capabilities:

1. When you run the setup script, it uploads your knowledge base (`datas.csv`) to OpenAI
2. It creates an Assistant specifically trained for France Challenges use cases
3. When users ask questions, the Assistant searches through the uploaded files to provide relevant answers
4. The Assistant is configured to respond in French and focus on educational services, sales operations, and France Challenges-specific information

## Features

- File-based knowledge retrieval using OpenAI's file search
- French language support
- Specialized for educational services and B2B sales
- Markdown formatting support
- Error handling and validation

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [OpenAI Assistants API](https://platform.openai.com/docs/assistants/overview) - learn about OpenAI Assistants.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Make sure to add your environment variables in the Vercel dashboard before deploying.
