
// Utility to convert image URL to Base64, primarily for avatars
export const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    if (url.startsWith('data:image')) {
        return url; // Already base64
    }

    try {
        // Add a timeout to the fetch call
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn("Failed to fetch image for conversion:", url);
            return null;
        }
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn("CORS or network error fetching image for Base64 conversion:", error);
        return null;
    }
};

export const extractBase64Data = (dataUrl: string) => {
    // Splits "data:image/png;base64,....." to get just the base64 part and mimeType
    // Uses [\s\S]+ to match across newlines if present in the data string
    const matches = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!matches || matches.length !== 3) {
        return null;
    }
    return {
        mimeType: matches[1],
        data: matches[2]
    };
};
