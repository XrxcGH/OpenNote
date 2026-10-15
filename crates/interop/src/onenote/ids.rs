//! The JCID and PropertyID values this reader uses, as [MS-ONE] 2.1.12 and 2.2 list them.

/// The `index` of a JCID ([MS-ONESTORE] 2.6.14): its low 16 bits, which name the type of object.
pub(crate) const fn idx(jcid: u32) -> u32 {
    jcid & 0xFFFF
}

/// JCID values ([MS-ONE] 2.2). Readers compare the low 16 bits, the `index` of [MS-ONESTORE] 2.6.14.
pub(crate) mod jcid {
    pub(crate) const SECTION: u32 = 0x0006_0007;
    pub(crate) const PAGE_SERIES: u32 = 0x0006_0008;
    pub(crate) const PAGE: u32 = 0x0006_000B;
    pub(crate) const OUTLINE: u32 = 0x0006_000C;
    pub(crate) const OUTLINE_ELEMENT: u32 = 0x0006_000D;
    pub(crate) const RICH_TEXT: u32 = 0x0006_000E;
    pub(crate) const IMAGE: u32 = 0x0006_0011;
    pub(crate) const NUMBER_LIST: u32 = 0x0006_0012;
    pub(crate) const OUTLINE_GROUP: u32 = 0x0006_0019;
    pub(crate) const TABLE: u32 = 0x0006_0022;
    pub(crate) const TABLE_ROW: u32 = 0x0006_0023;
    pub(crate) const TABLE_CELL: u32 = 0x0006_0024;
    pub(crate) const TITLE: u32 = 0x0006_002C;
    pub(crate) const PAGE_META_DATA: u32 = 0x0002_0030;
    pub(crate) const SECTION_META_DATA: u32 = 0x0002_0031;
    pub(crate) const EMBEDDED_FILE: u32 = 0x0006_0035;
    pub(crate) const EMBEDDED_FILE_CONTAINER: u32 = 0x0008_0036;
    pub(crate) const PAGE_MANIFEST: u32 = 0x0006_0037;
    pub(crate) const PICTURE_CONTAINER: u32 = 0x0008_0039;
    pub(crate) const NOTE_TAG_DEFINITION: u32 = 0x0012_0043;
    pub(crate) const PARAGRAPH_STYLE: u32 = 0x0012_004D;
}

/// PropertyID values ([MS-ONE] 2.1.12). Readers compare the 26-bit `id`, see [`super::props::pid`].
pub(crate) mod prop {
    pub(crate) const BOLD: u32 = 0x0800_1C04;
    pub(crate) const ITALIC: u32 = 0x0800_1C05;
    pub(crate) const UNDERLINE: u32 = 0x0800_1C06;
    pub(crate) const STRIKETHROUGH: u32 = 0x0800_1C07;
    pub(crate) const SUPERSCRIPT: u32 = 0x0800_1C08;
    pub(crate) const SUBSCRIPT: u32 = 0x0800_1C09;
    pub(crate) const OFFSET_FROM_PARENT_HORIZ: u32 = 0x1400_1C14;
    pub(crate) const OFFSET_FROM_PARENT_VERT: u32 = 0x1400_1C15;
    pub(crate) const NUMBER_LIST_FORMAT: u32 = 0x1C00_1C1A;
    pub(crate) const CONTENT_CHILD_NODES: u32 = 0x2400_1C1F;
    pub(crate) const ELEMENT_CHILD_NODES: u32 = 0x2400_1C20;
    pub(crate) const RICH_EDIT_TEXT_UNICODE: u32 = 0x1C00_1C22;
    pub(crate) const LIST_NODES: u32 = 0x2400_1C26;
    pub(crate) const PICTURE_CONTAINER: u32 = 0x2000_1C3F;
    pub(crate) const TOPOLOGY_CREATION_TIME_STAMP: u32 = 0x1800_1C65;
    pub(crate) const IS_TITLE_TEXT: u32 = 0x0800_1CB4;
    pub(crate) const CACHED_TITLE_STRING: u32 = 0x1C00_1CF3;
    pub(crate) const CACHED_TITLE_STRING_FROM_PAGE: u32 = 0x1C00_1D3C;
    pub(crate) const STRUCTURE_ELEMENT_CHILD_NODES: u32 = 0x2400_1D5F;
    pub(crate) const CHILD_GRAPH_SPACE_ELEMENT_NODES: u32 = 0x2C00_1D63;
    pub(crate) const LAST_MODIFIED_TIME: u32 = 0x1400_1D7A;
    pub(crate) const EMBEDDED_FILE_CONTAINER: u32 = 0x2000_1D9B;
    pub(crate) const EMBEDDED_FILE_NAME: u32 = 0x1C00_1D9C;
    pub(crate) const IMAGE_FILENAME: u32 = 0x1C00_1DD7;
    pub(crate) const PAGE_LEVEL: u32 = 0x1400_1DFF;
    pub(crate) const TEXT_RUN_INDEX: u32 = 0x1C00_1E12;
    pub(crate) const TEXT_RUN_FORMATTING: u32 = 0x2400_1E13;
    pub(crate) const HYPERLINK: u32 = 0x0800_1E14;
    pub(crate) const IMAGE_ALT_TEXT: u32 = 0x1C00_1E58;
    pub(crate) const PARAGRAPH_STYLE: u32 = 0x2000_342C;
    pub(crate) const PARAGRAPH_STYLE_ID: u32 = 0x1C00_345A;
    pub(crate) const NOTE_TAG_SHAPE: u32 = 0x1000_3464;
    pub(crate) const NOTE_TAG_LABEL: u32 = 0x1C00_3468;
    pub(crate) const ACTION_ITEM_STATUS: u32 = 0x1000_3470;
    pub(crate) const NOTE_TAG_DEFINITION_OID: u32 = 0x2000_3488;
    /// [MS-ONE] 2.1.12 prints 0x04003489, whose type bits say NoData, while 2.2.88 describes an
    /// ArrayOfPropertyValues. Matching on the `id` alone reads it either way.
    pub(crate) const NOTE_TAG_STATES: u32 = 0x0400_3489;
    pub(crate) const TEXT_EXTENDED_ASCII: u32 = 0x1C00_3498;
}
