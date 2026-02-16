require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { initialiseDatabase } = require("./db/db.connect");
const http = require("http");
const { Server } = require("socket.io");

//Routers
const bookRoutes = require("./routes/bookRoutes.route");
const authRoutes = require("./routes/authRoutes.route");

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const corsOption = {
  //   origin: "*", // this will not work if the request includes credentials(e.g cookies)
  origin: process.env.FRONTEND_URL,
  credentials: true,
  optionSuccessStatus: 200,
};

//Middleware
app.use(cors(corsOption));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  req.io = io; //attaching io to the req object
  next();
});

app.use("/api/books", bookRoutes);
app.use("/api/auth", authRoutes);

//Basic routing for testing
app.get("/", (req, res) => {
  res.send("Bookture API is Running!");
});

io.on("connection", (socket) => {
  console.log("\n 🔌 User Connected To Socket:", socket.id);
  //User can join a room based on their BookID so they only get the updated related to that bookId
  //and not someone else's
  socket.on("join_book_room", (bookId) => {
    socket.join(bookId);
    console.log(`\n 📡User joined book processing room: ${bookId}`);
  });
  socket.on("disconnect", () => console.log("\n 🔌 User Disconnected"));
});

const startServer = async () => {
  try {
    // DataBase Connection
    await initialiseDatabase();
    server.listen(PORT, () => {
      console.log(`🚀 Server running (with Sockets) on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
  }
};

startServer();
