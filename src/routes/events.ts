import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../config/db";

const router = Router();

// GET /events?cursor=<created_at>&limit=20&date=&host=
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const { cursor, date, host } = req.query as Record<string, string | undefined>;

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (date) {
      params.push(date);
      conditions.push(`e.date::date = $${params.length}`);
    }
    if (host) {
      params.push(`%${host}%`);
      conditions.push(`e.host ILIKE $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      conditions.push(`e.date > $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.host, e.date, v.id AS venue_id, v.name AS venue_name, v.address
       FROM events e
       JOIN venues v ON v.id = e.venue_id
       ${where}
       ORDER BY e.date ASC
       LIMIT $${params.length}`,
      params
    );

    const nextCursor = rows.length === limit ? rows[rows.length - 1].date : null;
    res.json({ data: rows, nextCursor });
  } catch (err) {
    next(err);
  }
});

// GET /events/:id — event detail with seat availability
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const BOOKING_WINDOW = parseInt(process.env.BOOKING_WINDOW_MINUTES ?? "30");

    const { rows: events } = await pool.query(
      `SELECT e.id, e.name, e.host, e.date, v.id AS venue_id, v.name AS venue_name, v.address
       FROM events e
       JOIN venues v ON v.id = e.venue_id
       WHERE e.id = $1`,
      [id]
    );

    if (!events.length) {
      return res.status(404).json({ error: "Event not found" });
    }

    // A seat is "taken" if there's a booking that is success, or pending and not yet expired
    const { rows: seats } = await pool.query(
      `SELECT s.id, s.label,
         CASE
           WHEN b.id IS NOT NULL THEN 'taken'
           ELSE 'available'
         END AS availability
       FROM seats s
       LEFT JOIN bookings b ON b.seat_id = s.id
         AND b.event_id = $1
         AND (
           b.status = 'success'
           OR (b.status = 'pending' AND b.created_at + ($2 || ' minutes')::interval > now())
         )
       WHERE s.venue_id = $3
       ORDER BY s.label`,
      [id, BOOKING_WINDOW, events[0].venue_id]
    );

    res.json({ event: events[0], seats });
  } catch (err) {
    next(err);
  }
});

export default router;
