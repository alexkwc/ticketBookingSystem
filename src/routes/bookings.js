const { Router } = require("express");
const { createBooking } = require("../services/bookingService");

const router = Router();

// POST /bookings  body: { eventID, seatID }
// userID comes from a real auth middleware in production; here we read from header for simplicity
router.post("/", async (req, res, next) => {
  try {
    const userID = req.headers["x-user-id"];
    if (!userID) return res.status(401).json({ error: "x-user-id header required" });

    const { eventID, seatID } = req.body;
    if (!eventID || !seatID) {
      return res.status(400).json({ error: "eventID and seatID are required" });
    }

    const booking = await createBooking({ eventID, seatID, userID });
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
