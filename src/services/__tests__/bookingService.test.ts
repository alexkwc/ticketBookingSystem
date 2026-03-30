import {
  createBooking,
  handlePaymentWebhook,
  confirmBookingSuccess,
  deriveStatus,
} from "../bookingService";
import type { Booking } from "../../types";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock("../lockService", () => ({
  acquireLock: jest.fn(),
}));

jest.mock("../paymentClient", () => ({
  createPaymentSession: jest.fn(),
  getPaymentStatus: jest.fn(),
}));

jest.mock("../../jobs/bookingCheckQueue", () => ({
  enqueueBookingCheck: jest.fn(),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("mock-uuid"),
}));

import { pool } from "../../config/db";
import { acquireLock } from "../lockService";
import { createPaymentSession, getPaymentStatus } from "../paymentClient";
import { enqueueBookingCheck } from "../../jobs/bookingCheckQueue";

const mockPoolQuery = pool.query as jest.Mock;
const mockPoolConnect = pool.connect as jest.Mock;
const mockAcquireLock = acquireLock as jest.MockedFunction<typeof acquireLock>;
const mockCreatePaymentSession = createPaymentSession as jest.MockedFunction<
  typeof createPaymentSession
>;
const mockGetPaymentStatus = getPaymentStatus as jest.MockedFunction<
  typeof getPaymentStatus
>;
const mockEnqueueBookingCheck = enqueueBookingCheck as jest.MockedFunction<
  typeof enqueueBookingCheck
>;

const baseBooking: Booking = {
  id: "booking-1",
  event_id: "event-1",
  seat_id: "seat-A",
  user_id: "user-1",
  created_at: new Date("2024-01-01T12:00:00Z"),
  status: "pending",
  payment_session_id: "sess-1",
};

describe("bookingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // deriveStatus
  // -------------------------------------------------------------------------
  describe("deriveStatus", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns "success" when booking status is success', () => {
      const booking: Booking = { ...baseBooking, status: "success" };
      expect(deriveStatus(booking)).toBe("success");
    });

    it('returns "pending" when booking is within the 30-minute window', () => {
      jest.setSystemTime(new Date("2024-01-01T12:10:00Z")); // 10 min after
      const booking: Booking = {
        ...baseBooking,
        status: "pending",
        created_at: new Date("2024-01-01T12:00:00Z"),
      };
      expect(deriveStatus(booking)).toBe("pending");
    });

    it('returns "rejected" when the booking window has expired', () => {
      jest.setSystemTime(new Date("2024-01-01T12:35:00Z")); // 35 min after
      const booking: Booking = {
        ...baseBooking,
        status: "pending",
        created_at: new Date("2024-01-01T12:00:00Z"),
      };
      expect(deriveStatus(booking)).toBe("rejected");
    });

    it('returns "pending" when booking is exactly at the window boundary', () => {
      // Exactly at 30 minutes — expiredAt equals now, so NOT less than now
      jest.setSystemTime(new Date("2024-01-01T12:30:00Z"));
      const booking: Booking = {
        ...baseBooking,
        status: "pending",
        created_at: new Date("2024-01-01T12:00:00Z"),
      };
      expect(deriveStatus(booking)).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // createBooking
  // -------------------------------------------------------------------------
  describe("createBooking", () => {
    it("creates a booking and returns bookingID, status, and checkoutURL", async () => {
      mockAcquireLock.mockResolvedValue("mock-uuid");
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [baseBooking] }) // INSERT
        .mockResolvedValueOnce({
          rows: [{ ...baseBooking, payment_session_id: "sess-1" }],
        }); // UPDATE
      mockCreatePaymentSession.mockResolvedValue({
        sessionID: "sess-1",
        checkoutURL: "https://pay.example.com/sess-1",
      });
      mockEnqueueBookingCheck.mockResolvedValue(undefined as any);

      const result = await createBooking({
        eventID: "event-1",
        seatID: "seat-A",
        userID: "user-1",
      });

      expect(result).toEqual({
        bookingID: "booking-1",
        status: "pending",
        checkoutURL: "https://pay.example.com/sess-1",
      });
    });

    it("acquires a Redis lock before inserting the booking", async () => {
      mockAcquireLock.mockResolvedValue("mock-uuid");
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [baseBooking] })
        .mockResolvedValueOnce({ rows: [baseBooking] });
      mockCreatePaymentSession.mockResolvedValue({
        sessionID: "sess-1",
        checkoutURL: "https://pay.example.com/sess-1",
      });
      mockEnqueueBookingCheck.mockResolvedValue(undefined as any);

      await createBooking({ eventID: "event-1", seatID: "seat-A", userID: "user-1" });

      expect(mockAcquireLock).toHaveBeenCalledWith("event-1", "seat-A", "mock-uuid");
      expect(mockAcquireLock.mock.invocationCallOrder[0]).toBeLessThan(
        mockPoolQuery.mock.invocationCallOrder[0]
      );
    });

    it("enqueues a 30-minute delayed job after successful booking creation", async () => {
      mockAcquireLock.mockResolvedValue("mock-uuid");
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [baseBooking] })
        .mockResolvedValueOnce({ rows: [baseBooking] });
      mockCreatePaymentSession.mockResolvedValue({
        sessionID: "sess-1",
        checkoutURL: "https://pay.example.com/sess-1",
      });
      mockEnqueueBookingCheck.mockResolvedValue(undefined as any);

      await createBooking({ eventID: "event-1", seatID: "seat-A", userID: "user-1" });

      expect(mockEnqueueBookingCheck).toHaveBeenCalledWith(
        "booking-1",
        30 * 60 * 1000
      );
    });

    it("throws 409 when the seat lock cannot be acquired", async () => {
      mockAcquireLock.mockResolvedValue(null);

      await expect(
        createBooking({ eventID: "event-1", seatID: "seat-A", userID: "user-1" })
      ).rejects.toMatchObject({ status: 409 });

      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("throws 503 when the payment service is unavailable", async () => {
      mockAcquireLock.mockResolvedValue("mock-uuid");
      mockPoolQuery.mockResolvedValueOnce({ rows: [baseBooking] });
      mockCreatePaymentSession.mockRejectedValue(
        new Error("Payment service unavailable")
      );

      await expect(
        createBooking({ eventID: "event-1", seatID: "seat-A", userID: "user-1" })
      ).rejects.toMatchObject({ status: 503 });
    });
  });

  // -------------------------------------------------------------------------
  // handlePaymentWebhook
  // -------------------------------------------------------------------------
  describe("handlePaymentWebhook", () => {
    it("does nothing when no booking matches the session ID", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      await handlePaymentWebhook({
        paymentSessionID: "unknown-session",
        status: "paid",
      });

      expect(mockGetPaymentStatus).not.toHaveBeenCalled();
    });

    it("skips processing when the booking is already successful (idempotency)", async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [{ ...baseBooking, status: "success" }],
      });

      await handlePaymentWebhook({ paymentSessionID: "sess-1", status: "paid" });

      expect(mockGetPaymentStatus).not.toHaveBeenCalled();
    });

    it("does nothing when payment status verification fails", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [baseBooking] });
      mockGetPaymentStatus.mockRejectedValue(
        new Error("Payment service unreachable")
      );

      await expect(
        handlePaymentWebhook({ paymentSessionID: "sess-1", status: "paid" })
      ).resolves.toBeUndefined();

      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it('does nothing when verified payment status is not "paid"', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [baseBooking] });
      mockGetPaymentStatus.mockResolvedValue({ status: "pending" });

      await handlePaymentWebhook({
        paymentSessionID: "sess-1",
        status: "pending",
      });

      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it("confirms the booking when payment is verified as paid", async () => {
      const mockClient = {
        query: jest
          .fn()
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SELECT conflicts
          .mockResolvedValueOnce(undefined) // UPDATE status = success
          .mockResolvedValueOnce(undefined), // COMMIT
        release: jest.fn(),
      };
      mockPoolQuery.mockResolvedValue({ rows: [baseBooking] });
      mockPoolConnect.mockResolvedValue(mockClient);
      mockGetPaymentStatus.mockResolvedValue({ status: "paid" });

      await handlePaymentWebhook({ paymentSessionID: "sess-1", status: "paid" });

      expect(mockPoolConnect).toHaveBeenCalled();
      const sqlCalls: string[] = mockClient.query.mock.calls.map(
        (c: any[]) => c[0]
      );
      expect(sqlCalls).toContain("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // confirmBookingSuccess
  // -------------------------------------------------------------------------
  describe("confirmBookingSuccess", () => {
    let mockClient: { query: jest.Mock; release: jest.Mock };

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      mockPoolConnect.mockResolvedValue(mockClient);
    });

    it("marks the booking as success when there is no conflicting booking", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT conflicts
        .mockResolvedValueOnce(undefined) // UPDATE status
        .mockResolvedValueOnce(undefined); // COMMIT

      await confirmBookingSuccess(baseBooking);

      const updateCall = mockClient.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes("UPDATE bookings SET status")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).toContain("booking-1");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("writes a refund outbox entry when a conflicting booking exists", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "newer-booking" }] }) // SELECT conflicts
        .mockResolvedValueOnce(undefined) // INSERT outbox
        .mockResolvedValueOnce(undefined); // COMMIT

      await confirmBookingSuccess(baseBooking);

      const insertCall = mockClient.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes("INSERT INTO outbox")
      );
      expect(insertCall).toBeDefined();
      const payload = JSON.parse(insertCall[1][1]);
      expect(payload.paymentSessionID).toBe("sess-1");
      expect(payload.bookingID).toBe("booking-1");
    });

    it("does not mark booking as success when a conflict exists", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "newer-booking" }] }) // SELECT conflicts
        .mockResolvedValueOnce(undefined) // INSERT outbox
        .mockResolvedValueOnce(undefined); // COMMIT

      await confirmBookingSuccess(baseBooking);

      const updateCall = mockClient.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes("UPDATE bookings SET status")
      );
      expect(updateCall).toBeUndefined();
    });

    it("rolls back and rethrows when a database error occurs", async () => {
      const dbError = new Error("Database connection lost");
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(dbError) // SELECT conflicts throws
        .mockResolvedValue(undefined); // ROLLBACK

      await expect(confirmBookingSuccess(baseBooking)).rejects.toThrow(
        "Database connection lost"
      );

      const rollbackCall = mockClient.query.mock.calls.find(
        (call: any[]) => call[0] === "ROLLBACK"
      );
      expect(rollbackCall).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("always releases the database client even after an error", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error("Unexpected error"))
        .mockResolvedValue(undefined); // ROLLBACK

      await expect(confirmBookingSuccess(baseBooking)).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
