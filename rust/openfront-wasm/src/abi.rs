#[unsafe(no_mangle)]
pub extern "C" fn openfront_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_last_error() -> u32 {
    LAST_ERROR.with(Cell::get)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_invalid_result() -> u32 {
    INVALID_RESULT
}
