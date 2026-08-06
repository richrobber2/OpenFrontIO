#[unsafe(no_mangle)]
pub extern "C" fn openfront_upload_create(length: u32) -> u32 {
    begin_call();
    UPLOADS.with(|uploads| insert_slot(&mut uploads.borrow_mut(), vec![0; length as usize]))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_upload_destroy(handle: u32) -> u32 {
    begin_call();
    let removed = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        remove_slot(uploads.as_mut_slice(), handle)
    });
    if removed {
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_upload_ptr(handle: u32) -> u32 {
    begin_call();
    let pointer = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        let index = slot_index(handle)?;
        Some(uploads.get_mut(index)?.as_mut()?.as_mut_ptr() as usize as u32)
    });

    pointer.unwrap_or_else(|| {
        fail(ErrorCode::InvalidHandle);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_upload_len(handle: u32) -> u32 {
    begin_call();
    let length = UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let index = slot_index(handle)?;
        Some(uploads.get(index)?.as_ref()?.len() as u32)
    });

    length.unwrap_or_else(|| {
        fail(ErrorCode::InvalidHandle);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_upload_set(handle: u32, index: u32, value: u32) -> u32 {
    begin_call();
    let updated = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        let slot = slot_index(handle)?;
        let upload = uploads.get_mut(slot)?.as_mut()?;
        *upload.get_mut(index as usize)? = value as u8;
        Some(())
    });

    if updated.is_some() {
        1
    } else {
        fail(ErrorCode::InvalidBufferIndex);
        0
    }
}
