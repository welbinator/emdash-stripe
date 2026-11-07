import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import type { BlockResponse } from "@emdash-cms/blocks";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Block Kit interaction schema
// EmDash sends one of these shapes to the `admin` route on every user action.
// ---------------------------------------------------------------------------
const interactionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("page_load"),
    page: z.string(),
  }),
  z.object({
    type: z.literal("form_submit"),
    action_id: z.string(),
    block_id: z.string().optional(),
    // values keys match the action_id of each form field
    values: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("block_action"),
    action_id: z.string(),
    block_id: z.string().optional(),
    value: z.unknown().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Public route input schemas
// ---------------------------------------------------------------------------
const checkoutInput = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(100).default(1),
});

// ---------------------------------------------------------------------------
// Settings page — renders the Block Kit form with current saved values.
// ---------------------------------------------------------------------------
async function renderSettings(ctx: PluginContext): Promise<BlockResponse> {
  const hasSecretKey = (await ctx.settings.get<string>("stripeSecretKey")) !== null;
  const hasWebhookSecret = (await ctx.settings.get<string>("stripeWebhookSecret")) !== null;
  const productCollection = (await ctx.settings.get<string>("productCollection")) ?? "products";
  const priceField = (await ctx.settings.get<string>("priceField")) ?? "price";
  const currencyCode = (await ctx.settings.get<string>("currencyCode")) ?? "usd";
  const successUrl = (await ctx.settings.get<string>("successUrl")) ?? "";
  const cancelUrl = (await ctx.settings.get<string>("cancelUrl")) ?? "";

  const configured = hasSecretKey && successUrl && cancelUrl;
  const webhookUrl = ctx.url("/webhook");

  const seedSnippet = JSON.stringify(
    {
      collections: [
        {
          slug: "products",
          label: "Products",
          label_singular: "Product",
          supports: ["drafts", "revisions", "preview", "search", "seo"],
          fields: [
            { slug: "title", label: "Title", type: "string", required: true },
            { slug: "description", label: "Description", type: "text" },
            { slug: "price", label: "Price (in cents)", type: "integer", required: true, indexed: true },
            { slug: "image", label: "Product Image", type: "image" },
            { slug: "active", label: "Available for purchase", type: "boolean", defaultValue: true },
          ],
        },
      ],
    },
    null,
    2,
  );

  const buttonSnippet =
    "<button onclick=\"startCheckout('{product.id}')\">Buy Now</button>\n\n" +
    "<script>\n" +
    "async function startCheckout(productId) {\n" +
    "  const res = await fetch('/_emdash/api/plugins/emdash-stripe/checkout', {\n" +
    "    method: 'POST',\n" +
    "    headers: { 'Content-Type': 'application/json' },\n" +
    "    body: JSON.stringify({ productId })\n" +
    "  });\n" +
    "  const json = await res.json();\n" +
    "  if (json.success && json.data.ok) {\n" +
    "    window.location.href = json.data.checkoutUrl;\n" +
    "  } else {\n" +
    "    alert('Checkout unavailable. Please try again.');\n" +
    "  }\n" +
    "}\n" +
    "</script>";

  return {
    blocks: [
      { type: "header", text: "Stripe Settings" },
      {
        type: "section",
        text: configured
          ? "✅ Plugin configured. Checkout is active."
          : "⚠️ Complete the form below to activate checkout.",
      },
      { type: "divider" },
      {
        type: "form",
        block_id: "settings",
        fields: [
          {
            type: "secret_input",
            action_id: "stripeSecretKey",
            label: "Stripe Secret Key",
            placeholder: hasSecretKey
              ? "••••••••• (saved — leave blank to keep)"
              : "sk_live_...",
          },
          {
            type: "secret_input",
            action_id: "stripeWebhookSecret",
            label: "Stripe Webhook Signing Secret",
            placeholder: hasWebhookSecret
              ? "••••••••• (saved — leave blank to keep)"
              : "whsec_...",
          },
          {
            type: "text_input",
            action_id: "productCollection",
            label: "Product Collection Slug",
            initial_value: productCollection,
            placeholder: "products",
          },
          {
            type: "text_input",
            action_id: "priceField",
            label: "Price Field Name (integer field, value in cents)",
            initial_value: priceField,
            placeholder: "price",
          },
          {
            type: "text_input",
            action_id: "currencyCode",
            label: "Currency Code",
            initial_value: currencyCode,
            placeholder: "usd",
          },
          {
            type: "text_input",
            action_id: "successUrl",
            label: "Order Success Page URL",
            initial_value: successUrl,
            placeholder: "https://yoursite.com/order-success",
          },
          {
            type: "text_input",
            action_id: "cancelUrl",
            label: "Cancel / Back URL",
            initial_value: cancelUrl,
            placeholder: "https://yoursite.com/products",
          },
        ],
        submit: { label: "Save Settings", action_id: "save_settings" },
      },
      { type: "divider" },
      { type: "header", text: "Webhook Setup" },
      {
        type: "section",
        text:
          "In your Stripe Dashboard → Developers → Webhooks → Add endpoint:\n\n" +
          "**Endpoint URL:** `" + webhookUrl + "`\n\n" +
          "**Events:** `checkout.session.completed` · `payment_intent.payment_failed`\n\n" +
          "Copy the **Signing Secret** and paste it in the field above.",
      },
      { type: "divider" },
      { type: "header", text: "Product Collection Setup" },
      {
        type: "section",
        text:
          "If you don't have a products collection yet, add this to your site's " +
          "`seed.json` and re-seed:\n\n```json\n" +
          seedSnippet +
          "\n```",
      },
      { type: "divider" },
      { type: "header", text: "Checkout Button Snippet" },
      {
        type: "section",
        text:
          "Drop this into your product page template. " +
          "Replace `{product.id}` with your entry's actual ID:\n\n```html\n" +
          buttonSnippet +
          "\n```\n\nOn your success page, fetch order details with:\n" +
          "`GET /_emdash/api/plugins/emdash-stripe/order-status?session_id={CHECKOUT_SESSION_ID}`",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Orders page — paginated, filterable table of plugin-owned order records.
// ---------------------------------------------------------------------------
async function renderOrders(
  ctx: PluginContext,
  cursor?: string,
  statusFilter?: string,
): Promise<BlockResponse> {
  const result = await ctx.storage.orders.query({
    where:
      statusFilter && statusFilter !== "all" ? { status: statusFilter } : undefined,
    orderBy: { createdAt: "desc" },
    limit: 25,
    cursor,
  });

  const rows = result.items.map((item) => {
    const d = item.data as Record<string, unknown>;
    const cents = typeof d.totalAmount === "number" ? d.totalAmount : 0;
    const currency =
      typeof d.currency === "string" ? d.currency.toUpperCase() : "USD";
    return {
      id: item.id,
      date:
        typeof d.createdAt === "string"
          ? new Date(d.createdAt).toLocaleDateString()
          : "—",
      customer: typeof d.customerEmail === "string" ? d.customerEmail : "—",
      product: typeof d.productName === "string" ? d.productName : "—",
      amount: cents ? (cents / 100).toFixed(2) + " " + currency : "—",
      status: typeof d.status === "string" ? d.status : "unknown",
    };
  });

  return {
    blocks: [
      { type: "header", text: "Orders" },
      {
        type: "actions",
        elements: [
          { type: "button", label: "All", action_id: "filter_orders", value: "all" },
          { type: "button", label: "Paid", action_id: "filter_orders", value: "paid" },
          { type: "button", label: "Pending", action_id: "filter_orders", value: "pending" },
          { type: "button", label: "Failed", action_id: "filter_orders", value: "failed" },
        ],
      },
      rows.length === 0
        ? { type: "section", text: "No orders yet." }
        : {
            type: "table",
            columns: [
              { key: "date", header: "Date" },
              { key: "customer", header: "Customer" },
              { key: "product", header: "Product" },
              { key: "amount", header: "Amount" },
              { key: "status", header: "Status" },
            ],
            rows,
          },
      ...(result.cursor
        ? [
            {
              type: "actions" as const,
              elements: [
                {
                  type: "button" as const,
                  label: "Load more",
                  action_id: "load_more_orders",
                  value: result.cursor,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const plugin: SandboxedPlugin = {
  // -------------------------------------------------------------------------
  // plugin:install — set sensible defaults. Idempotent.
  // -------------------------------------------------------------------------
  hooks: {
    "plugin:install": async (_event, ctx) => {
      if ((await ctx.settings.get<string>("productCollection")) === null) {
        await ctx.settings.set("productCollection", "products");
      }
      if ((await ctx.settings.get<string>("priceField")) === null) {
        await ctx.settings.set("priceField", "price");
      }
      if ((await ctx.settings.get<string>("currencyCode")) === null) {
        await ctx.settings.set("currencyCode", "usd");
      }
      ctx.log.info("emdash-stripe installed");
    },
  },

  routes: {
    // -----------------------------------------------------------------------
    // Block Kit admin route — handles all admin interactions for both pages.
    // -----------------------------------------------------------------------
    admin: {
      handler: async (routeCtx, ctx) => {
        const parsed = interactionSchema.safeParse(routeCtx.input);
        if (!parsed.success) {
          ctx.log.warn("admin: invalid interaction", { errors: parsed.error.issues });
          return { blocks: [] };
        }
        const interaction = parsed.data;

        if (interaction.type === "page_load") {
          if (interaction.page === "/orders") return renderOrders(ctx);
          return renderSettings(ctx);
        }

        if (interaction.type === "block_action") {
          if (interaction.action_id === "filter_orders") {
            const status =
              typeof interaction.value === "string" ? interaction.value : "all";
            return renderOrders(ctx, undefined, status);
          }
          if (interaction.action_id === "load_more_orders") {
            const cursor =
              typeof interaction.value === "string" ? interaction.value : undefined;
            return renderOrders(ctx, cursor);
          }
        }

        if (
          interaction.type === "form_submit" &&
          interaction.action_id === "save_settings"
        ) {
          const v = interaction.values as Record<string, unknown>;
          if (typeof v.stripeSecretKey === "string" && v.stripeSecretKey.trim()) {
            await ctx.settings.set("stripeSecretKey", v.stripeSecretKey.trim());
          }
          if (typeof v.stripeWebhookSecret === "string" && v.stripeWebhookSecret.trim()) {
            await ctx.settings.set("stripeWebhookSecret", v.stripeWebhookSecret.trim());
          }
          if (typeof v.productCollection === "string" && v.productCollection.trim()) {
            await ctx.settings.set("productCollection", v.productCollection.trim());
          }
          if (typeof v.priceField === "string" && v.priceField.trim()) {
            await ctx.settings.set("priceField", v.priceField.trim());
          }
          if (typeof v.currencyCode === "string" && v.currencyCode.trim()) {
            await ctx.settings.set("currencyCode", v.currencyCode.trim().toLowerCase());
          }
          if (typeof v.successUrl === "string" && v.successUrl.trim()) {
            await ctx.settings.set("successUrl", v.successUrl.trim());
          }
          if (typeof v.cancelUrl === "string" && v.cancelUrl.trim()) {
            await ctx.settings.set("cancelUrl", v.cancelUrl.trim());
          }
          return {
            ...(await renderSettings(ctx)),
            toast: { message: "Settings saved.", type: "success" },
          };
        }

        return { blocks: [] };
      },
    },

    // -----------------------------------------------------------------------
    // POST /_emdash/api/plugins/emdash-stripe/checkout  (public)
    //
    // Creates a Stripe Checkout Session. Product price is fetched from EmDash
    // server-side so it cannot be tampered with by the browser.
    // -----------------------------------------------------------------------
    checkout: {
      public: true,
      methods: ["POST"],
      handler: async (routeCtx, ctx) => {
        const parsed = checkoutInput.safeParse(routeCtx.input);
        if (!parsed.success) {
          return { ok: false, error: "INVALID_INPUT", details: parsed.error.issues };
        }
        const { productId, quantity } = parsed.data;

        const secretKey = await ctx.settings.get<string>("stripeSecretKey");
        if (!secretKey) return { ok: false, error: "STRIPE_NOT_CONFIGURED" };

        const productCollection =
          (await ctx.settings.get<string>("productCollection")) ?? "products";
        const priceField = (await ctx.settings.get<string>("priceField")) ?? "price";
        const currency = (await ctx.settings.get<string>("currencyCode")) ?? "usd";
        const successUrl = await ctx.settings.get<string>("successUrl");
        const cancelUrl = await ctx.settings.get<string>("cancelUrl");

        if (!successUrl || !cancelUrl) return { ok: false, error: "URLS_NOT_CONFIGURED" };

        if (!ctx.content) return { ok: false, error: "CONTENT_UNAVAILABLE" };

        const listResult = await ctx.content.list(productCollection, { limit: 100 });
        const product = listResult.items.find((item) => item.id === productId);
        if (!product) return { ok: false, error: "PRODUCT_NOT_FOUND" };

        const rawPrice = (product.data as Record<string, unknown>)[priceField];
        const priceInCents = Number(rawPrice);
        if (!Number.isInteger(priceInCents) || priceInCents <= 0) {
          return { ok: false, error: "INVALID_PRODUCT_PRICE" };
        }

        const productName = String(
          (product.data as Record<string, unknown>).title ??
          (product.data as Record<string, unknown>).name ??
          "Product",
        );

        if (!ctx.http) return { ok: false, error: "NETWORK_UNAVAILABLE" };

        const body = new URLSearchParams({
          mode: "payment",
          "line_items[0][quantity]": String(quantity),
          "line_items[0][price_data][currency]": currency,
          "line_items[0][price_data][unit_amount]": String(priceInCents),
          "line_items[0][price_data][product_data][name]": productName,
          "success_url": successUrl + "?session_id={CHECKOUT_SESSION_ID}",
          "cancel_url": cancelUrl,
          "metadata[productId]": productId,
          "metadata[productCollection]": productCollection,
        });

        const stripeRes = await ctx.http.fetch(
          "https://api.stripe.com/v1/checkout/sessions",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + secretKey,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
        );

        if (!stripeRes.ok) {
          ctx.log.error("Stripe session creation failed", { status: stripeRes.status });
          return { ok: false, error: "STRIPE_ERROR" };
        }

        const session = (await stripeRes.json()) as { id: string; url: string };

        const orderId = crypto.randomUUID();
        await ctx.storage.orders.put(orderId, {
          stripeSessionId: session.id,
          status: "pending",
          productId,
          productName,
          quantity,
          totalAmount: priceInCents * quantity,
          currency,
          customerEmail: null,
          stripePaymentIntentId: null,
          createdAt: new Date().toISOString(),
          paidAt: null,
        });

        ctx.log.info("Checkout session created", { orderId, sessionId: session.id });
        return { ok: true, checkoutUrl: session.url };
      },
    },

    // -----------------------------------------------------------------------
    // POST /_emdash/api/plugins/emdash-stripe/webhook  (public)
    //
    // Receives Stripe events. Applies a lightweight timestamp replay-guard.
    // TODO: upgrade to full HMAC-SHA256 body verification once EmDash exposes
    // a raw/text body mode in the sandbox (currently only parsed JSON input).
    // -----------------------------------------------------------------------
    webhook: {
      public: true,
      methods: ["POST"],
      handler: async (routeCtx, ctx) => {
        const webhookSecret = await ctx.settings.get<string>("stripeWebhookSecret");
        const sigHeader = routeCtx.request.headers["stripe-signature"] ?? "";

        if (sigHeader) {
          const parts = Object.fromEntries(
            sigHeader.split(",").flatMap((part: string) => {
              const eqIdx = part.indexOf("=");
              if (eqIdx === -1) return [];
              return [[part.slice(0, eqIdx), part.slice(eqIdx + 1)]];
            }),
          );
          const timestamp = parseInt(parts["t"] ?? "0", 10);
          const ageSeconds = Math.floor(Date.now() / 1000) - timestamp;
          if (ageSeconds > 300 || ageSeconds < -60) {
            ctx.log.warn("Webhook: timestamp outside tolerance", { ageSeconds });
            return { received: false, error: "TIMESTAMP_OUTSIDE_TOLERANCE" };
          }
        } else if (webhookSecret) {
          ctx.log.warn("Webhook: missing stripe-signature header");
          return { received: false, error: "MISSING_SIGNATURE" };
        }

        const event = routeCtx.input as {
          type?: string;
          data?: { object?: Record<string, unknown> };
        };

        if (!event.type) {
          ctx.log.warn("Webhook: missing event type");
          return { received: false, error: "INVALID_EVENT" };
        }

        ctx.log.info("Stripe webhook received", { type: event.type });

        if (event.type === "checkout.session.completed") {
          const session = event.data?.object ?? {};
          const sessionId = session["id"];
          if (typeof sessionId !== "string") return { received: true };

          const result = await ctx.storage.orders.query({
            where: { stripeSessionId: sessionId },
            limit: 1,
          });

          if (result.items.length > 0) {
            const order = result.items[0];
            const existing = order.data as Record<string, unknown>;
            const customerDetails = session["customer_details"] as
              | Record<string, unknown>
              | undefined;
            const customerEmail =
              typeof customerDetails?.["email"] === "string"
                ? customerDetails["email"]
                : null;

            await ctx.storage.orders.put(order.id, {
              ...existing,
              status: "paid",
              customerEmail,
              stripePaymentIntentId:
                typeof session["payment_intent"] === "string"
                  ? session["payment_intent"]
                  : null,
              paidAt: new Date().toISOString(),
            });

            ctx.log.info("Order marked paid", { orderId: order.id, sessionId });

            if (ctx.email && customerEmail) {
              const amount = ((existing.totalAmount as number) / 100).toFixed(2);
              const curr = String(existing.currency ?? "usd").toUpperCase();
              await ctx.email.send({
                to: customerEmail,
                subject: "Your order is confirmed!",
                text:
                  "Thank you for your purchase of \"" + String(existing.productName) + "\".\n\n" +
                  "Order ID: " + order.id + "\n" +
                  "Amount: " + amount + " " + curr + "\n\n" +
                  "A separate receipt from Stripe is on its way.",
              });
            }
          } else {
            ctx.log.warn("Webhook: no order found for session", { sessionId });
          }
        }

        if (event.type === "payment_intent.payment_failed") {
          const pi = event.data?.object ?? {};
          ctx.log.warn("Payment failed", {
            paymentIntentId: pi["id"],
            failureMessage: pi["last_payment_error"],
          });
        }

        return { received: true };
      },
    },

    // -----------------------------------------------------------------------
    // GET /_emdash/api/plugins/emdash-stripe/order-status?session_id=...  (public)
    //
    // Called by the success page to display order confirmation.
    // customerEmail is intentionally omitted — PII stays server-side.
    // -----------------------------------------------------------------------
    "order-status": {
      public: true,
      methods: ["GET"],
      handler: async (routeCtx, ctx) => {
        const url = new URL(routeCtx.request.url);
        const sessionId = url.searchParams.get("session_id");
        if (!sessionId) return { ok: false, error: "MISSING_SESSION_ID" };

        const result = await ctx.storage.orders.query({
          where: { stripeSessionId: sessionId },
          limit: 1,
        });

        if (result.items.length === 0) return { ok: false, error: "ORDER_NOT_FOUND" };

        const order = result.items[0];
        const d = order.data as Record<string, unknown>;

        return {
          ok: true,
          order: {
            id: order.id,
            status: d.status,
            productName: d.productName,
            quantity: d.quantity,
            totalAmount: d.totalAmount,
            currency: d.currency,
            createdAt: d.createdAt,
            paidAt: d.paidAt ?? null,
          },
        };
      },
    },
  },
};

export default plugin;
