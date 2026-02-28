const express = require("express");
const router = express.Router();

//Importing controller and middlewares
const bookController = require("../controllers/bookController.js");
const orchestrator = require("../controllers/orchestrator.js");
const { upload } = require("../middlewares/multer.middleware");
const { userAuth } = require("../middlewares/userAuth.js");

router.post("/upload", upload.single("bookFile"), userAuth, bookController.uploadBook);

router.post("/:id/generate-cover", userAuth, bookController.generateBookCover);

router.post("/:id/analyze", userAuth, bookController.analyzeBook);

router.post("/:id/generate-prompts", userAuth, bookController.generateImagePrompts);

router.post("/:id/generate-images", userAuth, bookController.generateActualImages);

router.get("/my-library", userAuth, bookController.fetchLibrary);

router.post("/start-pipeline", upload.single("bookFile"), userAuth, orchestrator.startNeuralPipeline);

router.get("/check-active-session", userAuth, orchestrator.getActiveSession);

router.get("/ping-socket/:bookId", userAuth, orchestrator.pingSocket);

module.exports = router;
