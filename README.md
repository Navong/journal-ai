<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Serenity Journal

A quiet space for your thoughts. A clean, calming, and minimalist journaling space that provides thoughtful AI reflections to support mental wellness.

Built with Next.js 16 App Router.

## Run Locally

**Prerequisites:** Node.js 18+ 

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file in the root directory and add your environment variables:
   ```bash
   # Required: Gemini API key for AI reflections
   NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here
   
   # Required: NextAuth secret (generate with: openssl rand -base64 32)
   AUTH_SECRET=your_auth_secret_here
   
   # Required: Database connection (Prisma + Supabase)
   # Get connection strings from: https://supabase.com/dashboard/project/_/settings/database
   
   # Pooled connection for Prisma Client (runtime) - Use Transaction Pooler
   # Format: postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   
   # Direct connection for Prisma CLI (migrations, introspection) - Use Direct Database Connection
   # Format: postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   
   # Optional: Supabase URL (for future use)
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   
   # Required: Google OAuth (for Google sign-in)
   # Get credentials from: https://console.cloud.google.com/apis/credentials
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```
   
   > **Note:** 
   > - The `NEXT_PUBLIC_` prefix is required for client-side environment variables in Next.js.
   > - `AUTH_SECRET` is required for NextAuth.js to work. Generate one with: `openssl rand -base64 32`
   > - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are required for Google authentication.
   > - `DATABASE_URL` is required for Prisma to connect to Supabase. Without it, the app will fallback to localStorage (demo mode only).
   > - **Google Redirect URI:** Set the redirect URI in Google Cloud Console to: `http://localhost:3000/api/auth/callback/google` (dev) or `https://yourdomain.com/api/auth/callback/google` (production)

3. Set up database with Prisma + Supabase:
   - Go to [Supabase](https://supabase.com) and create a free account
   - Create a new project
   - Go to Settings > Database
   - **Get two connection strings:**
     - **DATABASE_URL** (for Prisma Client): Use "Transaction Pooler" connection string
       - Format: `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
       - Add `?pgbouncer=true` to the end
     - **DIRECT_URL** (for Prisma CLI): Use "Direct connection" string
       - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`
   - Replace `[PASSWORD]`, `[PROJECT-REF]`, and `[REGION]` in both URLs
   - Install PostgreSQL adapter (if not already installed):
     ```bash
     npm install @prisma/adapter-pg pg
     ```
   - Run Prisma migrations to create tables:
     ```bash
     npx prisma migrate dev --name init
     ```
   - Or if tables already exist, generate Prisma client:
     ```bash
     npx prisma generate
     ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build for Production

```bash
npm run build
npm start
```

## Database Setup (Prisma + Supabase)

This app uses **Prisma ORM** with **Supabase (PostgreSQL)** for cloud database storage, providing:
- **Type-safe database access** - Full TypeScript support with Prisma
- **Cross-device sync** - Access your journal from any device
- **Automatic user isolation** - Each user's data is securely separated
- **No storage limits** - Unlike localStorage, no quota issues
- **Backup & recovery** - Data is safely stored in the cloud
- **Easy migrations** - Database schema managed with Prisma migrations

### Setting up Prisma with Supabase:

1. **Create a Supabase account** at [supabase.com](https://supabase.com) (free tier available)
2. **Create a new project**
3. **Get your database connection strings** (you need TWO):
   - Go to Settings > Database
   - **For DATABASE_URL** (Prisma Client runtime):
     - Use "Transaction Pooler" connection string
     - Format: `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true`
     - This uses connection pooling (required for serverless/serverless-like environments)
   - **For DIRECT_URL** (Prisma CLI):
     - Use "Direct connection" string
     - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`
     - This is used by Prisma CLI for migrations and introspection
4. **Add both URLs to `.env.local`** (see step 2 above)
5. **Run Prisma migrations**:
   ```bash
   npx prisma migrate dev --name init
   ```
   This will:
   - Create the `journal_entries` and `user_preferences` tables
   - Generate the Prisma Client for type-safe database access
   - Uses `DIRECT_URL` for migration operations
6. **Generate Prisma Client** (if needed):
   ```bash
   npx prisma generate
   ```

> **Important:** Supabase requires two connection strings:
> - **DATABASE_URL** (pooled) - For Prisma Client at runtime (with `?pgbouncer=true`)
> - **DIRECT_URL** (direct) - For Prisma CLI operations (migrations, introspection)
> 
> This setup allows your app to use connection pooling (better for serverless) while Prisma CLI can perform schema operations that require direct connections.

### Prisma Commands:

- `npx prisma studio` - Open Prisma Studio to view/edit database data
- `npx prisma migrate dev` - Create and apply new migrations
- `npx prisma generate` - Regenerate Prisma Client after schema changes
- `npx prisma db push` - Push schema changes without creating migrations (development only)

**Note:** If the database is not configured, the app will:
- Still work for demo mode (using localStorage)
- Fallback to localStorage for authenticated users (with a warning)
- Full functionality requires database setup

## Authentication

This app uses NextAuth.js for authentication. Users can sign in with:

- **Google OAuth** (required) - One-click Google sign-in
- **Demo mode** - Try the app without signing in (data stored locally only)

The app requires authentication or demo mode to access. Unauthenticated users are redirected to the login page.

### Setting up Google OAuth:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or select an existing one)
2. Enable the Google+ API for your project
3. Go to "Credentials" and create an OAuth 2.0 Client ID
4. Set the application type to "Web application"
5. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://yourdomain.com/api/auth/callback/google`
6. Copy your Client ID and Client Secret
7. Add the credentials to your `.env.local`:
   ```
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

## Project Structure

- `app/` - Next.js App Router directory
  - `layout.tsx` - Root layout with fonts and metadata
  - `page.tsx` - Home page
  - `globals.css` - Global styles and Tailwind CSS
  - `auth.ts` - NextAuth.js configuration
  - `providers.tsx` - Session provider wrapper
  - `login/` - Login page
    - `page.tsx` - Authentication page
  - `api/auth/[...nextauth]/` - NextAuth API routes
- `components/` - React components
  - `JournalApp.tsx` - Main application component
  - `ChatInterface.tsx` - Chat interface component
  - `HistoryView.tsx` - History view component
  - `ReflectionCard.tsx` - Reflection card component
- `services/` - Service layer
  - `geminiService.ts` - Gemini AI service integration
  - `historyService.ts` - Database operations via API routes
- `utils/` - Utility functions
  - `prisma.ts` - Prisma Client instance (server-side)
  - `audioCache.ts` - IndexedDB audio cache management
  - `toast.tsx` - Toast notification system
- `prisma/` - Prisma configuration
  - `schema.prisma` - Database schema definition
- `api/` - API routes
  - `auth/[...nextauth]/` - NextAuth.js API routes
  - `history/` - Journal entries API (Supabase operations)
  - `preferences/` - User preferences API (Supabase operations)
- `types.ts` - TypeScript type definitions
- `middleware.ts` - Next.js middleware for route protection
