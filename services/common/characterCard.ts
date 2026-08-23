// Character Card interop (SillyTavern / JanitorAI / chub.ai ecosystem).
//
// Reads and writes the de-facto standard "character card" format: a PNG image
// with the card JSON base64-encoded inside a tEXt chunk under the keyword
// "chara" (spec V1/V2) or "ccv3" (spec V3). Also normalizes plain-JSON cards.
//
// Import: V1 (flat fields), V2 (`spec: chara_card_v2`), V3 (`spec: chara_card_v3`)
// → RWE Character, including character_book → keyword-triggered LoreEntry.
// Export: Character → V2 card (the most widely accepted spec) with a lossless
// RWE roundtrip payload under data.extensions.rwe.

import { Character, FirstMessage, LoreEntry, Setting } from '../../types';

// ---------------------------------------------------------------------------
// PNG tEXt chunk codec
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const isPng = (bytes: Uint8Array): boolean =>
    bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

interface PngChunk {
    type: string;
    // Offset/length of the full chunk (length + type + data + crc) in the file.
    start: number;
    end: number;
    data: Uint8Array;
}

const readChunks = (bytes: Uint8Array): PngChunk[] => {
    const chunks: PngChunk[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        const end = offset + 12 + length;
        if (end > bytes.length) break;
        chunks.push({ type, start: offset, end, data: bytes.subarray(offset + 8, offset + 8 + length) });
        if (type === 'IEND') break;
        offset = end;
    }
    return chunks;
};

const decodeLatin1 = (bytes: Uint8Array): string => {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
};

const base64ToBytes = (b64: string): Uint8Array => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
};

/** Extracts the raw card JSON object embedded in a PNG, or null if none. */
export const readCardFromPng = (bytes: Uint8Array): any | null => {
    if (!isPng(bytes)) return null;
    const texts: Record<string, string> = {};
    for (const chunk of readChunks(bytes)) {
        if (chunk.type !== 'tEXt') continue;
        const sep = chunk.data.indexOf(0);
        if (sep < 0) continue;
        const keyword = decodeLatin1(chunk.data.subarray(0, sep)).toLowerCase();
        texts[keyword] = decodeLatin1(chunk.data.subarray(sep + 1));
    }
    const payload = texts['ccv3'] ?? texts['chara'];
    if (!payload) return null;
    try {
        return JSON.parse(new TextDecoder().decode(base64ToBytes(payload)));
    } catch {
        return null;
    }
};

const buildTextChunk = (keyword: string, text: string): Uint8Array => {
    const keywordBytes = new Uint8Array([...keyword].map(c => c.charCodeAt(0)));
    const textBytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xff));
    const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    data.set(keywordBytes, 0);
    data[keywordBytes.length] = 0;
    data.set(textBytes, keywordBytes.length + 1);

    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
    chunk.set(data, 8);
    const crcInput = chunk.subarray(4, 8 + data.length);
    view.setUint32(8 + data.length, crc32(crcInput));
    return chunk;
};

/** Returns a copy of the PNG with the card JSON embedded (replacing any existing card). */
export const writeCardToPng = (bytes: Uint8Array, card: object): Uint8Array => {
    if (!isPng(bytes)) throw new Error('Not a PNG file');
    const chunks = readChunks(bytes);
    const iend = chunks.find(c => c.type === 'IEND');
    if (!iend) throw new Error('Malformed PNG: missing IEND');

    // Drop pre-existing card chunks so re-exports don't accumulate stale data.
    const isCardChunk = (c: PngChunk) => {
        if (c.type !== 'tEXt') return false;
        const sep = c.data.indexOf(0);
        const keyword = sep >= 0 ? decodeLatin1(c.data.subarray(0, sep)).toLowerCase() : '';
        return keyword === 'chara' || keyword === 'ccv3';
    };

    const payload = bytesToBase64(new TextEncoder().encode(JSON.stringify(card)));
    const cardChunk = buildTextChunk('chara', payload);

    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    for (const chunk of chunks) {
        if (isCardChunk(chunk)) continue;
        if (chunk.type === 'IEND') parts.push(cardChunk);
        parts.push(bytes.subarray(chunk.start, chunk.end));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
};

// ---------------------------------------------------------------------------
// Card JSON → Character
// ---------------------------------------------------------------------------

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

const slugify = (s: string): string =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || crypto.randomUUID();

const normalizeCharacterBook = (book: any): LoreEntry[] => {
    const rawEntries = Array.isArray(book?.entries)
        ? book.entries
        : book?.entries && typeof book.entries === 'object'
            ? Object.values(book.entries)
            : [];
    const used = new Set<string>();
    return rawEntries
        .filter((e: any) => e && typeof e === 'object')
        .map((e: any): LoreEntry => {
            const keys = (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [])
                .map(asString).map((k: string) => k.trim()).filter(Boolean);
            const name = asString(e.comment) || asString(e.name) || keys.join(', ') || 'Entry';
            let id = slugify(name);
            while (used.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
            used.add(id);
            return {
                id,
                name,
                content: asString(e.content),
                type: 'setting',
                keys,
                alwaysActive: e.constant === true,
                disabled: e.enabled === false,
            };
        })
        .filter((e: LoreEntry) => e.content.trim() !== '');
};

export interface NormalizedCard {
    character: Character;
    /** True when the card carried an RWE roundtrip payload. */
    isRoundtrip: boolean;
}

/**
 * Normalizes any supported card JSON (V1 flat, V2, V3, or a previous
 * RWE export) into a Character. `imageDataUrl` is used as the avatar
 * when the card itself doesn't carry one.
 */
export const cardToCharacter = (
    json: any,
    sharedSystemTemplate: string,
    sharedPlayerDescription: string,
    imageDataUrl?: string
): NormalizedCard => {
    const data = json?.data && typeof json.data === 'object' ? json.data : json ?? {};
    const rwe = data.extensions?.rwe;

    const description = asString(data.description);
    const personalityField = asString(data.personality);
    const mesExample = asString(data.mes_example);

    // Many exports (ours included) mirror the same text into both description and
    // personality — joining identical strings would double the character card.
    const personalityParts = [description];
    if (personalityField && personalityField.trim() !== description.trim()) {
        personalityParts.push(personalityField);
    }
    let personality = personalityParts.filter(Boolean).join('\n\n');
    if (mesExample.trim()) {
        personality += `${personality ? '\n\n' : ''}Example dialogue:\n${mesExample.trim()}`;
    }

    const primaryGreeting = asString(data.first_mes) || asString(json?.first_message);
    const alternates = (Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [])
        .map(asString).filter(Boolean);

    let firstMessages: FirstMessage[];
    if (Array.isArray(rwe?.firstMessages) && rwe.firstMessages.length > 0) {
        firstMessages = rwe.firstMessages;
    } else if (Array.isArray(rwe?.alternativeFirstMessages) && rwe.alternativeFirstMessages.length > 0) {
        // Older export format: alternates as a bare string array.
        firstMessages = [
            { text: primaryGreeting },
            ...rwe.alternativeFirstMessages.map((t: unknown) => ({ text: asString(t) })),
        ];
    } else {
        const texts = [primaryGreeting, ...alternates].filter(t => t.trim() !== '');
        firstMessages = texts.length > 0 ? texts.map(text => ({ text })) : [{ text: '' }];
    }

    const scenario = asString(rwe?.scenario) || asString(data.scenario) || asString(json?.world_scenario);

    let availableSettings: Setting[] | undefined;
    let setting = asString(rwe?.setting);
    if (Array.isArray(rwe?.availableSettings) && rwe.availableSettings.length > 0) {
        availableSettings = rwe.availableSettings;
        setting = setting || availableSettings![0].content;
    }

    const loreBook: LoreEntry[] | undefined = Array.isArray(rwe?.loreBook) && rwe.loreBook.length > 0
        ? rwe.loreBook
        : (data.character_book ? normalizeCharacterBook(data.character_book) : undefined);

    const character: Character = {
        id: asString(rwe?.id) || crypto.randomUUID(),
        name: asString(data.name) || asString(json?.char_name) || 'Unknown',
        image: asString(rwe?.image) || imageDataUrl || asString(json?.avatar_url)
            || 'https://via.placeholder.com/400x600?text=No+Image',
        personality,
        firstMessages,
        setting,
        scenario: scenario || undefined,
        systemInstructionTemplate: sharedSystemTemplate,
        playerDescription: sharedPlayerDescription,
        availableSettings,
        loreBook: loreBook && loreBook.length > 0 ? loreBook : undefined,
        playerName: 'User',
        tags: Array.isArray(data.tags) ? data.tags.map(asString).filter(Boolean) : [],
        lastModified: Date.now(),
    };

    return { character, isRoundtrip: !!rwe };
};

// ---------------------------------------------------------------------------
// Character → Card JSON
// ---------------------------------------------------------------------------

export const characterToCard = (char: Character): object => {
    const greetings = char.firstMessages ?? [];
    const characterBook = char.loreBook && char.loreBook.length > 0
        ? {
            name: `${char.name} Lorebook`,
            entries: char.loreBook.map((e, i) => ({
                keys: e.keys ?? [],
                content: e.content,
                extensions: {},
                enabled: e.disabled !== true,
                insertion_order: i,
                comment: e.name,
                constant: e.alwaysActive === true,
            })),
        }
        : undefined;

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: char.name,
            description: char.personality,
            personality: '',
            scenario: char.scenario ?? char.setting ?? '',
            first_mes: greetings[0]?.text ?? '',
            mes_example: '',
            creator_notes: 'Exported from RWE.',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: greetings.slice(1).map(m => m.text),
            character_book: characterBook,
            tags: char.tags ?? [],
            creator: '',
            character_version: '',
            extensions: {
                rwe: {
                    id: char.id,
                    firstMessages: char.firstMessages,
                    availableSettings: char.availableSettings,
                    scenario: char.scenario,
                    setting: char.setting,
                    loreBook: char.loreBook,
                },
            },
        },
    };
};

// ---------------------------------------------------------------------------
// Avatar helpers for import
// ---------------------------------------------------------------------------

// localStorage holds ~5MB for the whole origin; storing multi-MB card art
// verbatim would let a couple of imports silently exceed quota (characters
// would then vanish on reload). Avatars above this size are downscaled.
const MAX_AVATAR_BYTES = 300 * 1024;
const MAX_AVATAR_DIM = 768;

export const compressAvatarDataUrl = async (dataUrl: string): Promise<string> => {
    if (!dataUrl.startsWith('data:image/')) return dataUrl;
    const approxBytes = Math.ceil(dataUrl.length * 3 / 4);
    if (approxBytes <= MAX_AVATAR_BYTES) return dataUrl;
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('avatar load failed'));
            i.src = dataUrl;
        });
        const scale = Math.min(1, MAX_AVATAR_DIM / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        return compressed.length < dataUrl.length ? compressed : dataUrl;
    } catch {
        return dataUrl;
    }
};

// ---------------------------------------------------------------------------
// Avatar helpers for export
// ---------------------------------------------------------------------------

/**
 * Produces PNG bytes for the character's avatar. Data-URL PNGs are used as-is;
 * other images are re-encoded through a canvas; when the avatar can't be
 * loaded at all (e.g. CORS) a simple placeholder card is drawn instead, so a
 * valid PNG card can always be exported.
 */
export const characterImageToPngBytes = async (char: Character): Promise<Uint8Array> => {
    const image = char.image ?? '';

    if (image.startsWith('data:image/png;base64,')) {
        return base64ToBytes(image.slice('data:image/png;base64,'.length));
    }

    const drawToPng = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): Uint8Array => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        draw(ctx, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        return base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };

    if (image) {
        try {
            const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Image failed to load'));
                img.src = image;
            });
            return drawToPng(ctx => ctx.drawImage(loaded, 0, 0), loaded.naturalWidth || 400, loaded.naturalHeight || 600);
        } catch {
            // Fall through to the placeholder
        }
    }

    return drawToPng((ctx, w, h) => {
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, '#312e81');
        gradient.addColorStop(1, '#831843');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(char.name.slice(0, 18), w / 2, h / 2);
    }, 400, 600);
};
