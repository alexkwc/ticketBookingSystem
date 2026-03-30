import http from "http";
import { createPaymentSession, getPaymentStatus, refundSession } from "../paymentClient";

jest.mock("http");

describe("paymentClient", () => {
  const mockEnd = jest.fn();
  const mockWrite = jest.fn();

  function mockHttpResponse(statusCode: number, body: unknown): void {
    (http.request as jest.Mock).mockImplementationOnce(
      (_options: unknown, callback: (res: any) => void) => {
        const res = {
          statusCode,
          on(event: string, handler: (data?: Buffer) => void) {
            if (event === "data") handler(Buffer.from(JSON.stringify(body)));
            if (event === "end") handler();
          },
        };
        callback(res);
        return { on: jest.fn(), write: mockWrite, end: mockEnd };
      }
    );
  }

  function mockHttpError(error: Error): void {
    (http.request as jest.Mock).mockImplementationOnce(
      (_options: unknown, _callback: unknown) => ({
        on(event: string, handler: (err: Error) => void) {
          if (event === "error") handler(error);
        },
        write: mockWrite,
        end: mockEnd,
      })
    );
  }

  beforeEach(() => jest.clearAllMocks());

  describe("createPaymentSession", () => {
    it("returns the PaymentSession on a successful response", async () => {
      const session = {
        sessionID: "sess-abc",
        checkoutURL: "https://pay.example.com/sess-abc",
      };
      mockHttpResponse(201, session);

      const result = await createPaymentSession({
        bookingID: "b-1",
        userID: "u-1",
        amount: 1000,
      });

      expect(result).toEqual(session);
      expect(mockEnd).toHaveBeenCalled();
    });

    it("throws with status 502 when the service returns 5xx", async () => {
      mockHttpResponse(500, { error: "Internal Server Error" });

      await expect(
        createPaymentSession({ bookingID: "b-1", userID: "u-1", amount: 1000 })
      ).rejects.toMatchObject({ status: 502 });
    });

    it("throws when the HTTP request fails with a connection error", async () => {
      mockHttpError(new Error("ECONNREFUSED"));

      await expect(
        createPaymentSession({ bookingID: "b-1", userID: "u-1", amount: 1000 })
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("sends the booking details in the request body", async () => {
      mockHttpResponse(201, { sessionID: "s", checkoutURL: "https://pay.example.com/s" });

      await createPaymentSession({ bookingID: "b-42", userID: "u-7", amount: 2500 });

      expect(mockWrite).toHaveBeenCalledWith(
        JSON.stringify({ bookingID: "b-42", userID: "u-7", amount: 2500 })
      );
    });
  });

  describe("getPaymentStatus", () => {
    it("returns the PaymentStatusResponse on a successful response", async () => {
      mockHttpResponse(200, { status: "paid" });

      const result = await getPaymentStatus("sess-abc");

      expect(result).toEqual({ status: "paid" });
    });

    it("throws with status 502 when the service returns 5xx", async () => {
      mockHttpResponse(503, { error: "Service Unavailable" });

      await expect(getPaymentStatus("sess-abc")).rejects.toMatchObject({
        status: 502,
      });
    });

    it("does not send a request body for GET requests", async () => {
      mockHttpResponse(200, { status: "pending" });

      await getPaymentStatus("sess-abc");

      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe("refundSession", () => {
    it("returns the response body on success", async () => {
      mockHttpResponse(200, { refunded: true });

      const result = await refundSession("sess-abc");

      expect(result).toEqual({ refunded: true });
    });

    it("throws with status 502 when the service returns 5xx", async () => {
      mockHttpResponse(500, { error: "Internal Server Error" });

      await expect(refundSession("sess-abc")).rejects.toMatchObject({
        status: 502,
      });
    });
  });
});
