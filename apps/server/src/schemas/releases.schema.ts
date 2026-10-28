import Type from "typebox";
import { IsoDate, literals } from "./common.schema.js";

export const Platform = literals(["ios", "android"], { examples: ["ios"] });

export const Commit = Type.Object(
  {
    hash: Type.String({ examples: ["61c0ac0"] }),
    author: Type.String({ examples: ["arda.t"] }),
    date: Type.String({ description: "`YYYY-MM-DD HH:mm` UTC", examples: ["2026-09-03 08:37"] }),
    type: Type.Union([Type.String(), Type.Null()], { description: "Conventional-commit type", examples: ["fix"] }),
    scope: Type.Union([Type.String(), Type.Null()], { examples: ["trial"] }),
    title: Type.String({ examples: ["trial reminder notification sent a day late"] }),
    body: Type.String({ examples: ["Reminder was scheduled in UTC instead of the user's time zone."] }),
  },
  { title: "Commit" },
);

export const Release = Type.Object(
  {
    platform: Platform,
    version: Type.String({ examples: ["3.41.0"] }),
    released: Type.String({ description: "`YYYY-MM-DD HH:mm` UTC", examples: ["2026-09-05 15:37"] }),
    date: { ...IsoDate, description: "Release day, for lining up with ad data days", examples: ["2026-09-05"] },
    commits: Type.Array(Commit),
  },
  { title: "Release" },
);

export const ReleasesQuery = Type.Object({
  from: Type.Optional({ ...IsoDate, description: "First release day, inclusive" }),
  to: Type.Optional({ ...IsoDate, description: "Last release day, inclusive", examples: ["2026-10-14"] }),
  platform: Type.Optional(Platform),
});
