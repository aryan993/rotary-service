function helloHandler(req, res) {
  res.status(200).json({ 
    message: "Hello! The server is running successfully.",
    timestamp: new Date().toISOString(),
    endpoints: {
      personalEmail: "POST /personal-email",
      hello: "GET /hello"
    }
  });
}

module.exports = { helloHandler };