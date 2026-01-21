const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
require("dotenv").config();

const userAuth = async (req, res, next) => {
  try {
    // console.log("cookies..", req.cookies);
    const { token } = req.cookies;
    if (!token) return res.status(401).json({ message: "Please Login" });

    const decodedObj = jwt.verify(token, process.env.JWT_SECRET); // Synchronous Operation.
    const { userId } = decodedObj;
    const responseUser = await User.findById(userId).select("-password");
    if (!responseUser) throw new Error("User Not Found.");
    req.user = responseUser;
    next();
  } catch (error) {
    if(!req.cookies?.token)
      return res.status(401).json({ message: "Unauthorized. Please login first." });
    return res.status(400).send("ERROR: " + error.message);
  }
};

module.exports = { userAuth };