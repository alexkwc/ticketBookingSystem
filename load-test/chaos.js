const http = require("./http");
const config = require("./config");

async function setChaosMode(mode) {
  const res = await http.post(`${config.PAYMENT_URL}/test/chaos/${mode}`);
  if (res.status !== 200) {
    throw new Error(`Failed to set chaos mode '${mode}': HTTP ${res.status}`);
  }
  return res.body.chaosMode;
}

async function withChaos(mode, fn) {
  await setChaosMode(mode);
  try {
    return await fn();
  } finally {
    await setChaosMode("reset");
  }
}

module.exports = { setChaosMode, withChaos };
