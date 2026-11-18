import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { cancelBooking, confirmBooking, getBookingDetails } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSubscription } from "@/lib/subscriptions";
import { stripe } from "@/lib/stripe";

// Stripe sends events here. Two endpoints can point at this URL:
//  - "Your account" events (subscriptions)            -> STRIPE_WEBHOOK_SECRET
//  - "Connected accounts" events (parent payments)    -> STRIPE_CONNECT_WEBHOOK_SECRET
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean) as string[];
  if (!signature || secrets.length === 0) return NextResponse.json({ error: "not configured" }, { status: 400 });

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = await stripe().webhooks.constructEventAsync(body, signature, secret);
      break;
    } catch {
      // try the next secret
    }
  }
  if (!event) return NextResponse.json({ error: "bad signature" }, { status: 400 });

  // Each event is handled once, even if Stripe sends it again.
  const admin = createAdminClient();
  const { error: dupe } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    throw dupe;
  }

  try {
    await handle(event);
  } catch (e) {
    console.error("webhook handling failed", event.type, e);
    await admin.from("stripe_events").delete().eq("id", event.id); // let Stripe retry
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.mode === "payment" && session.metadata?.booking_id && session.payment_status === "paid") {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
        await confirmBooking(session.metadata.booking_id, pi, true);
      }
      if (session.mode === "subscription" && session.subscription) {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await syncSubscription(await stripe().subscriptions.retrieve(id));
      }
      break;
    }
    case "checkout.session.expired": {
      const id = event.data.object.metadata?.booking_id;
      if (id) {
        const b = await getBookingDetails(id);
        if (b?.status === "pending") await cancelBooking(id, "system");
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    case "charge.refunded": {
      // Refunds made in the coach's own Stripe dashboard.
      const pi = event.data.object.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId && event.data.object.refunded) {
        await createAdminClient().from("bookings").update({ payment_status: "refunded" }).eq("stripe_payment_intent_id", piId);
      }
      break;
    }
  }
}
