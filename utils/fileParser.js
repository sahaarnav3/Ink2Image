const fs = require("fs");
const { PDFParse } = require("pdf-parse");

/**
 * Helper function to split a long string of text into seperate pages based on word count
 * @param {string} fullText - the entire text of book.
 * @param {number} wordsPerPage - Rough estimate of words per page (default 500)
 * @return {string[]} - An array where each item is the text for one page.
 */

const splitTextIntoPages = (fullText, wordsPerPage = 450) => {
  //1. Cleaning the text - Removing all the extra artifacts like multiple new lines
  const cleanText = fullText.replace(/\n+/g, " ").trim();

  //2. Split by spaces to get an array of words
  const words = cleanText.split(/\s+/);

//   console.log("WORDS --", words);

  const pages = [];
  let currentPageWords = [];

  //3. Loop through words and group them.
  for (let i = 0; i < words.length; i++) {
    currentPageWords.push(words[i]);

    if (currentPageWords.length >= wordsPerPage) {
      pages.push(currentPageWords.join(" "));
      currentPageWords = [];
    }
  }

  if (currentPageWords.length > 0) pages.push(currentPageWords.join(" "));

//   console.log("Pages -- ", pages);
  return pages;
};

/**
 * Now the main function which actually parses the file.
 */
const parseFile = async (filePath) => {
  //check if file exists
  if (!fs.existsSync(filePath))
    throw new Error("File not found at path: " + filePath);

  //Read the file buffer
  const dataBuffer = fs.readFileSync(filePath);

  try {
    const data = new PDFParse({ url:  filePath });
    const textObject = await data.getText(); // PDF parse is returning an array of objects with texts alrady segregated.
    // console.log("Text Object -- ", textObject.pages)
    const rawText = textObject.pages.reduce((acc, curr) => acc + curr.text, "");
    // console.log("Raw Text -- ", rawText);

    //Split the raw text into our page segments
    const pageContents = splitTextIntoPages(rawText);

    return pageContents; //Should return in following way - ['Page 1 text...', 'Page 2 text...', ...]
  } catch (error) {
    console.log("Error inside parseFile:", error);
    throw error;
  }
};

module.exports = { parseFile };
