const { GoogleGenAI, Type } = require("@google/genai");
require("dotenv").config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { generateAndUploadImage } = require("./imageService");

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * HELPER: Removes markdown code blocks (```json... ```) from the response text;
 */
const cleanAndParseJSON = (text) => {
  // 1. Remove the first line if it starts with ```json or ```
  let cleanText = text.replace(/^```json\s*/, "").replace(/^```\s*/, "");
  // 2. Remove the last line if it ends with ```
  cleanText = cleanText.replace(/```\s*$/, "");
  // 3. Trim extra whitespace
  return JSON.parse(cleanText.trim());
};

//The Gemini API returns 'server load issue' at times, so using below utility function to solve that issue
//To call the api atleast 5 times before sending server issue to the client.
const runWithRetry = async (fn, retries = 5, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    // Check if we have retries left AND if the error is a "busy" error
    // 503 = Service Unavailable (Overloaded)
    // 429 = Too Many Requests (Rate Limit)
    //error has only 2 keys - name and status.
    // console.log("errorobjj:", error.status); // we need to use error.status instead of error.code
    if (retries > 0 && (error.status == 503 || error.status == 429)) {
      console.warn(
        `⚠️ API is either Overloaded or Unavailable. Retrying in ${delay}ms... (${retries} attempts left)`
      );

      //1. Wait for delay
      await new Promise((resolve) => setTimeout(resolve, delay));

      return runWithRetry(fn, retries - 1, delay * 2);
    } else {
      throw error;
    }
  }
};

/**
 * PASS 1: Analyze the text to create a style guide.
 * Using Gemini 2.5 Flash
 */
const analyzeBookContext = async (bookTextSnippet) => {
  const mainApiTask = async () => {
    // console.log("book snippet:", bookTextSnippet);

    // The Prompt
    const prompt = `
    You are a professional Hollywood Concept Artist acting as a strict JSON-only API.

    TASK: 
    - Extract the official Title and Author from the text.
    - If Title/Author are not explicitly found, creatively generate a professional Title based on the themes(not more than 4 words) and set Author to "Unknown Storyteller".
    - Analyze the provided story segment and extract a detailed "Style Guide" for image generation.
    - Analyze the visual "Style Guide" for image generation. Focus on SENSORY details (lighting, texture, camera angles).

    OUTPUT RULES:
    1. Return ONLY a single valid JSON object.
    2. Do NOT use Markdown formatting (no \`\`\`json blocks).
    3. Do NOT include any conversational text before or after the JSON.
    4. The JSON must strictly follow this structure:

    {
      "title": "The name of book",
      "author": "The name of the author"
      "artStyle": "Detailed visual style description (e.g., 'Cinematic lighting, 35mm film grain, watercolor texture, deep shadows')",
      "characters": "Rich descriptions of appearance, clothing materials, facial features, and specific vibes",
      "setting": "Atmospheric description of the environment, weather, architecture, and color palette"
    }

    STORY SEGMENT:
    ${bookTextSnippet}
`;

    //Selecting model and generating the text accordingly.
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      // model: "gemma-3-27b-it",
      config: {
        responseMimeType: "application/json",
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          author: { type: Type.STRING },
          artStyle: { type: Type.STRING },
          characters: { type: Type.STRING },
          setting: { type: Type.STRING },
        },
      },
      contents: prompt,
    });

    // console.log("response from gemini in service:", response);
    const text = response.text;
    // console.log("Actual gemini text in service:", text);
    const styleGuide = cleanAndParseJSON(text);
    return styleGuide;
  };
  try {
    return await runWithRetry(mainApiTask);
  } catch (error) {
    console.error("Gemini Error after retries :-", error);
    throw new Error("Failed to generate style guide after multiple attempts.");
  }
};

/**
 * PASS 2: Generate Image Prompt
 * This function turns a page of story text into a visual description
 * @param {Object} styleGuide
 * @param {String} pageText - Text each page.
 * @param {String} previousSummary - (Kind of like a 1 sentence recap of what happened before)
 */
const generatePagePrompt = async (styleGuide, pageText, previousSummary) => {
  const apiTask = async () => {
    const prompt = `
    You are a Cinematographer. Write a single, highly-detailed image generation prompt..

    GLOBAL VISUAL RULES:
    - Art Style: ${styleGuide.artStyle}
    - Character Designs: ${styleGuide.characters}
    - Setting/Vibe: ${styleGuide.setting}

    STORY CONTEXT:
    - Previous Action: ${previousSummary}
    - Current Scene Text: "${pageText}"

    TASK:
    Write a 50-word visual prompt for an AI image generator.
    - Focus on the visual action (e.g., "A tall man with a scar holding a lantern").
    - Describe lighting and camera angle.
    - Do NOT use proper names (like "Harry"), use visual descriptions (like "The boy with glasses").
    - Output JUST the prompt text. No markdown. No "Sure, here it is."
    `;

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    // console.log("Image prompt text:", result.text.trim());
    return result.text.trim();
  };
  try {
    return await runWithRetry(apiTask);
  } catch (error) {
    console.error("Gemini Error after retries :-", error);
    throw new Error("Failed to generate Page Prompts after multiple attempts.");
  }
};

/**
 * Using AI to generate summary of the previous page
 * Previous approach was roughly taking a 0-150 words substring and pass it to AI prompt with the new page content.
 */
const summarizeForContinuity = async (pageText) => {
  const apiTask = async () => {
    const prompt = `Summarize the key visual and plot events of this page in 1 short sentence for an illustrator: "${pageText}"`;
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return result.text.trim();
  };
  try {
    return await runWithRetry(apiTask);
  } catch (error) {
    console.error("Gemini Error after retries :-", error);
    throw new Error(
      "Failed to generate Previous Page Summary after multiple attempts."
    );
  }
};

const generateCharacterSheet = async (
  bookId,
  characterDescription,
  styleVibe
) => {
  try {
    console.log("\n🎨 Generating Master Character Sheet...");

    const prompt = `
    A professional character concept sheet for a story. 
    Character: ${characterDescription}. 
    Style: ${styleVibe}. 
    Composition: Three full-body views of the same character (front, profile, and back) on a neutral grey background. 
    Highly detailed, consistent facial features, uniform clothing.`;

    const sheetUrl = await generateAndUploadImage(
      prompt,
      bookId,
      "MASTER_CHARACTER"
    );
    return sheetUrl;
  } catch (error) {
    console.log("Character Sheet Error:", error);
    throw error;
  }
};

module.exports = {
  analyzeBookContext,
  generatePagePrompt,
  summarizeForContinuity,
  generateCharacterSheet,
};
