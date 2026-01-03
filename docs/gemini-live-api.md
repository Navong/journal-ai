# Gemini Live API Overview

## What is the Live API?

The Live API facilitates **low-latency, real-time voice and video interactions with Gemini**. It processes continuous audio, video, or text streams to deliver immediate spoken responses, enabling natural conversations.

## How It Works

Two implementation approaches exist:

### Server-to-server
Backend connects via WebSockets, forwarding client stream data to the API

### Client-to-server
Frontend connects directly to the API via WebSockets, offering better performance but requiring ephemeral tokens for security

## Key Features

- **Voice Activity Detection** and interruptions
- **Tool use and function calling**
- **Session management** for long-running conversations
- **Ephemeral tokens** for secure client authentication
- **Native audio support**
  - Input: 16-bit PCM, 16kHz, mono
  - Output: 24kHz

## Code Examples

Both Python and JavaScript implementations are available:

### Python
Uses `google.genai` client to:
- Connect asynchronously to the model
- Send audio via `send_realtime_input()`
- Receive responses through an async iterator

### JavaScript
Uses `@google/genai` with WebSocket callbacks for `onopen`, `onmessage`, `onerror`, and `onclose` events.

## WebSocket Endpoint

```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent
```

## Journaling App Considerations

### Current Implementation vs Live API

**Current Serenity Journal:**
- User types → AI generates text → TTS converts to audio
- Separate steps, not real-time
- Uses REST API calls

**Live API Approach:**
- User speaks → AI hears in real-time → AI responds with voice immediately
- Single continuous WebSocket connection
- Natural conversation flow

### Potential Use Cases for Serenity

1. **Voice journaling** - Speak journal entries instead of typing
2. **Conversational reflections** - Have a real voice conversation with Serenity
3. **Hands-free mode** - Journal while walking, driving, etc.
4. **Real-time emotional support** - Natural spoken conversation with AI companion

### Implementation Requirements

- WebSocket connection management
- Audio input/output handling (Web Audio API)
- Ephemeral token generation for client-side security
- Session management for multi-turn conversations
- Audio format conversion (16-bit PCM, 16kHz, mono)
- Voice Activity Detection handling
- Interruption support

## References

- [Official Documentation](https://ai.google.dev/gemini-api/docs/live?example=file-stream)
- API Endpoint: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`
