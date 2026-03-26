require("dotenv").config();
const express = require("express");
const eventsRouter = require("./routes/events");
const bookingsRouter = require("./routes/bookings");
const webhooksRouter = require("./routes/webhooks");

const app = express();
app.use(express.json());

app.use("/events", eventsRouter);
app.use("/bookings", bookingsRouter);
app.use("/webhooks", webhooksRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Booking service listening on port ${PORT}`));

module.exports = app;
