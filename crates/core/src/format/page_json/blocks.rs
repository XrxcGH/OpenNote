//! Blocks in `page.json` (spec 6.1, 6.2, and 6.5).

use std::sync::Arc;

use serde_json::Value;

use super::data::{read_data, write_data};
use super::view::named;
use crate::error::FormatError;
use crate::format::json::{expect_object, Fields, Json, Obj};
use crate::model::{Block, Blocks, Fallback, Frame};

/// Reads the `blocks` array. Blocks with the same ID are an error: the model can't hold both.
pub fn read_blocks(items: Vec<Value>) -> Result<Blocks, FormatError> {
    let mut blocks = Blocks::new();
    for (index, item) in items.into_iter().enumerate() {
        let block = read_block(item, index)?;
        let id = block.id;
        blocks.insert(Arc::new(block)).map_err(|_| {
            let detail = format!("page.blocks[{index}]: the block ID {id} is used twice");
            FormatError::new(crate::error::FormatErrorKind::Validation, detail)
        })?;
    }
    Ok(blocks)
}

fn read_block(value: Value, index: usize) -> Result<Block, FormatError> {
    let mut fields = Fields::new(value, format_args!("page.blocks[{index}]"))?;
    let id = fields.id("id")?;
    let type_name = fields.str("type")?;
    let order = fields.order("order")?;
    let frame = fields.take("frame").map(read_frame).transpose()?;
    let lock = fields.named("lock")?;
    let created = fields.time("created")?;
    let modified = fields.time("modified")?;
    let data = expect_object(fields.required("data")?, format_args!("page.blocks[{index}].data"))?;
    let fallback = fields.take("fallback").map(read_fallback).transpose()?;
    Ok(Block {
        id,
        order,
        frame,
        lock,
        created,
        modified,
        data: read_data(&type_name, data),
        fallback,
        extra: fields.rest(),
    })
}

fn read_frame(value: Value) -> Result<Frame, FormatError> {
    let mut fields = Fields::new(value, "frame")?;
    Ok(Frame {
        x: fields.opt_f64("x")?,
        y: fields.opt_f64("y")?,
        w: fields.opt_f64("w")?,
        h: fields.opt_f64("h")?,
        rotate: fields.opt_f64("rotate")?,
        extra: fields.rest(),
    })
}

fn read_fallback(value: Value) -> Result<Fallback, FormatError> {
    let mut fields = Fields::new(value, "fallback")?;
    Ok(Fallback {
        markdown: fields.str("markdown")?,
        image: fields.opt_id("image")?,
        extra: fields.rest(),
    })
}

/// Writes the blocks in order: by order key, then ID (spec 2.8).
pub fn write_blocks(blocks: &Blocks) -> Json<'_> {
    Json::Array(blocks.iter().map(|block| write_block(block)).collect())
}

fn write_block(block: &Block) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("id", Json::string(block.id.to_string()))
        .put("type", Json::str(block.type_name()))
        .put("order", Json::str(block.order.as_str()))
        .opt("frame", block.frame.as_ref().map(write_frame))
        .opt("lock", block.lock.as_ref().map(named))
        .put("created", Json::string(block.created.to_rfc3339()))
        .put("modified", Json::string(block.modified.to_rfc3339()))
        .put("data", write_data(&block.data))
        .opt("fallback", block.fallback.as_ref().map(write_fallback));
    obj.finish(&block.extra)
}

fn write_frame(frame: &Frame) -> Json<'_> {
    let mut obj = Obj::new();
    let parts = [
        ("x", frame.x),
        ("y", frame.y),
        ("w", frame.w),
        ("h", frame.h),
        ("rotate", frame.rotate),
    ];
    for (key, value) in parts {
        obj.opt(key, value.map(Json::Geometry));
    }
    obj.finish(&frame.extra)
}

fn write_fallback(fallback: &Fallback) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("markdown", Json::str(&fallback.markdown))
        .opt("image", fallback.image.map(|id| Json::string(id.to_string())));
    obj.finish(&fallback.extra)
}
