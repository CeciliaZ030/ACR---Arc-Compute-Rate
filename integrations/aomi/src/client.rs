//! The one door from this App to ACR's press.
//!
//! BLOCKING, ON PURPOSE. Aomi runs a tool inside a synchronous FFI boundary with
//! no async runtime in the plugin — the official template
//! (`aomi-labs/playground-example`) says so in its `Cargo.toml` and prescribes
//! `reqwest`'s blocking client. An async client would compile, pass every local
//! test, and then fail inside their backend, which is the worst order to find out.
//!
//! ONE CLIENT FOR THE PROCESS. A blocking `reqwest` client owns a background
//! thread. The runtime builds one App value per chat session, so a client per App
//! would be a thread per session; a lazily built static is one thread total, and
//! it is created on the first tool call — inside that synchronous boundary — and
//! never dropped, so it can never be torn down from an async context.

use std::sync::OnceLock;
use std::time::Duration;

use aomi_sdk::{DynToolCallCtx, resolve_secret_value};
use serde_json::Value;

/// The press this App reads when nothing overrides it.
///
/// The same default the ACR MCP plugin ships (`mcp/src/tools.ts`): an Arc
/// mainnet press that stays awake and reads its subgraph through The Graph's
/// gateway, so the wallet and seller tools are not capped at 3,000 queries a day.
pub const DEFAULT_API: &str = "https://acr-probe-free.onrender.com";

/// The optional secret slot that points the App at another press (testnet, a fork).
pub const API_SECRET: &str = "ACR_API";

/// Long enough for a press that is waking (measured 25–40 s on Render's free
/// tier), short enough that a dead one fails inside a chat turn.
pub const TIMEOUT_S: u64 = 45;

fn http() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_S))
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!("acr-aomi/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("a TLS client with static settings always builds")
    })
}

/// Which press to call: the `ACR_API` secret when one is set, else the default.
///
/// Through the SDK's own resolution (an injected secret, then the environment),
/// so the dashboard's Environment tab and a local shell both work. An override
/// that is not an http(s) URL is refused rather than tried, because a typo here
/// would otherwise surface as a confusing connection error on every tool.
pub fn base_url(ctx: &DynToolCallCtx) -> Result<String, String> {
    match resolve_secret_value(ctx, None, API_SECRET, "") {
        Ok(raw) => {
            let base = raw.trim().trim_end_matches('/').to_string();
            if base.starts_with("https://")
                || base.starts_with("http://127.0.0.1")
                || base.starts_with("http://localhost")
            {
                Ok(base)
            } else {
                Err("the ACR_API setting is not an https URL; fix it in the App's Environment".into())
            }
        }
        Err(_) => Ok(DEFAULT_API.to_string()),
    }
}

/// The host part of a base URL — safe to name in an error, unlike the full
/// value of a secret, which the SDK says must never be returned.
pub fn host_of(base: &str) -> &str {
    let rest = base.split("://").nth(1).unwrap_or(base);
    rest.split('/').next().unwrap_or(rest)
}

/// GET a JSON route on the press, turning every failure into a sentence that
/// tells the model what to do next (retry, fix an argument, or stop).
///
/// TWO KINDS OF 404, AND ONLY ONE MEANS STOP. FastAPI answers an unknown route
/// with exactly `{"detail":"Not Found"}`: that deployment predates the tool.
/// Any other 404 carries the press's own sentence ("no on-chain print for
/// ACR-INF") and may be momentary: the press reads prints through Arc's
/// `eth_getLogs`, Arc throttles it, and a throttled read surfaces as 404.
/// Measured 2026-10-14 on the testnet press: one 404, then 36 of 36 reads
/// answered 200. So that kind is re-asked once before anything is concluded.
pub fn get_json(base: &str, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let host = host_of(base);
    for attempt in 0..2 {
        let resp = http()
            .get(format!("{base}{path}"))
            .query(query)
            .send()
            .map_err(|e| {
                if e.is_timeout() {
                    format!("ACR ({host}) did not answer within {TIMEOUT_S}s; it may be waking up, so retry once")
                } else {
                    format!("could not reach ACR ({host}); retry once, and stop if it fails again")
                }
            })?;
        let status = resp.status().as_u16();
        let body = resp.text().unwrap_or_default();
        return match status {
            200..=299 => serde_json::from_str(&body)
                .map_err(|_| format!("ACR ({host}) answered {path} with something that is not JSON")),
            404 if is_missing_route(&body) => Err(format!(
                "ACR ({host}) has no {path} route; that deployment predates this tool, so stop rather than retry"
            )),
            404 if attempt == 0 => {
                std::thread::sleep(Duration::from_millis(RETRY_404_MS));
                continue;
            }
            404 => Err(format!(
                "ACR ({host}) answered 404 for {path} twice ({}). Either there is no such record, or the \
                 press could not read the chain just now; retry in a minute before concluding it is absent",
                detail(&body)
            )),
            422 => Err(format!("ACR refused the arguments: {}", detail(&body))),
            _ => Err(format!("ACR ({host}) answered HTTP {status}; retry once, and stop if it repeats")),
        };
    }
    unreachable!("the loop returns on every path of its second pass")
}

/// The pause before re-asking after a data 404.
const RETRY_404_MS: u64 = 1500;

/// FastAPI's own body for a route that does not exist (or no body at all).
fn is_missing_route(body: &str) -> bool {
    let d = detail(body);
    d.is_empty() || d == "Not Found"
}

/// The press's own refusal sentence from a 422 body, trimmed.
fn detail(body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let text = parsed
        .as_ref()
        .and_then(|v| v.get("detail"))
        .map(|d| match d {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_else(|| body.to_string());
    text.chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aomi_sdk::testing::TestCtxBuilder;

    #[test]
    fn no_override_means_the_default_press() {
        let ctx = TestCtxBuilder::new("acr_rate").build();
        // The env fallback is part of the SDK's resolution; a developer shell
        // that sets ACR_API on purpose would change this, which is intended.
        if std::env::var(API_SECRET).is_err() {
            assert_eq!(base_url(&ctx).unwrap(), DEFAULT_API);
        }
    }

    #[test]
    fn an_override_is_honoured_and_trailing_slashes_dropped() {
        let ctx = TestCtxBuilder::new("acr_rate").secret(API_SECRET, "https://acr-api-1fto.onrender.com/").build();
        assert_eq!(base_url(&ctx).unwrap(), "https://acr-api-1fto.onrender.com");
    }

    #[test]
    fn a_non_url_override_is_refused_not_tried() {
        let ctx = TestCtxBuilder::new("acr_rate").secret(API_SECRET, "acr-api-1fto.onrender.com").build();
        let err = base_url(&ctx).unwrap_err();
        assert!(err.contains("not an https URL"), "{err}");
        assert!(!err.contains("acr-api-1fto"), "a secret's value must never appear in an error");
    }

    #[test]
    fn errors_name_the_host_not_the_whole_value() {
        assert_eq!(host_of("https://acr-probe-free.onrender.com"), "acr-probe-free.onrender.com");
        assert_eq!(host_of("https://h.example/some/path?token=x"), "h.example");
    }

    /// A scripted press on 127.0.0.1: answers each connection with the next
    /// (status, body) and counts the requests it saw.
    fn press(script: Vec<(u16, &'static str)>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        use std::sync::atomic::Ordering;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = hits.clone();
        std::thread::spawn(move || {
            for (status, body) in script {
                let Ok((mut sock, _)) = listener.accept() else { return };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf);
                seen.fetch_add(1, Ordering::SeqCst);
                let reason = if status == 200 { "OK" } else { "Not Found" };
                let _ = sock.write_all(
                    format!(
                        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\n\
                         content-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
            }
        });
        (base, hits)
    }

    const NO_PRINT: &str = r#"{"detail":"no on-chain print for ACR-INF"}"#;

    #[test]
    fn only_fastapis_own_not_found_means_the_route_is_missing() {
        assert!(is_missing_route(r#"{"detail":"Not Found"}"#));
        assert!(is_missing_route(""));
        assert!(!is_missing_route(NO_PRINT));
    }

    #[test]
    fn a_throttled_read_is_re_asked_and_the_value_comes_back() {
        let (base, hits) = press(vec![(404, NO_PRINT), (200, r#"{"value":0.49236}"#)]);
        let v = get_json(&base, "/onchain/ACR-INF", &[]).expect("the second answer is the value");
        assert_eq!(v["value"], 0.49236);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn two_data_404s_name_both_causes_and_say_retry() {
        let (base, hits) = press(vec![(404, NO_PRINT), (404, NO_PRINT)]);
        let err = get_json(&base, "/onchain/ACR-INF", &[]).unwrap_err();
        assert!(err.contains("twice") && err.contains("could not read the chain just now"), "{err}");
        assert!(err.contains("retry in a minute"), "{err}");
        assert!(!err.contains("predates"), "a data 404 is not a missing route: {err}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn a_missing_route_says_stop_and_is_not_re_asked() {
        let (base, hits) = press(vec![(404, r#"{"detail":"Not Found"}"#)]);
        let err = get_json(&base, "/par", &[]).unwrap_err();
        assert!(err.contains("predates this tool"), "{err}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn a_422_body_becomes_the_press_sentence() {
        let body = r#"{"detail":"unit must be one of ['$/1k tokens', '$/GPU-sec', '$/MB'], got 'x'"}"#;
        assert!(detail(body).starts_with("unit must be one of"));
        assert_eq!(detail("not json"), "not json");
    }
}
