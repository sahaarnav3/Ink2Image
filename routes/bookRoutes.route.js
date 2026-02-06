const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/multer.middleware");
const { userAuth } = require("../middlewares/userAuth.js");
const path = require("path");

// Models
const Book = require("../models/book.model");
const Page = require("../models/page.model");
const UserLibrary = require("../models/userLibrary.model");

//Importing Utility functions.
const { parseFilePageByPage } = require("../utils/fileParser");
const {
  analyzeBookContext,
  generatePagePrompt,
  summarizeForContinuity,
} = require("../utils/aiService");
const { generateAndUploadImage } = require("../utils/imageService");

// Uploading the book and segeragating the pages.
router.post(
  "/upload",
  upload.single("bookFile"),
  userAuth,
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "No File Uploaded" });

      console.log("\n📁 File Uploaded:", req.file.path);

      //Create a new book document
      const newBook = new Book({
        title: req.body.title || req.file.originalname,
        originalFilePath: req.file.path,
        status: "Draft",
      });

      const savedBook = await newBook.save();
      console.log("\n📚 Book created with ID:", savedBook._id);

      //File processing(To extract the text)
      const pageContent = await parseFilePageByPage(req.file.path); // work on this line here, we need per page analysis according to book.
      console.log(`\n📄 Successfully Extracted ${pageContent.length} pages.`);

      const pageDocuments = pageContent.map((content, index) => ({
        bookId: savedBook._id,
        pageNumber: index + 1,
        content: content,
        status: "pending",
      }));

      //Bulk inserting pages
      const pageResponse = await Page.insertMany(pageDocuments);
      // console.log("\nPage inserting to DB:", pageResponse);

      savedBook.totalPages = pageContent.length;
      const savingPageOnBooks = await savedBook.save();
      console.log("\n📜 Pages Saved in Book:", savingPageOnBooks.totalPages);

      //Linking User to Book in their private library
      const userLibrary = await UserLibrary.findOneAndUpdate(
        {
          userId: req.user._id,
          bookId: savedBook._id,
        },
        {
          $setOnInsert: {
            userId: req.user._id,
            bookId: savedBook._id,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      res.status(201).json({
        message:
          "Book uploaded & processed successfully. Book added to library",
        bookId: savedBook._id,
        totalPages: savedBook.totalPages,
        libraryId: userLibrary._id,
        firstPagePreview: pageContent[0].substring(0, 100) + "...",
      });
    } catch (error) {
      console.log("\n❌ Error in upload route:", error);
      res.status(500).json({
        message: "Server Error during processing",
        error: error.message,
      });
    }
  },
);

//Route to generate book cover
router.post("/:id/generate-cover", userAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Fetch the book data from MongoDB
    const book = await Book.findById(id);
    if (!book) return res.status(404).json({ message: "Book not found" });

    //Getting first 10 pages
    const pages = await Page.find({ bookId: id })
      .sort({ pageNumber: 1 })
      .limit(10);
    if (!pages || pages.length === 0)
      return res.status(404).json({ message: "Book pages not found" });
    //Combine text
    const textSnippet = pages.map((p) => p.content).join("\n\n");

    // 2. Book Cover Image Generation
    const sheetPrompt = `
      Role: Professional High-End Book Cover Illustrator.
      Source Text (First 10 Pages): "${textSnippet}"
      
      TASK: Generate a visually stunning, cinematic landscape or abstract scenery that represents the world of this book.
      
      STRICTURES:
      1. NO HUMANS: Do not include any people, faces, or characters.
      2. COLOR PALETTE: Be bold and vibrant. Use a rich, varied color scheme inspired by the mood of the text (e.g., celestial golds, deep cosmic purples, lush forest greens).
      3. COMPOSITION: Focus on landscapes, architecture, or symbolic abstract elements mentioned in the text.
      4. STYLE: High-fidelity, 3D render or cinematic digital art style. Portrait 2:3 aspect ratio. No text.
    `;
    const sheetUrl = await generateAndUploadImage(
      sheetPrompt,
      id,
      "book_cover",
    );
    console.log("\nBook Cover Image Generated and Uploaded.");
    book.coverImage = sheetUrl;
    book.status = "Processing";
    await book.save();
    res.status(200).json({
      message: "Cover generated successfully",
      coverImage: sheetUrl,
    });
  } catch (error) {
    console.log("\n❌ Error in Generating Book Cover:", error);
    res.status(500).json({
      message: "Book Cover Generation Failed",
      error: error.message,
    });
  }
});

//Route to analyze and generate artStyle, characters and setting.
router.post("/:id/analyze", userAuth, async (req, res) => {
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
    // console.log(`\n⬆️ Sending ${textSnippet.length} characters to Gemini...`);

    //Calling Gemini
    const styleGuide = await analyzeBookContext(textSnippet);
    console.log("\nArt style generated by Gemini.");
    // console.log("\n🤖 Gemini Output:", styleGuide);

    // 2. Character Sheet Generation (Pass 1.5)
    // This creates the "Source of Truth" image
    const sheetPrompt = `Professional character design sheet, 3 views (front, side, back), neutral background. Character: ${styleGuide.characters}. Style: ${styleGuide.artStyle}`;
    const sheetUrl = await generateAndUploadImage(
      sheetPrompt,
      id,
      "character_sheet",
    );
    console.log("\nCharacter Sheet Image Generated and Uploaded.");

    const updatedBook = await Book.findByIdAndUpdate(
      id,
      {
        author: styleGuide.author,
        globalContext: {
          artStyle: styleGuide.artStyle,
          characters: styleGuide.characters,
          setting: styleGuide.setting,
        },
        characterSheetUrl: sheetUrl,
      },
      { new: true },
    );

    res.status(201).json({
      message: "Style Guide Analysis Complete",
      globalContext: updatedBook.globalContext,
    });
  } catch (error) {
    console.log("\n🤖 Gemimi Analysis Stage Error - ", error);
    res.status(500).json({ message: "Analysis Failed", error: error.message });
  }
});

//Route to generate the actual image prompts of all the pages (by book id)
router.post("/:id/generate-prompts", userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(
      `\n--- Starting Step 6: Image Prompt Generation for Book ${id} ---`,
    );

    //1. GET DATA
    const book = await Book.findById(id);
    const pages = await Page.find({ bookId: id }).sort({ pageNumber: 1 });

    if (!book.globalContext || !book.globalContext.artStyle)
      return res.status(400).json({
        message: "Style Guide Missing. Please run the Analysis phase.",
      });

    console.log(
      `\n Found ${pages.length} pages. Using style guide:`,
      book.globalContext.artStyle,
    );

    //2. Setting up Loop Variables
    let previousPageSummary =
      "The story begins. Introduce the main characters and setting.";
    let processedCount = 0;
    for (let page of pages) {
      //Skipping the page if we already have a prompt for it.
      if (page.imagePrompt && page.imagePrompt.length > 20) {
        console.log(`\n⏭️ Skipping Page ${page.pageNumber}. (Already Done)`);
        previousPageSummary = await summarizeForContinuity(page.content);
        continue;
      }
      console.log(`\n📜 Processing Page ${page.pageNumber}`);

      //Now calling the AI function to actually create the prompt.
      const newPrompt = await generatePagePrompt(
        book.globalContext,
        page.content,
        previousPageSummary,
      );

      page.imagePrompt = newPrompt;
      page.status = "processing";
      await page.save();
      console.log(`\n--> Generated: "${newPrompt.substring(0, 40)}..."`);

      //We use AI to generate a 1 line summary (instead of using substring - previous approach)
      previousPageSummary = await summarizeForContinuity(page.content);

      //Safety Pause - 2 seconds wait before moving to next page so Rate Limiting is followed.
      console.log("\nGiving a 2 second break before calling the API again.");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      processedCount++;
    }

    console.log("\n--- Loop Complete ---");
    book.status = "Completed";
    await book.save();
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

//Route to generate actual images
//URL: POST /api/books/:id/generate-images // body - { startPage, endPage }
//Instead of batch processing (creating pages of all pages at once) I am doing On-demand buffering.
router.post("/:id/generate-images", userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { startPage, endPage } = req.body;
    const book = await Book.findById(req.params.id);
    console.log("\n🚀 Starting Pass 3: Image Generation for Book", id, "---");
    console.log(
      `\n---🚀 Generating Image Buffer: Pages ${startPage} to ${endPage} --- `,
    );

    //Fetch pages which have prompts but NO images
    const pages = await Page.find({
      bookId: id,
      pageNumber: { $gte: startPage, $lte: endPage },
      imagePrompt: { $exists: true, $ne: "" }, // image exists and !== ""
    }).sort({ pageNumber: 1 });

    if (pages.length === 0)
      return res.json(200).json({ message: "No pending images to generate." });

    console.log(`\nFound ${pages.length} pages ready for visualization.`);

    let newlyGenerated = 0;

    for (const page of pages) {
      if (page.imageUrl) {
        console.log(
          `\n🎨 Image already exists for Page: ${page.pageNumber}... Moving onto next page.`,
        );
        continue;
      }

      console.log(`\n🎨 Processing Buffer: Page ${page.pageNumber}...`);
      try {
        const driveUrl = await generateAndUploadImage(
          page.imagePrompt,
          id,
          `page_${page.pageNumber}`,
          book.characterSheetUrl,
        );
        page.imageUrl = driveUrl;
        page.status = "completed";
        await page.save();

        newlyGenerated++;

        //Rate Limit: 7 second for Image API Health
        console.log(
          "\n🖼️ Image Generated & Uploaded. Waiting 7 second before generating next.",
        );
        await new Promise((resolve) => setTimeout(resolve, 7000));
      } catch (error) {
        console.error(`\n❌ Error on Page ${page.pageNumber}:`, error.message);
        // continue; //Continuing to next page in buffer if one fails
        return res.status(400).json({
          message: `❌ Error on Page: ${page.pageNumber}:, ${error.message}`,
          range: `${startPage} - ${endPage}`,
          newlyGenerated,
        });
      }
    }
    res.status(200).json({
      message: "Buffer Updated",
      range: `${startPage} - ${endPage}`,
      newlyGenerated,
    });
  } catch (error) {
    console.log("\n❌ Buffer Generation Error:", error);
    res
      .status(500)
      .json({ message: "Range Processing Failed.", error: error.message });
  }
});

//Route to get all the books related to logged in user.
router.get("/my-library", userAuth, async (req, res) => {
  try {
    // Find all books in THIS user's library and pull the Book details
    const userBooks = await UserLibrary.find({ userId: req.user._id })
      .populate({
        path: "bookId",
        select: "_id title totalPages status coverImage"
      }) 
      .sort({ addedAt: -1 });

    res.json(userBooks);
  } catch (error) {
    console.log("library Error", error);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
