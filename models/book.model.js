const mongoose = require("mongoose");

const PageSchema = new mongoose.Schema({
  pageNumber: { type: Number, required: true },
  content: { type: String, required: true }, // Raw Text
  imagePrompt: { type: String }, //Generated later by LLM
  imageUrl: { type: String }, // Generated Lated by AI
  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },
});

const BookSchema = new mongoose.Schema({
  title: { type: String, required: true},
  author: { type: String},
  originalFilePath: { type: String, required: true}, // Path to the uploaded file
  //Below is for the style guide (context of the characters)
  globalContext: {
    characters: { type: String },
    setting: {type: String},
    artStyle: {type: String}
  },
  pages: [PageSchema]
}, {
    timestamps: true
});

module.exports = mongoose.model('Book', BookSchema);