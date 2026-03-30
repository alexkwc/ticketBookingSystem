export type BookingStatus = "pending" | "success";
export type DerivedBookingStatus = "pending" | "success" | "rejected";
export type PaymentStatusValue = "pending" | "paid" | "failed" | "refunded";

export interface Booking {
  id: string;
  event_id: string;
  seat_id: string;
  user_id: string;
  created_at: Date;
  status: BookingStatus;
  payment_session_id: string | null;
}

export interface OutboxPayload {
  paymentSessionID: string;
  bookingID: string;
}

export interface OutboxItem {
  id: string;
  type: string;
  payload: OutboxPayload;
  created_at: Date;
  processed_at: Date | null;
}

export interface PaymentSession {
  sessionID: string;
  checkoutURL: string;
}

export interface PaymentStatusResponse {
  status: PaymentStatusValue;
}
