import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import eventsRouter from "./routes/events";
import bookingsRouter from "./routes/bookings";
import webhooksRouter from "./routes/webhooks";

const app = express();
app.use(express.json());

app.use("/events", eventsRouter);
app.use("/bookings", bookingsRouter);
app.use("/webhooks", webhooksRouter);

app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

interface AppError extends Error {
  status?: number;
}

app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Booking service listening on port ${PORT}`));

export default app;
