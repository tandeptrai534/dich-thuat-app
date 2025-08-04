
import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzedText, ProperNounAnalysisAPIResult, ProperNounCategory } from '../types';

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

const analysisResponseSchema = {
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

const batchTranslateSystemInstruction = `You are an expert translator specializing in Chinese and Vietnamese. Your task is to translate a batch of Chinese sentences into Vietnamese.

**INPUT:**
You will receive a JSON array of strings, where each string is a Chinese sentence.

**OUTPUT:**
You MUST return a single, valid JSON object with a single key "translations". The value of "translations" must be an array of strings.
- Each string in the output array is the Vietnamese translation of the corresponding sentence in the input array.
- The order MUST be preserved. The first translation must correspond to the first input sentence, the second to the second, and so on.
- The output array MUST have the exact same number of items as the input array.

**TRANSLATION RULES:**
1.  **Pronouns:** 我 -> "ta", 你 -> "ngươi", 他 -> "hắn", 她 -> "nàng".
2.  **Consistency:** Translate proper nouns using Sino-Vietnamese (Hán Việt) readings.
3.  **Quality:** Provide natural, fluent translations. Correct any spelling errors.
4.  **Format:** Return ONLY the JSON object. Do not add any other text, explanations, or markdown.
`;

const batchTranslateResponseSchema = {
    type: Type.OBJECT,
    properties: {
        translations: {
            type: Type.ARRAY,
            description: "An array of Vietnamese translation strings, corresponding one-to-one with the input sentences.",
            items: {
                type: Type.STRING
            }
        }
    },
    required: ["translations"]
};

const properNounAnalysisSystemInstruction = `You are an expert analyst of Chinese web novels, specializing in identifying and translating proper nouns into Vietnamese. Your task is to filter and analyze a batch of Chinese terms based on the context provided.

**PRIMARY DIRECTIVE: USE CONTEXT TO FILTER, THEN ANALYZE.**
1.  **Context is Key:** You MUST use the provided "contextSentence" for each term to determine if it is a proper noun/idiom or just a common word. For example, "Bạch Vân" in "Bạch Vân là sư huynh của ta" is a name, but in "trên trời có một đoá bạch vân" it is just "white cloud".
2.  **Filter:** Review each term **within its context**. You MUST **filter out** and discard any common, everyday words. Keep only important terms (proper nouns like names, places, sects, skills, items; idioms; proverbs).
3.  **Analyze:** For the **important terms you keep**, perform the analysis.

**INPUT:**
You will receive a JSON array of objects. Each object has a "term" and its "contextSentence".

**OUTPUT:**
You MUST return a single, valid JSON object with a single key "results". The value of "results" must be an array of objects.
- The "results" array will **only contain entries for the important terms you decided to analyze**. It will likely be **shorter** than the input array.
- For each analyzed term, provide the following fields in the object:
  - \\\`term\\\`: The **original Chinese term** that you are analyzing. This is crucial for mapping.
  - \\\`hanViet\\\`: The correct Sino-Vietnamese (Hán Việt) reading.
  - \\\`category\\\`: Classify the term: 'Tên người', 'Địa danh', 'Công pháp', 'Chiêu thức', 'Vật phẩm', 'Tổ chức', 'Thành ngữ', 'Tục ngữ', 'Ngữ pháp', 'Khác'.
  - \\\`explanation\\\`: A brief, one-sentence explanation of the term in VIETNAMESE, based on its context.

**RULES:**
1.  **Be Strict in Filtering:** Aggressively remove non-essential terms based on context. The goal is a high-quality, curated list.
2.  **Accuracy:** Provide the most accurate Hán Việt translation possible.
3.  **Format:** Return ONLY the valid JSON object. No extra text or markdown.`;

const properNounAnalysisResponseSchema = {
    type: Type.OBJECT,
    properties: {
        results: {
            type: Type.ARRAY,
            description: "An array of analysis results, ONLY for the important, filtered terms.",
            items: {
                type: Type.OBJECT,
                properties: {
                    term: { type: Type.STRING, description: "The original Chinese term that was analyzed, used for mapping." },
                    hanViet: { type: Type.STRING, description: "Sino-Vietnamese (Hán Việt) reading of the term." },
                    category: {
                        type: Type.STRING,
                        enum: ['Tên người', 'Địa danh', 'Công pháp', 'Chiêu thức', 'Vật phẩm', 'Tổ chức', 'Thành ngữ', 'Tục ngữ', 'Ngữ pháp', 'Khác'],
                        description: "The category of the proper noun."
                    },
                    explanation: { type: Type.STRING, description: "A brief explanation of the term in Vietnamese." }
                },
                required: ["term", "hanViet", "category", "explanation"]
            }
        }
    },
    required: ["results"]
};


export const analyzeSentence = async (sentence: string, apiKey: string): Promise<AnalyzedText> => {
    if (!apiKey) {
        throw new Error("Khóa API chưa được cung cấp. Vui lòng thêm khóa của bạn trong phần Cài đặt.");
    }
    const ai = new GoogleGenAI({ apiKey });

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Please analyze and translate this sentence: "${sentence}"`,
            config: {
                systemInstruction: analysisSystemInstruction,
                responseMimeType: "application/json",
                responseSchema: analysisResponseSchema,
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
        console.error("Gemini API call for sentence analysis failed:", error);
        if (error instanceof Error) {
             throw new Error(`Lỗi từ API Gemini: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi gọi API Gemini.");
    }
};

export const translateSentencesInBatch = async (sentences: string[], apiKey: string): Promise<string[]> => {
    if (!apiKey) {
        throw new Error("Khóa API chưa được cung cấp. Vui lòng thêm khóa của bạn trong phần Cài đặt.");
    }
     if (sentences.length === 0) {
        return [];
    }
    const ai = new GoogleGenAI({ apiKey });
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Please translate this batch of sentences: ${JSON.stringify(sentences)}`,
            config: {
                systemInstruction: batchTranslateSystemInstruction,
                responseMimeType: "application/json",
                responseSchema: batchTranslateResponseSchema,
                temperature: 0.2,
            },
        });
        
        const responseText = response.text.trim();
        if (!responseText) {
            throw new Error("API returned an empty translation response.");
        }
        
        const parsedJson = JSON.parse(responseText);

        if (!parsedJson.translations || !Array.isArray(parsedJson.translations) || parsedJson.translations.length !== sentences.length) {
            throw new Error("Invalid or mismatched translation data received from API.");
        }

        return parsedJson.translations;

    } catch (error) {
        console.error("Gemini API call for batch translation failed:", error);
        if (error instanceof Error) {
             throw new Error(`Lỗi dịch thuật từ API Gemini: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi dịch hàng loạt.");
    }
};

export const analyzeProperNounsInBatch = async (
    termsWithContext: { term: string; contextSentence?: string }[],
    apiKey: string
): Promise<ProperNounAnalysisAPIResult[]> => {
    if (!apiKey) {
        throw new Error("Khóa API chưa được cung cấp. Vui lòng thêm khóa của bạn trong phần Cài đặt.");
    }
    if (termsWithContext.length === 0) {
        return [];
    }
    const ai = new GoogleGenAI({ apiKey });

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Please filter and analyze this batch of terms with their context: ${JSON.stringify(termsWithContext)}`,
            config: {
                systemInstruction: properNounAnalysisSystemInstruction,
                responseMimeType: "application/json",
                responseSchema: properNounAnalysisResponseSchema,
                temperature: 0.1,
            },
        });

        const responseText = response.text.trim();
        if (!responseText) {
            // This is an expected outcome if all terms are filtered out, so return an empty array.
            return [];
        }

        const parsedJson = JSON.parse(responseText);

        if (!parsedJson.results || !Array.isArray(parsedJson.results)) {
            console.warn("API returned invalid structure for proper noun analysis, but treating as empty.", parsedJson);
            return [];
        }

        return parsedJson.results;

    } catch (error) {
        console.error("Gemini API call for proper noun analysis failed:", error);
        if (error instanceof Error) {
            throw new Error(`Lỗi phân tích tên riêng từ API Gemini: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi phân tích tên riêng.");
    }
};
