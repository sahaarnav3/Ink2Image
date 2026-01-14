const mongoose = require('mongoose');

const userLibrarySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    progress: { type: Number, default: 0 },
    addedAt: { type: Date, default: Date.now },
    isFavorite: { type: Boolean, default: false }
});

// This ensures a user can't add the same book twice to their library
userLibrarySchema.index({ userId: 1, bookId: 1 }, { unique: true });

module.exports = mongoose.model('UserLibrary', userLibrarySchema);