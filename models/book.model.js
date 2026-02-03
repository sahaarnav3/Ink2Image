const mongoose = require("mongoose");

const BookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    author: { type: String },
    originalFilePath: { type: String, required: true }, // Path to the uploaded file
    coverImage: {
      type: String,
      default: "https://images.unsplash.com/photo-1532012197267-da84d127e765?q=80&w=800",
    },

    //Below is for the style guide (context of the characters)
    globalContext: {
      characters: { type: String },
      setting: { type: String },
      artStyle: { type: String },
    },
    characterSheetUrl: {
      type: String,
      default: "",
    },

    //We don't need to store an array of Page IDs because the Pages already point to the book. But keeping a count is useful.
    totalPages: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Book", BookSchema);
