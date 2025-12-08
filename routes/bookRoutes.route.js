const express = require('express');
const router = express.Router();
const { upload } = require('../middlewares/multer.middleware');
const Book = require('../models/book.model');
const path = require('path');

router.post('/upload', upload.single('bookFile'), async(req, res) => {
    try {
        if(!req.file)
            return res.status(400).json({ message: 'No File Uploaded'});

        //Create a new book document
        const newBook = new Book({
            title: req.body.title || req.file.originalname,
            originalFilePath: req.file.path,
            pages: [] // We will populate this in next step i.e. parsing
        });
        const savedBook = await newBook.save();
        console.log("book saved:", savedBook);
        res.status(201).json({
            message: 'File uploaded successfully',
            bookId: savedBook._id,
            filePath: req.file.path
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Server Error', error: error.message});
    }
});

module.exports = router;