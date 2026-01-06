// Utility functions for retry logic and error handling

export const withRetry = async <T,>(
    operationId: string,
    operation: () => Promise<T>,
    maxRetries = 3,
    retryDelay = 1000
): Promise<T> => {
    let ongoingOperations = new Set<string>();

    const attemptOperation = async (attempt: number): Promise<T> => {
        try {
            const result = await operation();
            ongoingOperations.delete(operationId);
            return result;
        } catch (error) {
            const isSuspensionError = error instanceof Error && (
                error.message.includes('network') ||
                error.message.includes('timeout') ||
                error.message.includes('aborted') ||
                error.message.includes('Failed to fetch')
            );

            if (isSuspensionError && attempt < maxRetries) {
                console.log(`[withRetry] Operation ${operationId} suspended, retrying (attempt ${attempt + 1}/${maxRetries})...`);

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                return attemptOperation(attempt + 1);
            }

            ongoingOperations.delete(operationId);
            throw error;
        }
    };

    ongoingOperations.add(operationId);
    return attemptOperation(1);
};