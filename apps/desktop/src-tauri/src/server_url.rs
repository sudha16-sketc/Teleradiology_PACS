//! Resolution and validation of the Axis deployment URL.
//!
//! Deliberately free of any Tauri dependency: every rule here is pure string /
//! file logic so it can be unit tested (`cargo test`) without a webview, and so
//! the rules are auditable in one place.
//!
//! The security-relevant rule is [`ServerUrl::parse`]. It refuses anything that
//! would point the shell at the local filesystem (`file:`, custom protocols),
//! smuggle credentials into a config file or a log line, or carry a path prefix
//! — a path prefix would silently break the root-relative `/api` and `/ohif`
//! requests the frontend makes, which is a confusing failure to debug on site.

use std::fmt;
use std::path::Path;

/// Environment variable that overrides every other source.
pub const ENV_VAR: &str = "AXIS_DESKTOP_SERVER_URL";

/// Per-user configuration file name, resolved inside the app config directory.
pub const CONFIG_FILE_NAME: &str = "desktop.json";

/// Used only by debug builds so `tauri dev` has something to load.
pub const DEV_DEFAULT: &str = "http://localhost:3000";

/// A validated, canonical Axis deployment base URL.
///
/// Canonical form is `scheme://host[:port]` with a lowercased scheme and
/// authority and no trailing slash. It is guaranteed to be free of credentials,
/// query strings, fragments and path prefixes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerUrl(String);

/// Why a candidate deployment URL was rejected. Shown to the operator verbatim.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidServerUrl(String);

impl fmt::Display for InvalidServerUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidServerUrl {}

fn reject(reason: &str) -> InvalidServerUrl {
    InvalidServerUrl(reason.to_string())
}

impl ServerUrl {
    /// Validate and canonicalise a deployment URL.
    ///
    /// Accepts HTTPS deployments and HTTP loopback URLs for local development.
    /// Rejects everything else — see the module docs.
    pub fn parse(raw: &str) -> Result<Self, InvalidServerUrl> {
        let value = raw.trim();
        if value.is_empty() {
            return Err(reject("the deployment URL is empty"));
        }
        if value.chars().any(char::is_whitespace) {
            return Err(reject("the deployment URL contains whitespace"));
        }

        let (scheme, rest) = value
            .split_once("://")
            .ok_or_else(|| reject("the deployment URL must start with http:// or https://"))?;
        let scheme = scheme.to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(reject(&format!(
                "the deployment URL scheme must be http or https, got \"{scheme}\""
            )));
        }

        let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let authority = &rest[..authority_end];
        let tail = &rest[authority_end..];

        if authority.is_empty() {
            return Err(reject("the deployment URL has no host"));
        }
        if authority.contains('@') {
            // Keeps passwords and API keys out of desktop.json, the process
            // environment and the log output.
            return Err(reject(
                "the deployment URL must not embed credentials; the API is authenticated with a session cookie",
            ));
        }
        if tail.contains('?') || tail.contains('#') {
            return Err(reject(
                "the deployment URL must not contain a query string or fragment",
            ));
        }
        if !tail.trim_end_matches('/').is_empty() {
            return Err(reject(
                "the deployment URL must not contain a path; the Axis web client uses root-relative /api and /ohif requests",
            ));
        }

        let url = Self(format!("{scheme}://{}", authority.to_ascii_lowercase()));
        if scheme == "http" && !url.is_loopback() {
            return Err(reject("non-loopback deployment URLs must use HTTPS"));
        }
        Ok(url)
    }

    /// The canonical URL, e.g. `https://pacs.example.org`.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// True when the host is a loopback address. Only ever expected in debug
    /// builds, so production diagnostics can call it out.
    pub fn is_loopback(&self) -> bool {
        let authority = self.0.split_once("://").map(|(_, rest)| rest).unwrap_or("");
        let host = match authority.rsplit_once(':') {
            Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => host,
            _ => authority,
        };
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let loopback_ip = host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
        loopback_ip || host == "localhost" || host.ends_with(".localhost")
    }
}

/// Where the resolved URL came from. Reported on stderr at startup so a
/// misconfigured machine is diagnosable without a debugger.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Environment,
    ConfigFile,
    CompiledIn,
    DevelopmentDefault,
    Unconfigured,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Environment => ENV_VAR,
            Source::ConfigFile => CONFIG_FILE_NAME,
            Source::CompiledIn => "compile-time AXIS_DESKTOP_SERVER_URL",
            Source::DevelopmentDefault => "development default",
            Source::Unconfigured => "not configured",
        }
    }
}

/// Outcome of [`resolve`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    /// The deployment to load, or `None` when nothing valid was configured.
    pub url: Option<ServerUrl>,
    pub source: Source,
    /// Human-readable explanation, always populated. Never contains secrets:
    /// only the offending URL shape and the reason it was rejected.
    pub detail: String,
}

/// Read `desktop.json` from the app config directory.
///
/// The file is intentionally minimal: `{"serverUrl": "https://..."}`. Anything
/// else in the object is ignored, so the format can grow later without breaking
/// existing installs.
pub fn read_config_file(config_dir: &Path) -> Result<Option<ServerUrl>, String> {
    let path = config_dir.join(CONFIG_FILE_NAME);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        // Absent is the normal case and not an error worth reporting loudly.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("{} could not be read: {err}", path.display())),
    };

    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("{} is not valid JSON: {err}", path.display()))?;
    let candidate = value
        .get("serverUrl")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            format!(
                "{} must contain a string field \"serverUrl\", e.g. {{\"serverUrl\":\"https://pacs.example.org\"}}",
                path.display()
            )
        })?;

    ServerUrl::parse(candidate)
        .map(Some)
        .map_err(|err| format!("{} has an invalid serverUrl: {err}", path.display()))
}

/// Resolve the deployment URL. First valid source wins.
///
/// * `env_value` — the `AXIS_DESKTOP_SERVER_URL` environment variable. An
///   invalid value is a hard stop rather than a fall-through, so a typo can
///   never silently start the client against the wrong deployment.
/// * `config_dir` — the per-user config directory holding `desktop.json`.
/// * `compiled_in` — the value captured at build time, if any.
/// * `allow_dev_default` — debug builds only. Release builds never guess.
pub fn resolve(
    env_value: Option<&str>,
    config_dir: Option<&Path>,
    compiled_in: Option<&str>,
    allow_dev_default: bool,
) -> Resolution {
    if let Some(raw) = env_value {
        return match ServerUrl::parse(raw) {
            Ok(url) => Resolution {
                detail: format!("{ENV_VAR} is set"),
                url: Some(url),
                source: Source::Environment,
            },
            Err(err) => Resolution {
                url: None,
                source: Source::Unconfigured,
                detail: format!("{ENV_VAR} is set but unusable: {err}"),
            },
        };
    }

    if let Some(dir) = config_dir {
        match read_config_file(dir) {
            Ok(Some(url)) => {
                return Resolution {
                    detail: format!("{CONFIG_FILE_NAME} found in {}", dir.display()),
                    url: Some(url),
                    source: Source::ConfigFile,
                }
            }
            Ok(None) => {}
            Err(err) => {
                return Resolution {
                    url: None,
                    source: Source::Unconfigured,
                    detail: err,
                }
            }
        }
    }

    if let Some(raw) = compiled_in {
        return match ServerUrl::parse(raw) {
            Ok(url) => Resolution {
                detail: "baked in at build time".to_string(),
                url: Some(url),
                source: Source::CompiledIn,
            },
            Err(err) => Resolution {
                url: None,
                source: Source::Unconfigured,
                detail: format!("the compiled-in deployment URL is unusable: {err}"),
            },
        };
    }

    if allow_dev_default {
        // parse() only fails on a programming error for this constant.
        let url = ServerUrl::parse(DEV_DEFAULT).ok();
        return Resolution {
            detail: format!("debug build falling back to {DEV_DEFAULT}"),
            url,
            source: Source::DevelopmentDefault,
        };
    }

    Resolution {
        url: None,
        source: Source::Unconfigured,
        detail: format!(
            "no deployment configured. Set {ENV_VAR}, or write {CONFIG_FILE_NAME} into the app config directory"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_and_port_forms() {
        for (input, expected) in [
            ("https://pacs.example.org", "https://pacs.example.org"),
            ("https://pacs.example.org/", "https://pacs.example.org"),
            (
                "https://pacs.example.org:8443",
                "https://pacs.example.org:8443",
            ),
            ("  https://pacs.example.org  ", "https://pacs.example.org"),
            ("HTTPS://PACS.EXAMPLE.ORG", "https://pacs.example.org"),
            ("http://127.0.0.1:3000", "http://127.0.0.1:3000"),
            ("http://[::1]:3000", "http://[::1]:3000"),
        ] {
            assert_eq!(
                ServerUrl::parse(input).unwrap().as_str(),
                expected,
                "{input}"
            );
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        for input in [
            "file:///C:/axis",
            "tauri://localhost",
            "ftp://pacs.example.org",
            "javascript:alert(1)",
            "pacs.example.org",
        ] {
            assert!(
                ServerUrl::parse(input).is_err(),
                "{input} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_non_loopback_http_deployments() {
        for input in [
            "http://pacs.example.org",
            "http://10.0.0.5:3000",
            "http://0.0.0.0:3000",
            "http://127.pacs.example.org",
        ] {
            let err = ServerUrl::parse(input).unwrap_err();
            assert!(err.to_string().contains("HTTPS"), "{input}: {err}");
        }
    }

    #[test]
    fn rejects_embedded_credentials() {
        let err = ServerUrl::parse("https://user:secret@pacs.example.org").unwrap_err();
        assert!(err.to_string().contains("credentials"), "{err}");
    }

    #[test]
    fn rejects_path_prefix() {
        // A prefix would break the root-relative /api and /ohif requests.
        let err = ServerUrl::parse("https://example.org/axis").unwrap_err();
        assert!(err.to_string().contains("path"), "{err}");
    }

    #[test]
    fn rejects_query_and_fragment() {
        assert!(ServerUrl::parse("https://example.org/?a=1").is_err());
        assert!(ServerUrl::parse("https://example.org/#x").is_err());
    }

    #[test]
    fn rejects_empty_and_hostless() {
        assert!(ServerUrl::parse("").is_err());
        assert!(ServerUrl::parse("   ").is_err());
        assert!(ServerUrl::parse("https://").is_err());
    }

    #[test]
    fn detects_loopback() {
        assert!(ServerUrl::parse("http://localhost:3000")
            .unwrap()
            .is_loopback());
        assert!(ServerUrl::parse("http://127.0.0.1:3000")
            .unwrap()
            .is_loopback());
        assert!(!ServerUrl::parse("https://pacs.example.org")
            .unwrap()
            .is_loopback());
        assert!(!ServerUrl::parse("https://0.0.0.0").unwrap().is_loopback());
    }

    #[test]
    fn env_wins_and_a_bad_env_is_not_silently_ignored() {
        let resolved = resolve(
            Some("https://from-env.example.org"),
            None,
            Some("https://from-build.example.org"),
            true,
        );
        assert_eq!(resolved.source, Source::Environment);
        assert_eq!(
            resolved.url.unwrap().as_str(),
            "https://from-env.example.org"
        );

        let resolved = resolve(
            Some("nonsense"),
            None,
            Some("https://from-build.example.org"),
            true,
        );
        assert_eq!(resolved.source, Source::Unconfigured);
        assert!(resolved.url.is_none());
        assert!(resolved.detail.contains("unusable"), "{}", resolved.detail);
    }

    #[test]
    fn compiled_in_is_used_before_the_dev_default() {
        let resolved = resolve(None, None, Some("https://from-build.example.org"), true);
        assert_eq!(resolved.source, Source::CompiledIn);

        let resolved = resolve(None, None, None, true);
        assert_eq!(resolved.source, Source::DevelopmentDefault);
        assert_eq!(resolved.url.unwrap().as_str(), DEV_DEFAULT);
    }

    #[test]
    fn release_build_never_guesses() {
        let resolved = resolve(None, None, None, false);
        assert_eq!(resolved.source, Source::Unconfigured);
        assert!(resolved.url.is_none());
        assert!(resolved.detail.contains(ENV_VAR), "{}", resolved.detail);
    }

    #[test]
    fn reads_server_url_from_config_file() {
        let dir = std::env::temp_dir().join(format!("axis-desktop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(CONFIG_FILE_NAME);

        std::fs::write(&path, r#"{"serverUrl":"https://pacs.example.org/"}"#).unwrap();
        assert_eq!(
            read_config_file(&dir).unwrap().unwrap().as_str(),
            "https://pacs.example.org"
        );

        std::fs::write(&path, r#"{"serverUrl":"https://user:pw@pacs.example.org"}"#).unwrap();
        assert!(read_config_file(&dir).is_err());

        std::fs::write(&path, "not json").unwrap();
        assert!(read_config_file(&dir).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_config_file_is_not_an_error() {
        let dir = std::env::temp_dir().join("axis-desktop-test-absent");
        std::fs::remove_dir_all(&dir).ok();
        assert!(read_config_file(&dir).unwrap().is_none());
    }
}
