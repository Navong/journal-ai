# Serenity Journal - Project Documentation

## Project Overview

Serenity Journal is a Next.js 16 application that provides a clean, calming, and minimalist journaling space with thoughtful AI reflections to support mental wellness. The application features:

- **AI-powered reflections** using Google's Gemini API
- **Text-to-speech** functionality for audio playback of reflections
- **Secure authentication** with Google OAuth
- **Cross-device sync** using Supabase PostgreSQL database
- **Entity extraction** to identify people, places, events, and organizations
- **Progressive Web App** capabilities with offline support
- **Detailed highlighting** of key phrases in reflections

## Architecture

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI Components**: Radix UI primitives, Tailwind CSS for styling
- **State Management**: React hooks and client-side state
- **Audio**: Web Audio API with IndexedDB caching for offline audio playback

### Backend
- **Authentication**: NextAuth.js with Google OAuth
- **Database**: Supabase (PostgreSQL) with Prisma ORM
- **AI Integration**: Google Gemini API for reflections and entity extraction
- **Text-to-Speech**: Cartesia AI for audio generation
- **API Routes**: Next.js API routes for database operations

### Data Flow
1. User writes journal entry
2. Entry is processed through AI for mood detection, topic identification, and entity extraction
3. AI generates personalized reflection with highlights
4. Audio is generated and cached locally
5. Data is synced to Supabase database for cross-device access

## Key Features

### AI Reflection System
- **Mood Detection**: Automatically detects emotional state from journal entries
- **Topic Identification**: Identifies main subject matter of entries
- **Entity Extraction**: Identifies people, places, events, and organizations
- **Context Awareness**: Remembers past entries to provide continuity
- **Progressive Highlights**: Identifies and highlights key phrases (main ideas, stressors, wins)

### Audio System
- **Text-to-Speech**: Converts reflections to audio using Cartesia AI
- **Caching**: IndexedDB caching for offline audio playback
- **Background Sync**: Automatic sync of audio files to Supabase
- **Chunked Processing**: Handles long texts by breaking into smaller chunks

### Entity Tracking
- **Pattern Recognition**: Tracks recurring people, places, and events
- **Context Building**: Builds context from recent entries for AI
- **Upcoming Events**: Identifies and highlights upcoming deadlines/events

### Cross-Device Sync
- **Database Storage**: Supabase PostgreSQL for cloud storage
- **User Isolation**: Secure separation of user data
- **Audio Sync**: Automatic background sync of audio files
- **Preferences**: User preference storage (auto-play settings)

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── components/         # React components (JournalApp, ChatInterface, etc.)
│   ├── services/           # API services (geminiService, historyService)
│   ├── utils/              # Utility functions (audioCache, encryption, etc.)
│   ├── api/                # API routes (auth, history, preferences, tts)
│   ├── auth.ts            # NextAuth configuration
│   ├── providers.tsx      # React context providers
│   └── layout.tsx         # Root layout
├── prisma/                # Database schema and migrations
├── components/            # Reusable UI components
├── types.ts               # TypeScript type definitions
├── middleware.ts          # Next.js middleware for auth protection
├── next.config.js         # Next.js configuration
├── package.json           # Dependencies and scripts
```

## Environment Variables

The application requires the following environment variables:

```bash
# Required: Gemini API key for AI reflections
NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here

# Required: NextAuth secret (generate with: openssl rand -base64 32)
AUTH_SECRET=your_auth_secret_here

# Required: Database connection (Prisma + Supabase)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Required: Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

## Building and Running

### Development
```bash
# Install dependencies
npm install

# Set up environment variables in .env.local
# Run development server
npm run dev
```

### Production
```bash
# Build the application
npm run build

# Start the production server
npm start
```

### Database Setup
```bash
# Run Prisma migrations
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate
```

## Development Conventions

### Code Style
- TypeScript with strict typing
- React hooks for state management
- Functional components with TypeScript interfaces
- Tailwind CSS for styling with utility-first approach

### API Design
- Next.js API routes for backend functionality
- RESTful endpoints with JSON responses
- Error handling with appropriate HTTP status codes
- Authentication middleware for protected routes

### Data Management
- Prisma ORM for database operations
- Type-safe database access
- User data isolation and privacy protection
- Secure ID generation using email hashing

## Key Components

### JournalApp.tsx
Main application component that handles:
- Journal entry input and reflection generation
- Audio playback and caching
- History management
- Chat interface with AI
- User authentication state

### geminiService.ts
Handles all AI interactions:
- Reflection generation with context awareness
- Mood and topic detection
- Entity extraction
- Text-to-speech generation
- Token usage tracking

### historyService.ts
Manages database operations:
- Journal entry storage and retrieval
- Audio data synchronization
- User preferences management
- Cross-device sync

### Audio System
- IndexedDB caching for offline audio
- Background sync with Supabase
- Progressive playback for long texts
- Audio optimization for storage efficiency

## Security Features

- **Email Hashing**: User emails are hashed to generate secure IDs
- **Authentication**: Google OAuth with NextAuth.js
- **Data Isolation**: Each user's data is securely separated
- **Environment Security**: Sensitive keys stored in environment variables
- **API Protection**: Middleware to protect routes

## Testing

The project includes Jest for testing:
- Unit tests for utility functions
- Integration tests for API routes
- Component tests for React components

Run tests with:
```bash
npm test
```

## Deployment

The application is designed for deployment on platforms that support Next.js:
- Vercel (recommended for Next.js apps)
- Netlify
- AWS, GCP, or other cloud platforms
- Self-hosted Node.js servers

## Troubleshooting

### Common Issues
- **API Key Issues**: Ensure NEXT_PUBLIC_GEMINI_API_KEY is properly set
- **Database Connection**: Verify Supabase connection strings and Prisma setup
- **Audio Playback**: Check browser permissions and AudioContext initialization
- **Authentication**: Ensure Google OAuth credentials are correctly configured

### Performance
- Audio files are optimized and cached for performance
- Database queries are optimized with proper indexing
- AI responses include token usage for cost transparency
- Background sync runs periodically to avoid blocking UI