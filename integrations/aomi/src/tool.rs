//! The five tools ACR exposes to an Aomi agent.
//!
//! Each one validates its arguments locally, calls one press route through
//! `client.rs`, and hands the response to a pure `shape_*` function that returns
//! stable JSON — never the raw upstream body (Aomi's own guidance, and the reason
//! the shaping is testable against recorded responses without a network).
//!
//! The routes and the honesty rules are the ones the ACR MCP plugin already
//! ships (`mcp/src/tools.ts`): a rate says how old it is, a bill says what it was
//! compared against, and a wallet ACR has never seen is "not seen", never "zero".

use std::time::{SystemTime, UNIX_EPOCH};

use aomi_sdk::{DynAomiTool, DynToolCallCtx};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AcrApp;
use crate::client::{base_url, get_json};

/// A print older than this is due for its next one (pinned to the press's
/// `ops.py`, like the MCP plugin's `printAge.ts`).
pub const PRINT_WARN_AGE_S: f64 = 5_400.0;
/// Past this the futures venue cannot settle against the print: it is the last
/// known value, not a current reading.
pub const PRINT_MAX_AGE_S: f64 = 7_200.0;

fn now_s() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// "4 min ago", "2.1 hr ago", "3.5 days ago".
pub fn age_words(age_s: f64) -> String {
    if !age_s.is_finite() || age_s < 0.0 {
        return "of unknown age".into();
    }
    if age_s < 60.0 {
        "under a minute ago".into()
    } else if age_s < 3_600.0 {
        format!("{} min ago", (age_s / 60.0).round())
    } else if age_s < 48.0 * 3_600.0 {
        format!("{:.1} hr ago", age_s / 3_600.0)
    } else {
        format!("{:.1} days ago", age_s / 86_400.0)
    }
}

fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// A 0x-prefixed 20-byte address.
pub fn is_address(a: &str) -> bool {
    a.len() == 42 && a.starts_with("0x") && a[2..].chars().all(|c| c.is_ascii_hexdigit())
}

fn window(days: Option<u32>) -> Result<u32, String> {
    match days.unwrap_or(30) {
        d @ 1..=90 => Ok(d),
        d => Err(format!("days must be between 1 and 90, got {d}")),
    }
}

// ─────────────────────────────────────────────────────────────── shared enums

/// One of ACR's three indices.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, JsonSchema)]
pub enum Index {
    #[serde(rename = "ACR-INF")]
    Inf,
    #[serde(rename = "ACR-GPU")]
    Gpu,
    #[serde(rename = "ACR-DATA")]
    Data,
}

impl Index {
    pub fn id(self) -> &'static str {
        match self {
            Index::Inf => "ACR-INF",
            Index::Gpu => "ACR-GPU",
            Index::Data => "ACR-DATA",
        }
    }
    /// The unit each index is quoted in — read off the press's own `/par`
    /// basket mapping, not assumed.
    pub fn unit(self) -> &'static str {
        match self {
            Index::Inf => "$/1k tokens",
            Index::Gpu => "$/GPU-sec",
            Index::Data => "$/MB",
        }
    }
    pub fn measures(self) -> &'static str {
        match self {
            Index::Inf => "AI inference",
            Index::Gpu => "GPU compute",
            Index::Data => "data delivery",
        }
    }
}

/// The three units a bill can be priced in — the press answers 422 to anything else.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, JsonSchema)]
pub enum Unit {
    #[serde(rename = "$/1k tokens")]
    Tokens1k,
    #[serde(rename = "$/GPU-sec")]
    GpuSec,
    #[serde(rename = "$/MB")]
    Mb,
}

impl Unit {
    pub fn as_str(self) -> &'static str {
        match self {
            Unit::Tokens1k => "$/1k tokens",
            Unit::GpuSec => "$/GPU-sec",
            Unit::Mb => "$/MB",
        }
    }
}

// ─────────────────────────────────────────────────────────────── acr_rate

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RateArgs {
    /// Which index: "ACR-INF" (AI inference, priced per 1k tokens), "ACR-GPU"
    /// (GPU compute, per GPU-second) or "ACR-DATA" (data delivery, per MB).
    pub index: Index,
}

pub struct RateTool;

impl DynAomiTool for RateTool {
    type App = AcrApp;
    type Args = RateArgs;

    const NAME: &'static str = "acr_rate";
    const DESCRIPTION: &'static str = "ACR's latest on-chain index print for machine compute: ACR-INF \
        (inference, per 1k tokens), ACR-GPU (GPU time, per second) or ACR-DATA (data, per MB). Returns the index \
        value, its confidence interval, what it would cost in USDC to move it by one basis point, and how old the \
        print is. These are index levels on ACR's own nominal scale, NOT market prices: ACR-INF sits about 1,250x \
        above public inference prices, so never quote them as what compute costs. Use for the index itself, its \
        freshness, or its manipulation cost; to judge a real price against the market, use acr_check_bill.";

    fn run(_app: &Self::App, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let base = base_url(&ctx)?;
        let raw = get_json(&base, &format!("/onchain/{}", args.index.id()), &[])?;
        shape_rate(args.index, &raw, now_s())
    }
}

pub fn shape_rate(index: Index, raw: &Value, now: f64) -> Result<Value, String> {
    let value = num(raw, "value").ok_or("ACR returned no value for that index; stop rather than retry")?;
    let posted = num(raw, "posted_at");
    let age = posted.map(|p| (now - p).max(0.0));
    let (current, note) = match age {
        None => (
            false,
            "this print carries no timestamp, so its age is unknown; present it as the last known value".to_string(),
        ),
        Some(a) if a > PRINT_MAX_AGE_S => (
            false,
            format!(
                "posted {}, past the 2-hour settle window: say it is the last known value, not a current reading",
                age_words(a)
            ),
        ),
        Some(a) if a > PRINT_WARN_AGE_S => (
            true,
            format!("posted {}: still inside the settle window, and due for its next hourly print", age_words(a)),
        ),
        Some(a) => (true, format!("posted {}", age_words(a))),
    };
    Ok(json!({
        "index": index.id(),
        "measures": index.measures(),
        "unit": index.unit(),
        "value": value,
        // THE SCALE TRAVELS WITH THE NUMBER. anchors/GAP.md (generated, 2026-10-06)
        // puts these reference levels 20x to 1,250x above public market prices; an
        // agent handed a bare 0.4977 "per 1k tokens" would quote it as a price.
        "scale": "ACR index level on its own nominal scale, not a market price; use acr_check_bill to compare a real \
                  price against the market",
        "confidence_interval": [num(raw, "ci_lo"), num(raw, "ci_hi")],
        "attack_cost_usdc_per_bp": num(raw, "attack_cost_per_bp"),
        "posted_at": posted,
        "age_s": age.map(f64::round),
        "current": current,
        "note": note,
        "oracle": text(raw, "oracle"),
    }))
}

// ─────────────────────────────────────────────────────────────── acr_check_bill

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CheckBillArgs {
    /// The amount on the invoice in USDC, as billed: the total, not a per-unit price.
    pub billed_usdc: f64,
    /// How much was bought, counted IN `unit`: 23 for 23,000 tokens at "$/1k tokens", not 23000.
    pub quantity: f64,
    /// What was bought: "$/1k tokens" (inference), "$/GPU-sec" (GPU time) or "$/MB" (data).
    pub unit: Unit,
    /// Optional 0x address of whoever billed you. Leave it out for a third-party provider
    /// (any AI API): the bill is then priced against the open market. A seller ACR operates
    /// is judged only against ACR's own fleet prices.
    #[serde(default)]
    pub vendor: Option<String>,
}

pub struct CheckBillTool;

impl DynAomiTool for CheckBillTool {
    type App = AcrApp;
    type Args = CheckBillArgs;

    const NAME: &'static str = "acr_check_bill";
    const DESCRIPTION: &'static str = "Should this bill be paid? Prices an invoice for AI inference, GPU time or data \
        against what the market publicly charges, and returns the verdict ACR's spend agent would reach (pay, \
        reroute, hold, escalate or refuse) with the rule behind it, how far over or under the going rate it is in \
        basis points, the cheapest published seller with a citation, and how much was avoidable. Use when the user \
        asks whether a bill, invoice or price for compute is fair. Nothing is paid or signed.";

    fn run(_app: &Self::App, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        if !(args.billed_usdc.is_finite() && args.billed_usdc > 0.0) {
            return Err("billed_usdc must be a positive number: the invoice total in USDC".into());
        }
        if !(args.quantity.is_finite() && args.quantity > 0.0) {
            return Err("quantity must be a positive number, counted in the chosen unit".into());
        }
        let vendor = args.vendor.as_deref().map(str::trim).filter(|v| !v.is_empty());
        if let Some(v) = vendor {
            if !is_address(v) {
                return Err("vendor must be a 0x address, or left out for a third-party provider".into());
            }
        }
        let base = base_url(&ctx)?;
        let mut query = vec![
            ("unit", args.unit.as_str().to_string()),
            ("billed_usdc", args.billed_usdc.to_string()),
            ("quantity", args.quantity.to_string()),
        ];
        if let Some(v) = vendor {
            query.push(("vendor", v.to_string()));
        }
        let raw = get_json(&base, "/par", &query)?;
        Ok(shape_bill(&raw, args.billed_usdc, args.quantity, vendor.is_some()))
    }
}

/// What a caller must know when a bill was judged against ACR's FLEET, not the market.
///
/// The same rule and the same measured reason as the MCP plugin's `fleetHint`: the
/// press prices a seller ACR operates only against ACR's fleet quotes, which sit on
/// ACR's index scale, and an agent reading that answer cannot otherwise know a
/// market answer exists. Measured 2026-10-13: one bill came back "pay,
/// unbenchmarked" against the fleet and "escalate, +500,870 bp" against the market.
pub fn fleet_hint(priced_against: Option<&str>, vendor_supplied: bool, priced: Option<bool>) -> Option<String> {
    if priced_against != Some("fleet") {
        return None;
    }
    Some(if vendor_supplied {
        format!(
            "This vendor is a seller ACR operates, so the bill was judged only against ACR's own fleet prices, \
             which sit on ACR's index scale rather than the open market{}. To price the same bill against what \
             the market charges, call acr_check_bill again without vendor.",
            if priced == Some(false) { ", and the fleet had no independent quote to compare it with" } else { "" }
        )
    } else {
        "The market basket could not be used, so this bill fell back to ACR's fleet prices, which sit on ACR's \
         index scale and are not market prices. Treat the verdict as unpriced."
            .to_string()
    })
}

pub fn shape_bill(raw: &Value, billed: f64, quantity: f64, vendor_supplied: bool) -> Value {
    let par = &raw["par"];
    let verdict = &raw["verdict"];
    let would = &raw["would"];
    let basket = &raw["basket"];
    let priced_against = text(raw, "benchmarked_against");
    let priced = verdict.get("benchmarked").and_then(Value::as_bool);

    let quotes: Vec<Value> = par["quotes"]
        .as_array()
        .map(|qs| {
            qs.iter()
                .take(5)
                .map(|q| {
                    json!({
                        "seller": text(q, "seller"),
                        "label": text(q, "label"),
                        "price_usdc_per_unit": num(q, "price_usdc"),
                        "source": text(q, "source"),
                        "url": text(q, "url"),
                        "cite": text(q, "cite"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let best_seller = text(par, "best_seller");
    let cheapest = best_seller.map(|seller| {
        let label = quotes.iter().find(|q| q["seller"] == seller).and_then(|q| q["label"].as_str());
        json!({ "seller": seller, "label": label, "price_usdc_per_unit": num(par, "best_usdc") })
    });
    let saving = num(verdict, "saving_usdc").filter(|s| *s > 0.0);
    let basket_status = text(basket, "status");

    let mut out = json!({
        "unit": text(raw, "unit"),
        "billed_usdc": billed,
        "quantity": quantity,
        "your_price_usdc_per_unit": billed / quantity,
        "priced_against": priced_against,
        "priced": priced,
        "verdict": text(verdict, "verdict"),
        "over_going_rate_bp": num(raw, "over_rate_bp"),
        "going_rate_usdc_per_unit": num(par, "par_usdc"),
        "cheapest": cheapest,
        "avoidable_usdc": saving,
        "sellers_compared": par.get("sellers").and_then(Value::as_u64),
        "spend_agent_would": text(would, "intent"),
        "because": text(would, "rule"),
        "quotes": quotes,
        "market_basket": {
            "status": basket_status,
            "age": num(basket, "age_s").map(age_words),
            "usable": basket_status == Some("ok"),
        },
        "note": "a suggestion, not a promise: compared against published list prices, not your contract",
    });
    if priced == Some(false) {
        out["why_unpriced"] = json!(text(verdict, "reason").or(text(par, "reason")));
    }
    if let Some(hint) = fleet_hint(priced_against, vendor_supplied, priced) {
        out["hint"] = json!(hint);
    }
    out
}

// ─────────────────────────────────────────────────────────────── acr_wallet_cost

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WalletCostArgs {
    /// The 0x address of the wallet whose purchases from ACR's sellers to analyse.
    pub wallet: String,
    /// Look-back window in days, 1 to 90. Defaults to 30.
    #[serde(default)]
    pub days: Option<u32>,
}

pub struct WalletCostTool;

impl DynAomiTool for WalletCostTool {
    type App = AcrApp;
    type Args = WalletCostArgs;

    const NAME: &'static str = "acr_wallet_cost";
    const DESCRIPTION: &'static str = "Transaction-cost analysis for a wallet that buys compute or data from ACR's \
        sellers: how many purchases, how much it spent, how far it paid above or below the benchmark (slippage in \
        basis points, negative is better), how much it overpaid, broken down by seller, and the cheaper seller it \
        should have used if there was one. Use when the user asks whether an agent or wallet is overpaying, or what \
        it spent. A wallet ACR has never seen returns seen: false, which is not the same as spending nothing.";

    fn run(_app: &Self::App, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let wallet = args.wallet.trim();
        if !is_address(wallet) {
            return Err("wallet must be a 0x address".into());
        }
        let days = window(args.days)?;
        let base = base_url(&ctx)?;
        let raw = get_json(&base, &format!("/tca/{wallet}"), &[("days", days.to_string())])?;
        shape_wallet(&raw)
    }
}

pub fn shape_wallet(raw: &Value) -> Result<Value, String> {
    if raw.get("available").and_then(Value::as_bool) == Some(false) {
        return Err(format!(
            "ACR could not read its tape right now: {}; retry later",
            text(raw, "reason").unwrap_or("no reason given")
        ));
    }
    let seen = raw.get("seen").and_then(Value::as_bool).unwrap_or(false);
    let days = raw.get("window_days").and_then(Value::as_u64);
    let by_seller: Vec<Value> = raw["by_seller"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .take(5)
                .map(|r| {
                    json!({
                        "seller": text(r, "seller"),
                        "purchases": r.get("n").and_then(Value::as_u64),
                        "volume_usdc": num(r, "volume_usdc"),
                        "slippage_bp": num(r, "vw_slippage_bp"),
                        "human_share": num(r, "human_share"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let reroute = &raw["reroute"];
    let cheaper = if reroute.is_object() {
        json!({
            "leave": text(reroute, "from"),
            "use_instead": text(reroute, "to"),
            "saving_bp": num(reroute, "saving_bp"),
            "saving_usdc": num(reroute, "saving_usdc"),
            "basis": text(reroute, "basis"),
        })
    } else {
        Value::Null
    };
    let note = if seen {
        "slippage is measured against ACR's benchmark at the moment of each purchase; negative means the wallet paid less"
            .to_string()
    } else {
        format!(
            "ACR has no purchases from this wallet in the last {} days. That means ACR has not seen it buy, not that it \
             spent nothing: say so, and do not report zero spend",
            days.unwrap_or(30)
        )
    };
    Ok(json!({
        "wallet": text(raw, "payer"),
        "window_days": days,
        "seen": seen,
        "purchases": raw.get("purchases").and_then(Value::as_u64),
        "benchmarked_purchases": raw.get("benchmarked").and_then(Value::as_u64),
        "spent_usdc": num(raw, "spent_usdc"),
        "slippage_bp": num(raw, "vw_slippage_bp"),
        "overpaid_usdc": num(raw, "overpaid_usdc"),
        "by_seller": by_seller,
        "cheaper_seller": cheaper,
        "note": note,
    }))
}

// ─────────────────────────────────────────────────────────────── acr_seller_rating

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SellerRatingArgs {
    /// The 0x address of the seller to rate.
    pub seller: String,
    /// Look-back window in days, 1 to 90. Defaults to 30.
    #[serde(default)]
    pub days: Option<u32>,
}

pub struct SellerRatingTool;

impl DynAomiTool for SellerRatingTool {
    type App = AcrApp;
    type Args = SellerRatingArgs;

    const NAME: &'static str = "acr_seller_rating";
    const DESCRIPTION: &'static str = "A seller's grade on ACR's tape: price fairness against the benchmark, how \
        clean its trades are, how much real human demand backs it, and how fresh its attestations are, with how much \
        of the grade is actually measured. Use when the user asks whether a compute or data seller is trustworthy or \
        fairly priced. A thin record comes back Unrated with the reason, rather than a made-up score.";

    fn run(_app: &Self::App, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let seller = args.seller.trim();
        if !is_address(seller) {
            return Err("seller must be a 0x address".into());
        }
        let days = window(args.days)?;
        let base = base_url(&ctx)?;
        let raw = get_json(&base, &format!("/rating/{seller}"), &[("days", days.to_string())])?;
        shape_rating(&raw)
    }
}

pub fn shape_rating(raw: &Value) -> Result<Value, String> {
    if raw.get("available").and_then(Value::as_bool) == Some(false) {
        return Err(format!(
            "ACR could not read its tape right now: {}; retry later",
            text(raw, "reason").unwrap_or("no reason given")
        ));
    }
    let mut components = serde_json::Map::new();
    if let Some(obj) = raw["components"].as_object() {
        for (name, c) in obj {
            components.insert(
                name.clone(),
                json!({ "score": num(c, "score"), "measured": c.get("available").and_then(Value::as_bool) }),
            );
        }
    }
    Ok(json!({
        "seller": text(raw, "seller"),
        "window_days": raw.get("window_days").and_then(Value::as_u64),
        "grade": text(raw, "grade"),
        "score": num(raw, "score"),
        "measured_pct": raw.get("weight_covered_pct").and_then(Value::as_u64),
        "why_unrated": text(raw, "unrated_reason"),
        "trades": raw.get("n").and_then(Value::as_u64),
        "volume_usdc": num(raw, "volume_usdc"),
        "human_share": num(raw, "human_share"),
        "synthetic_share": num(raw, "synthetic_share"),
        "components": components,
    }))
}

// ─────────────────────────────────────────────────────────────── acr_receipts

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReceiptsArgs {
    /// Optional 0x address: only this payer's settlements.
    #[serde(default)]
    pub payer: Option<String>,
    /// How many to return, 1 to 50. Defaults to 10.
    #[serde(default)]
    pub limit: Option<u32>,
}

pub struct ReceiptsTool;

impl DynAomiTool for ReceiptsTool {
    type App = AcrApp;
    type Args = ReceiptsArgs;

    const NAME: &'static str = "acr_receipts";
    const DESCRIPTION: &'static str = "Recent paid queries settled with ACR in USDC, newest first: who paid, for which \
        resource, how much, on which network, and the settlement reference. Use when the user asks whether a payment \
        to ACR landed, or what a wallet has paid ACR recently. Narrow it with payer.";

    fn run(_app: &Self::App, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let payer = args.payer.as_deref().map(str::trim).filter(|p| !p.is_empty());
        if let Some(p) = payer {
            if !is_address(p) {
                return Err("payer must be a 0x address, or left out for every payer".into());
            }
        }
        let limit = match args.limit.unwrap_or(10) {
            l @ 1..=50 => l as usize,
            l => return Err(format!("limit must be between 1 and 50, got {l}")),
        };
        let base = base_url(&ctx)?;
        let raw = get_json(&base, "/marketplace/receipts", &[])?;
        Ok(shape_receipts(&raw, payer, limit, now_s()))
    }
}

pub fn shape_receipts(raw: &Value, payer: Option<&str>, limit: usize, now: f64) -> Value {
    let want = payer.map(str::to_ascii_lowercase);
    let rows: Vec<&Value> = raw["receipts"]
        .as_array()
        .map(|rs| {
            rs.iter()
                .filter(|r| match &want {
                    Some(p) => text(r, "payer").map(str::to_ascii_lowercase).as_deref() == Some(p.as_str()),
                    None => true,
                })
                .collect()
        })
        .unwrap_or_default();
    let receipts: Vec<Value> = rows
        .iter()
        .take(limit)
        .map(|r| {
            let at = num(r, "settled_at");
            json!({
                "settled_at": at,
                "age": at.map(|t| age_words(now - t)),
                "payer": text(r, "payer"),
                "seller": text(r, "seller"),
                "resource": text(r, "resource"),
                "amount_usdc": num(r, "amount_usdc"),
                "network": text(r, "network"),
                "settlement": text(r, "tx_ref"),
            })
        })
        .collect();
    let held = raw["receipts"].as_array().map(Vec::len).unwrap_or(0);
    // EMPTY IS NOT "NOBODY PAID". Receipts live in the memory of the press that
    // SOLD them; the default press sells nothing and holds none, and any press
    // forgets them on restart. Measured 2026-10-13: the default press answered
    // with zero rows while the testnet press held 119.
    let empty_note = (held == 0).then(|| {
        "this press holds no receipts at all: it may not be the press that sold them, or it restarted since.          Do not report that as no payments; the settlements themselves stay on chain"
    });
    json!({
        "payer": payer,
        "held_by_this_press": held,
        "why_empty": empty_note,
        "matching": rows.len(),
        "returned": receipts.len(),
        "receipts": receipts,
        "press_totals": { "paid_queries": raw.get("paid_queries").and_then(Value::as_u64), "revenue_usdc": num(raw, "revenue_usdc") },
        "note": "a floor, not a total: receipts the press holds in memory are lost when it restarts, while the \
                 settlement itself stays on chain",
    })
}

// ─────────────────────────────────────────────────────────────── tests

#[cfg(test)]
mod tests {
    use super::*;
    use aomi_sdk::testing::{TestCtxBuilder, run_tool};

    fn fixture(name: &str) -> Value {
        let text = match name {
            "onchain_inf" => include_str!("../fixtures/onchain_inf.json"),
            "onchain_gpu" => include_str!("../fixtures/onchain_gpu.json"),
            "par_market" => include_str!("../fixtures/par_market.json"),
            "par_fleet_vendor" => include_str!("../fixtures/par_fleet_vendor.json"),
            "tca_seen" => include_str!("../fixtures/tca_seen.json"),
            "tca_unseen" => include_str!("../fixtures/tca_unseen.json"),
            "rating" => include_str!("../fixtures/rating.json"),
            "receipts" => include_str!("../fixtures/receipts_testnet.json"),
            other => panic!("no fixture {other}"),
        };
        serde_json::from_str(text).unwrap()
    }

    // ── rate: the age is computed, and the boundaries are the press's

    #[test]
    fn a_fresh_print_is_current_and_says_its_age() {
        let raw = fixture("onchain_inf");
        let posted = raw["posted_at"].as_f64().unwrap();
        let out = shape_rate(Index::Inf, &raw, posted + 240.0).unwrap();
        assert_eq!(out["current"], true);
        assert_eq!(out["unit"], "$/1k tokens");
        assert_eq!(out["note"], "posted 4 min ago");
        assert!(out["confidence_interval"][0].as_f64().unwrap() <= out["value"].as_f64().unwrap());
    }

    #[test]
    fn a_print_past_the_settle_window_is_called_the_last_known_value() {
        let raw = fixture("onchain_inf");
        let posted = raw["posted_at"].as_f64().unwrap();
        let out = shape_rate(Index::Inf, &raw, posted + 25.0 * 3600.0).unwrap();
        assert_eq!(out["current"], false);
        assert!(out["note"].as_str().unwrap().contains("last known value"), "{}", out["note"]);
        // Between the warn line and the settle window it is current but flagged.
        let due = shape_rate(Index::Inf, &raw, posted + 6_000.0).unwrap();
        assert_eq!(due["current"], true);
        assert!(due["note"].as_str().unwrap().contains("due for its next"));
    }

    #[test]
    fn an_index_print_never_travels_without_its_scale() {
        // The output and the model-facing description must both say an index level
        // is not a market price — the description is what decides how the agent talks.
        let out = shape_rate(Index::Inf, &fixture("onchain_inf"), 0.0).unwrap();
        assert!(out["scale"].as_str().unwrap().contains("not a market price"));
        assert!(RateTool::DESCRIPTION.contains("NOT market prices"));
        assert!(RateTool::DESCRIPTION.contains("acr_check_bill"));
    }

    #[test]
    fn each_index_carries_its_own_unit() {
        let out = shape_rate(Index::Gpu, &fixture("onchain_gpu"), 0.0).unwrap();
        assert_eq!(out["index"], "ACR-GPU");
        assert_eq!(out["unit"], "$/GPU-sec");
    }

    #[test]
    fn a_print_with_no_value_is_an_error_not_a_zero() {
        assert!(shape_rate(Index::Inf, &json!({"posted_at": 1.0}), 2.0).is_err());
    }

    // ── bills: market vs fleet, and the numbers are the press's

    #[test]
    fn a_market_bill_carries_the_verdict_the_cheapest_cited_seller_and_the_saving() {
        let out = shape_bill(&fixture("par_market"), 0.47, 23.0, false);
        assert_eq!(out["priced_against"], "market");
        assert_eq!(out["priced"], true);
        assert_eq!(out["verdict"], "over_par");
        assert_eq!(out["spend_agent_would"], "escalate");
        assert!(out["over_going_rate_bp"].as_f64().unwrap() > 400_000.0);
        assert_eq!(out["cheapest"]["seller"], "openai/gpt-4o-mini");
        assert_eq!(out["cheapest"]["label"], "GPT-4o mini");
        assert!(out["avoidable_usdc"].as_f64().unwrap() > 0.4);
        let quotes = out["quotes"].as_array().unwrap();
        assert!(quotes.len() >= 2 && quotes.iter().all(|q| q["url"].is_string() && q["cite"].is_string()));
        assert!(out.get("hint").is_none(), "a market-priced bill needs no hint");
        assert!((out["your_price_usdc_per_unit"].as_f64().unwrap() - 0.47 / 23.0).abs() < 1e-12);
    }

    #[test]
    fn an_acr_seller_bill_is_unpriced_and_says_how_to_get_the_market_answer() {
        let out = shape_bill(&fixture("par_fleet_vendor"), 0.47, 23.0, true);
        assert_eq!(out["priced_against"], "fleet");
        assert_eq!(out["priced"], false);
        assert_eq!(out["why_unpriced"], "NO_QUOTES");
        let hint = out["hint"].as_str().unwrap();
        assert!(hint.contains("without vendor") && hint.contains("no independent quote"), "{hint}");
        assert!(out["avoidable_usdc"].is_null(), "an unpriced bill must not claim a saving");
    }

    #[test]
    fn the_fleet_hint_covers_both_ways_a_bill_reaches_the_fleet() {
        assert!(fleet_hint(Some("market"), true, Some(true)).is_none());
        assert!(fleet_hint(None, true, Some(false)).is_none(), "an older press with no basis gets no guess");
        assert!(fleet_hint(Some("fleet"), false, Some(true)).unwrap().contains("basket could not be used"));
    }

    // ── wallets: unseen is not zero

    #[test]
    fn a_seen_wallet_reports_its_spend_and_slippage() {
        let out = shape_wallet(&fixture("tca_seen")).unwrap();
        assert_eq!(out["seen"], true);
        assert_eq!(out["purchases"], 3);
        assert!(out["spent_usdc"].as_f64().unwrap() > 0.0);
        assert!(out["by_seller"].as_array().unwrap().len() >= 1);
        assert!(out["cheaper_seller"].is_null());
    }

    #[test]
    fn an_unseen_wallet_is_not_reported_as_spending_nothing() {
        let out = shape_wallet(&fixture("tca_unseen")).unwrap();
        assert_eq!(out["seen"], false);
        assert!(out["note"].as_str().unwrap().contains("not that it spent nothing"));
    }

    #[test]
    fn a_reroute_is_passed_on_in_plain_terms() {
        let mut raw = fixture("tca_seen");
        raw["reroute"] = json!({"from": "0xA", "to": "0xB", "saving_bp": 120.5, "saving_usdc": 0.0012,
                                "basis": "past fills in this window", "note": "a suggestion, not a promise"});
        let out = shape_wallet(&raw).unwrap();
        assert_eq!(out["cheaper_seller"]["leave"], "0xA");
        assert_eq!(out["cheaper_seller"]["use_instead"], "0xB");
    }

    #[test]
    fn an_unreadable_tape_is_an_error_not_an_empty_wallet() {
        assert!(shape_wallet(&json!({"available": false, "reason": "the subgraph did not answer"})).is_err());
    }

    // ── ratings: a thin tape says why

    #[test]
    fn a_thin_tape_comes_back_unrated_with_the_reason() {
        let out = shape_rating(&fixture("rating")).unwrap();
        assert_eq!(out["grade"], "Unrated");
        assert!(out["why_unrated"].as_str().unwrap().contains("thin tape"));
        assert_eq!(out["measured_pct"], 40);
        assert!(out["components"]["fairness"]["score"].is_number());
    }

    // ── receipts: narrowing is exact and case-blind

    #[test]
    fn receipts_narrow_to_one_payer_whatever_the_case() {
        let raw = fixture("receipts");
        let out = shape_receipts(&raw, Some("0x784E6D2D4870174AD1AEA3D7446F2377D0C6A05D"), 50, 2e9);
        assert_eq!(out["matching"], 6);
        assert!(out["receipts"].as_array().unwrap().iter().all(|r| r["payer"] == "0x784e6d2d4870174ad1aea3d7446f2377d0c6a05d"));
        assert_eq!(shape_receipts(&raw, None, 3, 2e9)["returned"], 3);
        assert_eq!(out["press_totals"]["paid_queries"], 119);
    }

    #[test]
    fn a_press_holding_no_receipts_says_so_instead_of_implying_nobody_paid() {
        let out = shape_receipts(&json!({"receipts": [], "paid_queries": 0}), None, 10, 2e9);
        assert_eq!(out["held_by_this_press"], 0);
        assert!(out["why_empty"].as_str().unwrap().contains("Do not report that as no payments"));
        // A press that holds receipts but none for this payer is a different, ordinary answer.
        let some = shape_receipts(&fixture("receipts"), Some("0x0000000000000000000000000000000000000001"), 10, 2e9);
        assert_eq!(some["matching"], 0);
        assert!(some["why_empty"].is_null());
    }

    // ── arguments are refused locally, before any network call

    #[test]
    fn bad_arguments_are_refused_before_the_network() {
        let ctx = || TestCtxBuilder::new("t").secret("ACR_API", "https://unreachable.invalid").build();
        let app = AcrApp;
        let bad_bill = run_tool::<CheckBillTool>(&app, json!({"billed_usdc": 0, "quantity": 1, "unit": "$/MB"}), ctx());
        assert!(bad_bill.unwrap_err().contains("billed_usdc"));
        let bad_vendor = run_tool::<CheckBillTool>(
            &app,
            json!({"billed_usdc": 1, "quantity": 1, "unit": "$/MB", "vendor": "acme"}),
            ctx(),
        );
        assert!(bad_vendor.unwrap_err().contains("0x address"));
        let bad_unit = run_tool::<CheckBillTool>(&app, json!({"billed_usdc": 1, "quantity": 1, "unit": "$/GPU-hour"}), ctx());
        assert!(bad_unit.is_err(), "an invented unit must not reach the press");
        let bad_wallet = run_tool::<WalletCostTool>(&app, json!({"wallet": "me"}), ctx());
        assert!(bad_wallet.unwrap_err().contains("0x address"));
        let bad_days = run_tool::<SellerRatingTool>(&app, json!({"seller": "0x".to_string() + &"a".repeat(40), "days": 365}), ctx());
        assert!(bad_days.unwrap_err().contains("between 1 and 90"));
        let bad_index = run_tool::<RateTool>(&app, json!({"index": "ACR-FOO"}), ctx());
        assert!(bad_index.is_err());
    }

    // ── live: the same tools against the real press (run with --ignored)

    #[test]
    #[ignore = "network: talks to the live ACR press"]
    fn live_every_tool_answers_from_the_real_press() {
        let app = AcrApp;
        let ctx = || TestCtxBuilder::new("live").build();
        for index in ["ACR-INF", "ACR-GPU", "ACR-DATA"] {
            let r = run_tool::<RateTool>(&app, json!({"index": index}), ctx()).unwrap().value;
            assert!(r["value"].as_f64().unwrap() > 0.0, "{index}: {r}");
            println!("acr_rate {index}: {} {} ({})", r["value"], r["unit"], r["note"]);
        }
        let bill = run_tool::<CheckBillTool>(&app, json!({"billed_usdc": 0.47, "quantity": 23, "unit": "$/1k tokens"}), ctx())
            .unwrap()
            .value;
        assert_eq!(bill["priced_against"], "market", "{bill}");
        println!("acr_check_bill: {} {} bp, would {}", bill["verdict"], bill["over_going_rate_bp"], bill["spend_agent_would"]);
        // SUBJECTS FROM THE PRESS UNDER TEST, not from one chain. This used to
        // name the mainnet deployer, so `ACR_API=<testnet> cargo test -- --ignored`
        // failed on a wallet testnet never saw — a fixture, not the tool. A press
        // that holds receipts names a real payer and seller; one that holds none
        // falls back to the mainnet examples the /developers page uses.
        let base = crate::client::base_url(&ctx()).unwrap();
        let held = crate::client::get_json(&base, "/marketplace/receipts", &[]).unwrap_or_default();
        let first = |k: &str| {
            held["receipts"].as_array().and_then(|rows| rows.iter().find_map(|r| r[k].as_str().map(str::to_string)))
        };
        let payer = first("payer").unwrap_or_else(|| "0xc2903b52a3ad365fd237b78389a2fde99e886999".into());
        let seller = first("seller").unwrap_or_else(|| "0xefe0E4625AFf072c3FCff230b47f8150A17aDF19".into());
        let wallet = run_tool::<WalletCostTool>(&app, json!({"wallet": payer, "days": 90}), ctx())
            .unwrap()
            .value;
        match wallet["seen"].as_bool() {
            Some(true) => assert!(wallet["spent_usdc"].as_f64().is_some(), "{wallet}"),
            Some(false) => assert!(
                wallet["note"].as_str().unwrap_or("").contains("has not seen"),
                "an unseen wallet must say so, never read as zero spend: {wallet}"
            ),
            None => panic!("no seen flag: {wallet}"),
        }
        println!("acr_wallet_cost {payer} (90 d): seen={} purchases={}", wallet["seen"], wallet["purchases"]);
        let rating = run_tool::<SellerRatingTool>(&app, json!({"seller": seller, "days": 90}), ctx())
            .unwrap()
            .value;
        assert!(rating["grade"].is_string(), "{rating}");
        println!("acr_seller_rating {seller}: {}", rating["grade"]);
        let receipts = run_tool::<ReceiptsTool>(&app, json!({"limit": 3}), ctx()).unwrap().value;
        assert!(receipts["receipts"].is_array(), "{receipts}");
    }
}
