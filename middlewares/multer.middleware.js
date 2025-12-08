const multer = require ("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // save to uploads folder.
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname); //console.log this file once
  },
});

const upload = multer({ storage });
module.exports = { upload };