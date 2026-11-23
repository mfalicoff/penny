// A plain SMTP sink for a full-stack test environment (MAZ-124, `penny-env --smtp`): the API's
// mail worker sends password reset and invitation emails to it on loopback
// (`Email__Smtp__Security=none`, which the API only allows for a loopback host), so the outbox,
// retries and invitation statuses run for real. Every message is accepted and kept in memory
// for the run; nothing leaves the machine. Node built-ins only.
import { createServer } from "node:net";

/**
 * Starts the sink on a free loopback port. `messages` holds each accepted message as
 * `{ from, to, data }`; `close()` stops it.
 * @returns {Promise<{ port: number, messages: { from: string, to: string[], data: string }[], close: () => Promise<void> }>}
 */
export async function startSmtpSink({ host = "127.0.0.1", hostname = "penny-smtp.test" } = {}) {
  const messages = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setEncoding("utf8");
    let buffer = "";
    let reading = false;
    let envelope = { from: "", to: [], data: "" };
    const reply = (line) => socket.write(`${line}\r\n`);
    reply(`220 ${hostname} ESMTP Penny test sink`);
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (reading) {
          if (line === ".") {
            reading = false;
            messages.push(envelope);
            envelope = { from: "", to: [], data: "" };
            reply("250 2.0.0 Accepted");
          } else {
            envelope.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") reply(`250-${hostname}\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250 SIZE 10485760`);
        else if (verb === "HELO") reply(`250 ${hostname}`);
        else if (verb === "MAIL") {
          envelope = { from: line.slice(10).trim(), to: [], data: "" };
          reply("250 2.1.0 OK");
        } else if (verb === "RCPT") {
          envelope.to.push(line.slice(8).trim());
          reply("250 2.1.5 OK");
        } else if (verb === "DATA") {
          reading = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "RSET") {
          envelope = { from: "", to: [], data: "" };
          reply("250 2.0.0 OK");
        } else if (verb === "NOOP") reply("250 2.0.0 OK");
        else if (verb === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
        } else reply("502 5.5.1 Command not implemented");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    messages,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The API settings that send mail to the sink, with links to the run's first web origin. */
export function apiSmtpEnvironment(smtp, origins) {
  return {
    Email__Smtp__Host: "127.0.0.1",
    Email__Smtp__Port: String(smtp.port),
    Email__Smtp__Security: "none",
    Email__From: "penny@example.test",
    Email__AppUrl: origins[0],
    Email__PollSeconds: "1",
  };
}
