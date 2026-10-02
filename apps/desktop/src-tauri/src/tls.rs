use std::sync::OnceLock;

/// Install Rustls' ring provider before any reqwest client is constructed.
pub(crate) fn initialize() {
    static INITIALIZED: OnceLock<()> = OnceLock::new();
    INITIALIZED.get_or_init(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            // Another concurrent caller may install it first; in that case the
            // provider is already available to reqwest.
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
    });
}
