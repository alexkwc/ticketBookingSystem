const http = require("http");
const https = require("https");
const config = require("./config");

function request(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const driver = url.protocol === "https:" ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };

    const req = driver.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.setTimeout(config.REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${config.REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function get(urlStr, headers) {
  return request("GET", urlStr, null, headers);
}

function post(urlStr, body, headers) {
  return request("POST", urlStr, body, headers);
}

module.exports = { get, post };
