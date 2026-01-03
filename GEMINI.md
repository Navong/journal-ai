# GEMINI.md

## Project Overview

This is a Next.js application called "Serenity Journal," a web-based journaling platform that provides AI-powered reflections to support mental wellness. The application is built with the Next.js App Router and uses a variety of modern web technologies.

The front-end is built with React and TypeScript, and it uses Tailwind CSS for styling. The back-end is powered by Next.js API routes and uses Prisma as an ORM to interact with a Supabase (PostgreSQL) database. Authentication is handled by NextAuth.js with Google OAuth.

The core feature of the application is its integration with the Gemini API. The application uses the Gemini API to:

*   Generate empathetic reflections on user's journal entries.
*   Analyze the mood and topic of the entries.
*   Extract entities (people, places, events) from the entries.
*   Generate text-to-speech audio of the reflections.
*   Provide a chat interface for users to interact with the AI about their journal entries.

The application also includes a sophisticated context management system that uses embeddings, mood similarity, and other techniques to provide the Gemini API with relevant context from the user's past journal entries.

## Building and Running

**Prerequisites:**

*   Node.js 18+

**1. Install dependencies:**

```bash
npm install
```

**2. Create a `.env.local` file:**

Create a `.env.local` file in the root directory and add the following environment variables:

```
# Required: Gemini API key for AI reflections
NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here

# Required: NextAuth secret (generate with: openssl rand -base64 32)
AUTH_SECRET=your_auth_secret_here

# Required: Database connection (Prisma + Supabase)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Required: Google OAuth (for Google sign-in)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**3. Set up the database:**

This project uses Prisma and Supabase for database management. Follow the instructions in the `README.md` file to set up the database and run the migrations.

**4. Run the development server:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**5. Build for production:**

```bash
npm run build
npm start
```

## Development Conventions

*   **TypeScript:** The project is written in TypeScript and uses strict type checking.
*   **Linting:** The project uses ESLint to enforce a consistent coding style. Run `npm run lint` to check for linting errors.
*   **Components:** React components are located in the `app/components` directory.
*   **Services:** Services that interact with external APIs (like the Gemini API) are located in the `app/services` directory.
*   **Prisma:** The database schema is defined in `prisma/schema.prisma`. Migrations are located in the `prisma/migrations` directory.
*   **API Routes:** Next.js API routes are located in the `app/api` directory.
