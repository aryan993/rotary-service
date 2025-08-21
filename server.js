require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

// Import controllers
const { personalEmailHandler } = require('./controllers/personal-email');
const { helloHandler } = require('./controllers/hello');

// Define routes
app.post('/personal-email', personalEmailHandler);
app.get('/hello', helloHandler);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: "Welcome to the API Server",
    availableEndpoints: {
      personalEmail: {
        method: "POST",
        path: "/personal-email",
        description: "Send personalized emails"
      },
      hello: {
        method: "GET",
        path: "/hello",
        description: "Check server status"
      }
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    message: "Endpoint not found",
    availableEndpoints: [
      "GET /",
      "POST /personal-email",
      "GET /hello"
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  http://localhost:${PORT}/`);
  console.log(`- POST http://localhost:${PORT}/personal-email`);
  console.log(`- GET  http://localhost:${PORT}/hello`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

module.exports = app;