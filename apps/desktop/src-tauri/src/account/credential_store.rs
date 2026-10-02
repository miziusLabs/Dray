//! Windows credentials are limited to 2560 bytes after UTF-16 encoding.
//! Publish a small manifest only after all parts of a new generation are saved.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const ROOT: &str = "account";
const PREFIX: &str = "dray-chunks-v1:";
// A UTF-8 byte bound also bounds UTF-16 code units, leaving ample headroom.
const PART_SIZE: usize = 1000;

pub(super) trait Store {
    fn read(&self, name: &str) -> Result<Option<String>>;
    fn write(&self, name: &str, value: &str) -> Result<()>;
    fn delete(&self, name: &str) -> Result<()>;
}

#[cfg(windows)]
pub(super) struct NativeStore;

#[cfg(windows)]
impl Store for NativeStore {
    fn read(&self, name: &str) -> Result<Option<String>> {
        match keyring::Entry::new(super::credential_service(), name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn write(&self, name: &str, value: &str) -> Result<()> {
        Ok(keyring::Entry::new(super::credential_service(), name)?.set_password(value)?)
    }

    fn delete(&self, name: &str) -> Result<()> {
        match keyring::Entry::new(super::credential_service(), name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    generation: String,
    parts: usize,
}

impl Manifest {
    fn parse(value: &str) -> Result<Option<Self>> {
        let Some(json) = value.strip_prefix(PREFIX) else {
            return Ok(None);
        };
        let manifest: Self = serde_json::from_str(json)?;
        uuid::Uuid::parse_str(&manifest.generation)?;
        if manifest.parts == 0 || manifest.parts > 1024 {
            bail!("Invalid ChatGPT credential part count");
        }
        Ok(Some(manifest))
    }

    fn name(&self, part: usize) -> String {
        format!("account-{}-{part}", self.generation)
    }

    fn cleanup(&self, store: &impl Store) {
        for part in 0..self.parts {
            // Cleanup must not turn a successfully published save into a failure.
            let _ = store.delete(&self.name(part));
        }
    }
}

pub(super) fn load(store: &impl Store) -> Result<Option<String>> {
    let Some(root) = store.read(ROOT)? else {
        return Ok(None);
    };
    let Some(manifest) = Manifest::parse(&root)? else {
        // Existing single-entry credentials remain readable until the next save.
        return Ok(Some(root));
    };
    let mut value = String::new();
    for part in 0..manifest.parts {
        value.push_str(
            &store
                .read(&manifest.name(part))?
                .context("Saved ChatGPT credentials are incomplete. Reconnect in Settings.")?,
        );
    }
    Ok(Some(value))
}

pub(super) fn store(store: &impl Store, value: Option<&str>) -> Result<()> {
    let previous = store
        .read(ROOT)?
        .as_deref()
        .map(Manifest::parse)
        .transpose()?
        .flatten();
    if let Some(mut value) = value {
        let mut parts = Vec::new();
        while !value.is_empty() {
            let mut end = value.len().min(PART_SIZE);
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            parts.push(&value[..end]);
            value = &value[end..];
        }
        if parts.is_empty() || parts.len() > 1024 {
            bail!("Invalid ChatGPT credential size");
        }
        let manifest = Manifest {
            generation: uuid::Uuid::new_v4().to_string(),
            parts: parts.len(),
        };
        let result = (|| {
            for (part, value) in parts.iter().enumerate() {
                store.write(&manifest.name(part), value)?;
            }
            store.write(
                ROOT,
                &format!("{PREFIX}{}", serde_json::to_string(&manifest)?),
            )
        })();
        if let Err(error) = result {
            manifest.cleanup(store);
            return Err(error);
        }
    } else {
        store.delete(ROOT)?;
    }
    if let Some(previous) = previous {
        previous.cleanup(store);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[derive(Default)]
    struct MemoryStore {
        values: RefCell<HashMap<String, String>>,
        fail_after: RefCell<Option<usize>>,
    }

    impl Store for MemoryStore {
        fn read(&self, name: &str) -> Result<Option<String>> {
            Ok(self.values.borrow().get(name).cloned())
        }
        fn write(&self, name: &str, value: &str) -> Result<()> {
            assert!(value.encode_utf16().count() * 2 <= 2560);
            if let Some(remaining) = self.fail_after.borrow_mut().as_mut() {
                if *remaining == 0 {
                    bail!("Injected write failure");
                }
                *remaining -= 1;
            }
            self.values.borrow_mut().insert(name.into(), value.into());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<()> {
            self.values.borrow_mut().remove(name);
            Ok(())
        }
    }

    #[test]
    fn oversized_credentials_round_trip_and_replace_legacy() {
        let backend = MemoryStore::default();
        backend.write(ROOT, "legacy").unwrap();
        assert_eq!(load(&backend).unwrap().as_deref(), Some("legacy"));
        let value = format!("{}{}", "token".repeat(3000), "🦀é".repeat(1000));
        store(&backend, Some(&value)).unwrap();
        assert_eq!(load(&backend).unwrap().as_deref(), Some(value.as_str()));
        store(&backend, Some("replacement")).unwrap();
        assert_eq!(load(&backend).unwrap().as_deref(), Some("replacement"));
        assert_eq!(backend.values.borrow().len(), 2);
        store(&backend, None).unwrap();
        assert!(load(&backend).unwrap().is_none());
        assert!(backend.values.borrow().is_empty());
    }

    #[test]
    fn failed_save_preserves_previous_credentials() {
        // Fail both during part writes and when publishing the manifest.
        for writes in [1, 3] {
            let backend = MemoryStore::default();
            store(&backend, Some("previous")).unwrap();
            *backend.fail_after.borrow_mut() = Some(writes);
            assert!(store(&backend, Some(&"x".repeat(3000))).is_err());
            assert_eq!(load(&backend).unwrap().as_deref(), Some("previous"));
            assert_eq!(backend.values.borrow().len(), 2);
        }
    }

    #[test]
    fn missing_part_is_reported() {
        let backend = MemoryStore::default();
        store(&backend, Some(&"x".repeat(3000))).unwrap();
        let manifest = Manifest::parse(&backend.read(ROOT).unwrap().unwrap())
            .unwrap()
            .unwrap();
        backend.delete(&manifest.name(1)).unwrap();
        assert!(load(&backend).is_err());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "writes isolated temporary entries to Windows Credential Manager"]
    fn native_windows_credentials_round_trip() {
        struct IsolatedStore(String, RefCell<Vec<String>>);
        impl Store for IsolatedStore {
            fn read(&self, name: &str) -> Result<Option<String>> {
                NativeStore.read(&format!("{}-{name}", self.0))
            }
            fn write(&self, name: &str, value: &str) -> Result<()> {
                self.1.borrow_mut().push(name.into());
                NativeStore.write(&format!("{}-{name}", self.0), value)
            }
            fn delete(&self, name: &str) -> Result<()> {
                NativeStore.delete(&format!("{}-{name}", self.0))
            }
        }
        impl Drop for IsolatedStore {
            fn drop(&mut self) {
                for name in self.1.borrow().iter() {
                    let _ = self.delete(name);
                }
            }
        }
        let backend = IsolatedStore(
            format!("test-{}", uuid::Uuid::new_v4()),
            RefCell::new(Vec::new()),
        );
        let value = "synthetic-token-🦀".repeat(1500);
        store(&backend, Some(&value)).unwrap();
        assert_eq!(load(&backend).unwrap().as_deref(), Some(value.as_str()));
        store(&backend, Some("refreshed")).unwrap();
        assert_eq!(load(&backend).unwrap().as_deref(), Some("refreshed"));
        store(&backend, None).unwrap();
        assert!(load(&backend).unwrap().is_none());
        for name in backend.1.borrow().iter() {
            assert!(backend.read(name).unwrap().is_none());
        }
    }
}
