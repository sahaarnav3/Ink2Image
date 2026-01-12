const fs = require("fs");
const { PDFParse } = require("pdf-parse");

/**
 * Main function which actually parses the file.
 */
const parseFilePageByPage = async (filePath) => {
  //check if file exists
  if (!fs.existsSync(filePath))
    throw new Error("File not found at path: " + filePath);
  console.log("\n--------Read PDF Page By Page--------");
  try {
    const parser = new PDFParse({ url: filePath });
    const info = await parser.getInfo();
    const totalPages = info.total;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      const parsedText = await parser.getText({ partial: [i] });
      //1. Cleaning the text - Removing all the extra artifacts like multiple new lines
      const cleanText = parsedText.text.replace(/\n+/g, " ").trim();
      pages.push(cleanText);
    }
    await parser.destroy();
    return pages; //Should return in following way - ['Page 1 text...', 'Page 2 text...', ...]
  } catch (error) {
    console.log("Error inside parseFile:", error);
    throw error;
  }
};

module.exports = { parseFilePageByPage };
