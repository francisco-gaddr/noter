//! Security-critical parser for the custom `noter://` protocol and `.noter` file opens.
//!
//! This is the Rust port of `electron-noter/src/deeplink.js` — Rust is now the trust boundary the
//! Electron main process used to be, so the validation lives here and only a *validated* internal
//! route ever crosses into the webview. Returns `None` for anything untrusted (foreign protocol,
//! malformed id, external redirect, path traversal). The unit tests below mirror the JS test suite so
//! the two implementations cannot silently diverge.
//!
//! Supported routes:
//!   noter://note/<noteId>             → /note/<noteId>
//!   noter://task/<taskId>             → /task/<taskId>
//!   noter://open?route=<encoded-path> → arbitrary internal route (must stay inside our SPA)

use url::Url;

const MAX_RAW: usize = 1024;

/// `^[A-Za-z0-9._:-]{1,128}$`
fn is_valid_id(s: &str) -> bool {
    let len = s.chars().count();
    len >= 1
        && len <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// `^/[A-Za-z0-9._:/?&=%-]{0,512}$`
fn is_valid_route(s: &str) -> bool {
    let mut chars = s.chars();
    if chars.next() != Some('/') {
        return false;
    }
    let rest_len = s.chars().count() - 1;
    rest_len <= 512
        && chars.all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '?' | '&' | '=' | '%' | '-')
        })
}

fn is_http(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http:") || lower.starts_with("https:")
}

/// Parse a `noter://` URL into a trusted internal route, or `None` if untrusted/malformed.
pub fn parse_deeplink(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > MAX_RAW {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "noter" {
        return None;
    }
    // JS `url.hostname` is lower-cased; match that so noter://NOTE/x behaves like noter://note/x.
    let host = url.host_str()?.to_ascii_lowercase();

    match host.as_str() {
        "note" | "task" => {
            let segment = url.path().trim_start_matches('/').split('/').next().unwrap_or("");
            if !is_valid_id(segment) {
                return None;
            }
            Some(format!("/{}/{}", host, segment))
        }
        "open" => {
            let route = url
                .query_pairs()
                .find(|(k, _)| k == "route")
                .map(|(_, v)| v.into_owned())?;
            if !is_valid_route(&route) {
                return None;
            }
            // Defence in depth: never accept a protocol-relative or absolute-with-host route.
            if route.starts_with("//") || is_http(&route) {
                return None;
            }
            Some(route)
        }
        _ => None,
    }
}

/// Walk argv (Windows/Linux pass deep-links as an argv entry) and return the first valid route.
pub fn find_deeplink_in_argv(argv: &[String]) -> Option<String> {
    argv.iter()
        .filter(|a| a.starts_with("noter://"))
        .find_map(|a| parse_deeplink(a))
}

/// Return the first `.noter` file path in argv (OS file-association launch), if any.
pub fn find_noter_file_in_argv(argv: &[String]) -> Option<String> {
    argv.iter()
        .find(|a| a.to_ascii_lowercase().ends_with(".noter"))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_over_long() {
        assert_eq!(parse_deeplink(""), None);
        assert_eq!(parse_deeplink(&"x".repeat(2000)), None);
    }

    #[test]
    fn rejects_foreign_protocols() {
        assert_eq!(parse_deeplink("https://daylited.com/"), None);
        assert_eq!(parse_deeplink("file:///etc/passwd"), None);
        assert_eq!(parse_deeplink("javascript:alert(1)"), None);
    }

    #[test]
    fn parses_note_and_task() {
        assert_eq!(parse_deeplink("noter://note/abc123"), Some("/note/abc123".into()));
        assert_eq!(
            parse_deeplink("noter://task/507f1f77bcf86cd799439011"),
            Some("/task/507f1f77bcf86cd799439011".into())
        );
    }

    #[test]
    fn rejects_unsafe_ids() {
        // Traversal text must never reach the route.
        let trav = parse_deeplink("noter://note/abc/../etc/passwd");
        assert!(trav.is_some());
        assert!(!trav.unwrap().contains(".."));
        assert_eq!(parse_deeplink("noter://note/a%20b"), None); // space not in allow-list
        assert_eq!(parse_deeplink("noter://note/<script>"), None);
    }

    #[test]
    fn rejects_empty_id() {
        assert_eq!(parse_deeplink("noter://note/"), None);
        assert_eq!(parse_deeplink("noter://note"), None);
    }

    #[test]
    fn parses_open_route() {
        assert_eq!(
            parse_deeplink("noter://open?route=/settings/profile"),
            Some("/settings/profile".into())
        );
    }

    #[test]
    fn rejects_open_without_or_external_route() {
        assert_eq!(parse_deeplink("noter://open"), None);
        assert_eq!(parse_deeplink("noter://open?route=https://evil.com"), None);
        assert_eq!(parse_deeplink("noter://open?route=//evil.com"), None);
    }

    #[test]
    fn rejects_unknown_resource_type() {
        assert_eq!(parse_deeplink("noter://admin/everything"), None);
    }

    #[test]
    fn finds_deeplink_in_mixed_argv() {
        let argv = vec![
            "/path/to/app".to_string(),
            "--some-flag".to_string(),
            "noter://note/abc123".to_string(),
            "--other".to_string(),
        ];
        assert_eq!(find_deeplink_in_argv(&argv), Some("/note/abc123".into()));
        assert_eq!(
            find_deeplink_in_argv(&["/usr/bin/app".to_string(), "--inspect".to_string()]),
            None
        );
    }

    #[test]
    fn finds_noter_file_in_argv() {
        let argv = vec!["/app".to_string(), "/Users/x/My Note.noter".to_string()];
        assert_eq!(find_noter_file_in_argv(&argv), Some("/Users/x/My Note.noter".into()));
        assert_eq!(find_noter_file_in_argv(&["/app".to_string()]), None);
    }
}
