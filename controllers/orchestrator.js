// Models
const Book = require("../models/book.model");
const Page = require("../models/page.model");
const UserLibrary = require("../models/userLibrary.model");
const path = require("path");

//Importing Utility functions.
const { parseFilePageByPage } = require("../utils/fileParser");
const {
  analyzeBookContext,
  generatePagePrompt,
  summarizeForContinuity,
} = require("../utils/aiService");
const { generateAndUploadImage } = require("../utils/imageService");

/**
 * HELPER: Syncs progress to MongoDB and emits real-time updates via Socket.io
 * @param {string} bookId - The ID of the book being processed
 * @param {string} status - Current pipeline status (Enum)
 * @param {number} progress - Numeric percentage (0-100)
 * @param {object} io - The Socket.io instance
 */
const syncPipeline = async (bookId, status, progress, io) => {
  try {
    await Book.findByIdAndUpdate(bookId, { status, progress });
    if (io) {
      io.to(bookId.toString()).emit("pipeline_update", { status, progress });
    }
    console.log(`\n[NEURAL LINK] ${status.toUpperCase()} // ${progress}%`);
  } catch (error) {
    console.error("Failed to sync pipeline status:", error);
  }
};

//MAIN CONTROLLER: Orchestrates the Multi-Pass Visualization Pipeline
module.exports.startNeuralPipeline = async (req, res) => {
  const { io } = req;
  try {
    if (!req.file) throw new Error("Book Not Uploaded");

    // --- 🛡️ THE SAFETY CHECK ---
    // Check if specific user already has a book currently processing.
    // To prevents "Double-Triggering" if they refresh and re-upload quickly.
    const activeBook = await Book.findOne({
      title: req.body.title || req.file.originalName,
      status: {
        $in: [
          "Analyzing",
          "Shredding",
          "Generating_Cover",
          "Generating_Prompts",
          "Uploaded",
        ],
      },
    });
    if (activeBook) {
      console.log(
        `\n⚠️ Pipeline already active for: ${activeBook.title}. Re-linking...`,
      );
      return res.status(200).json({
        message:
          "Pipeline already active for this book. Connecting to existing stream...",
        bookId: activeBook._id,
        status: activeBook.status,
        progress: activeBook.progress,
      });
    }

    // --- PART 1: INITIAL UPLOAD & DB CREATION ---
    const bookId = await uploadBook(req);

    // --- PART 2: SEGREGATING THE PDF INTO PAGES ---
    await segrateBookIntoPages(bookId, io);
    res.status(202).json({
      message: "Upload Successful. Neural Pipeline Initiated.",
      bookId,
    });

    // --- PART 3: THE ASYNCHRONOUS AI PIPELINE (Background) ---

    (async () => {
      try {
        console.log(`\n--- 🚀 Starting Background Pipeline for: ${bookId} ---`);

        // Phase 1: Book Cover
        await syncPipeline(bookId, "Generating_Cover", 25, io);
        await generateBookCover(bookId, 1);

        // Phase 2: Analysis & Character Sheet
        await syncPipeline(bookId, "Analyzing", 50, io);
        await analyzeBook(bookId);

        // Phase 3: Prompt Generation (Free Tier: 1-10)
        await syncPipeline(bookId, "Generating_Prompts", 75, io);
        await generateImagePrompts(bookId);

        // Phase 4: Image Generation (Free Tier: 1-10)
        await syncPipeline(bookId, "Generating_Images", 90, io);
        await generateActualImages(bookId);

        await syncPipeline(bookId, "Completed", 100, io);
        console.log(`\n--- ✅ Pipeline Finished for: ${bookId} ---`);
      } catch (error) {
        console.error("Critical Pipeline Breakdown:", error);
        await syncPipeline(bookId, "Error", 0, io);
        if (io)
          io.to(bookId.toString()).emit("pipeline_error", {
            message: error.message,
          });
      }
    })();
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: error.message });
  }
};

//For Uploading the book
const uploadBook = async (req) => {
  const newBook = new Book({
    title: req.body.title || req.file.originalname,
    originalFilePath: req.file.path,
    status: "Uploaded",
    progress: 0,
  });
  const savedBook = await newBook.save();

  //Linking User to Book in their private library
  await UserLibrary.findOneAndUpdate(
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
  return savedBook._id;
};

//Segeragating the pages of uploaded book
const segrateBookIntoPages = async (bookId, io) => {
  const book = await Book.findById(bookId);

  await syncPipeline(bookId, "Shredding", 10, io);
  const pageContent = await parseFilePageByPage(book.originalFilePath);

  const pageDocuments = pageContent.map((content, index) => ({
    bookId,
    pageNumber: index + 1,
    content,
    status: "pending",
  }));

  //Bulk inserting pages
  await Page.insertMany(pageDocuments);
  book.totalPages = pageContent.length;
  await book.save();
  await syncPipeline(bookId, "Shredding", 20, io);
};

//Function for generating Book Cover
const generateBookCover = async (bookId, startPage = 1) => {
  //Getting first 10 pages
  const pages = await Page.find({ bookId })
    .sort({ pageNumber: startPage })
    .limit(10);
  if (!pages || pages.length === 0)
    throw new Error("Pages not found for cover.");

  //Combine text
  const textSnippet = pages.map((p) => p.content).join("\n\n");
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
    bookId,
    "book_cover",
  );
  await Book.findByIdAndUpdate(bookId, {
    coverImage: sheetUrl,
    status: "Generating_Cover",
  });
};

//Function to analyze characters and scene
const analyzeBook = async (bookId) => {
  //Getting first n page (change limit value to get n number of pages)(to get a rough global context for art style)
  const pages = await Page.find({ bookId }).sort({ pageNumber: 1 }).limit(10);
  if (!pages || pages.length === 0) throw new Error("Book pages not found");

  //Combine text
  const textSnippet = pages.map((p) => p.content).join("\n\n");

  //Calling Gemini
  const styleGuide = await analyzeBookContext(textSnippet);
  // 2. Character Sheet Generation (Pass 1.5)
  // This creates the "Source of Truth" image
  const sheetPrompt = `Professional character design sheet, 3 views (front, side, back), neutral background. Character: ${styleGuide.characters}. Style: ${styleGuide.artStyle}`;
  const sheetUrl = await generateAndUploadImage(
    sheetPrompt,
    bookId,
    "character_sheet",
  );

  await Book.findByIdAndUpdate(
    bookId,
    {
      author: styleGuide.author,
      globalContext: {
        artStyle: styleGuide.artStyle,
        characters: styleGuide.characters,
        setting: styleGuide.setting,
      },
      characterSheetUrl: sheetUrl,
      status: "Analyzing",
    },
    { new: true },
  );
};

//Function to generate image prompts for all the pages
const generateImagePrompts = async (bookId) => {
  //1. GET DATA
  const book = await Book.findById(bookId);
  //Prompting is done for 1st 10 pages only
  const pages = await Page.find({ bookId, pageNumber: { $lte: 10 } }).sort({
    pageNumber: 1,
  });

  if (!book.globalContext || !book.globalContext.artStyle)
    throw new Error("Style Guide Missing. Please run the Analysis phase.");

  //2. Setting up Loop Variables
  let previousPageSummary =
    "The story begins. Introduce the main characters and setting.";

  for (let page of pages) {
    //Skipping the page if we already have a prompt for it.
    if (page.imagePrompt && page.imagePrompt.length > 20) {
      previousPageSummary = await summarizeForContinuity(page.content);
      continue;
    }
    //Now calling the AI function to actually create the prompt.
    const newPrompt = await generatePagePrompt(
      book.globalContext,
      page.content,
      previousPageSummary,
    );
    page.imagePrompt = newPrompt;
    page.status = "processing";
    await page.save();

    //We use AI to generate a 1 line summary (instead of using substring - previous approach)
    previousPageSummary = await summarizeForContinuity(page.content);

    //Safety Pause - 2 seconds wait before moving to next page so Rate Limiting is followed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await book.save();
};

//Function to generate actual images
//Instead of batch processing (creating pages of all pages at once) I am doing On-demand buffering.
// body - { startPage, endPage }
const generateActualImages = async (bookId) => {
  const book = await Book.findById(req.params.id);

  //Fetch pages which have prompts but NO images
  const pages = await Page.find({
    bookId: id,
    pageNumber: { $gte: 1, $lte: 10 },
    imagePrompt: { $exists: true, $ne: "" }, // image exists and !== ""
  }).sort({ pageNumber: 1 });

  if (pages.length === 0) throw new Error("No pending images to generate.");

  for (const page of pages) {
    if (page.imageUrl) continue;

    const driveUrl = await generateAndUploadImage(
      page.imagePrompt,
      bookId,
      `page_${page.pageNumber}`,
      book.characterSheetUrl,
    );
    page.imageUrl = driveUrl;
    page.status = "completed";
    await page.save();

    //Rate Limit: 7 second for Image API Health
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
};
