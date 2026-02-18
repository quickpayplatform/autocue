export type Role = "SUBMITTER" | "OPERATOR" | "ADMIN";
export type CueStatus = "PENDING" | "APPROVED" | "EXECUTED" | "REJECTED" | "FAILED";

export interface AuthPayload {
  userId: string;
  role: Role;
}
