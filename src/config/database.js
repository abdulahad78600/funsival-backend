const mongoose = require('mongoose');

const config = require('./env');

async function connectDatabase() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected successfully.');
}

module.exports = connectDatabase;
