const mongoose = require("mongoose");

const PageSchema = new mongoose.Schema({
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
  pageNumber: { type: Number, required: true },
  content: { type: String, required: true }, // Raw Text

  //Below are AI generated fields for 2nd Stage
  pageSummary: {type: String},
  imagePrompt: { type: String },
  imageUrl: { type: String },
  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },
});

//Compound index to ensure you can't have two "Page 1s/ only have unique pages" for the same book
PageSchema.index({ bookId: 1, pageNumber: 1 }, { unique: true });

module.exports = mongoose.model('Page', PageSchema);