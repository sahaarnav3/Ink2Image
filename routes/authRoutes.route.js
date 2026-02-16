const express = require("express");
const router = express.Router();

//Middlewares & Controllers
const { userAuth } = require("../middlewares/userAuth");
const authController = require("../controllers/authController");

router.post("/register", authController.registerUser);

router.post("/login", authController.userLogin);

router.get("/me", userAuth, authController.loggedUserDetails);

router.post("/logout", authController.logoutUser);

module.exports = router;
