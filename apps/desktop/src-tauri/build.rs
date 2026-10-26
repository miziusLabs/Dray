fn main() {
    // `analytics.rs` reads this through `option_env!`, which is resolved at
    // compile time — without the declaration, a key exported after the first
    // build stays baked in as absent until something else forces a rebuild.
    println!("cargo:rerun-if-env-changed=POSTHOG_KEY");
    println!("cargo:rerun-if-env-changed=POSTHOG_HOST");

    #[cfg(feature = "desktop")]
    desktop();

    // GNU ld gives every exported symbol an ordinal, and a Windows DLL runs out
    // of them at 65,535 — this crate's own `cdylib` has more than that, so
    // linking it fails with `export ordinal too large`. Nothing on Windows loads
    // that library (the app is a binary, and the `cdylib` exists for mobile),
    // so its export table can be empty here.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,--exclude-all-symbols");
    }
}

/// `tauri build`'s Windows resource step, with the application manifest moved out
/// of the binary-only resource and into [`link_app_manifest`].
#[cfg(feature = "desktop")]
fn desktop() {
    // The manifest is linked through `/MANIFESTINPUT`, which only MSVC's linker
    // understands. A `windows-gnu` build keeps Tauri's own arrangement: the
    // manifest travels inside the `.rc` resource, for the binary alone.
    let msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");

    let windows = if msvc {
        tauri_build::WindowsAttributes::new_without_app_manifest()
    } else {
        tauri_build::WindowsAttributes::new()
    };

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");

    if msvc {
        link_app_manifest();
    }
}

/// Embeds the application manifest in every linkable target, not only the binary.
///
/// Tauri's resource step passes its manifest through `cargo:rustc-link-arg-bins`,
/// so `cargo test`'s harness is built without one — and Tauri imports
/// `TaskDialogIndirect`, which only Common Controls *v6* exports. Without the
/// manifest the loader binds the v5 `comctl32.dll`, so the test process dies
/// before `main` with `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139). Cargo has no
/// key for "binaries and tests but not cdylibs", so the manifest goes to every
/// linkable target; the `.rc` manifest is switched off in `desktop` above so no
/// target carries two. See [tauri-apps/tauri#14580].
///
/// [tauri-apps/tauri#14580]: https://github.com/tauri-apps/tauri/issues/14580
fn link_app_manifest() {
    let manifest =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows/app.manifest");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}
