require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Models
const User = require("../models/user.model");

//User Registration - POST /api/auth/register
module.exports.registerUser = async (req, res) => {
  const { fullName, username, email, password } = req.body;
  try {
    let user = await User.find({ email: email });
    if (user._id)
      return res.status(409).json({ message: "User Already Exists.", user });

    //hashing the password
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    user = new User({ fullName, username, email, password: hash });
    const userResponse = await user.save();
    if (!userResponse)
      return res
        .status(400)
        .json({ message: "Some error occurred. Please try again." });

    res.status(200).json({
      message: "User Created.",
      user: { id: userResponse._id, username, email },
    });
  } catch (error) {
    console.log("User Registration Error:", error);
    if (error.keyValue.email)
      res.status(500).json({
        message: "Email ID already exists. Try again with another Email.",
      });
    else if (error.keyValue.username)
      res.status(500).json({
        message: "Username already exists. Try again with another Username.",
      });
    if (error._message == "User validation failed")
      res.status(500).send("Please write email in proper format.");
    res.status(500).send("Server Error");
  }
};

//User Login - POST /api/auth/login
module.exports.userLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(400)
        .json({ message: "User Doesn't Exist. Try again with correct Email." });

    //Comparing Hashed passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ message: "Incorrect Password. Please try again." });

    const payload = { userId: user._id };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: `7d`,
    });
    res.cookie("token", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    res.status(200).json({
      message: "User Logged In. Token Generated",
      token,
      user: { id: user._id, username: user.username },
    });
  } catch (error) {
    console.log("User Login Error:", error);
    res.status(500).send("Server Error");
  }
};

//Fetch logged in user details - GET /api/auth/me
module.exports.loggedUserDetails = async (req, res) => {
  try {
    res.status(200).json({
      fullName: req.user.fullName,
      username: req.user.username,
      email: req.user.email,
    });
  } catch (error) {
    console.log("User Fetch Error:", error);
    res.status(500).send("Server Error");
  }
};

//Logout the user
module.exports.logoutUser = async (req, res) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).send("Logout Success.");
};
