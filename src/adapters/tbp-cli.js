import { createInterface } from "node:readline";
import { TBPAdapter } from "./tbp.js";
import { JevAdapter } from "./providers.js";
const bot = new TBPAdapter(new JevAdapter());
console.log(JSON.stringify(bot.info()));
for await (const line of createInterface({ input: process.stdin })) {
  if (line.length > 100000) break;
  try {
    const message = JSON.parse(line);
    const response = await bot.message(message);
    if (response) console.log(JSON.stringify(response));
    if (message.type === "quit") break;
  } catch {
    console.error("Invalid TBP message");
  }
}
bot.close();
