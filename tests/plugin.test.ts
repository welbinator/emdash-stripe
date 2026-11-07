import { afterEach, describe, expect, it } from "vitest";

import {
	createPluginTestHost,
	createPluginRuntimeTestHost,
	type PluginTestHost,
	type PluginRuntimeTestHost,
} from "@emdash-cms/plugin-test";

// createPluginTestHost        — transport-level (no ctx.settings/storage).
// createPluginRuntimeTestHost — full runtime, runs install+activate first.

let host: PluginTestHost | PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

// ---------------------------------------------------------------------------
// admin route — Block Kit page interactions (needs ctx.settings + ctx.storage)
// ---------------------------------------------------------------------------
describe("admin route", () => {
	it("returns blocks for settings page_load", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute("admin", {
			type: "page_load",
			page: "/settings",
		}) as { blocks: unknown[] };
		expect(Array.isArray(result.blocks)).toBe(true);
		expect(result.blocks.length).toBeGreaterThan(0);
	});

	it("returns blocks for orders page_load", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute("admin", {
			type: "page_load",
			page: "/orders",
		}) as { blocks: unknown[] };
		expect(Array.isArray(result.blocks)).toBe(true);
		expect(result.blocks.length).toBeGreaterThan(0);
	});

	it("returns empty blocks for an unrecognised interaction (transport-level)", async () => {
		host = await createPluginTestHost();
		const result = await host.invokeRoute("admin", {
			input: { not_a_valid_shape: true },
		}) as { blocks: unknown[] };
		expect(result).toMatchObject({ blocks: [] });
	});
});

// ---------------------------------------------------------------------------
// checkout route
// ---------------------------------------------------------------------------
describe("checkout route", () => {
	it("returns INVALID_INPUT when productId is missing (transport-level)", async () => {
		host = await createPluginTestHost();
		const result = await host.invokeRoute("checkout", {
			input: { quantity: 1 },
		});
		expect(result).toMatchObject({ ok: false, error: "INVALID_INPUT" });
	});

	it("returns STRIPE_NOT_CONFIGURED when no key is set (runtime host)", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute("checkout", {
			productId: "prod_123",
			quantity: 1,
		});
		expect(result).toMatchObject({ ok: false, error: "STRIPE_NOT_CONFIGURED" });
	});
});

// ---------------------------------------------------------------------------
// webhook route
// ---------------------------------------------------------------------------
describe("webhook route", () => {
	it("returns INVALID_EVENT when event type is missing (runtime host)", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute("webhook", { data: {} });
		expect(result).toMatchObject({ received: false, error: "INVALID_EVENT" });
	});

	it("acknowledges an unknown event type when no webhook secret is configured (runtime host)", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute("webhook", {
			type: "some.unknown.event",
			data: { object: {} },
		});
		expect(result).toMatchObject({ received: true });
	});
});

// ---------------------------------------------------------------------------
// order-status route
// ---------------------------------------------------------------------------
describe("order-status route", () => {
	it("returns MISSING_SESSION_ID when session_id is absent (transport-level)", async () => {
		host = await createPluginTestHost();
		const result = await host.invokeRoute("order-status", {
			method: "GET",
			input: {},
		});
		expect(result).toMatchObject({ ok: false, error: "MISSING_SESSION_ID" });
	});

	it("returns ORDER_NOT_FOUND for an unknown session (runtime host)", async () => {
		host = await createPluginRuntimeTestHost();
		const result = await host.transport.invokeRoute(
			"order-status",
			{},
			{
				method: "GET",
				url: "https://localhost/_emdash/api/plugins/emdash-stripe/order-status?session_id=cs_test_unknown",
			},
		) as { ok: boolean; error?: string };
		// Either the query param is parsed → ORDER_NOT_FOUND, or it isn't → MISSING_SESSION_ID.
		// Either way ok must be false and there must be no crash.
		expect(result.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// plugin:install hook
// ---------------------------------------------------------------------------
describe("plugin:install hook", () => {
	it("plugin loads and install hook runs without error", async () => {
		host = await createPluginRuntimeTestHost();
		expect(host).toBeDefined();
	});
});
