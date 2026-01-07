# Technical Context: Serenity Journal

## Core Technology Stack

### Frontend Framework
- **Next.js 16**: App Router with React 18
- **TypeScript**: Strict type checking
- **Tailwind CSS**: Utility-first styling

### Backend & Database
- **Supabase**: Managed PostgreSQL
- **Prisma ORM**: Type-safe database client

### AI Integration
- **Google Gemini API**: Native SDK for optimized Google models
- **OpenRouter SDK**: Unified access to Grok and hundreds of other models
- **Embedding Models**: `text-embedding-004` (Google) and `text-embedding-3-small` (OpenRouter)

## Development Environment

### Runtime Requirements
- **Node.js**: Minimum v18
- **Package Manager**: NPM

### Key Environment Variables (`.env.local`)
| Variable | Description | Client Exposed? |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_GEMINI_API_KEY` | Primary key for Gemini models | Yes (for testing) |
| `OPENROUTER_API_KEY` | Server-side key for Grok/OpenRouter | No (Security) |
| `NEXT_PUBLIC_OPENROUTER_API_KEY` | Client-side key for Grok testing | Yes (Dev only) |
| `DATABASE_URL` | Pooled connection string | No |
| `AUTH_SECRET` | NextAuth.js encryption secret | No |

## API Integrations

### OpenRouter SDK (`@openrouter/sdk`)
- **Usage**: Handles all logic for Grok models.
- **Model**: `x-ai/grok-4.1-fast` (Streaming enabled).
- **Features**: Automatic token usage tracking including `reasoningTokens`.

### Google Gemini SDK
- **Usage**: Main provider for cost-efficient long-context journaling.
- **Model**: `gemini-1.5-flash` / `gemini-1.5-pro`.
- **Features**: Context caching for cost reduction.

## Key Dependencies

### Runtimes & SDKs
```json
{
  "next": "^16.0.0",
  "@google/generative-ai": "latest",
  "@openrouter/sdk": "latest",
  "@prisma/client": "latest",
  "next-auth": "5.0.0-beta.x"
}
```

## Infrastructure Constraints

### Security Measures
- **Public API Keys**: Support for `NEXT_PUBLIC_` prefixes restricted to development/test environments.
- **Production Safety**: Server-side proxies recommended for all high-value keys.
- **Database Security**: Prisma scopes all queries by `userId` to ensure data isolation.

---

*Technical context updated to include multi-SDK architecture and refined environment variable strategy.*
- **Connection Pooling**: Automatic connection management
