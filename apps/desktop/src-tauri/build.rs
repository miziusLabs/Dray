fn main() {
    tauri_build::build();
    // Make Tauri's resource object available to the library test executable.
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("windows-gnu")) {
        let out = std::env::var("OUT_DIR").unwrap();
        println!("cargo:rustc-link-search=native={out}");
    }
}
