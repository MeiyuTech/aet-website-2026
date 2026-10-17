import "server-only";
import { db } from "../database";
export const listRules = () =>
  db<unknown[]>(
    "aet_aice_grade_conversion_rules?select=*&order=country.asc&limit=500",
  );
