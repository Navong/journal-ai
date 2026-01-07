// Token estimation utilities
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function daysBetween(date1: string, date2: Date = new Date()): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
