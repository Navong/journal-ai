# Serenity Journal

A clean, calming journaling app that generates thoughtful AI reflections (and optional follow-up chat) to support mental wellness.

## Features

- **AI reflections + summaries**: Generates an empathetic reflection and a one-line summary for each entry.
- **Follow-up chat**: Ask questions after a reflection to continue the thread.
- **History**: View, delete, or clear past entries.
- **Entity awareness**: Extracts and reuses people/places/events context across recent entries.
- **Highlights**: AI returns phrases to visually emphasize (main idea, stressors/triggers, identity wins).
- **Auth + demo mode**:
  - **Google OAuth** sign-in (NextAuth).
  - **Demo Mode** (no sign-in; stores data locally in the browser).
  - **Dev Login** provider appears only when `NODE_ENV=development`.

## Tech stack

- **Next.js 16** (App Router) + **React 19**
- **NextAuth v5 (beta)** for authentication
- **MongoDB** + **Mongoose**
- **Tailwind CSS**
- **Gemini API** via `@google/genai`

## Getting started

### Prereqs

- **Node.js** (recommended: current LTS)
- A **MongoDB** database (local or hosted)
- A **Gemini API key**
- (Optional) Google OAuth credentials for sign-in

### Install

```bash
npm install
```

### Environment variables

Create `.env.local` (recommended) or `.env` with the following variables.

> Important: don’t commit real secrets. This repo currently contains an `.env` file in the root — treat it as local-only and rotate any keys that were ever committed.

| Variable | Required | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_GEMINI_API_KEY` (or `GEMINI_API_KEY`) | Yes | Gemini calls for reflections, embeddings, and chat |
| `AUTH_SECRET` | Yes | NextAuth session/JWT signing |
| `GOOGLE_CLIENT_ID` | Yes (unless using Demo Mode / Dev Login) | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Yes (unless using Demo Mode / Dev Login) | Google OAuth |
| `MONGODB_URI` | Yes (for persisted history/preferences) | MongoDB connection string for entries/preferences |

Notes:

- **Demo Mode** does not require a database; entries are stored in `localStorage`.

### Run dev server

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Usage

### Sign in options

- **Google**: uses NextAuth Google provider.
- **Demo Mode**: click “Try Demo — No sign-in required”. This sets a `demo-mode=true` cookie for ~24 hours.
- **Dev Login** (development only): available on the login screen when running locally in dev; signs in as a fixed dev user.

### History storage

- **Authenticated users**: entries and preferences are stored in MongoDB and served through API routes under `app/api/*`.
- **Demo mode**: entries/preferences are stored in the browser (`localStorage`) and are not persisted to the database.

## Scripts

```bash
npm run dev      # start Next.js dev server
npm run build    # next build
npm run start    # start production server
```

## Deployment

This is a standard Next.js app. For production you’ll need:

- All required **environment variables** configured in your hosting platform
- A reachable **MongoDB** database

## Security notes

- Treat journal entries as sensitive. Keep `AUTH_SECRET`, OAuth secrets, and DB credentials out of git.
- If secrets were ever committed, **rotate them** immediately.

## Docs

- See `docs/gemini-live-api.md` for notes on Gemini Live API (not currently required for the core app).

