import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzedText, VocabularyItem } from '../types';

const getAiClient = (apiKey: string) => {
    if (!apiKey) {
        // This error is for the developer/user to see if the key is missing in the app.
        throw new Error("Vui lòng cung cấp khóa API Gemini trong bảng Cài đặt.");
    }
    return new GoogleGenAI({ apiKey });
};

const analysisSystemInstruction = `You are an expert linguist and translator specializing in Chinese and Vietnamese. Your task is to perform a detailed grammatical analysis and translation of a single Chinese sentence.

**RESPONSE FORMAT:**
You MUST return the output as a single, valid JSON object that conforms to the provided schema. Do not include any text outside of the JSON object.

**ANALYSIS & TRANSLATION RULES:**
1.  **Tokenization:** Break down the Chinese sentence into its fundamental components (words, characters, punctuation). Each component is a "token".
2.  **Detailed Token Information:** For each token, you must provide:
    -   \`character\`: The original Chinese character(s).
    -   \`pinyin\`: The correct Pinyin transcription.
    -   \`sinoVietnamese\`: The Sino-Vietnamese (Hán Việt) reading.
    -   \`vietnameseMeaning\`: A concise Vietnamese meaning of the token.
    -   \`grammarRole\`: The grammatical function (Subject, Predicate, Object, etc.). Use "Unknown" if unclear.
    -   \`grammarExplanation\`: A brief explanation of the token's role and meaning in the context of the sentence. **This explanation MUST be in VIETNAMESE.**
3.  **Special Term Identification:**
    -   Scan the sentence for multi-word proper nouns, idioms, or proverbs.
    -   For each one found, create an object in the \`specialTerms\` array.
    -   Each object MUST contain:
        -   \`term\`: The full phrase in Chinese (e.g., "Bích Xà Tam Hoa Đồng").
        -   \`sinoVietnamese\`: The precise Sino-Vietnamese (Hán Việt) reading of the term.
        -   \`vietnameseTranslation\`: The natural Vietnamese translation of the term itself, as it would appear in a normal sentence. This is CRITICAL for the client-side 'Unify' feature.
        -   \`category\`: The type, like 'Tên người', 'Địa danh', 'Công pháp', 'Thành ngữ'. Use 'Tiêu đề chương' if analyzing a chapter title.
        -   \`explanation\`: A brief explanation of what it is, in Vietnamese (do NOT include the Hán Việt reading here).
4.  **Full Translation:** Provide a single, complete, and natural Vietnamese translation for the entire sentence in the \`translation\` field. This MUST be a string. Pay close attention to spacing; words must be separated by a single space, e.g., "Hắn nhìn thấy một con rắn" is CORRECT, "Hắnnhìnthấy mộtconrắn" is WRONG.
5.  **Sentence Grammar Structure:** After analyzing all tokens, provide a high-level summary of the sentence's overall grammatical structure in the \`sentenceGrammarExplanation\` field. Explain the main components (e.g., "Chủ ngữ + Vị ngữ + Bổ ngữ") and how they relate. This explanation MUST be in VIETNAMESE.
6.  **Strict Translation Rules & Forced Terms:**
    -   **ABSOLUTE RULE: FORCED SINO-VIETNAMESE TERMS:** This is the most important rule. If you are provided with a list of 'Forced Sino Terms', you MUST use their provided Sino-Vietnamese readings as their translation in the final Vietnamese output. NO EXCEPTIONS. For example, if a forced term is { term: "魔躯", sinoVietnamese: "Ma Khu" }, you MUST translate "魔躯" as "Ma Khu", not "Ma Thần" or anything else.
    -   **Consistency:** For other proper nouns (names, places, etc.), translate using their Sino-Vietnamese (Hán Việt) reading.
    -   **Pronouns:** 我 -> "ta", 你 -> "ngươi", 他 -> "hắn", 她 -> "nàng".
    -   **Formatting:** The final Vietnamese translation must have correct, natural spacing between words.
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
                        enum: [ 'Subject', 'Predicate', 'Object', 'Adverbial', 'Complement', 'Attribute', 'Particle', 'Interjection', 'Conjunction', 'Numeral', 'Measure Word', 'Unknown' ],
                        description: "The grammatical role of the token."
                    },
                    grammarExplanation: { type: Type.STRING, description: "A brief explanation of the token's function in the sentence, written in Vietnamese." }
                },
                required: ["character", "pinyin", "sinoVietnamese", "vietnameseMeaning", "grammarRole", "grammarExplanation"]
            }
        },
        translation: {
            type: Type.STRING,
            description: "The full, natural Vietnamese translation of the sentence as a single string."
        },
        specialTerms: {
            type: Type.ARRAY,
            description: "A list of identified meaningful phrases like proper nouns or idioms.",
            items: {
                type: Type.OBJECT,
                properties: {
                    term: { type: Type.STRING, description: "The full Chinese phrase for the special term." },
                    sinoVietnamese: { type: Type.STRING, description: "The Sino-Vietnamese (Hán Việt) reading of the term." },
                    vietnameseTranslation: { type: Type.STRING, description: "The natural Vietnamese translation of the term, used for client-side replacement." },
                    category: { type: Type.STRING, description: "The category of the term (e.g., Tên người, Thành ngữ, Tiêu đề chương)." },
                    explanation: { type: Type.STRING, description: "A brief explanation of the term (excluding the Hán-Việt reading)."}
                },
                required: ["term", "sinoVietnamese", "vietnameseTranslation", "category", "explanation"]
            }
        },
        sentenceGrammarExplanation: {
            type: Type.STRING,
            description: "A high-level explanation of the entire sentence's grammatical structure, written in Vietnamese."
        }
    },
    required: ["tokens", "translation", "specialTerms", "sentenceGrammarExplanation"]
};

const batchTranslateSystemInstruction = `You are an expert translator specializing in Chinese and Vietnamese. Your task is to translate a batch of Chinese sentences into Vietnamese.

**INPUT:**
You will receive a JSON array of strings, where each string is a Chinese sentence. An optional list of 'Forced Sino Terms' may also be provided.

**OUTPUT:**
You MUST return a single, valid JSON object with a single key "translations". The value of "translations" must be an array of strings.
- Each string in the output array is the Vietnamese translation of the corresponding sentence in the input array.
- The order MUST be preserved.
- The output array MUST have the exact same number of items as the input array.

**TRANSLATION RULES:**
1.  **ABSOLUTE RULE: FORCED SINO-VIETNAMESE TERMS:** This is the most important rule. If you are provided with a list of 'Forced Sino Terms' (Chinese term and its Hán Việt reading), you MUST use the provided Hán Việt reading as the translation for that exact Chinese term wherever it appears. This rule is absolute and overrides all others. For example, if a forced term is { term: "魔躯", sinoVietnamese: "Ma Khu" }, you must translate "魔躯" as "Ma Khu", not "Ma Thần" or anything else.
2.  **SPACING:** The final Vietnamese translation MUST have correct, natural spacing between words. Do NOT return text with words joined together without spaces. For example, "Sư huynhcóbiết" is WRONG. "Sư huynh có biết" is CORRECT.
3.  **Pronouns:** 我 -> "ta", 你 -> "ngươi", 他 -> "hắn", 她 -> "nàng".
4.  **Consistency:** For other proper nouns not in the forced list, translate using Sino-Vietnamese (Hán Việt) readings.
5.  **Quality:** Provide natural, fluent translations. Correct any spelling errors.
6.  **Format:** Return ONLY the JSON object. Do not add any other text, explanations, or markdown.
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

const buildPromptWithForcedTerms = (basePrompt: string, forcedSinoTerms: { term: string; sinoVietnamese: string }[]): string => {
    if (forcedSinoTerms.length === 0) {
        return basePrompt;
    }
    const termsList = JSON.stringify(forcedSinoTerms);
    return `${basePrompt}\n\nHere is a list of 'Forced Sino Terms' you must adhere to: ${termsList}`;
};

export const analyzeSentence = async (sentence: string, apiKey: string, forcedSinoTerms: { term: string; sinoVietnamese: string }[] = []): Promise<AnalyzedText> => {
    const ai = getAiClient(apiKey);
    const prompt = buildPromptWithForcedTerms(`Please analyze and translate this sentence: "${sentence}"`, forcedSinoTerms);

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
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
        
        if (!parsedJson.tokens || !parsedJson.translation || !parsedJson.sentenceGrammarExplanation) {
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

export const translateSentencesInBatch = async (sentences: string[], apiKey: string, forcedSinoTerms: { term: string; sinoVietnamese: string }[] = []): Promise<string[]> => {
    if (sentences.length === 0) {
        return [];
    }
    const ai = getAiClient(apiKey);
    
    const prompt = buildPromptWithForcedTerms(`Please translate this batch of sentences: ${JSON.stringify(sentences)}`, forcedSinoTerms);

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
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