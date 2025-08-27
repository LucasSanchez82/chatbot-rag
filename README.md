# France Challenges Chatbot

## 🚀 Setup

### Prérequis

- [Bun](https://bun.sh/) Installé ( ou utilise npm )
- [Docker](https://www.docker.com/) Docker Compose
- OpenAI API key

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/LucasSanchez82/chatbot-rag.git
cd chatbot-interne
bun install
```

### 2. Environment Configuration

Copier le .env depuis .env.example

```bash
cp .env.example .env
```

Configurer le .env comme suit

```bash
# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_MODEL_DIMENSION=1536

# Qdrant Configuration (Required - Vector Database)
QDRANT_URL=http://localhost:6338
QDRANT_PORT=6338
QDRANT_DB_COLLECTION=test_qdrant_fc_openai_embedding_only_questions

# PostgreSQL Configuration (Required - for cost tracking)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=chatbot_db
POSTGRES_PORT=5447
DATABASE_URL=postgresql://postgres:your_secure_password_here@localhost:5447/chatbot_db

# pgAdmin Configuration (Optional - for database administration)
PGADMIN_EMAIL=admin@chatbot.local
PGADMIN_PASSWORD=admin_password
PGADMIN_PORT=5050

```
### 3. Démarrer les services docker compose

Lancer Qdrant et postgres

```bash
docker compose up -d
```

les serveurs lancés :
- PostgreSQL db (port 5447)
- Qdrant base de donnée vectorielle et son api (port 6338) ( ui : http://localhost:6338/dashboard )
- pgAdmin web interface (port 5050, optional)

### 4. Setup la base de données postgres

Lancer la migration:

```bash
bun run prisma migrate dev
```

### 5. Remplir la base de donnée vectoriel

Script seed :

```bash
bun run seed
```

Devrait :
- utiliser `datas.csv` et remplir la base de donnée avec
- Generer des embeddings avec openai
- Stocker les questions reponses pour ensuite faire des recherches de similarites

### 6. Lancer l'application

Lancer le serveur web :

```bash
bun run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000) Pour tester le chatbot.

## 📊 Suivre les couts

### Suivre l'utilisation openai

Commande pour suivre la consommation des couts :

```bash
bun run print-costs
```

Cette commande permet de visionner :
- L'utilisation des tokens et leurs couts
- niveau de similarité par question
- Quel type de reponse (web search | knowledge base)