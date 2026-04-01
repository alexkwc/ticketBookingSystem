import http from "http";
import https from "https";
import { REQUEST_TIMEOUT_MS } from "./config";

export interface HttpResponse {
  status: number | undefined;
  body: unknown;
}

function request(
  method: string,
  urlStr: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const driver = url.protocol === "https:" ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": String(Buffer.byteLength(bodyStr)) } : {}),
        ...headers,
      },
    };

    const req = driver.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function get(urlStr: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return request("GET", urlStr, null, headers);
}

function post(
  urlStr: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<HttpResponse> {
  return request("POST", urlStr, body, headers);
}

export { get, post };
