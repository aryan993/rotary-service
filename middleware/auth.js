const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({
      message: "API key required",
      details: "Provide API key via x-api-key header or apiKey query parameter"
    });
  }

  // Validate against single environment variable
  const validApiKey = process.env.API_KEY;
  
  if (!validApiKey) {
    console.error('API_KEY environment variable not set');
    return res.status(500).json({
      message: "Server configuration error"
    });
  }

  if (apiKey !== validApiKey) {
    return res.status(403).json({
      message: "Invalid API key",
      details: "The provided API key is not authorized"
    });
  }

  next();
};

module.exports = { apiKeyAuth };