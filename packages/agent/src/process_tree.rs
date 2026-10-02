//! Scoped process trees: interruption cannot leave descendant commands running.
use anyhow::{Context, Result};
use tokio::process::Child;

#[cfg(windows)]
pub struct ProcessTree {
    handle: usize,
}
#[cfg(windows)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, HANDLE},
            System::JobObjects::*,
        };
        let process = child
            .raw_handle()
            .context("child process handle unavailable")?;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&limits) as u32,
            ) != 0
                && AssignProcessToJobObject(handle, process as HANDLE) != 0
        };
        if !ok {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(error.into());
        }
        Ok(Self {
            handle: handle as usize,
        })
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle as _);
        }
    }
}

#[cfg(unix)]
pub struct ProcessTree {
    pid: i32,
}
#[cfg(unix)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self> {
        Ok(Self {
            pid: child
                .id()
                .context("child exited before process group setup")? as i32,
        })
    }
}
#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-self.pid, libc::SIGKILL);
        }
    }
}
