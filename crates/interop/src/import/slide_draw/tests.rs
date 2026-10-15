//! Golden-image tests: three fixture decks are drawn and compared with the SVG files in
//! `tests/data/slides`. Set `OPENNOTE_UPDATE_GOLDEN=1` to write the files again after a deliberate change, and
//! look at them in a browser before committing.

// checks-disable-file length: fixture slide XML keeps each element on one line, as the decks write it

use std::io::Cursor;
use std::path::PathBuf;

use super::*;
use crate::testing::{assert_well_formed_xml, png_bytes, zip_bytes};

const NS: &str = r#"xmlns:a="a" xmlns:p="p" xmlns:r="r""#;

fn theme() -> String {
    r#"<a:theme xmlns:a="a"><a:themeElements>
      <a:clrScheme name="Fixture">
        <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
        <a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
        <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
        <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
        <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      </a:clrScheme>
      <a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
        <a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
      <a:fmtScheme name="Fixture"><a:fillStyleLst/>
        <a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst>
        <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
    </a:themeElements></a:theme>"#
        .to_owned()
}

fn master() -> String {
    format!(
        r#"<p:sldMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="228600"/></a:xfrm><a:prstGeom prst="rect"/>
            <a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr anchor="b"/><a:p><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:p><a:r><a:t>Master text</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld>
        <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
        <p:txStyles>
          <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
          <p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
            <a:lvl2pPr marL="685800" indent="-228600"><a:buChar char="&#8211;"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>
          <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
        </p:txStyles></p:sldMaster>"#
    )
}

fn layout() -> String {
    format!(
        r#"<p:sldLayout {NS}><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
            <p:txBody><a:bodyPr/><a:p><a:r><a:t>Layout title</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
        </p:spTree></p:cSld></p:sldLayout>"#
    )
}

const SHAPES: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
    <p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Shapes &amp; lines</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="Oval"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="1828800" cy="1371600"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
    <a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="4" name="Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm rot="900000"><a:off x="3657600" y="2286000"/><a:ext cx="2286000" cy="1371600"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>
    <a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent5"><a:alpha val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:spPr>
    <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>Turned card</a:t></a:r></a:p></p:txBody></p:sp>
  <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
    <p:spPr><a:xfrm flipV="1"><a:off x="6400800" y="2286000"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="straightConnector1"/>
    <a:ln w="19050"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
  <p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="914400" y="4572000"/><a:ext cx="3657600" cy="1371600"/><a:chOff x="0" y="0"/><a:chExt cx="7315200" cy="2743200"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="7" name="Tri"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="2743200"/></a:xfrm><a:prstGeom prst="triangle"/></p:spPr>
      <p:style><a:lnRef idx="2"><a:schemeClr val="accent6"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent6"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent6"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="8" name="Free"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm flipH="1"><a:off x="3657600" y="0"/><a:ext cx="3657600" cy="2743200"/></a:xfrm>
      <a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="40" y="0"/></a:lnTo>
        <a:cubicBezTo><a:pt x="60" y="0"/><a:pt x="100" y="40"/><a:pt x="100" y="100"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>
      <a:solidFill><a:srgbClr val="FFC000"/></a:solidFill></p:spPr></p:sp>
  </p:grpSp>
  <p:sp><p:nvSpPr><p:cNvPr id="9" name="Cloud"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="6400800" y="4114800"/><a:ext cx="2286000" cy="1600200"/></a:xfrm><a:prstGeom prst="cloud"/>
    <a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill><a:effectLst><a:outerShdw blurRad="40000"/></a:effectLst></p:spPr></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="10" name="Hidden" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld></p:sld>"#;

const TEXT: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
    <p:txBody><a:bodyPr/><a:p><a:r><a:t>Reading the cell</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="5181600" cy="4351338"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr><a:normAutofit fontScale="92500"/></a:bodyPr>
      <a:p><a:r><a:t>The membrane lets some things through and keeps others out, which is why it is called selectively permeable.</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Bold</a:t></a:r><a:r><a:t>, </a:t></a:r><a:r><a:rPr i="1"/><a:t>italic</a:t></a:r><a:r><a:t>, and </a:t></a:r><a:r><a:rPr u="sng"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:rPr><a:t>red underline</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1400" strike="sngStrike"/><a:t>No bullet, struck</a:t></a:r><a:br/><a:r><a:rPr sz="1400"/><a:t>after a break</a:t></a:r></a:p>
      <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>First</a:t></a:r></a:p>
      <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Second</a:t></a:r></a:p>
    </p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="4" name="Note"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="6400800" y="5943600"/><a:ext cx="4572000" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr>
    <p:txBody><a:bodyPr wrap="none" anchor="b"/><a:p><a:pPr algn="r"/><a:r><a:rPr sz="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="Georgia&quot; onload=&quot;x"/></a:rPr><a:t>Source: lab notes &lt;2024&gt;</a:t></a:r></a:p></p:txBody></p:sp>
  <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="6400800" y="1825625"/><a:ext cx="4572000" cy="1828800"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>
      <a:tblGrid><a:gridCol w="2286000"/><a:gridCol w="2286000"/></a:tblGrid>
      <a:tr h="609600"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Part</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Job</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="609600"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Nucleus</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Keeps DNA</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="609600"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>Both columns</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill></a:tcPr></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>"#;

const PICTURES: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r" xmlns:mc="mc" showMasterSp="0"><p:cSld>
  <p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="DEEBF7"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>
  <p:spTree>
  <p:pic><p:nvPicPr><p:cNvPr id="2" name="Leaf" descr="A leaf"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rIdPng"/><a:srcRect l="10000" t="10000" r="10000" b="10000"/><a:stretch/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="2743200"/></a:xfrm><a:prstGeom prst="ellipse"/>
    <a:ln w="12700"><a:solidFill><a:srgbClr val="70AD47"/></a:solidFill></a:ln></p:spPr></p:pic>
  <p:pic><p:nvPicPr><p:cNvPr id="3" name="Again"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rIdPng"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="4114800" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>
  <p:pic><p:nvPicPr><p:cNvPr id="4" name="Metafile"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rIdEmf"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="5486400" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>
  <p:pic><p:nvPicPr><p:cNvPr id="5" name="Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rIdPng"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="6858000" y="914400"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr></p:pic>
  <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="914400" y="4114800"/><a:ext cx="3657600" cy="2286000"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="c" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>
  <mc:AlternateContent><mc:Choice Requires="p14"><p:sp><p:nvSpPr><p:cNvPr id="7" name="New"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp></mc:Choice>
    <mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="8" name="Old"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="5486400" y="4114800"/><a:ext cx="2743200" cy="1371600"/></a:xfrm><a:prstGeom prst="rightArrow"/><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill></p:spPr></p:sp></mc:Fallback></mc:AlternateContent>
</p:spTree></p:cSld></p:sld>"#;

const PICTURE_RELS: &str = r#"<Relationships>
  <Relationship Id="rIdLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdPng" Target="../media/leaf.png"/>
  <Relationship Id="rIdEmf" Target="../media/logo.emf"/>
  <Relationship Id="rIdVideo" Target="https://example.invalid/clip.mp4" TargetMode="External"/>
  <Relationship Id="rIdChart" Target="../charts/chart1.xml"/></Relationships>"#;

const LAYOUT_ONLY: &str =
    r#"<Relationships><Relationship Id="rIdLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#;

fn deck(slide: &str, slide_rels: &str) -> Parts<Cursor<Vec<u8>>> {
    let presentation = format!(
        r#"<p:presentation {NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#
    );
    let master_rels = r#"<Relationships><Relationship Id="rId1" Target="../theme/theme1.xml"/></Relationships>"#;
    let layout_rels =
        r#"<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#;
    let (master, layout, theme) = (master(), layout(), theme());
    let png = png_bytes();
    let bytes = zip_bytes(&[
        ("ppt/presentation.xml", presentation.as_bytes()),
        ("ppt/slides/slide1.xml", slide.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", slide_rels.as_bytes()),
        ("ppt/slideLayouts/slideLayout1.xml", layout.as_bytes()),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layout_rels.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", master.as_bytes()),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels", master_rels.as_bytes()),
        ("ppt/theme/theme1.xml", theme.as_bytes()),
        ("ppt/media/leaf.png", &png),
        ("ppt/media/logo.emf", b"\x01\x00\x00\x00 not drawn"),
    ]);
    Parts::from_reader(Cursor::new(bytes)).expect("opens")
}

fn draw(slide: &str, rels: &str) -> Drawn {
    let mut parts = deck(slide, rels);
    let presentation = parts.xml("ppt/presentation.xml").expect("reads").expect("there");
    let slide = parts.xml("ppt/slides/slide1.xml").expect("reads").expect("there");
    let rels = parts
        .xml("ppt/slides/_rels/slide1.xml.rels")
        .expect("reads")
        .map(|r| read_rels(&r))
        .unwrap_or_default();
    SlideDrawer::new(&presentation).draw(&mut parts, &slide, &rels, "ppt/slides")
}

/// Compares a drawing with its golden file, or writes the file when asked to.
fn golden(name: &str, drawn: &Drawn) {
    assert_well_formed_xml(&drawn.svg);
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("tests/data/slides/{name}.svg"));
    // The golden file is the drawing with one element to a line, so a change reads well in a diff.
    let pretty = drawn.svg.replace("><", ">\n<") + "\n";
    if std::env::var_os("OPENNOTE_UPDATE_GOLDEN").is_some() {
        std::fs::create_dir_all(path.parent().expect("a folder")).expect("makes the folder");
        std::fs::write(&path, &pretty).expect("writes the golden file");
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("{} is missing; run with OPENNOTE_UPDATE_GOLDEN=1", path.display()))
        .replace("\r\n", "\n");
    assert!(expected == pretty, "{name} no longer matches {}", path.display());
}

#[test]
fn a_slide_of_shapes_matches_its_golden_image() {
    let drawn = draw(SHAPES, LAYOUT_ONLY);
    golden("shapes", &drawn);
    assert!((drawn.height - 405.0).abs() < 0.01);
    assert!(drawn.svg.contains(r##"fill="#4472c4""##), "the master's bar");
    assert!(drawn.svg.contains("Shapes &amp; lines"));
    assert!(!drawn.svg.contains("#ff0000"), "a hidden shape is not drawn");
    assert_eq!(
        drawn.missed,
        Missed {
            geometry: 1,
            effects: 1,
            ..Missed::default()
        }
    );
}

#[test]
fn a_slide_of_text_and_a_table_matches_its_golden_image() {
    let drawn = draw(TEXT, LAYOUT_ONLY);
    golden("text", &drawn);
    assert!(drawn.svg.contains(">1.<"), "numbered paragraphs");
    assert!(drawn.svg.contains('\u{2022}'), "the master's bullet");
    assert!(drawn.svg.contains("Source: lab notes &lt;2024&gt;"));
    assert!(!drawn.svg.contains("onload="), "a font name can't add an attribute");
    assert_eq!(drawn.missed, Missed::default());
}

#[test]
fn a_slide_of_pictures_matches_its_golden_image_and_lists_what_it_left_out() {
    let drawn = draw(PICTURES, PICTURE_RELS);
    golden("pictures", &drawn);
    assert_eq!(
        drawn.svg.matches("data:image/png;base64,").count(),
        1,
        "a picture is kept once"
    );
    assert!(
        !drawn.svg.contains("example.invalid"),
        "nothing outside the file is linked"
    );
    assert!(
        !drawn.svg.contains(r##"fill="#4472c4""##),
        "the master's shapes are hidden on this slide"
    );
    assert_eq!(
        drawn.missed,
        Missed {
            charts: 1,
            media: 1,
            pictures: 1,
            ..Missed::default()
        }
    );
}

#[test]
fn hostile_slides_stay_within_their_limits() {
    let mut deep = String::new();
    for _ in 0..100 {
        deep.push_str("<p:grpSp><p:grpSpPr/>");
    }
    for _ in 0..100 {
        deep.push_str("</p:grpSp>");
    }
    let mut many = String::new();
    for i in 0..6_000 {
        let _ = write!(
            many,
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="s"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9" cy="9"/></a:xfrm><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp>"#
        );
    }
    let slide = format!(r#"<p:sld {NS}><p:cSld><p:spTree>{deep}{many}</p:spTree></p:cSld></p:sld>"#);
    let drawn = draw(&slide, LAYOUT_ONLY);
    assert_well_formed_xml(&drawn.svg);
    assert!(drawn.missed.limits > 0);
    assert!(drawn.svg.matches("#00ff00").count() <= MAX_SHAPES);
}

#[test]
fn colors_and_names_are_read_as_powerpoint_reads_them() {
    let blue = Rgba::hex("4472C4").expect("a color");
    let (h, s, l) = blue.to_hsl();
    assert_eq!(Rgba::from_hsl(h, s, l * 0.75, 1.0).css(), "#2f5597");
    assert_eq!(Rgba::hex("zz0000"), None);
    assert_eq!(num(1.004), "1");
    assert_eq!(num(-0.001), "0");
    assert_eq!(font_name("Georgia\" onload=\"x"), Some("Georgia onloadx".to_owned()));
}
