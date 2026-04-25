const fs = require("node:fs");
const path = require("node:path");

// Load env variables
function loadEnv() {
  const envPath = path.join(__dirname, "../.env");
  try {
    const content = fs.readFileSync(envPath, "utf8");
    content.split("\n").forEach(line => {
      const [key, ...valueParts] = line.trim().split("=");
      if (key && !key.startsWith("#")) {
        process.env[key] = valueParts.join("=");
      }
    });
  } catch (e) {
    console.log("No .env file");
  }
}

loadEnv();

// GET /api/products
if (process.env.REQUEST_URL === "/api/products") {
  return {
    statusCode: 200,
    body: JSON.stringify([
      { id: "noir-neon", name: "Noir Neon", price: 99 },
      { id: "cyber-wave", name: "Cyber Wave", price: 99 }
    ])
  };
}

// Serve static files
const publicPath = path.join(__dirname, "../public");
const filePath = path.join(publicPath, process.env.REQUEST_PATH || "index.html");

if (fs.existsSync(filePath)) {
  const content = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath);
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json"
  };
  
  return {
    statusCode: 200,
    headers: { "Content-Type": mimeTypes[ext] || "text/plain" },
    body: content
  };
}

return {
  statusCode: 404,
  body: "Not found"
};
