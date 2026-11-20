// A test DNS server for one installation, in the test process: the story
// publishes records (as an admin would at their DNS provider) and Ortus's
// checks read them. UDP and TCP on 127.0.0.1.
import dgram from "node:dgram";
import net from "node:net";
import packet from "dns-packet";

export interface Dns {
  address: string;
  /** Sets the records of one name and type (data in dns-packet's shapes). */
  publish(name: string, type: string, data: unknown[]): void;
  stop(): Promise<void>;
}

export async function startDns(): Promise<Dns> {
  const zone = new Map<string, unknown[]>();
  const answer = (query: packet.Packet): Buffer => {
    const question = query.questions![0]!;
    const key = `${question.name.toLowerCase().replace(/\.$/, "")} ${question.type}`;
    const answers = (zone.get(key) ?? []).map((data) => ({ name: question.name, type: question.type, ttl: 60, data }) as packet.Answer);
    return packet.encode({ id: query.id, type: "response", flags: packet.AUTHORITATIVE_ANSWER | (answers.length ? 0 : 3), questions: query.questions, answers });
  };
  const udp = dgram.createSocket("udp4");
  udp.on("message", (message, from) => {
    try {
      udp.send(answer(packet.decode(message)), from.port, from.address);
    } catch {
      // a broken query gets no answer
    }
  });
  await new Promise<void>((done) => udp.bind(0, "127.0.0.1", done));
  const port = udp.address().port;
  const tcp = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16BE(0)) {
        const length = buffer.readUInt16BE(0);
        const reply = answer(packet.decode(buffer.subarray(2, 2 + length)));
        buffer = buffer.subarray(2 + length);
        const size = Buffer.alloc(2);
        size.writeUInt16BE(reply.length);
        socket.write(Buffer.concat([size, reply]));
      }
    });
  });
  await new Promise<void>((done) => tcp.listen(port, "127.0.0.1", done));
  return {
    address: `127.0.0.1:${port}`,
    publish(name, type, data) {
      zone.set(`${name.toLowerCase().replace(/\.$/, "")} ${type}`, data);
    },
    async stop() {
      udp.close();
      await new Promise((done) => tcp.close(done));
    },
  };
}
