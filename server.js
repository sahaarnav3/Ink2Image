require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { initialiseDatabase } = require('./db/db.connect');


//Routers
const bookRoutes = require('./routes/bookRoutes.route');

const app = express();
const PORT = process.env.PORT || 3000;

//Middleware
app.use(cors());
app.use(express.json());
app.use('/api/books', bookRoutes);

//DataBase Connection
initialiseDatabase();


//Basic routing for testing
app.get('/', (req, res) => {
    res.send('Bookture API is Running!');
})


app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
})