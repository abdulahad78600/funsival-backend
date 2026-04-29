const mongoose = require('mongoose');

const app = require('./app');
const config = require('./config/env');
const connectDatabase = require('./config/database');

let server;

async function startServer() {
  try {
    await connectDatabase();

    server = app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start the server.');
    console.error(error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Closing server and database connection...`);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    console.log('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown.');
    console.error(error.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection detected.');
  console.error(error);
  shutdown('UNHANDLED_REJECTION');
});

startServer();
