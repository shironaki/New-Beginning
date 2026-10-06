/**
 * tools/devpass.js — set the dev-mode password.
 *
 *   node tools/devpass.js "новый пароль"
 *
 * Only the SHA-256 of the password is written to dev.config.json; the
 * password itself is never stored anywhere in the repository.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const pass = process.argv[2];
if (!pass) {
    console.error("укажите пароль:  node tools/devpass.js \"новый пароль\"");
    process.exit(1);
}
const file = new URL("../dev.config.json", import.meta.url);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.sha256 = crypto.createHash("sha256").update(pass, "utf8").digest("hex");
cfg._password = "хеш обновлён " + new Date().toISOString().slice(0, 10) + "; сам пароль нигде не хранится";
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log("🔑 пароль обновлён, хеш записан в dev.config.json");
