/** Bound UI waits; database writes may still sync after a network timeout. */
export async function withDeadline<T>(operation: Promise<T>, milliseconds = 15000): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Connection timed out. Please check your connection and retry.')), milliseconds);
        })]);
    } finally {
        clearTimeout(timer!);
    }
}
