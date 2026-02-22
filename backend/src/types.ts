export type Role =
  | "SUBMITTER"
  | "OPERATOR"
  | "ADMIN"
  | "THEATRE_ADMIN"
  | "THEATRE_TECH"
  | "DESIGNER"
  | "CLIENT";
export type VenueRole = "SUBMITTER" | "OPERATOR" | "ADMIN";
export type CueStatus = "PENDING" | "APPROVED" | "EXECUTED" | "REJECTED" | "FAILED";

export interface AuthPayload {
  userId: string;
  role: Role;
}
