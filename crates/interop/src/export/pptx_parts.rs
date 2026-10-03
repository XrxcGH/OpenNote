//! The fixed parts of a PowerPoint file: the theme, the slide master, and one layout. Slides refer to them.

pub(super) const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub(super) const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub(super) const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
pub(super) const HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

/// An empty group shape, which starts every shape tree.
const GROUP: &str = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
    <p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/>\
    <a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>";

fn title_placeholder(prompt: &str) -> String {
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title 1\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>\
         <p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"548640\" y=\"365760\"/>\
         <a:ext cx=\"11094720\" cy=\"914400\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>\
         <p:txBody><a:bodyPr anchor=\"ctr\"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r>\
         <a:rPr lang=\"en-US\"/><a:t>{prompt}</a:t></a:r></a:p></p:txBody></p:sp>"
    )
}

pub(super) fn theme() -> String {
    let colors = [
        ("dk2", "2B2521"),
        ("lt2", "F6F1E8"),
        ("accent1", "2F4F9A"),
        ("accent2", "B0342A"),
        ("accent3", "2E7048"),
        ("accent4", "6A4A9C"),
        ("accent5", "B8620F"),
        ("accent6", "6E4B2E"),
        ("hlink", "2F4F9A"),
        ("folHlink", "6A4A9C"),
    ];
    let scheme: String = colors
        .iter()
        .map(|(name, hex)| format!("<a:{name}><a:srgbClr val=\"{hex}\"/></a:{name}>"))
        .collect();
    let fill = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
    let line = |w: u32| {
        format!("<a:ln w=\"{w}\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\">{fill}<a:prstDash val=\"solid\"/></a:ln>")
    };
    let effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
    let font = |tag: &str| {
        format!("<a:{tag}><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:{tag}>")
    };
    format!(
        "{HEADER}<a:theme xmlns:a=\"{NS_A}\" name=\"OpenNote\"><a:themeElements><a:clrScheme name=\"OpenNote\">\
         <a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>\
         {scheme}</a:clrScheme><a:fontScheme name=\"OpenNote\">{}{}</a:fontScheme>\
         <a:fmtScheme name=\"OpenNote\"><a:fillStyleLst>{fill}{fill}{fill}</a:fillStyleLst>\
         <a:lnStyleLst>{}{}{}</a:lnStyleLst><a:effectStyleLst>{effect}{effect}{effect}</a:effectStyleLst>\
         <a:bgFillStyleLst>{fill}{fill}{fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>",
        font("majorFont"),
        font("minorFont"),
        line(6350),
        line(12700),
        line(19050),
    )
}

pub(super) fn master() -> String {
    format!(
        "{HEADER}<p:sldMaster xmlns:a=\"{NS_A}\" xmlns:r=\"{NS_R}\" xmlns:p=\"{NS_P}\"><p:cSld><p:bg><p:bgRef idx=\"1001\">\
         <a:schemeClr val=\"bg1\"/></p:bgRef></p:bg><p:spTree>{GROUP}{}\
         <p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Text Placeholder 2\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>\
         <p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"548640\" y=\"1371600\"/>\
         <a:ext cx=\"11094720\" cy=\"4846320\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>\
         <p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl=\"0\"/><a:r><a:rPr lang=\"en-US\"/>\
         <a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>\
         <p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" \
         accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>\
         <p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>\
         <p:txStyles><p:titleStyle><a:lvl1pPr algn=\"l\"><a:defRPr sz=\"3200\" b=\"1\"><a:solidFill><a:schemeClr val=\"tx1\"/>\
         </a:solidFill><a:latin typeface=\"+mj-lt\"/></a:defRPr></a:lvl1pPr></p:titleStyle>\
         <p:bodyStyle><a:lvl1pPr marL=\"342900\" indent=\"-342900\" algn=\"l\"><a:buFont typeface=\"Arial\"/><a:buChar char=\"&#8226;\"/>\
         <a:defRPr sz=\"2000\"><a:solidFill><a:schemeClr val=\"tx1\"/></a:solidFill><a:latin typeface=\"+mn-lt\"/></a:defRPr>\
         </a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang=\"en-US\"/></a:defPPr></p:otherStyle></p:txStyles>\
         </p:sldMaster>",
        title_placeholder("Click to edit Master title style")
    )
}

pub(super) fn layout() -> String {
    format!(
        "{HEADER}<p:sldLayout xmlns:a=\"{NS_A}\" xmlns:r=\"{NS_R}\" xmlns:p=\"{NS_P}\" type=\"titleOnly\" preserve=\"1\">\
         <p:cSld name=\"Title Only\"><p:spTree>{GROUP}{}</p:spTree></p:cSld>\
         <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>",
        title_placeholder("Click to edit Master title style")
    )
}

pub(super) fn group() -> &'static str {
    GROUP
}
