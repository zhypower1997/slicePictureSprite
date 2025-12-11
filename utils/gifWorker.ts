
// Fetch the standard gif.worker.js from CDN to ensure we have a valid, non-corrupt worker script.
// This resolves issues with "s is not defined" or "e.writeHeader is not a function" caused by broken inline code.

export const getGifWorkerUrl = async (): Promise<string> => {
  try {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
    if (!response.ok) {
        throw new Error(`Failed to fetch worker script: ${response.statusText}`);
    }
    const workerScript = await response.text();
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Could not load GIF worker script:", error);
    // Fallback: If fetch fails (e.g. offline), we might be stuck, 
    // but better to fail loudly than crash silently with obscure errors.
    throw error;
  }
};
