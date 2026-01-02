/**
 * TTS Request Queue
 * Helps prevent overwhelming the API with too many simultaneous requests
 */

interface QueuedRequest {
  text: string;
  resolve: (value: string | undefined) => void;
  reject: (error: any) => void;
}

class TTSRequestQueue {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private readonly MAX_CONCURRENT = 1; // Process one at a time to avoid rate limits
  private currentProcessing = 0;

  async enqueue(text: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.currentProcessing >= this.MAX_CONCURRENT || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.currentProcessing < this.MAX_CONCURRENT) {
      const request = this.queue.shift();
      if (!request) break;

      this.currentProcessing++;
      
      // Process request asynchronously
      this.processRequest(request)
        .finally(() => {
          this.currentProcessing--;
          this.processing = false;
          // Process next item in queue
          setTimeout(() => this.processQueue(), 0);
        });
    }

    this.processing = false;
  }

  private async processRequest(request: QueuedRequest) {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: request.text }),
      });

      if (response.status === 429) {
        // Rate limit - wait and retry
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Retry once
        const retryResponse = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: request.text }),
        });

        if (!retryResponse.ok) {
          const errorData = await retryResponse.json().catch(() => ({}));
          throw new Error(errorData.message || 'Rate limit exceeded');
        }

        const data = await retryResponse.json();
        request.resolve(data.audioData);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `TTS API error: ${response.status}`);
      }

      const data = await response.json();
      request.resolve(data.audioData);
    } catch (error) {
      request.reject(error);
    }
  }
}

// Export singleton instance
export const ttsQueue = new TTSRequestQueue();

