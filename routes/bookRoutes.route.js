const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/multer.middleware");
const path = require("path");

// Models
const Book = require("../models/book.model");
const Page = require("../models/page.model");

//Importing Parser
const { parseFile } = require("../utils/fileParser");

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
    res
      .status(500)
      .json({
        message: "Server Error during processing",
        error: error.message,
      });
  }
});

module.exports = router;
