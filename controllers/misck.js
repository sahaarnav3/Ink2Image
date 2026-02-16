const Book = require("../models/book.model");
const Page = require("../models/page.model");
const { 
  analyzeBookContext, 
  generatePagePrompt, 
  summarizeForContinuity 
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
      // Emits to a room specifically for this book ID
      io.to(bookId.toString()).emit("pipeline_update", { status, progress });
    }
    console.log(`\n[NEURAL LINK] ${status.toUpperCase()} // ${progress}%`);
  } catch (err) {
    console.error("Failed to sync pipeline status:", err);
  }
};

/**
 * MAIN CONTROLLER: Orchestrates the Multi-Pass Visualization Pipeline
 */
module.exports.startNeuralPipeline = async (req, res) => {
  const { id } = req.params;
  const io = req.app.get("socketio"); // Fetches the io instance attached in server.js

  try {
    const book = await Book.findById(id);
    if (!book) return res.status(404).json({ message: "Neural Link Failed: Source not found." });

    // 1. RESPOND IMMEDIATELY: Prevents browser timeouts (Vercel/Render 30s limit)
    res.status(202).json({ 
      message: "Neural Pipeline Initiated", 
      bookId: id 
    });

    // 2. BACKGROUND EXECUTION: The async "Neural Pass" flow
    (async () => {
      try {
        console.log(`\n--- 🚀 Starting Orchestration for Book: ${id} ---`);

        // --- PASS 1: GLOBAL SYNTHESIS (Analysis & Character Design) ---
        // Resumable check: Only runs if progress is below 45%
        if (book.progress < 45) {
          await syncPipeline(id, "Analyzing", 10, io);
          
          const pages = await Page.find({ bookId: id }).sort({ pageNumber: 1 }).limit(10);
          if (!pages.length) throw new Error("No extracted pages found to analyze.");

          const textSnippet = pages.map((p) => p.content).join("\n\n");
          
          // Gemini Analysis: Art Style, Characters, Setting
          const styleGuide = await analyzeBookContext(textSnippet);
          
          // Generation: Character Sheet (The "Source of Truth" for consistency)
          const sheetPrompt = `Professional character design sheet, 3 views (front, side, back), neutral background. Character: ${styleGuide.characters}. Style: ${styleGuide.artStyle}`;
          const sheetUrl = await generateAndUploadImage(sheetPrompt, id, "character_sheet");

          await Book.findByIdAndUpdate(id, {
            author: styleGuide.author,
            globalContext: {
              artStyle: styleGuide.artStyle,
              characters: styleGuide.characters,
              setting: styleGuide.setting,
            },
            characterSheetUrl: sheetUrl,
          });
          
          await syncPipeline(id, "Analyzing", 45, io);
        }

        // --- PASS 1.5: COVER FRAGMENT (Cinematic Book Cover) ---
        // Resumable check: Only runs if progress is below 75%
        if (book.progress < 75) {
          await syncPipeline(id, "Generating_Cover", 55, io);
          
          const pages = await Page.find({ bookId: id }).sort({ pageNumber: 1 }).limit(10);
          const textSnippet = pages.map((p) => p.content).join("\n\n");
          
          const coverPrompt = `Role: Professional Book Cover Illustrator. Cinematic landscape, no people, bold vibrant colors. Source: "${textSnippet.substring(0, 1000)}". Style: High-fidelity digital art.`;
          const coverUrl = await generateAndUploadImage(coverPrompt, id, "book_cover");
          
          await Book.findByIdAndUpdate(id, { coverImage: coverUrl });
          await syncPipeline(id, "Generating_Cover", 75, io);
        }

        // --- PASS 2: PROMPT SERIALIZATION (The Continuity Loop) ---
        // Resumable check: Processes pending pages until 100%
        if (book.progress < 100) {
          await syncPipeline(id, "Generating_Prompts", 80, io);
          
          const currentBook = await Book.findById(id);
          const allPages = await Page.find({ bookId: id }).sort({ pageNumber: 1 });
          
          let previousSummary = "The story begins.";

          for (let page of allPages) {
            // Skip page if imagePrompt already exists (Self-healing loop)
            if (page.imagePrompt && page.imagePrompt.length > 20) {
              previousSummary = await summarizeForContinuity(page.content);
              continue;
            }

            // Generate prompt using Style Guide + Current Content + Prev Page Summary
            const newPrompt = await generatePagePrompt(
              currentBook.globalContext, 
              page.content, 
              previousSummary
            );

            page.imagePrompt = newPrompt;
            page.status = "processing";
            await page.save();

            // Generate summary for next page's continuity
            previousSummary = await summarizeForContinuity(page.content);
            
            // Real-time notification for the UI Terminal
            if (io) {
              io.to(id).emit("log_update", { 
                message: `Page ${page.pageNumber} serialized into neural prompt.` 
              });
            }
            
            // Rate Limiting Safety: 2s pause between Gemini calls
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          await syncPipeline(id, "Completed", 100, io);
        }

        console.log(`\n--- ✅ Orchestration Complete for Book: ${id} ---`);

      } catch (pipelineErr) {
        console.error("Critical Pipeline Breakdown:", pipelineErr);
        await syncPipeline(id, "Error", book.progress, io);
        if (io) io.to(id).emit("pipeline_error", { message: pipelineErr.message });
      }
    })();

  } catch (error) {
    console.error("Orchestrator Internal Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};