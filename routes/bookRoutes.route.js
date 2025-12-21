const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/multer.middleware");
const path = require("path");

// Models
const Book = require("../models/book.model");
const Page = require("../models/page.model");

//Importing Utility functions.
const { parseFile } = require("../utils/fileParser");
const {
  analyzeBookContext,
  generatePagePrompt,
  summarizeForContinuity
} = require("../utils/aiService");


// Uploading the book and segeragating the pages.
router.post("/upload", upload.single("bookFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No File Uploaded" });

    console.log("File Uploaded:", req.file.path);

    //Create a new book document
    const newBook = new Book({
      title: req.body.title || req.file.originalname,
      originalFilePath: req.file.path,
    });

    const savedBook = await newBook.save();
    console.log("book created with ID:", savedBook._id);

    //File processing(To extract the text)
    const pageContent = await parseFile(req.file.path);
    console.log(`Successfully Extracted ${pageContent.length} pages.(Roughly)`);

    const pageDocuments = pageContent.map((content, index) => ({
      bookId: savedBook._id,
      pageNumber: index + 1,
      content: content,
      status: "pending",
    }));

    //Bulk inserting pages
    const pageResponse = await Page.insertMany(pageDocuments);
    // console.log("Page inserting to DB:", pageResponse);

    savedBook.totalPages = pageContent.length;
    const savingPageOnBooks = await savedBook.save();
    console.log("Pages Saved in Book:", savingPageOnBooks);

    res.status(201).json({
      message: "Book uploaded and processed successfully!",
      bookId: savedBook._id,
      totalPages: savedBook.totalPages,
      firstPagePreview: pageContent[0].substring(0, 100) + "...",
    });
  } catch (error) {
    console.log("Error in upload route:", error);
    res.status(500).json({
      message: "Server Error during processing",
      error: error.message,
    });
  }
});

//Route to analyze and generate artStyle, characters and setting.
router.post("/:id/analyze", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`\n--- Starting Prompt Generation Loop for Book ID: ${id} ---`);

    //Getting first n page (change limit value to get n number of pages)(to get a rough global context for art style)
    const pages = await Page.find({ bookId: id })
      .sort({ pageNumber: 1 })
      .limit(10);
    if (!pages || pages.length === 0)
      return res.status(404).json({ message: "Book pages not found" });

    //Combine text
    const textSnippet = pages.map((p) => p.content).join("\n\n");
    // console.log(`Sending ${textSnippet.length} characters to Gemini...`);

    //Calling Gemini
    const styleGuide = await analyzeBookContext(textSnippet);
    console.log("Gemini Output:", styleGuide);

    const updatedBook = await Book.findByIdAndUpdate(
      id,
      { globalContext: styleGuide },
      { new: true }
    );

    res.status(201).json({
      message: "Style Guide Analysis Complete",
      globalContext: updatedBook.globalContext,
    });
  } catch (error) {
    console.log("Gemimi Analysis Stage Error - ", error);
    res.status(500).json({ message: "Analysis Failed", error: error.message });
  }
});

//Route to generate the actual image prompts of all the pages (by book id)
router.post("/:id/generate-prompts", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(
      `\n--- Starting Step 6: Image Prompt Generation for Book ${id} ---`
    );

    //1. GET DATA
    const book = await Book.findById(id);
    const pages = await Page.find({ bookId: id }).sort({ pageNumber: 1 });

    if (!book.globalContext || !book.globalContext.artStyle)
      return res.status(400).json({
        message: "Style Guide Missing. Please run the Analysis phase.",
      });

    console.log(
      `Found ${pages.length} pages. Using style guide:`,
      book.globalContext.artStyle
    );

    //2. Setting up Loop Variables
    let previousPageSummary =
      "The story begins. Introduce the main characters and setting.";
    let processedCount = 0;
    for (let page of pages) {
      //Skipping the page if we already have a prompt for it.
      if (page.imagePrompt && page.imagePrompt.length > 20) {
        console.log(`Skipping Page ${page.pageNumber}. (Already Done)`);
        previousPageSummary = await summarizeForContinuity(page.content);
        continue;
      }
      console.log(`\n 📜 Processing Page ${page.pageNumber}`);

      //Now calling the AI function to actually create the prompt.
      const newPrompt = await generatePagePrompt(
        book.globalContext,
        page.content,
        previousPageSummary
      );

      page.imagePrompt = newPrompt;
      page.status = "completed";
      await page.save();
      console.log(`\n --> Generated: "${newPrompt.substring(0, 40)}..."`);

      //We use AI to generate a 1 line summary (instead of using substring - previous approach)
      previousPageSummary = await summarizeForContinuity(page.content);

      //Safety Pause - 2 seconds wait before moving to next page so Rate Limiting is followed.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      processedCount++;
    }

    console.log("\n--- Loop Complete ---");
    res.status(201).json({
      message: "Successfully generated image prompts for all pages.",
      totalPages: pages.length,
      processed: processedCount,
    });
  } catch (error) {
    console.error("Loop Error (Image Prompt Generation):", error);
    res
      .status(500)
      .json({ message: "Generation failed", error: error.message });
  }
});

module.exports = router;
