require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { initialiseDatabase } = require("./db/db.connect");

//Routers
const bookRoutes = require("./routes/bookRoutes.route");
const authRoutes = require("./routes/authRoutes.route");

const app = express();
const PORT = process.env.PORT || 3000;

const corsOption = {
  //   origin: "*", // this will not work if the request includes credentials(e.g cookies)
  origin: "http://localhost:3000",
  credentials: true,
  optionSuccessStatus: 200,
};

//Middleware
app.use(cors(corsOption));
app.use(express.json());
app.use(cookieParser());
app.use("/api/books", bookRoutes);
app.use("/api/auth", authRoutes);

//Basic routing for testing
app.get("/", (req, res) => {
  res.send("Bookture API is Running!");
});

const startServer = async () => {
  //DataBase Connection
  await initialiseDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
};

startServer();
