import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const overrideFreeze = process.argv[2] === "true";
const FREEZE_HOURS = 48;

const events = yaml.load(readFileSync(new URL("../events.yaml", import.meta.url), "utf8")).events ?? [];
const now = new Date();

const upcoming = events
  .map((e) => ({ ...e, date: new Date(e.date) }))
  .filter((e) => e.date > now)
  .sort((a, b) => a.date - b.date)[0];

if (!upcoming) {
  console.log("No upcoming events on file. Promotion allowed.");
  process.exit(0);
}

const hoursUntil = (upcoming.date - now) / 1000 / 60 / 60;

if (hoursUntil <= FREEZE_HOURS) {
  if (overrideFreeze) {
    console.warn(
      `Freeze window active for "${upcoming.name}" (${hoursUntil.toFixed(1)}h away) — ` +
        `proceeding because override_freeze=true. This should be a tested hotfix only.`
    );
    process.exit(0);
  }
  console.error(
    `BLOCKED: "${upcoming.name}" is ${hoursUntil.toFixed(1)}h away, inside the ${FREEZE_HOURS}h freeze window.\n` +
      `Re-run this workflow with override_freeze=true only if this is a required, tested hotfix.`
  );
  process.exit(1);
}

console.log(
  `Nearest event "${upcoming.name}" is ${hoursUntil.toFixed(1)}h away — outside the freeze window. Promotion allowed.`
);
