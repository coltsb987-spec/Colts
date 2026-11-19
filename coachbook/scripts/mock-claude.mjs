// A scripted stand-in for the Claude Messages API, for testing the receptionist's
// plumbing (tools, database, Stripe, limits) without a real API key. It is NOT a model:
// it picks tools from keywords in the visitor's message. Real conversations are tested
// against the real API on a deployment.
//   node scripts/mock-claude.mjs [port] [requests-log.jsonl]
import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const PORT = Number(process.argv[2] ?? 4010);
const LOG = process.argv[3];
if (LOG) writeFileSync(LOG, "");
let n = 0;
// Message threads: the SDK tool runner sends only new messages after the first request.
const threads = new Map(); // response id -> full conversation including that response

const plans = {
  times: ["get_services", "check_availability"],
  book_free: ["get_services", "check_availability", "create_booking"],
  book: ["get_services", "check_availability", "create_booking"],
  coach: ["hand_off_to_coach"],
  cancel: ["list_my_bookings", "cancel_booking"],
  faq: ["answer_faq"],
};
const intent = (t) => {
  t = t.toLowerCase();
  if (t.includes("cancel")) return "cancel";
  if (t.includes("free taster")) return "book_free";
  if (t.includes("book")) return "book";
  if (t.includes("coach")) return "coach";
  if (t.includes("time") || t.includes("free")) return "times";
  return "faq";
};

// "Fill my profile for me": link reading and drafting requests.
function respondSetup(body) {
  if ((body.tools ?? []).some((t) => t.type?.startsWith("web_fetch"))) {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Notes: Saturday mornings 09:00-12:00 at Moss Bank 3G. Kit: boots, shin pads, water." }] };
  }
  const text = typeof body.messages[0].content === "string" ? body.messages[0].content : body.messages[0].content.map((c) => c.text).join("");
  const answered = /A: .*£?30/.test(text);
  const draft = {
    business_name: "Sam Bolton Football", bio: "I'm Sam, a UEFA C coach in Bolton. I run 1-to-1 sessions for players aged 7-14.",
    qualifications: "UEFA C Licence", postcode: "BL1 4AA", dbs_mentioned: true,
    services: [{ name: "1-to-1 session", type: "one_to_one", duration_minutes: 60, price_pounds: answered ? 30 : null, max_participants: null, location: "Moss Bank 3G", description: null }],
    weekly_hours: [{ weekday: 6, start: "09:00", end: "12:00", location: "Moss Bank 3G" }],
    faqs: [{ q: "What should my child bring?", a: "Boots, shin pads and water." }],
    questions: answered ? [] : [{ id: "price", question: "How much is a 1-to-1 session?" }],
    notes: text.includes("web pages") ? ["Read your website."] : [],
  };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(draft) }] };
}

function respond(body) {
  const sys = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text).join("");
  if (sys.includes("set up their CoachBook booking page") || (body.tools ?? []).some((t) => t.type?.startsWith("web_fetch"))) return respondSetup(body);
  const msgs = body.messages;
  // last plain-text visitor message = start of this turn
  const textOf = (m) => (typeof m.content === "string" ? m.content : m.content.filter((c) => c.type === "text").map((c) => c.text).join(" "));
  const isVisitor = (m) => m.role === "user" && (typeof m.content === "string" || !m.content.some((c) => c.type === "tool_result"));
  let i = msgs.length - 1;
  while (i >= 0 && !isVisitor(msgs[i])) i--;
  const visitor = textOf(msgs[i]);
  const results = msgs.slice(i + 1).filter((m) => m.role === "user").flatMap((m) => m.content).filter((c) => c.type === "tool_result");
  const parsed = results.map((r) => { try { return JSON.parse(typeof r.content === "string" ? r.content : r.content[0].text); } catch { return {}; } });
  const kind = intent(visitor);
  const plan = plans[kind];
  const step = results.length;
  const id = () => `toolu_mock_${++n}`;
  const tool = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "text", text: "" }, { type: "tool_use", id: id(), name, input }] });

  if (step < plan.length) {
    const name = plan[step];
    const services = parsed[0]?.services ?? [];
    const svc = kind === "book_free" ? services.find((s) => s.price === "Free") : services.find((s) => s.price !== "Free") ?? services[0];
    if (name === "get_services" || name === "list_my_bookings") return tool(name, {});
    if (name === "check_availability") return tool(name, { service_id: svc.service_id, days: 7 });
    if (name === "create_booking") {
      const first = parsed[1].days[0].times[0].start;
      return tool(name, { service_id: svc.service_id, start: first, new_player: { first_name: "Mia", age_group: "U11" }, parent_consent: true });
    }
    if (name === "cancel_booking") { const bs = parsed[0].bookings; return tool(name, { booking_id: (bs.find((b) => /taster/i.test(b.session)) ?? bs[0]).booking_id }); }
    if (name === "hand_off_to_coach") return tool(name, { reason: "Asked to speak to the coach about a team trial", contact_name: "Sam Visitor", contact_email: "sam.visitor@example.com" });
    if (name === "answer_faq") return tool(name, { question: visitor });
  }
  // final answer built from tool results
  const last = parsed[parsed.length - 1] ?? {};
  let text = "OK.";
  if (kind === "times") text = `Free times: ${last.days?.[0]?.date}: ${last.days?.[0]?.times.slice(0, 3).map((t) => t.time).join(", ")}.`;
  if (kind === "book" || kind === "book_free")
    text = last.payment_link ? `Booked for ${last.when}. Pay here to confirm: ${last.payment_link}` : last.booking_link ? `Please sign in to book: ${last.booking_link}` : last.status === "confirmed" ? `You're booked for ${last.when}.` : `Sorry: ${last.message ?? last.error}`;
  if (kind === "coach") text = "I've passed this to the coach – they'll reply here or by email.";
  if (kind === "cancel") text = last.status === "cancelled" ? "Done – that booking is cancelled." : `Sorry: ${last.message ?? last.error}`;
  if (kind === "faq") text = last.faqs?.[0]?.a ?? "I'm not sure – shall I ask the coach?";
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw);
      if (body.thread?.type === "continue") {
        const prev = threads.get(body.thread.previous_message_id);
        if (!prev) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "thread not found", details: { error_code: "thread_not_found" } } }));
          return;
        }
        body.messages = [...prev, ...body.messages];
        body.system = body.system ?? threads.get(`${body.thread.previous_message_id}:system`);
        body.tools = body.tools ?? threads.get(`${body.thread.previous_message_id}:tools`);
      }
      if (LOG) appendFileSync(LOG, JSON.stringify({ headers: { "anthropic-beta": req.headers["anthropic-beta"] }, body: { ...body, messages: body.messages.length } }) + "\n");
      let out;
      try {
        out = respond(body);
      } catch (e) {
        console.error("mock could not handle request:", JSON.stringify(body.messages).slice(0, 2000));
        throw e;
      }
      const msgId = `msg_mock_${++n}`;
      if (body.thread) {
        threads.set(msgId, [...body.messages, { role: "assistant", content: out.content }]);
        threads.set(`${msgId}:system`, body.system);
        threads.set(`${msgId}:tools`, body.tools);
      }
      res.writeHead(200, { "content-type": "application/json", "request-id": `req_mock_${n}` });
      res.end(JSON.stringify({
        id: msgId, type: "message", role: "assistant", model: body.model, stop_reason: out.stop_reason, stop_sequence: null,
        content: out.content, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Claude on :${PORT}`));
