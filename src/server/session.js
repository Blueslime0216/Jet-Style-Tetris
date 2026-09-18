import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class Sessions {
  constructor(secret = randomBytes(32).toString("hex")) {
    this.secret = secret;
    this.rows = new Map();
  }
  sign(text) {
    return createHmac("sha256", this.secret).update(text).digest("hex");
  }
  issue(now = Date.now()) {
    const id = randomBytes(24).toString("hex"),
      expires = now + 30 * 60_000;
    const payload = `${id}.${expires}`;
    const row = {
      id,
      expires,
      csrf: this.sign(`csrf:${id}`),
      token: `${payload}.${this.sign(payload)}`,
    };
    this.rows.set(id, row);
    return row;
  }
  read(token, now = Date.now()) {
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{48}\.\d{13}\.[a-f0-9]{64}$/.test(token)
    )
      return null;
    const [id, expiry, signature] = token.split("."),
      expires = Number(expiry);
    if (
      expires <= now ||
      expires > now + 30 * 60_000 ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(this.sign(`${id}.${expiry}`)),
      )
    )
      return null;
    if (!this.rows.has(id))
      this.rows.set(id, { id, expires, csrf: this.sign(`csrf:${id}`), token });
    return this.rows.get(id);
  }
}
