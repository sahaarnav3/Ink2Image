const { GoogleGenAI, Type } = require("@google/genai");
require("dotenv").config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * PASS 1: Analyze the text to create a style guide.
 * Using Gemini 2.5 Flash
 */
const analyzeBookContext = async (bookTextSnippet) => {
  // console.log("book snippet:", bookTextSnippet);
  try {
    //Selecting the model
    // const model = genAI.getGenerativeModel({
    //   model: "gemini-2.5-flash",
    //   generationConfig: {
    //     type: Type.OBJECT,
    //     properties: {
    //       artStyle: { type: Type.STRING },
    //       characters: { type: Type.STRING },
    //       setting: { type: Type.STRING },
    //     },
    //   },
    // });

    // The Prompt
    const prompt = `
    You are an expert Art Director. Analyze the following story segement.

    Extract a "Style Guide" that will be used to generate consistent illustrations for the rest of the book.
    - artStyle: Describe the visual style (e.g., "Watercolor, Studio Ghibli style").
    - characters: Summarize main characters and their physical traits.
    - setting: Describe the primary environment.

    Story Segment:
    ${bookTextSnippet}
    `;

    //Selecting model and generating the text accordingly.
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        type: Type.OBJECT,
        properties: {
          artStyle: { type: Type.STRING },
          characters: { type: Type.STRING },
          setting: { type: Type.STRING },
        },
      },
      contents: prompt,
    })

    // console.log("response from gemini in service:", response);
    const text = response.text;
    console.log("Actual gemini text in service:", text);
    const styleGuide = JSON.parse(text);
    return styleGuide;
  } catch (error) {
    console.log("Gemini 2.5 Error:", error);
    throw new Error("Failed to generate style guide.");
  }
};

module.exports = { analyzeBookContext };
