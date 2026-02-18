import { Response, NextFunction } from "express";
import { AuthedRequest } from "./auth.js";
import { Role } from "../types.js";

export function requireRole(roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
