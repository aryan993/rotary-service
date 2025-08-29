require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

// Import middleware
const { apiKeyAuth } = require('./middleware/auth');

// Import controllers
const { personalEmailHandler } = require('./controllers/personal-email');
const { helloHandler } = require('./controllers/hello');
const { dailyEmailHandler } = require('./controllers/daily');

// Public endpoint - no authentication
app.get('/', (req, res) => {
  res.status(200).json({
    message: "Welcome to the API Server",
    availableEndpoints: {
      personalEmail: {
        method: "POST",
        path: "/personal-email",
        description: "Send emails to all users with events today",
        authentication: "API key required (x-api-key header or apiKey query param)"
      },
      daily: {
        method: "POST",
        path: "/daily",
        description: "Send daily birthday and anniversary notifications",
        authentication: "API key required",
        body: {
          type: "string (required: 'test', 'realtime', or 'advance')",
          date: "string (optional, format: 'YYYY-MM-DD')",
          listOfEmails: "array (optional, for testing)"
        }
      },
      hello: {
        method: "GET",
        path: "/hello",
        description: "Check server status",
        authentication: "API key required"
      }
    }
  });
});

// Protected endpoints - require API key
app.post('/personal-email', apiKeyAuth, personalEmailHandler);
app.get('/hello', apiKeyAuth, helloHandler);
app.post('/daily', apiKeyAuth, dailyEmailHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    message: "Endpoint not found",
    availableEndpoints: [
      "GET / (Public)",
      "POST /personal-email (API Key required)",
      "POST /daily (API Key required)",
      "GET /hello (API Key required)"
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
  console.log(`API Key: ${process.env.API_KEY || 'NOT SET - Please set API_KEY in .env'}`);
  console.log(`Endpoints:`);
  console.log(`- GET  http://localhost:${PORT}/ (Public)`);
  console.log(`- POST http://localhost:${PORT}/personal-email (API Key required)`);
  console.log(`- POST http://localhost:${PORT}/daily (API Key required)`);
  console.log(`- GET  http://localhost:${PORT}/hello (API Key required)`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

module.exports = app;