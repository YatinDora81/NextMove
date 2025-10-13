import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
// The client gets the API key from the environment variable `GEMINI_API_KEY`.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_Y81 });

export async function generateMessage(message: string) {
    try {
        const chat = await ai.chats.create({
            model: "gemini-2.5-flash",
            history: [
            ],
            config: {
                systemInstruction: "Send me in json format only using language english"
            }
        });
        const response1 = await chat.sendMessage({
            message: message,
        });
        console.log("Chat response 1:", response1.text);

        return response1.text || null;
    } catch (error) {
        console.log(error);
        return null;
        throw error;
    }
}

// class Gemini {

//     private secretKey = ["GEMINI_API_KEY_Y81"];
//     private currentClientNumber: number;
//     private ai: GoogleGenAI[];

//     constructor() {
//         this.ai = this.secretKey.map(key => new GoogleGenAI({ apiKey: key }));
//         this.currentClientNumber = 0;
//     }

//     async generateMessage(message: string, history: string[]) {
//         const client = this.ai[this.currentClientNumber];
//         const response = await client.models.generateContent({
//             model: "gemini-2.5-flash",
//             contents: message,

//         });
//         return response.text || null;
//     }
// }