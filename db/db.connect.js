const mongoose = require("mongoose");
require("dotenv").config();

const mongoUri = process.env.MONGODB;

let cached = global.mongoose;
if(!cached) {
  cached = global.mongoose = { conn: null, promise: null};
}

const initialiseDatabase = async () => {
  if(cached.conn) return cached.conn;
  if(!cached.promise) {
    cached.promise = mongoose.connect(mongoUri, {
      bufferCommands: false,
    }).then((mongoose) => {
      console.log("MongoDB Connected Successfully.");
      return mongoose;
    })
    .catch((err) => console.log("Error Connecting Database:", err));
  }
  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = { initialiseDatabase };