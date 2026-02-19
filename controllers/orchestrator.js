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

// HELPER: Syncs progress to MongoDB and emits real-time updates via Socket.io
const syncPipeline = async (bookId, status, progress, io) => {
  try {
    if (status == "Error") await Book.findByIdAndUpdate(bookId, { status });
    else await Book.findByIdAndUpdate(bookId, { status, progress });

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
  let bookId;
  let isResuming = false;

  try {
    console.log("Strating PIpeline");
    if (!req.file) throw new Error("No file provided for new book.");
    const titleToCheck =
      req.body.title || (req.file ? req.file.originalname : null);

    // --- 🔍 STEP 1: SMART DETECTION ---
    //Fetch all books for the logged in user.
    const userLibraryEntries = await UserLibrary.find({
      userId: req.user._id,
    }).select("bookId");

    //Extracting just the bookIds (forming array)
    const userBookIds = userLibraryEntries.map((entry) => entry.bookId);

    // Find ANY book that matches the title and belongs from the list above
    const existingBook = await Book.findOne({
      _id: { $in: userBookIds },
      title: titleToCheck,
    }).sort({ createdAt: -1 });

    // --- 🛡️ THE SAFETY CHECK ---
    // Check if specific user already has a book currently processing.
    // To prevents "Double-Triggering" if they refresh and re-upload quickly.
    if (existingBook) {
      // CASE A: Already Completed -> Return immediately
      if (
        existingBook.status === "Completed" ||
        existingBook.progress === 100
      ) {
        console.log(
          `\n✅ Book already processed: ${existingBook.title}. Redirecting...`,
        );
        return res.status(200).json({
          message: "Book already in library.",
          bookId: existingBook._id,
          status: "Completed",
          progress: 100,
          redirect: true, // Flag for frontend to redirect to /library
        });
      }
      // CASE B: It's already running -> Just connect
      if (
        [
          "Analyzing",
          "Shredding",
          "Generating_Cover",
          "Generating_Prompts",
        ].includes(existingBook.status)
      ) {
        console.log(
          `\n⚠️ Pipeline active for: ${existingBook.title}. Re-linking...`,
        );
        return res.status(200).json({
          message: "Pipeline active. Connecting to stream...",
          bookId: existingBook._id,
          status: existingBook.status,
          progress: existingBook.progress,
        });
      }

      // CASE C: It failed or is incomplete -> RESUME IT
      if (
        existingBook.status === "Error" ||
        existingBook.status === "Uploaded" ||
        existingBook.progress < 100
      ) {
        console.log(
          `\n🔄 Resuming Failed/Incomplete Book: ${existingBook.title}`,
        );
        bookId = existingBook._id;
        isResuming = true;

        // Reset status to "Resuming" so UI knows something is happening
        await syncPipeline(bookId, "Resuming", existingBook.progress, io);
      }
    }

    // --- 🛠️ STEP 2: HANDLE CREATION (Only if NOT resuming) ---
    if (!isResuming) {
      // --- PART 1: INITIAL UPLOAD & DB CREATION ---
      bookId = await uploadBook(req);
      // --- PART 2: SEGREGATING THE PDF INTO PAGES ---
      await segrateBookIntoPages(bookId, io);
    } else {
      // If resuming, check if we missed the shredding phase previously
      const bookToCheck = await Book.findById(bookId);
      if (bookToCheck.totalPages === 0 && req.file) {
        // It failed BEFORE shredding finished, so we must retry shredding
        await segrateBookIntoPages(bookId, io);
      }
    }

    // --- 🚀 STEP 3: LAUNCH PIPELINE ---
    res.status(202).json({
      message: isResuming
        ? "Pipeline Resumed"
        : "Upload Successful. Neural Pipeline Initiated.",
      bookId,
    });

    // --- PART 4: THE ASYNCHRONOUS AI PIPELINE (Background) ---
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
  //Checking if book already has a cover url
  const bookResponse = await Book.findById(bookId);
  if (!bookResponse.coverImage.includes("unsplash")) {
    console.log("Cover image already generated. Skipping.");
    return;
  }

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
  //Checking if book already has a cover url
  const bookResponse = await Book.findById(bookId);
  if (
    bookResponse?.author &&
    bookResponse?.globalContext &&
    bookResponse?.characterSheetUrl
  ) {
    console.log("Analysis already complete. Skipping.");
    return;
  }

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
  const book = await Book.findById(bookId);

  //Fetch pages which have prompts but NO images
  const pages = await Page.find({
    bookId: bookId,
    pageNumber: { $gte: 1, $lte: 10 },
    imagePrompt: { $exists: true, $ne: "" }, // image exists and !== ""
  }).sort({ pageNumber: 1 });

  if (pages.length === 0) {
    console.log("No pending images found. Skipping generation.");
    return;
  }

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

// Websocket tester.
module.exports.pingSocket = async (req, res) => {
  const { bookId } = req.params;
  const { io } = req; // Ensure io is attached in server.js

  if (!io) {
    return res.status(500).json({ error: "Socket server not found on app." });
  }

  console.log(`\n📡 Starting Mock Pinger for Room: ${bookId}`);

  // 1. Immediate response to Postman
  res.status(200).json({ message: `Pinger started for room ${bookId}` });

  // 2. Start the Loop
  let count = 1;
  const interval = setInterval(() => {
    if (count > 5) {
      clearInterval(interval);
      console.log(`🏁 Mock Pinger finished for: ${bookId}`);
      return;
    }

    const mockStatus = [
      "Analyzing",
      "Generating_Cover",
      "Shredding",
      "Finalizing",
    ][count % 4];
    const mockProgress = count * 20;

    console.log(`📤 Pinging Room ${bookId}: Step ${count}`);

    // The Critical Emit
    io.to(bookId.toString()).emit("pipeline_update", {
      status: `Mock_${mockStatus}`,
      progress: mockProgress,
      isTest: true,
    });

    count++;
  }, 3000); // 3-second delay
};
