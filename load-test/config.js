module.exports = {
  API_URL: process.env.API_URL || "http://localhost:3000",
  PAYMENT_URL: process.env.PAYMENT_URL || "http://localhost:4000",
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/ticketbooking",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  BOOKING_WINDOW_MINUTES: parseInt(process.env.BOOKING_WINDOW_MINUTES || "2"),
  REQUEST_TIMEOUT_MS: 15000,
};
