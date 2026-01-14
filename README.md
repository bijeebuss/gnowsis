# TLDR - Document Search with AI-Powered OCR

TLDR is a full-stack document management application that allows users to upload PDF and image files, automatically extract text using OCR (Optical Character Recognition), and perform powerful hybrid vector searches across their documents.

## Features

- **Document Upload**: Support for PDF, PNG, and JPG files with bulk upload capability
- **LLM-Powered OCR**: Extract text from images and PDFs using OpenAI's vision API for superior accuracy on complex layouts
- **Hybrid Vector Search**: Combine dense (semantic) and sparse (keyword) vector search for superior accuracy
- **Document Viewer**: View documents with zoom controls, page navigation, and extracted OCR text
- **Tag Management**: Organize documents with custom tags
- **Metadata Fields**: Add custom metadata to documents
- **User Authentication**: Secure JWT-based authentication
- **Real-time Processing**: Temporal workflow orchestration for document processing

## Tech Stack

### Frontend
- **React** with **TypeScript**
- **TanStack Router** for routing
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **Vite** for build tooling

### Backend
- **Node.js** with **Express**
- **PostgreSQL** with **pgvector** extension
- **Prisma** ORM
- **Temporal** for workflow orchestration
- **OpenAI Vision API** for LLM-based text extraction
- **ImageMagick** for PDF to image conversion

## Quick Start with Docker Compose

The easiest way to run TLDR is with Docker Compose. All dependencies (PostgreSQL, Temporal, etc.) are included.

### Prerequisites

- **Docker** and **Docker Compose** (v2.0+)
- **OpenAI API Key** (or compatible endpoint like OpenRouter)

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd TLDR
   ```

2. **Create your environment file:**
   ```bash
   cp .env.docker.example .env
   ```

3. **Edit `.env`** and configure the required values:
   ```env
   # Required: Generate secure secrets
   JWT_SECRET=your-secret-key-here          # openssl rand -base64 32
   ENCRYPTION_SECRET=your-64-char-hex-key   # openssl rand -hex 32

   # Required: OpenAI API for OCR
   OPENAI_API_KEY=your-openai-api-key-here
   OPENAI_API_ENDPOINT=https://api.openai.com/v1
   OPENAI_MODEL=gpt-4o-mini

   # Optional: Database credentials (defaults work fine)
   DB_USER=postgres
   DB_PASSWORD=postgres
   DB_NAME=tldr
   ```

4. **Start the application:**
   ```bash
   # Start core services (app, api, workers, postgres, temporal)
   docker compose up -d

   # Or include Gotenberg for email-to-PDF conversion
   docker compose --profile gotenberg up -d

   # Or include Ollama with GPU passthrough for local LLM
   docker compose --profile ollama up -d

   # Or start everything
   docker compose --profile full up -d
   ```

5. **Access the application:**
   - Frontend: http://localhost:3000
   - API: http://localhost:3001
   - Temporal UI: http://localhost:8233

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `app` | 3000 | Frontend React application |
| `api` | 3001 | Backend Express API |
| `worker` | - | Document & email processing worker |
| `postgres` | 5432 | PostgreSQL with pgvector |
| `temporal` | 7233, 8233 | Workflow orchestration & UI |
| `gotenberg` | 3003 | PDF conversion (optional) |
| `ollama` | 11434 | Local LLM with GPU (optional) |

### Persistent Data

All data is stored in Docker volumes:
- `tldr-postgres-data` - Database
- `tldr-temporal-data` - Workflow state
- `tldr-uploads-data` - Uploaded documents
- `tldr-ollama-data` - Ollama models (if enabled)

To backup or migrate data:
```bash
# List volumes
docker volume ls | grep tldr

# Backup uploads
docker run --rm -v tldr-uploads-data:/data -v $(pwd):/backup alpine tar czf /backup/uploads-backup.tar.gz /data
```

### Stopping and Cleanup

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes all data)
docker compose down -v
```

---

## Manual Installation (Without Docker)

If you prefer to run services manually, follow the instructions below.

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **PostgreSQL** (v14 or higher) with **pgvector** extension
- **Temporal Server** (for workflow orchestration)
- **ImageMagick** (for PDF to image conversion)
- **OpenAI API Key** (for LLM-based OCR)

### Installing Prerequisites

#### PostgreSQL with pgvector

**macOS (using Homebrew):**
```bash
brew install postgresql@14
brew services start postgresql@14
brew install pgvector
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo apt-get install postgresql-14-pgvector
```

#### Temporal Server

**Using Docker:**
```bash
docker run -d -p 7233:7233 temporalio/auto-setup:latest
```

**Or install locally:**
```bash
brew install temporal
temporal server start-dev
```

#### ImageMagick

**macOS:**
```bash
brew install imagemagick
```

**Ubuntu/Debian:**
```bash
sudo apt-get install imagemagick
```

#### OpenAI API Key

1. Sign up for an OpenAI account at https://platform.openai.com/
2. Navigate to API keys section
3. Create a new API key
4. Save it for use in the `.env` file

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd TLDR
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure the following:
   ```env
   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/tldr?schema=public"

   # JWT Authentication
   JWT_SECRET="your-secret-key-here-change-in-production"

   # Temporal Workflow Server
   TEMPORAL_ADDRESS="localhost:7233"

   # OpenAI API for LLM-based OCR
   OPENAI_API_KEY="your-openai-api-key-here"
   OPENAI_API_ENDPOINT="https://api.openai.com/v1"  # Can use compatible endpoints (e.g., Azure OpenAI)
   OPENAI_MODEL="gpt-4o-mini"  # Model with vision capabilities (gpt-4o, gpt-4o-mini, etc.)

   # Server Configuration
   PORT=3000
   NODE_ENV="development"
   ```

4. **Set up the database:**

   Create the database:
   ```bash
   createdb tldr
   ```

   Enable pgvector extension:
   ```bash
   psql -d tldr -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

   Run Prisma migrations:
   ```bash
   npx prisma migrate dev
   ```

   Generate Prisma Client:
   ```bash
   npx prisma generate
   ```

## Running the Application

The application consists of three services that need to run simultaneously:

### 1. Frontend Development Server (Vite)
```bash
npm run dev
```
Runs on: http://0.0.0.0:3000 (accessible from outside Docker containers)

### 2. Backend API Server
```bash
npm run api
```
Runs on: http://0.0.0.0:3001 (accessible from outside Docker containers)

### 3. Temporal Worker (for document processing)
```bash
npm run worker
```

**Note:** Both the frontend and API servers are configured to listen on `0.0.0.0`, making them accessible from outside Docker containers. You can access the application at `http://localhost:3000` on your host machine.

### Running All Services Together

**Recommended: Single Command (All Services)**

The easiest way to run all services is with a single command:

```bash
npm start
```

This will launch all three services (Vite frontend, API server, and Temporal worker) concurrently in a single terminal. Press `Ctrl+C` to stop all services at once.

**Alternative: Separate Terminal Windows**

If you prefer to run services in separate terminals for easier debugging:

**Terminal 1:**
```bash
npm run dev
```

**Terminal 2:**
```bash
npm run api
```

**Terminal 3:**
```bash
npm run worker
```

### Available Scripts

- `npm start` - Run all services (Vite, API, Worker) concurrently
- `npm run dev` - Start Vite development server only
- `npm run api` - Start API server only
- `npm run worker` - Start Temporal worker only
- `npm test` - Run tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Testing

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Building for Production

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Preview production build:**
   ```bash
   npm run preview
   ```

## Project Structure

```
TLDR/
├── app/                      # Frontend application
│   ├── components/           # React components
│   │   ├── ui/              # shadcn/ui components
│   │   ├── ProtectedRoute.tsx
│   │   └── UploadWidget.tsx
│   ├── routes/              # TanStack Router routes
│   │   ├── __root.tsx       # Root layout
│   │   ├── index.tsx        # Landing page
│   │   ├── login.tsx        # Login page
│   │   ├── signup.tsx       # Signup page
│   │   ├── dashboard.tsx    # Document dashboard
│   │   ├── search.tsx       # Search page
│   │   └── documents/       # Document routes
│   ├── utils/               # Utility functions
│   │   └── auth.ts         # Authentication utilities
│   └── styles/             # Global styles
│       └── globals.css
│
├── server/                  # Backend API
│   ├── api/                # API routes
│   │   ├── auth.ts         # Authentication endpoints
│   │   ├── documents.ts    # Document management
│   │   └── tags.ts         # Tag management
│   ├── middleware/         # Express middleware
│   │   └── auth.ts        # JWT authentication
│   ├── utils/             # Utility functions
│   │   ├── embeddings.ts  # Dense vector generation
│   │   ├── sparse-vectors.ts # Sparse vector (TF-IDF)
│   │   └── search.ts      # Hybrid search implementation
│   ├── db.ts              # Prisma client
│   └── app.ts             # Express app setup
│
├── workflows/              # Temporal workflows
│   ├── document-processing.workflow.ts
│   ├── worker.ts          # Temporal worker
│   └── client.ts          # Temporal client
│
├── activities/            # Temporal activities
│   └── document-processing.ts # OCR and vectorization
│
├── prisma/               # Database schema and migrations
│   ├── schema.prisma    # Prisma schema
│   └── migrations/      # Database migrations
│
├── uploads/             # Uploaded files storage
│
└── tests/              # Test files
    └── database.test.ts
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user

### Documents
- `GET /api/documents` - List user's documents
- `GET /api/documents/:id` - Get document details
- `POST /api/documents/upload` - Upload document
- `GET /api/documents/:id/download` - Download document
- `DELETE /api/documents/:id` - Delete document

### Tags
- `GET /api/tags` - List user's tags
- `POST /api/documents/:id/tags` - Add tag to document
- `DELETE /api/documents/:id/tags/:tagId` - Remove tag from document

### Metadata
- `GET /api/documents/:id/metadata` - Get document metadata
- `POST /api/documents/:id/metadata` - Add metadata field

### Search
- `POST /api/search` - Hybrid vector search across documents

## Performance & Scalability

The system uses optimized vector search with the following features:

- **IVFFlat Vector Index**: Approximate nearest neighbor search using pgvector's IVFFlat index for fast similarity queries
- **Per-Document Ranking**: SQL window functions ensure each document appears once, ranked by its best matching page
- **Hybrid Search**: 60% semantic (dense) + 40% keyword (sparse) scoring for accurate results

**Expected Capacity:**
- **1,000-10,000 documents** (5K-50K vectors): Sub-second search times
- **10,000-100,000 documents** (50K-500K vectors): 1-2 second search times
- **Beyond 100K documents**: Consider upgrading to HNSW index for better performance

**Note:** The IVFFlat index provides ~95-99% recall (may miss some edge case matches) but delivers fast query times at scale.

## How It Works

1. **Upload**: User uploads a PDF or image file
2. **Storage**: File is stored in `/uploads/{document-id}/`
3. **OCR Processing**: Temporal workflow is triggered:
   - PDFs are converted to images (one per page) using ImageMagick
   - OpenAI Vision API extracts text from each page/image
   - LLM-based extraction handles complex layouts (chat screenshots, forms, etc.)
   - Extracted text is stored in the database
4. **Vectorization**: For each page:
   - Dense vectors (semantic embeddings) are generated
   - Sparse vectors (TF-IDF) are computed
   - Vectors are stored in PostgreSQL with pgvector
5. **Search**: When searching:
   - Query is converted to dense and sparse vectors
   - Hybrid search combines both vector types (60% semantic + 40% keyword)
   - Results are ranked by relevance score

## Development Tips

- Use the Prisma Studio to explore the database:
  ```bash
  npx prisma studio
  ```

- View Temporal workflows in the UI:
  ```bash
  temporal server start-dev --ui-port 8080
  ```
  Open http://localhost:8080

- Check TypeScript types:
  ```bash
  npx tsc --noEmit
  ```

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running: `pg_isready`
- Check your DATABASE_URL in `.env`
- Verify pgvector extension is installed: `psql -d tldr -c "SELECT * FROM pg_extension WHERE extname = 'vector';"`

### Temporal Connection Issues
- Ensure Temporal server is running on port 7233
- Check TEMPORAL_ADDRESS in `.env`

### OCR Not Working
- Verify OPENAI_API_KEY is set in `.env` and is valid
- Check that the OpenAI model supports vision (gpt-4o, gpt-4o-mini, etc.)
- Ensure uploaded files are in supported formats (PDF, PNG, JPG)
- Verify ImageMagick is installed: `magick --version` or `convert --version`
- Check Temporal worker logs for specific error messages

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


# CURL commands

# First, login to get a JWT token
  TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"your-email@example.com","password":"your-password"}' \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  # Then upload a file
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/path/to/your/document.pdf"

  Or as a single command if you already have a token:

  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
    -F "file=@/path/to/your/document.pdf" \
    -v

  Examples with different file types:

  # Upload a PDF
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@document.pdf"

  # Upload a PNG image
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@screenshot.png"

  # Upload a JPEG image
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@photo.jpg"

  Complete workflow example:

  # 1. Register a new user (optional, if you don't have an account)
  curl -X POST http://localhost:3001/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "SecurePass123!"
    }'

  # 2. Login and extract token
  TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "SecurePass123!"
    }' | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"$//')

  # 3. Upload a document
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/workspaces/TLDR/uploads/f43a228d-c369-4834-aa60-a7810f1ec75a/pages/page-0.png" \
    -v

  # 4. Check the response (should return document ID and status)