
export interface TTSProvider {
  generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined>;
}
