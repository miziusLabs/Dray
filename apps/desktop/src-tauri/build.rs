fn main() {
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("windows-gnu")) {
        use_short_resource_path();
    }
    tauri_build::build();
    // Make Tauri's resource object available to the library test executable.
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("windows-gnu")) {
        let out = std::env::var("OUT_DIR").unwrap();
        println!("cargo:rustc-link-search=native={out}");
    }
}

#[cfg(windows)]
fn use_short_resource_path() {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    #[link(name = "kernel32")]
    extern "system" {
        fn GetShortPathNameW(long: *const u16, short: *mut u16, length: u32) -> u32;
    }

    // windres passes its include directory to gcc without quoting spaces.
    // Only change this build script's environment; Cargo keeps its original path.
    let out = std::env::var_os("OUT_DIR").expect("missing OUT_DIR");
    let wide: Vec<_> = out.encode_wide().chain(Some(0)).collect();
    let length = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if length == 0 {
        return;
    }
    let mut short = vec![0; length as usize];
    let written = unsafe { GetShortPathNameW(wide.as_ptr(), short.as_mut_ptr(), length) };
    if written > 0 && written < length {
        std::env::set_var(
            "OUT_DIR",
            std::ffi::OsString::from_wide(&short[..written as usize]),
        );
    }
}

#[cfg(not(windows))]
fn use_short_resource_path() {}
