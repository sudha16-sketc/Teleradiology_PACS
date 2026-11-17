//! Axis Desktop — the native shell for the Axis teleradiology PACS.
//!
//! # What this process does
//!
//! It opens a window and points it at a running Axis deployment. That is all.
//! It deliberately contains no PACS logic: every workflow, every authorization
//! decision and all clinical data handling stay in the NestJS API, which remains
//! the single source of truth. Rust here covers only what a browser tab cannot
//! do — a real window, an installer, a single-instance lock and a navigation
//! policy.
//!
//! # Why the window loads a remote origin
//!
//! The web frontend is not bundled into the executable, and that is a deliberate
//! security decision rather than an omission.
//!
//! Session state is an httpOnly cookie (`axis_session`) issued by the API with
//! `sameSite=lax`, and the API carries no CSRF token. A bundle shipped inside the
//! app is served from the Tauri custom protocol (`http://tauri.localhost` on
//! Windows), which is cross-site with any real API host. Browsers refuse to
//! attach a `SameSite=Lax` cookie to such a request, so login would silently
//! fail, and the only available fixes — relaxing the cookie to
//! `SameSite=None; Secure`, or opening a CORS + CSRF surface — would weaken the
//! deployment for the web client as well.
//!
//! Loading the deployment keeps the client same-origin with the API, so the
//! existing cookie, `SameSite=Lax`, RBAC, hospital/radiologist isolation and
//! audit logging all apply unchanged, to the desktop client exactly as they do
//! to a browser tab. The session cookie stays httpOnly and inside the WebView2
//! cookie store (OS-protected, DPAPI-encrypted on Windows); it is never read by
//! JavaScript and is never copied into Rust.
//!
//! The trade-off is that the client needs a reachable deployment, which is also
//! how clinical viewers are normally deployed: one shipped installer is correct
//! for every site instead of being pinned to a frozen build of the UI.
//!
//! # Where the deployment URL comes from
//!
//! First valid source wins — see [`server_url::resolve`]:
//!   1. the `AXIS_DESKTOP_SERVER_URL` environment variable,
//!   2. `desktop.json` in the per-user app config directory
//!      (`%APPDATA%\com.axis.teleradiology.pacs\desktop.json` on Windows),
//!   3. the value captured at compile time, if the build environment set one,
//!   4. `http://localhost:3000` — debug builds only.
//!
//! A release build with none of the above never guesses. It stays on the bundled
//! splash, which explains how to configure it.

mod file_select;
mod server_url;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use file_select::{
    collect_dicom_folder, pick_dicom_files, pick_dicom_folder, release_picked_paths,
};
use server_url::{resolve, Resolution, ServerUrl, ENV_VAR};

/// Must match the label used when the window is created below.
const MAIN_WINDOW: &str = "main";
const VIEWER_WINDOW: &str = "axis-viewer";

/// Bundled splash, used as the initial document and as the fallback when no
/// deployment is configured. Served from the Tauri custom protocol.
const SPLASH: &str = "index.html";

const WINDOW_TITLE: &str = "Axis";
const DEFAULT_SIZE: (f64, f64) = (1440.0, 900.0);
/// The reading room places the OHIF viewer beside the report editor, so a
/// narrower window is genuinely unusable rather than merely cramped.
const MIN_SIZE: (f64, f64) = (1024.0, 700.0);

/// Escape a Rust string for embedding in a single-quoted JS string literal.
/// The `<`/`>`/`&` escapes also defuse a `</script>`-style break-out should the
/// value ever be interpolated into an inline script by a caller.
fn js_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
}

/// Script handed to the webview before any page script runs. The bundled splash
/// reads `__AXIS_DESKTOP__` to tell "still connecting" from "not configured".
///
/// Note this reaches only the top-level document: the OHIF viewer is framed in
/// an iframe and must not be handed a desktop surface.
fn initialization_script(server_url: Option<&str>) -> String {
    let url = match server_url {
        Some(value) => format!("'{}'", js_escape(value)),
        None => "null".to_string(),
    };
    format!(
        "Object.defineProperty(window, '__AXIS_DESKTOP__', {{ \
           value: Object.freeze({{ serverUrl: {url}, shell: 'tauri' }}), \
           writable: false, configurable: false \
         }});"
    )
}

/// True for the document Tauri serves from the bundled `frontendDist`.
fn is_bundled_app_url(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// True for an ordinary web URL, which is safe to hand to the system browser.
fn is_external_http(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Navigation policy: the shell may only ever display the bundled splash or the
/// configured deployment. Everything else is refused, so a link in the UI, a
/// `Location.assign` from a compromised dependency, or a redirect cannot turn
/// the desktop client into a general-purpose browser inside the PACS window.
fn navigation_allowed(url: &Url, deployment: Option<&ServerUrl>) -> bool {
    if is_bundled_app_url(url) {
        return true;
    }
    match deployment {
        Some(deployment) => is_external_http(url) && same_origin(url.as_str(), deployment.as_str()),
        // Nothing configured: only the diagnostic splash is meaningful.
        None => false,
    }
}

fn same_origin(a: &str, b: &str) -> bool {
    fn origin(url: &str) -> String {
        let mut parts = url.splitn(3, "://");
        let scheme = parts.next().unwrap_or_default();
        let rest = parts.next().unwrap_or_default();
        let authority = rest.split('/').next().unwrap_or_default();
        format!("{scheme}://{authority}").to_ascii_lowercase()
    }
    origin(a) == origin(b)
}

fn build_viewer_url(deployment: &ServerUrl, study_uid: &str) -> Result<Url, String> {
    let valid_uid = !study_uid.is_empty()
        && study_uid.len() <= 64
        && study_uid
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        && !study_uid.starts_with('.')
        && !study_uid.ends_with('.')
        && !study_uid.contains("..");
    if !valid_uid {
        return Err("Invalid study identifier.".to_string());
    }

    let mut url = Url::parse(deployment.as_str()).map_err(|_| "Invalid deployment URL")?;
    url.set_path("/ohif/viewer");
    url.query_pairs_mut()
        .append_pair("StudyInstanceUIDs", study_uid);
    Ok(url)
}

fn to_boxed_error<E: std::fmt::Display>(err: E) -> Box<dyn std::error::Error> {
    format!("{err}").into()
}

fn report(resolution: &Resolution) {
    match &resolution.url {
        Some(url) => eprintln!(
            "[axis-desktop] deployment {} (source: {})",
            url.as_str(),
            resolution.source.as_str()
        ),
        None => eprintln!(
            "[axis-desktop] no deployment configured (source: {}): {}",
            resolution.source.as_str(),
            resolution.detail
        ),
    }
}

#[tauri::command]
fn open_viewer_window<R: Runtime>(app: AppHandle<R>, study_uid: String) -> Result<(), String> {
    let main = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "The PACS window is not available.".to_string())?;
    let mut origin = main
        .url()
        .map_err(|_| "The deployment URL is unavailable.")?;
    origin.set_path("/");
    origin.set_query(None);
    origin.set_fragment(None);
    let deployment = ServerUrl::parse(origin.as_str())
        .map_err(|_| "The viewer is unavailable until Axis is connected to a deployment.")?;
    let url = build_viewer_url(&deployment, &study_uid)?;

    if let Some(existing) = app.get_webview_window(VIEWER_WINDOW) {
        return existing
            .set_focus()
            .map_err(|_| "The viewer window could not be focused.".to_string());
    }

    let navigation_deployment = deployment.clone();
    let popup_deployment = deployment;
    WebviewWindowBuilder::new(&app, VIEWER_WINDOW, WebviewUrl::External(url))
        .title("Axis image viewer")
        .inner_size(1280.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .on_navigation(move |url| navigation_allowed(url, Some(&navigation_deployment)))
        .on_new_window(move |url, _| {
            if navigation_allowed(&url, Some(&popup_deployment)) {
                NewWindowResponse::Allow
            } else {
                NewWindowResponse::Deny
            }
        })
        .build()
        .map(|_| ())
        .map_err(|_| "The viewer window could not be opened.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Registered first, as the plugin requires: it must take the
    // single-instance lock before anything can create a window. A second launch
    // focuses the running window instead of opening a second webview against the
    // same session cookie.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        // Native pickers for DICOM submission. Both commands open the dialog
        // themselves and grant read access only to what the user chose.
        .plugin(tauri_plugin_dialog::init())
        // Native toasts. Message content is chosen by the frontend from a
        // PHI-free label, never from a server-supplied patient string.
        .plugin(tauri_plugin_notification::init())
        // Scoped reads for the picked paths only. There is deliberately no
        // blanket filesystem scope: see src/file_select.rs.
        .plugin(tauri_plugin_fs::init())
        // OS name/version for desktop crash reports.
        .plugin(tauri_plugin_os::init())
        // Signed self-update. Inert until a release build supplies an endpoint
        // and minisign key through `--config`; the frontend treats a
        // configuration error as "updates unavailable" rather than as a fault.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_viewer_window,
            pick_dicom_files,
            pick_dicom_folder,
            collect_dicom_folder,
            release_picked_paths
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let config_dir = handle.path().app_config_dir().ok();
            let resolution = resolve(
                std::env::var(ENV_VAR).ok().as_deref(),
                config_dir.as_deref(),
                option_env!("AXIS_DESKTOP_SERVER_URL"),
                cfg!(debug_assertions),
            );
            report(&resolution);

            // Both callbacks need their own copy: each `move` closure takes
            // ownership, so a single binding cannot be shared.
            let navigation_deployment = resolution.url.clone();
            let popup_deployment = resolution.url.clone();
            let navigation_handle = handle.clone();
            let popup_handle = handle.clone();

            let window =
                WebviewWindowBuilder::new(&handle, MAIN_WINDOW, WebviewUrl::App(SPLASH.into()))
                    .title(WINDOW_TITLE)
                    .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
                    .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
                    .resizable(true)
                    .center()
                    .initialization_script(initialization_script(
                        resolution.url.as_ref().map(ServerUrl::as_str),
                    ))
                    // Anything the deployment links to off-origin leaves the app and
                    // opens in the system browser instead of replacing the PACS.
                    .on_navigation(move |url| {
                        if navigation_allowed(url, navigation_deployment.as_ref()) {
                            return true;
                        }
                        if is_external_http(url) {
                            let _ = navigation_handle
                                .opener()
                                .open_url(url.as_str(), None::<String>);
                        }
                        false
                    })
                    // Popups (`target="_blank"`, e.g. "Open in new tab" in the viewer
                    // error state) may only ever be same-origin with the deployment.
                    .on_new_window(move |url, _features| {
                        if navigation_allowed(&url, popup_deployment.as_ref()) {
                            return NewWindowResponse::Allow;
                        }
                        if is_external_http(&url) {
                            let _ = popup_handle.opener().open_url(url.as_str(), None::<String>);
                        }
                        NewWindowResponse::Deny
                    })
                    .build()
                    .map_err(to_boxed_error)?;

            if let Some(deployment) = resolution.url.as_ref() {
                // parse() already guaranteed this, so a failure here means the
                // url crate disagrees with our parser: refuse loudly rather
                // than leaving the splash up with no explanation.
                let url = Url::parse(deployment.as_str()).map_err(to_boxed_error)?;
                window.navigate(url).map_err(to_boxed_error)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Axis desktop client");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).unwrap()
    }

    #[test]
    fn navigation_is_pinned_to_the_deployment() {
        let deployment = ServerUrl::parse("https://pacs.example.org").unwrap();

        assert!(navigation_allowed(
            &url("https://pacs.example.org/login"),
            Some(&deployment)
        ));
        assert!(navigation_allowed(
            &url("https://pacs.example.org/reading/1.2.3"),
            Some(&deployment)
        ));
        // The viewer is proxied through the same origin.
        assert!(navigation_allowed(
            &url("https://pacs.example.org/ohif/viewer"),
            Some(&deployment)
        ));

        // Off-origin, other scheme, other port: all refused.
        assert!(!navigation_allowed(
            &url("https://evil.example.org/"),
            Some(&deployment)
        ));
        assert!(!navigation_allowed(
            &url("http://pacs.example.org/login"),
            Some(&deployment)
        ));
        assert!(!navigation_allowed(
            &url("https://pacs.example.org:8443/login"),
            Some(&deployment)
        ));
        assert!(!navigation_allowed(
            &url("file:///C:/Windows/System32"),
            Some(&deployment)
        ));
    }

    #[test]
    fn bundled_splash_is_always_allowed() {
        assert!(navigation_allowed(
            &url("tauri://localhost/index.html"),
            None
        ));
        assert!(navigation_allowed(
            &url("tauri://localhost/index.html"),
            Some(&ServerUrl::parse("https://pacs.example.org").unwrap())
        ));
    }

    #[test]
    fn viewer_url_uses_only_the_configured_origin_and_encodes_the_study_uid() {
        let deployment = ServerUrl::parse("https://pacs.example.org").unwrap();
        let url = build_viewer_url(&deployment, "1.2.840.10008.5.1").unwrap();

        assert_eq!(
            url.origin().ascii_serialization(),
            "https://pacs.example.org"
        );
        assert_eq!(url.path(), "/ohif/viewer");
        assert_eq!(url.query(), Some("StudyInstanceUIDs=1.2.840.10008.5.1"));
    }

    #[test]
    fn viewer_url_rejects_non_uid_input() {
        let deployment = ServerUrl::parse("https://pacs.example.org").unwrap();
        for invalid in ["", "../login", "1.2.3&url=https://evil.example", "1..2"] {
            assert!(build_viewer_url(&deployment, invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn unconfigured_shell_shows_only_the_splash() {
        assert!(!navigation_allowed(&url("https://pacs.example.org/"), None));
        assert!(!navigation_allowed(&url("https://evil.example.org/"), None));
    }

    #[test]
    fn same_origin_compares_scheme_and_authority_only() {
        assert!(same_origin("https://a.example/x", "https://a.example/y"));
        assert!(!same_origin("https://a.example", "https://b.example"));
        assert!(!same_origin("https://a.example", "http://a.example"));
        assert!(!same_origin("https://a.example", "https://a.example:8443"));
    }

    #[test]
    fn initialization_script_embeds_the_url_safely() {
        let script = initialization_script(Some("https://pacs.example.org"));
        assert!(script.contains("'https://pacs.example.org'"));
        assert!(script.contains("Object.freeze"));

        // A quote in the value must not be able to terminate the literal.
        let script = initialization_script(Some("https://x.example/'; alert(1); //"));
        assert!(script.contains("\\'"), "{script}");

        // Unconfigured: null, not the string "null".
        let script = initialization_script(None);
        assert!(script.contains("serverUrl: null"), "{script}");
    }

    #[test]
    fn only_http_urls_are_handed_to_the_system_browser() {
        assert!(is_external_http(&url("https://pacs.example.org")));
        assert!(is_external_http(&url("http://pacs.example.org")));
        assert!(!is_external_http(&url("file:///C:/Windows/System32")));
        assert!(!is_external_http(&url("javascript:alert(1)")));
        assert!(!is_external_http(&url("mailto:admin@example.org")));
    }
}
