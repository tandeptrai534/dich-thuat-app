
import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzedText, GrammarRole } from './types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const analysisSystemInstruction = `You are an expert linguist and translator specializing in Chinese and Vietnamese. Your task is to perform a detailed grammatical analysis and translation of a single Chinese sentence.

**RESPONSE FORMAT:**
You MUST return the output as a single, valid JSON object that conforms to the provided schema. Do not include any text outside of the JSON object.

**ANALYSIS & TRANSLATION RULES:**
1.  **Tokenization:** Break down the Chinese sentence into its fundamental components (words, characters, punctuation). Each component is a "token".
2.  **Detailed Token Information:** For each token, you must provide:
    -   \\\`character\\\`: The original Chinese character(s).
    -   \\\`pinyin\\\`: The correct Pinyin transcription.
    -   \\\`sinoVietnamese\\\`: The Sino-Vietnamese (Hán Việt) reading.
    -   \\\`vietnameseMeaning\\\`: A concise Vietnamese meaning of the token.
    -   \\\`grammarRole\\\`: The grammatical function (Subject, Predicate, Object, etc.). Use "Unknown" if unclear.
    -   \\\`grammarExplanation\\\`: A brief explanation of the token's role and meaning in the context of the sentence. **This explanation MUST be in VIETNAMESE.**
3.  **Segmented Translation:**
    -   Translate the full sentence into natural, fluent Vietnamese.
    -   Crucially, you must then break down this translation into segments (\\\`translation\\\` array).
    -   Each segment's \\\`grammarRole\\\` MUST correspond to the \\\`grammarRole\\\` of the original Chinese token it translates. This is essential for color-coding. Ensure all parts of the translation are assigned to a segment.
4.  **Strict Translation Rules:**
    -   **Consistency:** Translate all proper nouns (names, places, etc.) using their Sino-Vietnamese (Hán Việt) reading.
    -   **Pronouns:** 我 -> "ta", 你 -> "ngươi", 他 -> "hắn", 她 -> "nàng".
    -   **Formatting:** Preserve original formatting and punctuation in the translation.
    -   **Completeness:** Translate everything. No Chinese characters should remain in the Vietnamese translation.
    -   **Quality:** Correct all Vietnamese spelling errors before outputting.`;

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        tokens: {
            type: Type.ARRAY,
            description: "An array of token objects, one for each component of the original sentence.",
            items: {
                type: Type.OBJECT,
                properties: {
                    character: { type: Type.STRING, description: "The original Chinese character(s) for this token." },
                    pinyin: { type: Type.STRING, description: "Pinyin transcription." },
                    sinoVietnamese: { type: Type.STRING, description: "Sino-Vietnamese (Hán Việt) reading." },
                    vietnameseMeaning: { type: Type.STRING, description: "The token's meaning in Vietnamese." },
                    grammarRole: {
                        type: Type.STRING,
                        enum: [
                            'Subject', 'Predicate', 'Object', 'Adverbial', 'Complement',
                            'Attribute', 'Particle', 'Interjection', 'Conjunction',
                            'Numeral', 'Measure Word', 'Unknown'
                        ],
                        description: "The grammatical role of the token."
                    },
                    grammarExplanation: { type: Type.STRING, description: "A brief explanation of the token's function in the sentence, written in Vietnamese." }
                },
                required: ["character", "pinyin", "sinoVietnamese", "vietnameseMeaning", "grammarRole", "grammarExplanation"]
            }
        },
        translation: {
            type: Type.ARRAY,
            description: "The Vietnamese translation, broken into segments that correspond to the tokens for color-coding.",
            items: {
                type: Type.OBJECT,
                properties: {
                    segment: { type: Type.STRING, description: "A piece of the Vietnamese translation." },
                    grammarRole: {
                        type: Type.STRING,
                        enum: [
                            'Subject', 'Predicate', 'Object', 'Adverbial', 'Complement',
                            'Attribute', 'Particle', 'Interjection', 'Conjunction',
                            'Numeral', 'Measure Word', 'Unknown'
                        ],
                        description: "The grammar role of the original token this segment translates."
                    }
                },
                required: ["segment", "grammarRole"]
            }
        }
    },
    required: ["tokens", "translation"]
};

const translationSystemInstruction = `You are an expert translator specializing in Chinese and Vietnamese. Your task is to translate the given text accurately and naturally.

**TRANSLATION RULES:**
1.  **Consistency:** Translate all proper nouns (names, places, etc.) using their Sino-Vietnamese (Hán Việt) reading.
2.  **Pronouns:** 我 -> "ta", 你 -> "ngươi", 他 -> "hắn", 她 -> "nàng".
3.  **Formatting:** Preserve original formatting, including line breaks and punctuation. If the original text has line breaks to separate paragraphs, the translation must have them too.
4.  **Completeness:** Translate EVERYTHING. No Chinese characters should remain in the final Vietnamese translation.
5.  **Quality:** Correct all Vietnamese spelling errors before outputting.
6.  **Output:** Return ONLY the translated Vietnamese text, with no extra explanations, titles, or formatting.
`;

export const analyzeSentence = async (sentence: string): Promise<AnalyzedText> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Please analyze and translate this sentence: "${sentence}"`,
            config: {
                systemInstruction: analysisSystemInstruction,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.1,
            },
        });
        
        const responseText = response.text.trim();
        if (!responseText) {
            throw new Error("API returned an empty response.");
        }

        const parsedJson = JSON.parse(responseText);
        
        if (!parsedJson.tokens || !parsedJson.translation) {
             throw new Error("Invalid JSON structure received from API.");
        }

        return parsedJson as AnalyzedText;

    } catch (error) {
        console.error("Gemini API call failed:", error);
        if (error instanceof Error) {
             throw new Error(`Lỗi từ API Gemini: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi gọi API Gemini.");
    }
};

export const translateChapter = async (chapterContent: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: chapterContent,
            config: {
                systemInstruction: translationSystemInstruction,
                temperature: 0.1,
            },
        });
        
        const responseText = response.text.trim();
        if (!responseText) {
            throw new Error("API returned an empty translation.");
        }
        return responseText;

    } catch (error) {
        console.error("Gemini API call for translation failed:", error);
        if (error instanceof Error) {
             throw new Error(`Lỗi dịch thuật từ API Gemini: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi dịch chương.");
    }
};
