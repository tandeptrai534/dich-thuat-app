

import { GoogleGenAI, Type } from "@google/genai";
import { GrammarRole, type AnalyzedText, type SpecialTerm } from '../types';

const MODEL_NAME = 'gemini-2.5-flash';

const allowedGrammarRoles = Object.values(GrammarRole);

const analysisSchema = {
    type: Type.OBJECT,
    properties: {
        tokens: {
            type: Type.ARRAY,
            description: "Phân tích từng từ hoặc ký tự trong câu gốc.",
            items: {
                type: Type.OBJECT,
                properties: {
                    character: { type: Type.STRING, description: "Từ hoặc ký tự gốc." },
                    pinyin: { type: Type.STRING, description: "Phiên âm Pinyin." },
                    sinoVietnamese: { type: Type.STRING, description: "Âm Hán-Việt." },
                    vietnameseMeaning: { type: Type.STRING, description: "Nghĩa tiếng Việt." },
                    grammarRole: { 
                        type: Type.STRING, 
                        description: `Vai trò ngữ pháp. Phải là một trong các giá trị sau: ${allowedGrammarRoles.join(', ')}.`,
                        enum: allowedGrammarRoles,
                    },
                    grammarExplanation: { type: Type.STRING, description: "Giải thích ngắn gọn về vai trò ngữ pháp của từ này trong câu." }
                },
                required: ["character", "pinyin", "sinoVietnamese", "vietnameseMeaning", "grammarRole", "grammarExplanation"]
            }
        },
        translation: {
            type: Type.STRING,
            description: "Bản dịch tự nhiên, đầy đủ của câu sang tiếng Việt."
        },
        specialTerms: {
            type: Type.ARRAY,
            description: "Danh sách các thuật ngữ đặc biệt như tên riêng, địa danh, công pháp, chiêu thức, vật phẩm, thành ngữ được tìm thấy trong câu.",
            items: {
                type: Type.OBJECT,
                properties: {
                    term: { type: Type.STRING, description: "Thuật ngữ gốc bằng tiếng Trung." },
                    sinoVietnamese: { type: Type.STRING, description: "Âm Hán-Việt của thuật ngữ." },
                    vietnameseTranslation: { type: Type.STRING, description: "Bản dịch hoặc tên tiếng Việt tương ứng của thuật ngữ." },
                    category: { type: Type.STRING, description: "Phân loại thuật ngữ (Tên người, Địa danh, Công pháp, Chiêu thức, Vật phẩm, Tổ chức, Thành ngữ, Tục ngữ, Tiêu đề chương, Khác)." },
                    explanation: { type: Type.STRING, description: "Giải thích ngắn gọn về thuật ngữ." }
                },
                required: ["term", "sinoVietnamese", "vietnameseTranslation", "category", "explanation"]
            }
        },
        sentenceGrammarExplanation: {
            type: Type.STRING,
            description: "Giải thích tổng quan về cấu trúc ngữ pháp của toàn bộ câu."
        }
    },
    required: ["tokens", "translation", "specialTerms", "sentenceGrammarExplanation"]
};

export const analyzeSentence = async (apiKey: string, sentence: string, forcedSinoTerms: { term: string; sinoVietnamese: string; }[] = []): Promise<AnalyzedText> => {
    const ai = new GoogleGenAI({ apiKey });
    let sinoInstruction = "";
    if (forcedSinoTerms.length > 0) {
        const termsList = forcedSinoTerms.map(t => `- "${t.term}": "${t.sinoVietnamese}"`).join('\n');
        sinoInstruction = `Lưu ý quan trọng: Khi xác định âm Hán-Việt, hãy ưu tiên sử dụng các cách đọc sau cho những thuật ngữ này:\n${termsList}\n`;
    }

    const systemInstruction = `Bạn là một chuyên gia ngôn ngữ và dịch thuật Trung-Việt. Nhiệm vụ của bạn là phân tích chi tiết một câu tiếng Trung.
    1.  Chia câu thành các từ (hoặc ký tự nếu cần).
    2.  Với mỗi từ, cung cấp phiên âm Pinyin, âm Hán-Việt, nghĩa tiếng Việt chính xác nhất trong ngữ cảnh, và vai trò ngữ pháp của nó trong câu. Vai trò ngữ pháp phải là một trong các giá trị sau: ${allowedGrammarRoles.join(', ')}.
    3.  Dịch toàn bộ câu sang tiếng Việt một cách tự nhiên và mượt mà.
    4.  Xác định các thuật ngữ đặc biệt (tên người, địa danh, công pháp, v.v.) và cung cấp thông tin chi tiết về chúng.
    5.  Cung cấp một giải thích tổng quan về cấu trúc ngữ pháp của câu.
    ${sinoInstruction}
    QUY TẮC DỊCH ĐẶC BIỆT: Luôn dịch các đại từ sau theo quy tắc: 我 -> ta, 你 -> ngươi, 他 -> hắn, 她 -> nàng.
    Hãy trả về kết quả dưới dạng một đối tượng JSON tuân thủ theo schema đã cung cấp.`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: `Phân tích câu sau: "${sentence}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisSchema,
                systemInstruction: systemInstruction,
            },
        });

        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText) as AnalyzedText;
        return result;

    } catch (error) {
        console.error("Error analyzing sentence with Gemini:", error);
        if (error instanceof Error) {
            throw new Error(`Lỗi Gemini API: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi phân tích câu.");
    }
};

const batchAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        analyses: {
            type: Type.ARRAY,
            description: "Một mảng các kết quả phân tích, mỗi mục tương ứng với một câu đầu vào.",
            items: analysisSchema
        }
    },
    required: ["analyses"]
};

export const analyzeSentencesInBatch = async (apiKey: string, sentences: string[], forcedSinoTerms: { term: string; sinoVietnamese: string; }[] = []): Promise<AnalyzedText[]> => {
    if (sentences.length === 0) return [];
    const ai = new GoogleGenAI({ apiKey });
    
    let sinoInstruction = "";
    if (forcedSinoTerms.length > 0) {
        const termsList = forcedSinoTerms.map(t => `- "${t.term}": "${t.sinoVietnamese}"`).join('\n');
        sinoInstruction = `Lưu ý quan trọng: Khi xác định âm Hán-Việt, hãy ưu tiên sử dụng các cách đọc sau cho những thuật ngữ này:\n${termsList}\n`;
    }

    const systemInstruction = `Bạn là một chuyên gia ngôn ngữ và dịch thuật Trung-Việt. Nhiệm vụ của bạn là phân tích chi tiết một danh sách các câu tiếng Trung. Với mỗi câu, hãy thực hiện đầy đủ các bước như phân tích từ, dịch thuật, nhận diện thuật ngữ, và giải thích ngữ pháp. Vai trò ngữ pháp cho mỗi từ phải là một trong các giá trị sau: ${allowedGrammarRoles.join(', ')}. QUY TẮC DỊCH ĐẶC BIỆT: Luôn dịch các đại từ sau theo quy tắc: 我 -> ta, 你 -> ngươi, 他 -> hắn, 她 -> nàng. ${sinoInstruction}Hãy trả về kết quả dưới dạng một đối tượng JSON duy nhất chứa một mảng 'analyses', trong đó mỗi mục của mảng là một đối tượng JSON phân tích chi tiết cho một câu, tuân thủ theo schema đã cung cấp.`;

    const content = `Phân tích các câu sau đây: ${JSON.stringify(sentences)}`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: content,
            config: {
                responseMimeType: "application/json",
                responseSchema: batchAnalysisSchema,
                systemInstruction: systemInstruction,
            },
        });
        
        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);

        if (result && Array.isArray(result.analyses) && result.analyses.length === sentences.length) {
            return result.analyses;
        } else {
            console.error("Batch analysis response mismatch.", "Expected:", sentences.length, "Got:", result.analyses?.length);
            throw new Error("Số lượng câu phân tích trả về không khớp với số lượng câu đầu vào.");
        }

    } catch (error) {
        console.error("Error in batch analysis with Gemini:", error);
         if (error instanceof Error) {
            throw new Error(`Lỗi Gemini API: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi phân tích hàng loạt.");
    }
};


const batchTranslationSchema = {
    type: Type.OBJECT,
    properties: {
        translations: {
            type: Type.ARRAY,
            description: "Một mảng các chuỗi, mỗi chuỗi là một câu dịch tiếng Việt.",
            items: {
                type: Type.STRING
            }
        }
    },
    required: ["translations"]
};

export const translateSentencesInBatch = async (apiKey: string, sentences: string[], forcedSinoTerms: { term: string; sinoVietnamese: string; }[] = []): Promise<string[]> => {
    if (sentences.length === 0) return [];
    const ai = new GoogleGenAI({ apiKey });
    
    let sinoInstruction = "";
    if (forcedSinoTerms.length > 0) {
        const termsList = forcedSinoTerms.map(t => `- "${t.term}": "${t.sinoVietnamese}"`).join('\n');
        sinoInstruction = `Lưu ý: Khi dịch, hãy ưu tiên sử dụng các thuật ngữ Hán-Việt đã được định nghĩa sau đây nếu chúng xuất hiện trong câu: ${termsList}. Điều này giúp đảm bảo tính nhất quán trong bản dịch.`;
    }

    const systemInstruction = `Bạn là một dịch giả chuyên nghiệp từ tiếng Trung sang tiếng Việt. Dịch các câu sau một cách chính xác và tự nhiên. QUY TẮC DỊCH ĐẶC BIỆT: Luôn dịch các đại từ sau theo quy tắc: 我 -> ta, 你 -> ngươi, 他 -> hắn, 她 -> nàng. ${sinoInstruction} Trả về kết quả dưới dạng một đối tượng JSON chứa một mảng các chuỗi, trong đó mỗi chuỗi tương ứng với một câu dịch.`;
    
    const content = `Dịch các câu sau đây: ${JSON.stringify(sentences)}`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: content,
            config: {
                responseMimeType: "application/json",
                responseSchema: batchTranslationSchema,
                systemInstruction: systemInstruction,
            },
        });
        
        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);

        if (result && Array.isArray(result.translations) && result.translations.length === sentences.length) {
            return result.translations;
        } else {
            throw new Error("Số lượng câu dịch trả về không khớp với số lượng câu đầu vào.");
        }

    } catch (error) {
        console.error("Error in batch translation with Gemini:", error);
         if (error instanceof Error) {
            throw new Error(`Lỗi Gemini API: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi dịch hàng loạt.");
    }
};